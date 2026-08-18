import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiNotFoundError,
  AiTurnConflictError,
  AiValidationError,
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
  #sessionSequences = new Map();
  #sessionSubscribers = new Map();
  #sessionEvents = new Map();
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

  async startTurn({ provider, providerSessionId, sessionId, message, prompt, idempotencyKey, onSessionEstablished } = {}) {
    if (this.#closed) throw new AiError('AI_RUNTIME_CLOSED', 'The AI turn runtime is shut down.', { status: 503 });
    if (sessionId !== undefined) {
      throw new AiValidationError("Property 'sessionId' is obsolete. Use 'providerSessionId' instead.");
    }
    if (!provider || typeof provider !== 'string') {
      throw new AiValidationError('A valid provider is required.');
    }
    if (providerSessionId !== undefined && providerSessionId !== null) {
      validateAgentIdentity({ provider, providerSessionId });
    }
    const inputMessage = message ?? prompt;
    const entry = this.registry.get(provider);
    const adapter = entry.adapter;
    if (typeof adapter.startTurn !== 'function') {
      throw new CapabilityNotSupportedError(provider, 'startTurn');
    }

    const isNewSession = !providerSessionId;
    const turnId = `turn-${this.idFactory()}`;
    const key = isNewSession ? `new-turn\u0000${turnId}` : sessionKey(provider, providerSessionId);

    const releaseStartLock = await this.#acquireStartLock(key);

    try {
      if (!isNewSession) {
        const existingId = this.#activeBySession.get(key);
        if (existingId) {
          const existing = this.#turns.get(existingId);
          if (idempotencyKey && existing?.idempotencyKey === idempotencyKey) {
            return { turnId: existingId, idempotent: true };
          }
          throw new AiTurnConflictError(existingId);
        }
      }

      if (typeof inputMessage !== 'string' || inputMessage.trim().length === 0 || inputMessage.length > 100_000) {
        throw new AiError('AI_VALIDATION_ERROR', 'A non-empty message is required.', { status: 400 });
      }
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
        throw new AiError('AI_VALIDATION_ERROR', 'The idempotency key is invalid.', { status: 400 });
      }

      const startedAt = this.#timestamp();

      let initialSeq = 0;
      if (!isNewSession) {
        if (this.#sessionSequences.has(key)) {
          initialSeq = this.#sessionSequences.get(key);
        } else if (this.transcriptCache) {
          try {
            const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
            initialSeq = transcript.lastEventSeq || 0;
            this.#sessionSequences.set(key, initialSeq);
          } catch {}
        }
      }

      if (!isNewSession && this.transcriptCache) {
        this.transcriptCache.recordUserMessage(provider, providerSessionId, {
          text: inputMessage,
          createdAt: startedAt,
        });
      }

      const state = {
        turnId,
        provider,
        providerSessionId: providerSessionId || undefined,
        identity: providerSessionId ? { provider, providerSessionId } : undefined,
        key,
        idempotencyKey,
        onSessionEstablished,
        status: 'running',
        sequence: initialSeq,
        events: [],
        subscribers: new Set(),
        pendingInteraction: null,
        abortController: new AbortController(),
        adapter,
        privateOperation: undefined,
        startedAt,
        completedAt: undefined,
      };

      let resolveEstablished;
      let rejectEstablished;
      const establishedPromise = new Promise((resolve, reject) => {
        resolveEstablished = resolve;
        rejectEstablished = reject;
      });

      if (!isNewSession) {
        resolveEstablished(providerSessionId);
      }

      const setProviderSessionId = async (allocatedSessionId) => {
        if (!state.providerSessionId && allocatedSessionId) {
          state.providerSessionId = allocatedSessionId;
          state.identity = { provider: state.provider, providerSessionId: allocatedSessionId };
          state.key = sessionKey(state.provider, allocatedSessionId);
          this.#activeBySession.set(state.key, state.turnId);
          let seq = this.#sessionSequences.get(state.key) || 0;
          if (seq < state.sequence) {
            seq = state.sequence;
            this.#sessionSequences.set(state.key, seq);
          }
          if (this.transcriptCache) {
            this.transcriptCache.recordUserMessage(state.provider, allocatedSessionId, {
              text: inputMessage,
              createdAt: state.startedAt,
            });
            for (const ev of state.events) {
              this.transcriptCache.applyEvent(state.provider, allocatedSessionId, ev).catch(() => {});
            }
          }
          if (state.onSessionEstablished) {
            try {
              await state.onSessionEstablished(allocatedSessionId);
            } catch (bindingErr) {
              rejectEstablished(bindingErr);
              throw bindingErr;
            }
          }
          resolveEstablished(allocatedSessionId);
        }
      };

      this.#turns.set(turnId, state);
      if (!isNewSession) {
        this.#activeBySession.set(key, turnId);
      }
      this.#notifyAdapterState(state);
      this.#emit(state, 'turn.started', {
        userPrompt: inputMessage,
        userMessage: {
          id: `user-${turnId}`,
          role: 'user',
          text: inputMessage,
          createdAt: state.startedAt,
        },
      });
      queueMicrotask(() => this.#run(state, inputMessage, setProviderSessionId, rejectEstablished));

      try {
        const establishedSessionId = await establishedPromise;
        return { turnId, providerSessionId: establishedSessionId, idempotent: false };
      } catch (err) {
        state.abortController.abort();
        this.#finish(state, 'turn.failed', err);
        throw err;
      }
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

  async #run(state, message, setProviderSessionId, rejectEstablished) {
    try {
      const turnResult = state.adapter.startTurn({
        turnId: state.turnId,
        providerSessionId: state.providerSessionId,
        setProviderSessionId,
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

      let result;
      if (turnResult && typeof turnResult[Symbol.asyncIterator] === 'function') {
        for await (const event of turnResult) {
          if (this.#isTerminal(state)) break;
          this.#emit(state, event.type, event);
        }
      } else {
        result = await turnResult;
        if (result?.providerSessionId) {
          await setProviderSessionId(result.providerSessionId);
        }
        if (result?.operation !== undefined) state.privateOperation = result.operation;
      }

      if (result?.isDeferred) {
        state.status = 'waitingForUser';
        state.pendingInteraction = result.interaction;
        state.privateOperation = null;
        this.#notifyAdapterState(state);
        this.#emit(state, 'interaction.requested', { interaction: result.interaction });
        return;
      }

      if (!this.#isTerminal(state)) this.#finish(state, 'turn.completed');
    } catch (error) {
      if (rejectEstablished) {
        try { rejectEstablished(error); } catch {}
      }
      if (!this.#isTerminal(state)) this.#finish(state, 'turn.failed', error);
    }
  }


  async #runContinuation(state, interactionId, interaction, response) {
    try {
      let result;
      if (typeof state.adapter.respondInteraction === 'function') {
        result = await state.adapter.respondInteraction({
          turnId: state.turnId,
          providerSessionId: state.providerSessionId,
          interactionId,
          interaction,
          response,
          signal: state.abortController.signal,
          setOperation: op => { state.privateOperation = op; },
          emitDelta: (delta, msgId) => this.#emitDelta(state, delta, msgId),
          emitTextDelta: (text, msgId) => this.#emitTextDelta(state, text, msgId),
          emitReasoningDelta: (text, msgId) => this.#emitReasoningDelta(state, text, msgId),
          emitToolStarted: tool => this.#emitToolStarted(state, tool),
          emitToolUpdated: tool => this.#emitToolUpdated(state, tool),
          emitToolCompleted: tool => this.#emitToolCompleted(state, tool),
          emitUsageUpdated: usage => this.#emitUsageUpdated(state, usage),
          emitEvent: (type, data) => this.#emit(state, type, data),
        });
      }

      if (result?.isDeferred) {
        state.status = 'waitingForUser';
        state.pendingInteraction = result.interaction;
        state.privateOperation = null;
        this.#notifyAdapterState(state);
        this.#emit(state, 'interaction.requested', { interaction: result.interaction });
        return;
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
    state.pendingInteraction = interaction;
    this.#notifyAdapterState(state);
    this.#emit(state, 'interaction.requested', { interaction });
    return interaction;
  }

  async resolveInteraction(turnId, interactionId, response, options = {}) {
    const { provider, providerSessionId } = options;
    let state = turnId ? this.#turns.get(turnId) : null;

    if (!state && !turnId && provider && providerSessionId) {
      const activeId = this.#activeBySession.get(sessionKey(provider, providerSessionId));
      if (activeId) {
        state = this.#turns.get(activeId);
        turnId = activeId;
      }
    }

    if (state && provider && providerSessionId) {
      if (state.provider !== provider || (state.providerSessionId || state.sessionId) !== providerSessionId) {
        throw new AiNotFoundError(`Turn '${state.turnId}' does not belong to session '${providerSessionId}'.`, {
          turnId: state.turnId,
          provider,
          providerSessionId,
        });
      }
    }

    if (!state && this.transcriptCache) {
      if (provider && providerSessionId) {
        const cached = await this.transcriptCache.getTranscript(provider, providerSessionId);
        if (cached?.activeTurn && cached?.pendingInteraction?.id === interactionId) {
          if (!turnId || cached.activeTurn.turnId === turnId) {
            turnId = cached.activeTurn.turnId;
            state = {
              turnId,
              provider: cached.provider,
              providerSessionId: cached.providerSessionId,
              identity: { provider: cached.provider, providerSessionId: cached.providerSessionId },
              key: sessionKey(cached.provider, cached.providerSessionId),
              status: 'waitingForUser',
              pendingInteraction: structuredClone(cached.pendingInteraction),
              sequence: cached.lastEventSeq || 0,
              events: [],
              subscribers: new Set(),
              abortController: new AbortController(),
              adapter: this.registry.get(cached.provider).adapter,
              startedAt: cached.activeTurn.startedAt,
            };
            this.#turns.set(turnId, state);
            this.#activeBySession.set(state.key, turnId);
            this.#sessionSequences.set(state.key, cached.lastEventSeq || 0);
          }
        }
      } else if (turnId) {
        for (const [key, cached] of this.transcriptCache.entries?.() || []) {
          if (cached?.activeTurn?.turnId === turnId && cached?.pendingInteraction?.id === interactionId) {
            state = {
              turnId,
              provider: cached.provider,
              providerSessionId: cached.providerSessionId,
              identity: { provider: cached.provider, providerSessionId: cached.providerSessionId },
              key: sessionKey(cached.provider, cached.providerSessionId),
              status: 'waitingForUser',
              pendingInteraction: structuredClone(cached.pendingInteraction),
              sequence: cached.lastEventSeq || 0,
              events: [],
              subscribers: new Set(),
              abortController: new AbortController(),
              adapter: this.registry.get(cached.provider).adapter,
              startedAt: cached.activeTurn.startedAt,
            };
            this.#turns.set(turnId, state);
            this.#activeBySession.set(state.key, turnId);
            this.#sessionSequences.set(state.key, cached.lastEventSeq || 0);
            break;
          }
        }
      }
    }

    if (!state) {
      if (!turnId) {
        throw new AiNotFoundError('No active turn found for this session.', { provider, providerSessionId, interactionId });
      }
      state = this.#get(turnId);
    }

    if (provider && providerSessionId) {
      if (state.provider !== provider || (state.providerSessionId || state.sessionId) !== providerSessionId) {
        throw new AiNotFoundError(`Turn '${state.turnId}' does not belong to session '${providerSessionId}'.`, {
          turnId: state.turnId,
          provider,
          providerSessionId,
        });
      }
    }

    const pending = state.pendingInteraction;
    if (!pending || pending.id !== interactionId) {
      throw new AiNotFoundError('The pending interaction was not found for this turn.', { turnId: state.turnId, interactionId });
    }
    const normalized = validateInteractionResponse(pending, response);
    const interaction = state.pendingInteraction;
    state.pendingInteraction = null;
    state.status = 'running';
    this.#notifyAdapterState(state);
    this.#emit(state, 'interaction.resolved', { interactionId, response: normalized });
    queueMicrotask(() => this.#runContinuation(state, interactionId, interaction, normalized));
    return this.getSnapshot(state.turnId);
  }

  async cancelTurn(turnId, options = {}) {
    const { provider, providerSessionId } = options;
    let state = this.#turns.get(turnId);
    if (!state && this.transcriptCache && provider && providerSessionId) {
      const cached = await this.transcriptCache.getTranscript(provider, providerSessionId);
      if (cached?.activeTurn?.turnId === turnId) {
        state = {
          turnId,
          provider: cached.provider,
          providerSessionId: cached.providerSessionId,
          identity: { provider: cached.provider, providerSessionId: cached.providerSessionId },
          key: sessionKey(cached.provider, cached.providerSessionId),
          status: 'waitingForUser',
          pendingInteraction: structuredClone(cached.pendingInteraction),
          sequence: cached.lastEventSeq || 0,
          events: [],
          subscribers: new Set(),
          abortController: new AbortController(),
          adapter: this.registry.get(cached.provider).adapter,
          startedAt: cached.activeTurn.startedAt,
        };
        this.#turns.set(turnId, state);
        this.#activeBySession.set(state.key, turnId);
        this.#sessionSequences.set(state.key, cached.lastEventSeq || 0);
      }
    }
    if (!state) {
      state = this.#get(turnId);
    }
    if (provider && providerSessionId) {
      if (state.provider !== provider || (state.providerSessionId || state.sessionId) !== providerSessionId) {
        throw new AiNotFoundError(`Turn '${turnId}' does not belong to session '${providerSessionId}'.`, {
          turnId,
          provider,
          providerSessionId,
        });
      }
    }
    if (this.#isTerminal(state)) return this.getSnapshot(turnId);
    if (state.status === 'waitingForUser') {
      this.#finish(state, 'turn.failed', new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 }));
      return this.getSnapshot(turnId);
    }
    const adapter = this.registry.require(state.provider, 'cancelTurn', 'cancelTurn');
    if (state.privateOperation) {
      await adapter.cancelTurn({
        turnId,
        providerSessionId: state.providerSessionId,
        identity: state.identity,
        operation: state.privateOperation,
      });
    }
    state.abortController.abort();
    this.#finish(state, 'turn.failed', new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 }));
    return this.getSnapshot(turnId);
  }

  getSnapshot(turnId) {
    let state = this.#turns.get(turnId);
    if (!state && this.transcriptCache) {
      for (const [key, cached] of this.transcriptCache.entries?.() || []) {
        if (cached?.activeTurn?.turnId === turnId) {
          return {
            turnId,
            provider: cached.provider,
            providerSessionId: cached.providerSessionId,
            status: 'waitingForUser',
            startedAt: cached.activeTurn.startedAt,
            lastEventId: cached.lastEventSeq || 0,
            pendingInteraction: cached.pendingInteraction ? structuredClone(cached.pendingInteraction) : null,
            events: [],
          };
        }
      }
    }
    if (!state) {
      state = this.#get(turnId);
    }
    return {
      turnId: state.turnId,
      provider: state.provider,
      providerSessionId: state.providerSessionId,
      status: state.status,
      startedAt: state.startedAt,
      ...(state.completedAt ? { completedAt: state.completedAt } : {}),
      lastEventId: state.sequence,
      pendingInteraction: state.pendingInteraction ? structuredClone(state.pendingInteraction) : null,
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

  subscribeToSession({ provider, providerSessionId }, { afterSequence = 0, onEvent } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    const key = sessionKey(provider, providerSessionId);
    let subs = this.#sessionSubscribers.get(key);
    if (!subs) {
      subs = new Set();
      this.#sessionSubscribers.set(key, subs);
    }
    const recent = this.#sessionEvents.get(key) || [];
    const cursor = Number(afterSequence) || 0;
    for (const event of recent) {
      if ((event.seq ?? event.id ?? 0) > cursor) {
        onEvent(structuredClone(event));
      }
    }
    subs.add(onEvent);
    return () => {
      subs.delete(onEvent);
      if (subs.size === 0) this.#sessionSubscribers.delete(key);
    };
  }

  shutdown() {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#turns.values()) {
      if (this.#isTerminal(state)) continue;
      if (state.status === 'waitingForUser') continue;
      state.abortController.abort();
      this.#finish(state, 'turn.failed', new AiError('AI_TURN_INTERRUPTED', 'The server stopped before the turn completed.', { status: 503 }));
    }
  }

  #finish(state, type, error) {
    if (this.#isTerminal(state)) return;
    state.pendingInteraction = null;
    state.status = type === 'turn.completed' ? 'completed' : 'failed';
    state.completedAt = this.#timestamp();
    this.#activeBySession.delete(state.key);
    this.#notifyAdapterState(state);
    console.log(`[ai] [turn:${type}] turnId=${state.turnId} provider=${state.provider} session=${state.providerSessionId}${error ? ` error="${error.message}"` : ''}`);
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

  #getNextSeq(state) {
    if (state.provider && state.providerSessionId) {
      const key = sessionKey(state.provider, state.providerSessionId);
      let current = this.#sessionSequences.get(key);
      if (current === undefined) {
        current = state.sequence || 0;
      }
      current += 1;
      this.#sessionSequences.set(key, current);
      state.sequence = current;
      return current;
    }
    state.sequence = (state.sequence || 0) + 1;
    return state.sequence;
  }

  #emit(state, type, data = {}) {
    const seq = this.#getNextSeq(state);
    const event = {
      id: seq,
      seq,
      type,
      turnId: state.turnId,
      timestamp: this.#timestamp(),
      ...structuredClone(data),
    };
    state.events.push(event);
    if (state.events.length > this.maxEventsPerTurn) state.events.shift();

    if (state.provider && state.providerSessionId) {
      const key = sessionKey(state.provider, state.providerSessionId);
      let sessionEvents = this.#sessionEvents.get(key);
      if (!sessionEvents) {
        sessionEvents = [];
        this.#sessionEvents.set(key, sessionEvents);
      }
      sessionEvents.push(event);
      if (sessionEvents.length > 500) sessionEvents.shift();

      if (this.transcriptCache) {
        this.transcriptCache.applyEvent(state.provider, state.providerSessionId, event).catch(() => {});
      }

      const sessionSubs = this.#sessionSubscribers.get(key);
      if (sessionSubs) {
        for (const subscriber of sessionSubs) subscriber(structuredClone(event));
      }
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
