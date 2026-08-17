import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiNotFoundError,
  AiTurnConflictError,
  CapabilityNotSupportedError,
  normalizeInteraction,
  publicAiError,
  validateAgentIdentity,
  validateInteractionResponse,
} from './contracts.mjs';
import { createTranscriptCacheService } from './transcript-cache.mjs';

function sessionKey(provider, providerSessionId) {
  return `${provider}\u0000${providerSessionId}`;
}

function publicFailure(error) {
  const normalized = publicAiError(error);
  return { code: normalized.code, message: normalized.message };
}

export class AiTurnRuntime {
  #turns = new Map();
  #activeBySession = new Map();
  #startQueueBySession = new Map();
  #terminalOrder = [];
  #closed = false;

  constructor({
    registry,
    transcriptCache,
    maxEventsPerTurn = 500,
    maxRetainedTurns = 100,
    idFactory = randomUUID,
    clock = () => new Date(),
  } = {}) {
    this.registry = registry;
    this.transcriptCache = transcriptCache ?? createTranscriptCacheService();
    this.maxEventsPerTurn = maxEventsPerTurn;
    this.maxRetainedTurns = maxRetainedTurns;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  async startTurn({ provider, providerSessionId, message, prompt, idempotencyKey } = {}) {
    if (this.#closed) throw new AiError('AI_RUNTIME_CLOSED', 'The AI turn runtime is shut down.', { status: 503 });
    const identity = validateAgentIdentity({ provider, providerSessionId });
    const inputMessage = message ?? prompt;
    const entry = this.registry.get(provider);
    const adapter = entry.adapter;
    if (typeof adapter.startTurn !== 'function') {
      throw new CapabilityNotSupportedError(provider, 'startTurn');
    }
    const key = sessionKey(identity.provider, identity.providerSessionId);

    const releaseStartLock = await this.#acquireStartLock(key);

    try {
      const existingId = this.#activeBySession.get(key);
      if (existingId) {
        const existing = this.#turns.get(existingId);
        if (idempotencyKey && existing?.idempotencyKey === idempotencyKey) {
          return { turnId: existingId, idempotent: true };
        }
        throw new AiTurnConflictError(existingId);
      }

      if (typeof inputMessage !== 'string' || inputMessage.trim().length === 0 || inputMessage.length > 100_000) {
        throw new AiError('AI_VALIDATION_ERROR', 'A non-empty message is required.', { status: 400 });
      }
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
        throw new AiError('AI_VALIDATION_ERROR', 'The idempotency key is invalid.', { status: 400 });
      }

      const turnId = `turn-${this.idFactory()}`;
      const startedAt = this.#timestamp();

      if (this.transcriptCache) {
        this.transcriptCache.recordUserMessage(identity.provider, identity.providerSessionId, {
          text: inputMessage,
          createdAt: startedAt,
        });
      }

      const state = {
        turnId,
        provider: identity.provider,
        providerSessionId: identity.providerSessionId,
        identity,
        key,
        idempotencyKey,
        status: 'running',
        sequence: 0,
        events: [],
        subscribers: new Set(),
        pendingInteraction: null,
        abortController: new AbortController(),
        adapter,
        privateOperation: undefined,
        startedAt,
        completedAt: undefined,
      };

      this.#turns.set(turnId, state);
      this.#activeBySession.set(key, turnId);
      this.#notifyAdapterState(state);
      this.#emit(state, 'turn.started');
      queueMicrotask(() => this.#run(state, inputMessage));
      return { turnId, idempotent: false };
    } finally {
      releaseStartLock();
    }
  }

  async #acquireStartLock(key) {
    const previous = this.#startQueueBySession.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.#startQueueBySession.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.#startQueueBySession.get(key) === tail) this.#startQueueBySession.delete(key);
    };
  }

  async #run(state, message) {
    try {
      const turnResult = state.adapter.startTurn({
        turnId: state.turnId,
        providerSessionId: state.providerSessionId,
        identity: state.identity,
        message,
        prompt: message,
        signal: state.abortController.signal,
        setOperation: operation => { state.privateOperation = operation; },
        emitDelta: (delta, messageId) => this.#emitDelta(state, delta, messageId),
        emitTextDelta: (text, messageId) => this.#emitTextDelta(state, text, messageId),
        emitReasoningDelta: (text, messageId) => this.#emitReasoningDelta(state, text, messageId),
        emitToolStarted: tool => this.#emitToolStarted(state, tool),
        emitToolUpdated: tool => this.#emitToolUpdated(state, tool),
        emitToolCompleted: tool => this.#emitToolCompleted(state, tool),
        emitUsageUpdated: usage => this.#emitUsageUpdated(state, usage),
        emitEvent: (type, data) => this.#emit(state, type, data),
        requestInteraction: interaction => this.#requestInteraction(state, interaction),
      });

      if (turnResult && typeof turnResult[Symbol.asyncIterator] === 'function') {
        for await (const event of turnResult) {
          if (this.#isTerminal(state)) break;
          this.#emit(state, event.type, event);
        }
      } else {
        const result = await turnResult;
        if (result?.operation !== undefined) state.privateOperation = result.operation;
      }

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
    this.#emit(state, 'text.delta', { messageId, text: delta, delta });
  }

  #emitTextDelta(state, text, messageId = `message-${state.turnId}`) {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid text delta.', { status: 502 });
    }
    this.#emit(state, 'text.delta', { messageId, text, delta: text });
  }

  #emitReasoningDelta(state, text, messageId = `message-${state.turnId}`) {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid reasoning delta.', { status: 502 });
    }
    this.#emit(state, 'reasoning.delta', { messageId, text });
  }

  #emitToolStarted(state, { toolId, toolName, input } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'tool.started', { toolId, toolName, input });
  }

  #emitToolUpdated(state, { toolId, output, status } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'tool.updated', { toolId, output, status });
  }

  #emitToolCompleted(state, { toolId, output, durationMs } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'tool.completed', { toolId, output, durationMs });
  }

  #emitUsageUpdated(state, { tokensIn, tokensOut, cost } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'usage.updated', { tokensIn, tokensOut, cost });
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
    this.#notifyAdapterState(state);
    this.#emit(state, 'interaction.resolved', { interactionId, response: normalized });
    pending.resolve(normalized);
    return this.getSnapshot(turnId);
  }

  async cancelTurn(turnId) {
    const state = this.#get(turnId);
    if (this.#isTerminal(state)) return this.getSnapshot(turnId);
    const adapter = this.registry.require(state.provider, 'cancelTurn', 'cancelTurn');
    await adapter.cancelTurn({
      turnId,
      providerSessionId: state.providerSessionId,
      identity: state.identity,
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
      providerSessionId: state.providerSessionId,
      status: state.status,
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
    return state.events.filter(event => (event.id ?? event.seq ?? 0) > cursor).map(event => structuredClone(event));
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
    if (this.transcriptCache) {
      this.transcriptCache.flush(state.provider, state.providerSessionId).catch(() => {});
    }
  }

  #emit(state, type, data = {}) {
    const event = {
      id: ++state.sequence,
      seq: state.sequence,
      type,
      turnId: state.turnId,
      timestamp: this.#timestamp(),
      ...structuredClone(data),
    };
    state.events.push(event);
    if (state.events.length > this.maxEventsPerTurn) state.events.shift();

    if (this.transcriptCache) {
      this.transcriptCache.applyEvent(state.provider, state.providerSessionId, event).catch(() => {});
    }

    for (const subscriber of state.subscribers) subscriber(structuredClone(event));
    return event;
  }

  #notifyAdapterState(state) {
    state.adapter.onTurnState?.({
      turnId: state.turnId,
      provider: state.provider,
      providerSessionId: state.providerSessionId,
      status: state.status,
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
