import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiNotFoundError,
  AiTurnConflictError,
  AiUnsupportedOperationError,
  normalizeInteraction,
  publicAiError,
  validateInteractionResponse,
} from './contracts.mjs';

function sessionKey(provider, sessionId) {
  return `${provider}\u0000${sessionId}`;
}

function publicFailure(error) {
  const normalized = publicAiError(error);
  return { code: normalized.code, message: normalized.message };
}

export class AiTurnRuntime {
  #turns = new Map();
  #activeBySession = new Map();
  #terminalOrder = [];
  #closed = false;

  constructor({
    registry,
    maxEventsPerTurn = 250,
    maxRetainedTurns = 100,
    idFactory = randomUUID,
    clock = () => new Date(),
  } = {}) {
    this.registry = registry;
    this.maxEventsPerTurn = maxEventsPerTurn;
    this.maxRetainedTurns = maxRetainedTurns;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  async startTurn({ provider, sessionId, message, idempotencyKey } = {}) {
    if (this.#closed) throw new AiError('AI_RUNTIME_CLOSED', 'The AI turn runtime is shut down.', { status: 503 });
    const adapter = this.registry.require(provider, 'startTurn', 'startTurn');
    const key = sessionKey(provider, sessionId);
    const existingId = this.#activeBySession.get(key);
    if (existingId) {
      const existing = this.#turns.get(existingId);
      if (idempotencyKey && existing?.idempotencyKey === idempotencyKey) {
        return { turnId: existingId, idempotent: true };
      }
      throw new AiTurnConflictError(existingId);
    }
    const metadataAdapter = this.registry.require(provider, 'sessionMetadata', 'getSession');
    const session = await metadataAdapter.getSession(sessionId);
    if (session.status === 'completed') {
      throw new AiUnsupportedOperationError(provider, 'resumeTurn');
    }
    if (typeof message !== 'string' || message.trim().length === 0 || message.length > 100_000) {
      throw new AiError('AI_VALIDATION_ERROR', 'A non-empty message is required.', { status: 400 });
    }
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
      throw new AiError('AI_VALIDATION_ERROR', 'The idempotency key is invalid.', { status: 400 });
    }

    const turnId = `turn-${this.idFactory()}`;
    const state = {
      turnId,
      provider,
      sessionId,
      key,
      idempotencyKey,
      status: 'running',
      sessionStatus: 'running',
      sequence: 0,
      events: [],
      subscribers: new Set(),
      pendingInteraction: null,
      abortController: new AbortController(),
      adapter,
      privateOperation: undefined,
      startedAt: this.#timestamp(),
      completedAt: undefined,
    };
    this.#turns.set(turnId, state);
    this.#activeBySession.set(key, turnId);
    this.#notifyAdapterState(state);
    this.#emit(state, 'turn.started');
    queueMicrotask(() => this.#run(state, message));
    return { turnId, idempotent: false };
  }

  async #run(state, message) {
    try {
      const result = await state.adapter.startTurn({
        turnId: state.turnId,
        sessionId: state.sessionId,
        message,
        signal: state.abortController.signal,
        setOperation: operation => { state.privateOperation = operation; },
        emitDelta: (delta, messageId) => this.#emitDelta(state, delta, messageId),
        requestInteraction: interaction => this.#requestInteraction(state, interaction),
      });
      if (result?.operation !== undefined) state.privateOperation = result.operation;
      if (!this.#isTerminal(state)) this.#finish(state, 'turn.completed');
    } catch (error) {
      if (!this.#isTerminal(state)) this.#finish(state, 'turn.failed', error);
    }
  }

  #emitDelta(state, delta, messageId = `message-${state.turnId}`) {
    if (this.#isTerminal(state)) return;
    if (typeof delta !== 'string' || delta.length === 0 || delta.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid message delta.', { status: 502 });
    }
    this.#emit(state, 'message.delta', { messageId, delta });
  }

  #requestInteraction(state, value) {
    if (this.#isTerminal(state)) throw new AiError('AI_TURN_TERMINAL', 'The turn is already terminal.', { status: 409 });
    if (state.pendingInteraction) throw new AiError('AI_INTERACTION_PENDING', 'The turn already has a pending interaction.', { status: 409 });
    const neutral = {
      ...value,
      id: undefined,
      ...(Array.isArray(value?.questions)
        ? { questions: value.questions.map(question => ({ ...question, id: undefined })) }
        : {}),
    };
    const interaction = normalizeInteraction(neutral, {
      assignIds: true,
      idFactory: () => this.idFactory(),
    });
    state.status = 'waitingForUser';
    state.sessionStatus = 'waitingForUser';
    this.#notifyAdapterState(state);
    this.#emit(state, 'interaction.requested', { interaction });
    return new Promise((resolve, reject) => {
      state.pendingInteraction = { interaction, resolve, reject };
    });
  }

  async resolveInteraction(turnId, interactionId, response) {
    const state = this.#get(turnId);
    const pending = state.pendingInteraction;
    if (!pending || pending.interaction.id !== interactionId) {
      throw new AiNotFoundError('The pending interaction was not found for this turn.', { turnId, interactionId });
    }
    const normalized = validateInteractionResponse(pending.interaction, response);
    state.pendingInteraction = null;
    state.status = 'running';
    state.sessionStatus = 'running';
    this.#notifyAdapterState(state);
    this.#emit(state, 'interaction.resolved', { interactionId });
    pending.resolve(normalized);
    return this.getSnapshot(turnId);
  }

  async cancelTurn(turnId) {
    const state = this.#get(turnId);
    if (this.#isTerminal(state)) return this.getSnapshot(turnId);
    const adapter = this.registry.require(state.provider, 'cancelTurn', 'cancelTurn');
    await adapter.cancelTurn({
      turnId,
      sessionId: state.sessionId,
      operation: state.privateOperation,
    });
    state.abortController.abort();
    this.#finish(state, 'turn.failed', new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 }));
    return this.getSnapshot(turnId);
  }

  getSnapshot(turnId) {
    const state = this.#get(turnId);
    return {
      turnId: state.turnId,
      provider: state.provider,
      sessionId: state.sessionId,
      status: state.status,
      sessionStatus: state.sessionStatus,
      startedAt: state.startedAt,
      ...(state.completedAt ? { completedAt: state.completedAt } : {}),
      lastEventId: state.sequence,
      pendingInteraction: state.pendingInteraction ? structuredClone(state.pendingInteraction.interaction) : null,
      events: state.events.map(event => structuredClone(event)),
    };
  }

  getEvents(turnId, afterSequence = 0) {
    const state = this.#get(turnId);
    const cursor = Number(afterSequence) || 0;
    return state.events.filter(event => event.id > cursor).map(event => structuredClone(event));
  }

  subscribe(turnId, { afterSequence = 0, onEvent } = {}) {
    const state = this.#get(turnId);
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    for (const event of this.getEvents(turnId, afterSequence)) onEvent(event);
    if (!this.#isTerminal(state)) state.subscribers.add(onEvent);
    return () => state.subscribers.delete(onEvent);
  }

  shutdown() {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#turns.values()) {
      if (this.#isTerminal(state)) continue;
      state.abortController.abort();
      this.#finish(state, 'turn.failed', new AiError('AI_TURN_INTERRUPTED', 'The server stopped before the turn completed.', { status: 503 }));
    }
  }

  #finish(state, type, error) {
    if (this.#isTerminal(state)) return;
    if (state.pendingInteraction) {
      const pending = state.pendingInteraction;
      state.pendingInteraction = null;
      pending.reject(error || new AiError('AI_TURN_TERMINAL', 'The turn ended.', { status: 409 }));
    }
    state.status = type === 'turn.completed' ? 'completed' : 'failed';
    state.sessionStatus = type === 'turn.completed' ? 'waitingForUser' : 'idle';
    state.completedAt = this.#timestamp();
    this.#activeBySession.delete(state.key);
    this.#notifyAdapterState(state);
    this.#emit(state, type, error ? { error: publicFailure(error) } : {});
    state.subscribers.clear();
    this.#terminalOrder.push(state.turnId);
    while (this.#terminalOrder.length > this.maxRetainedTurns) {
      const evicted = this.#terminalOrder.shift();
      this.#turns.delete(evicted);
    }
  }

  #emit(state, type, data = {}) {
    const event = {
      id: ++state.sequence,
      type,
      turnId: state.turnId,
      timestamp: this.#timestamp(),
      ...structuredClone(data),
    };
    state.events.push(event);
    if (state.events.length > this.maxEventsPerTurn) state.events.shift();
    for (const subscriber of state.subscribers) subscriber(structuredClone(event));
    return event;
  }

  #notifyAdapterState(state) {
    state.adapter.onTurnState?.({
      turnId: state.turnId,
      sessionId: state.sessionId,
      turnStatus: state.status,
      sessionStatus: state.sessionStatus,
      timestamp: this.#timestamp(),
    });
  }

  #timestamp() {
    const value = this.clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  #get(turnId) {
    const state = this.#turns.get(turnId);
    if (!state) throw new AiNotFoundError(`AI turn '${turnId}' was not found.`, { turnId });
    return state;
  }

  #isTerminal(state) {
    return state.status === 'completed' || state.status === 'failed';
  }
}

export function createAiTurnRuntime(options) {
  return new AiTurnRuntime(options);
}
