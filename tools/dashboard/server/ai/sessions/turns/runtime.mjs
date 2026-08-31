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
  validateAgentExecutionMode,
  validateInteractionResponse,
  getGlobalTraceSink,
} from '../../contracts.mjs';
import { createTranscriptCacheService } from '../transcript-cache.mjs';
import { TurnEventStream, sessionKey } from './turn-event-stream.mjs';
import {
  findPersistedActiveTurn,
  getPersistedTurnSnapshot,
  interruptStaleLiveInteraction,
  reconcileOrphanedTurns,
  reconstructTurnState,
} from './turn-recovery.mjs';

function publicFailure(error) {
  const normalized = publicAiError(error);
  return { code: normalized.code, message: normalized.message };
}

const TURN_ACTIVITY_EVENT_TYPES = new Set([
  'text.delta',
  'progress.delta',
  'reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'usage.updated',
]);

/**
 * Main application-facing Agent Turn runtime facade.
 * Coordinates turn lifecycle admission, provider turn orchestration,
 * interaction state transitions, cancellation/timeout policy, and delegates
 * event streaming and recovery to focused collaborators.
 */
export class AgentTurnRuntime {
  #turns = new Map();
  #activeBySession = new Map();
  #startQueueBySession = new Map();
  #terminalOrder = [];
  #closed = false;
  #shutdownPromise;
  #idleWatchdogTimer = null;
  #eventStream;

  constructor({
    registry,
    transcriptCache,
    maxEventsPerTurn = 500,
    maxRetainedTurns = 100,
    idFactory = randomUUID,
    clock = () => new Date(),
    idleTimeoutMs = 5 * 60 * 1000,
    idleCheckIntervalMs = Math.min(idleTimeoutMs > 0 ? idleTimeoutMs : 30_000, 30_000),
    traceSink = null,
  } = {}) {
    this.registry = registry;
    this.transcriptCache = transcriptCache ?? createTranscriptCacheService();
    this.traceSink = traceSink ?? getGlobalTraceSink();
    this.maxEventsPerTurn = maxEventsPerTurn;
    this.maxRetainedTurns = maxRetainedTurns;
    this.idFactory = idFactory;
    this.clock = clock;
    this.idleTimeoutMs = idleTimeoutMs;
    this.idleCheckIntervalMs = idleCheckIntervalMs;
    this.#eventStream = new TurnEventStream({
      transcriptCache: this.transcriptCache,
      maxEventsPerTurn,
      clock,
    });

    if (this.idleTimeoutMs > 0) {
      this.#idleWatchdogTimer = setInterval(() => this.#checkIdleTurns(), this.idleCheckIntervalMs);
      this.#idleWatchdogTimer.unref?.();
    }
  }

  getTrace(turnId) {
    return this.traceSink?.getTrace(turnId) ?? [];
  }

  exportTrace(turnId) {
    return this.traceSink?.exportTrace(turnId) ?? { turnId, recordCount: 0, records: [] };
  }

  async startTurn({ provider, providerSessionId, sessionId, message, prompt, mode, idempotencyKey, onSessionEstablished } = {}) {
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
    const validatedMode = mode ? validateAgentExecutionMode(mode, 'mode') : 'edit';
    const inputMessage = message ?? prompt;
    const entry = this.registry.get(provider);
    const agentProvider = entry.provider;
    if (typeof agentProvider.startTurn !== 'function') {
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
        const existingSeq = this.#eventStream.getSessionSequence(provider, providerSessionId);
        if (existingSeq !== undefined) {
          initialSeq = existingSeq;
        } else if (this.transcriptCache) {
          try {
            const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
            initialSeq = transcript.lastEventSeq || 0;
            this.#eventStream.initSessionSequence(provider, providerSessionId, initialSeq);
          } catch {
            initialSeq = 0;
          }
        }
      }

      if (!isNewSession && this.transcriptCache) {
        this.transcriptCache.recordUserMessage(provider, providerSessionId, {
          text: inputMessage,
          createdAt: startedAt,
        });
      }

      this.#eventStream.registerTurn({
        turnId,
        provider: isNewSession ? undefined : provider,
        providerSessionId: isNewSession ? undefined : providerSessionId,
        initialSequence: initialSeq,
      });

      const state = {
        turnId,
        provider,
        providerSessionId: providerSessionId || undefined,
        identity: providerSessionId ? { provider, providerSessionId } : undefined,
        key,
        mode: validatedMode,
        idempotencyKey,
        onSessionEstablished,
        status: 'running',
        pendingInteraction: null,
        abortController: new AbortController(),
        agentProvider,
        privateOperation: undefined,
        startedAt,
        completedAt: undefined,
        lastActivityAt: this.clock().getTime(),
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
          this.#eventStream.bindSession(state.turnId, { provider: state.provider, providerSessionId: allocatedSessionId });
          if (this.transcriptCache) {
            this.transcriptCache.recordUserMessage(state.provider, allocatedSessionId, {
              text: inputMessage,
              createdAt: state.startedAt,
            });
            for (const ev of this.#eventStream.getTurnEvents(state.turnId, 0)) {
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
      state.tracer = this.traceSink?.createTurnTracer?.({
        turnId,
        sessionId: providerSessionId || turnId,
        provider,
        providerSessionId,
      });
      state.tracer?.record?.({
        source: 'runtime',
        event: 'turn.started',
        disposition: 'accepted',
        afterStatus: { status: 'active', detail: 'startup' },
      });
      this.#notifyProviderState(state);
      this.#emit(state, 'turn.started', {
        mode: state.mode,
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

  #createProviderTurnContext(state, extra = {}) {
    return {
      turnId: state.turnId,
      providerSessionId: state.providerSessionId,
      identity: state.identity,
      mode: state.mode,
      signal: state.abortController.signal,
      setOperation: operation => { state.privateOperation = operation; },
      emitDelta: (delta, messageId) => this.#emitDelta(state, delta, messageId),
      emitTextDelta: (text, messageId) => this.#emitTextDelta(state, text, messageId),
      emitProgressDelta: (text, progressId) => this.#emitProgressDelta(state, text, progressId),
      emitReasoningDelta: (text, messageId) => this.#emitReasoningDelta(state, text, messageId),
      emitToolStarted: tool => this.#emitToolStarted(state, tool),
      emitToolUpdated: tool => this.#emitToolUpdated(state, tool),
      emitToolCompleted: tool => this.#emitToolCompleted(state, tool),
      emitUsageUpdated: usage => this.#emitUsageUpdated(state, usage),
      emitEvent: (type, data) => this.#emit(state, type, data),
      ...extra,
    };
  }

  async #run(state, message, setProviderSessionId, rejectEstablished) {
    try {
      const turnResult = state.agentProvider.startTurn(
        this.#createProviderTurnContext(state, {
          setProviderSessionId,
          message,
          prompt: message,
          requestInteraction: (interaction, options) => this.#requestInteraction(state, interaction, options),
        })
      );

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
        const interaction = normalizeInteraction({
          ...result.interaction,
          resumePolicy: result.resumePolicy ?? result.interaction?.resumePolicy ?? 'restart',
        });
        state.status = 'waitingForUser';
        state.pendingInteraction = interaction;
        state.privateOperation = null;
        this.#notifyProviderState(state);
        this.#emit(state, 'interaction.requested', { interaction });
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
      if (typeof state.agentProvider.respondInteraction === 'function') {
        result = await state.agentProvider.respondInteraction(
          this.#createProviderTurnContext(state, {
            interactionId,
            interaction,
            response,
          })
        );
      }

      if (result?.isDeferred) {
        const nextInteraction = normalizeInteraction({
          ...result.interaction,
          resumePolicy: result.resumePolicy ?? result.interaction?.resumePolicy ?? 'restart',
        });
        state.status = 'waitingForUser';
        state.pendingInteraction = nextInteraction;
        state.privateOperation = null;
        this.#notifyProviderState(state);
        this.#emit(state, 'interaction.requested', { interaction: nextInteraction });
        return;
      }

      if (result?.continuesTurn === true) return;

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

  #emitProgressDelta(state, text, progressId = `progress-${state.turnId}`) {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid progress delta.', { status: 502 });
    }
    this.#emit(state, 'progress.delta', { progressId, text });
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

  #emitToolCompleted(state, { toolId, output, durationMs, status } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'tool.completed', { toolId, output, durationMs, status });
  }

  #emitUsageUpdated(state, { tokensIn, tokensOut, cost } = {}) {
    if (this.#isTerminal(state)) return;
    this.#emit(state, 'usage.updated', { tokensIn, tokensOut, cost });
  }

  #requestInteraction(state, value, { resumePolicy = 'restart' } = {}) {
    if (this.#isTerminal(state)) throw new AiError('AI_TURN_TERMINAL', 'The turn is already terminal.', { status: 409 });
    if (state.pendingInteraction) throw new AiError('AI_INTERACTION_PENDING', 'The turn already has a pending interaction.', { status: 409 });
    const neutral = {
      ...value,
      id: undefined,
      resumePolicy,
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
    this.#notifyProviderState(state);
    this.#emit(state, 'interaction.requested', { interaction });
    return interaction;
  }

  async #restorePersistedTurn({ provider, providerSessionId, turnId, interactionId, checkStaleLiveOp = false } = {}) {
    if (!this.transcriptCache) return null;

    const cached = await findPersistedActiveTurn({
      transcriptCache: this.transcriptCache,
      provider,
      providerSessionId,
      turnId,
      interactionId,
    });

    if (!cached) return null;

    if (checkStaleLiveOp && cached.pendingInteraction?.resumePolicy === 'live-operation') {
      await interruptStaleLiveInteraction(this.transcriptCache, cached.provider, cached.providerSessionId);
    }

    const restoredTurnId = cached.activeTurn.turnId;
    const state = reconstructTurnState({
      cached,
      registry: this.registry,
      clock: this.clock,
    });

    this.#eventStream.registerTurn({
      turnId: restoredTurnId,
      provider: state.provider,
      providerSessionId: state.providerSessionId,
      initialSequence: cached.lastEventSeq || 0,
    });

    this.#turns.set(restoredTurnId, state);
    this.#activeBySession.set(state.key, restoredTurnId);
    return state;
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

    if (!state) {
      state = await this.#restorePersistedTurn({
        provider,
        providerSessionId,
        turnId,
        interactionId,
        checkStaleLiveOp: true,
      });
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
    state.lastActivityAt = this.clock().getTime();
    this.#notifyProviderState(state);
    this.#emit(state, 'interaction.resolved', { interactionId, response: normalized });
    queueMicrotask(() => this.#runContinuation(state, interactionId, interaction, normalized));
    return this.getSnapshot(state.turnId);
  }

  async cancelTurn(turnId, options = {}) {
    const { provider, providerSessionId } = options;
    let state = this.#turns.get(turnId);
    if (!state) {
      state = await this.#restorePersistedTurn({
        provider,
        providerSessionId,
        turnId,
        checkStaleLiveOp: false,
      });
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
    state.tracer?.record?.({
      source: 'runtime',
      event: 'turn.cancel_requested',
      initiator: 'user',
      disposition: 'accepted',
      afterStatus: { status: 'cancelling', initiator: 'user' },
    });
    if (state.status === 'waitingForUser') {
      const error = new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 });
      if (state.privateOperation) {
        await this.#cancelRunningTurn(state, error);
      } else {
        this.#finish(state, 'turn.failed', error);
      }
      return this.getSnapshot(turnId);
    }
    await this.#cancelRunningTurn(state, new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 }));
    return this.getSnapshot(turnId);
  }

  /**
   * Explicit-cancel termination path — mirrors the pre-watchdog `cancelTurn` behavior
   * exactly: the provider must declare `cancelTurn` capability (throws
   * `CapabilityNotSupportedError` when missing), and provider-level cancellation errors
   * bubble directly to the caller.
   */
  async #cancelRunningTurn(state, error) {
    state.abortController.abort();
    const agentProvider = this.registry.require(state.provider, 'cancelTurn', 'cancelTurn');
    if (state.privateOperation) {
      await agentProvider.cancelTurn({
        turnId: state.turnId,
        providerSessionId: state.providerSessionId,
        identity: state.identity,
        operation: state.privateOperation,
      });
    }
    this.#finish(state, 'turn.failed', error);
  }

  /**
   * Best-effort termination path used by the idle watchdog: a hung turn must still reach
   * a terminal state even when the provider doesn't declare `cancelTurn` capability, or
   * provider-level cancellation itself fails.
   */
  async #timeoutRunningTurn(state, error) {
    if (this.#isTerminal(state)) return;
    state.tracer?.record?.({
      source: 'coordinator',
      event: 'timeout.fired',
      initiator: 'runtime',
      cause: 'timeout/protocol-silence',
      timeout: {
        kind: 'protocol-silence',
        deadlineMs: this.idleTimeoutMs,
      },
    });
    const entry = this.registry.get(state.provider);
    if (state.privateOperation && entry?.provider?.cancelTurn) {
      try {
        await entry.provider.cancelTurn({
          turnId: state.turnId,
          providerSessionId: state.providerSessionId,
          identity: state.identity,
          operation: state.privateOperation,
        });
      } catch {}
    }
    state.abortController.abort();
    this.#finish(state, 'turn.failed', error);
  }

  #checkIdleTurns() {
    if (this.idleTimeoutMs <= 0) return;
    const now = this.clock().getTime();
    for (const state of this.#turns.values()) {
      if (state.status !== 'running') continue;
      const lastActivityAt = state.lastActivityAt ?? (state.startedAt ? new Date(state.startedAt).getTime() : now);
      if (now - lastActivityAt >= this.idleTimeoutMs) {
        void this.#timeoutRunningTurn(state, new AiError(
          'AI_TURN_TIMEOUT',
          'The turn was cancelled because it stopped responding.',
          { status: 504 },
        ));
      }
    }
  }

  /**
   * Boot-time reconciliation (D9): finalizes any persisted `activeTurn` left behind by a
   * session whose owning turn was never terminated (ungraceful restart), since the
   * in-memory `turnRuntime` always starts empty. Restart-resumable pending interactions
   * are left untouched; live-operation interactions are interrupted because their
   * provider correlation disappeared with the owning process. Safe to call even when the
   * `transcriptCache` doesn't support persisted-session enumeration (e.g. a test double).
   */
  async reconcileOrphanedTurns() {
    return reconcileOrphanedTurns(this.transcriptCache);
  }

  getSnapshot(turnId) {
    let state = this.#turns.get(turnId);
    if (!state && this.transcriptCache) {
      const persistedSnapshot = getPersistedTurnSnapshot({
        transcriptCache: this.transcriptCache,
        turnId,
      });
      if (persistedSnapshot) return persistedSnapshot;
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
      lastEventId: this.#eventStream.getTurnSequence(state.turnId),
      pendingInteraction: state.pendingInteraction ? structuredClone(state.pendingInteraction) : null,
      events: this.#eventStream.getTurnEvents(state.turnId, 0),
    };
  }

  getEvents(turnId, afterSequence = 0) {
    const state = this.#get(turnId);
    return this.#eventStream.getTurnEvents(state.turnId, afterSequence);
  }

  subscribe(turnId, options = {}) {
    const state = this.#get(turnId);
    return this.#eventStream.subscribeToTurn(state.turnId, {
      ...options,
      isTerminal: this.#isTerminal(state),
    });
  }

  subscribeToSession({ provider, providerSessionId }, options = {}) {
    return this.#eventStream.subscribeToSession({ provider, providerSessionId }, options);
  }

  shutdown() {
    if (this.#closed) return this.#shutdownPromise ?? Promise.resolve();
    this.#closed = true;
    if (this.#idleWatchdogTimer) {
      clearInterval(this.#idleWatchdogTimer);
      this.#idleWatchdogTimer = null;
    }
    const transcriptFlushes = [];
    for (const state of this.#turns.values()) {
      if (this.#isTerminal(state)) continue;
      if (state.status === 'waitingForUser' && state.pendingInteraction?.resumePolicy !== 'live-operation') continue;
      state.abortController.abort();
      transcriptFlushes.push(this.#finish(state, 'turn.failed', new AiError('AI_TURN_INTERRUPTED', 'The server stopped before the turn completed.', { status: 503 })));
    }
    this.#shutdownPromise = Promise.all(transcriptFlushes).then(() => this.registry?.dispose?.());
    return this.#shutdownPromise;
  }

  #finish(state, type, error) {
    if (this.#isTerminal(state)) return Promise.resolve();
    state.pendingInteraction = null;
    state.status = type === 'turn.completed' ? 'completed' : 'failed';
    state.completedAt = this.#timestamp();
    this.#activeBySession.delete(state.key);
    this.#notifyProviderState(state);
    console.log(`[ai] [turn:${type}] turnId=${state.turnId} provider=${state.provider} session=${state.providerSessionId}${error ? ` error="${error.message}"` : ''}`);
    this.#emit(state, type, error ? { error: publicFailure(error) } : {});
    this.#eventStream.clearTurnSubscribers(state.turnId);
    this.#terminalOrder.push(state.turnId);
    while (this.#terminalOrder.length > this.maxRetainedTurns) {
      const evicted = this.#terminalOrder.shift();
      this.#turns.delete(evicted);
      this.#eventStream.releaseTurn(evicted);
    }
    if (this.transcriptCache && state.provider && state.providerSessionId) {
      this.transcriptCache.flush(state.provider, state.providerSessionId).catch(() => {});
    }
    state.tracer?.flush?.().catch?.(() => {});
    return Promise.resolve();
  }

  #emit(state, type, data = {}) {
    const event = this.#eventStream.emit(state.turnId, type, data);
    if (TURN_ACTIVITY_EVENT_TYPES.has(type)) {
      state.lastActivityAt = this.clock().getTime();
    }
    if (state?.tracer) {
      if (type === 'tool.started') {
        state.tracer.record({ source: 'tool', event: 'tool.started', subjectId: data.toolId, metadata: { toolName: data.toolName } });
      } else if (type === 'tool.updated') {
        state.tracer.record({ source: 'tool', event: 'tool.updated', subjectId: data.toolId, metadata: { status: data.status } });
      } else if (type === 'tool.completed') {
        state.tracer.record({ source: 'tool', event: 'tool.completed', subjectId: data.toolId, disposition: data.status === 'completed' ? 'accepted' : 'ignored', metadata: { status: data.status, durationMs: data.durationMs } });
      } else if (type === 'interaction.requested') {
        state.tracer.record({ source: 'runtime', event: 'interaction.requested', subjectId: data.interaction?.id, afterStatus: { status: 'requiresAttention', reason: data.interaction?.kind, interactionId: data.interaction?.id }, metadata: { kind: data.interaction?.kind } });
      } else if (type === 'interaction.resolved') {
        state.tracer.record({ source: 'runtime', event: 'interaction.resolved', subjectId: data.interactionId, disposition: 'accepted' });
      } else if (type === 'turn.completed' || type === 'turn.failed') {
        state.tracer.record({
          source: 'coordinator',
          event: type,
          disposition: 'accepted',
          afterStatus: { status: 'terminal', outcome: type === 'turn.completed' ? 'completed' : 'failed', initiator: 'provider' },
          cause: data.error?.code,
        });
      }
    }
    return event;
  }

  #notifyProviderState(state) {
    state.agentProvider.onTurnState?.({
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

export function createAgentTurnRuntime(options) {
  return new AgentTurnRuntime(options);
}
