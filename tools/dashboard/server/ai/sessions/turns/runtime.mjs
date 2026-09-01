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
  normalizeTransitionalToolStatus,
} from '../../contracts.mjs';
import { createTranscriptCacheService } from '../transcript-cache.mjs';
import { TurnLifecycleCoordinator } from './coordinator.mjs';
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
  'commentary.delta',
  'final_answer.delta',
  'text.delta',
  'progress.delta',
  'reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'tool.action.added',
  'usage.updated',
]);

/**
 * Main application-facing Agent Turn runtime facade.
 * Coordinates turn lifecycle admission, provider turn orchestration,
 * process termination, and delegates semantic lifecycle ownership
 * exclusively to TurnLifecycleCoordinator.
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

  #mapLegacyStatus(canonicalStatus) {
    if (!canonicalStatus) return 'running';
    const s = canonicalStatus.status;
    if (s === 'requiresAttention') return 'waitingForUser';
    if (s === 'active' || s === 'waiting' || s === 'cancelling') return 'running';
    if (s === 'terminal') return canonicalStatus.outcome === 'completed' ? 'completed' : 'failed';
    return 'failed';
  }

  async startTurn({ provider, providerSessionId, sessionId, message, prompt, userMessage, mode, idempotencyKey, onSessionEstablished, isSessionEstablished = true } = {}) {
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
    // The user-visible chat text. Defaults to inputMessage for a plain composer send
    // (message === displayed text); a caller-enriched prompt (e.g. injected task/spec
    // context) supplies a separate, clean `userMessage` so the chat bubble never shows
    // automatically injected context the user did not type.
    const displayMessage = (typeof userMessage === 'string' && userMessage.trim()) ? userMessage : inputMessage;
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
          text: displayMessage,
          createdAt: startedAt,
        });
      }

      this.#eventStream.registerTurn({
        turnId,
        provider: isNewSession ? undefined : provider,
        providerSessionId: isNewSession ? undefined : providerSessionId,
        initialSequence: initialSeq,
      });

      const coordinator = new TurnLifecycleCoordinator({
        turnId,
        sessionId: providerSessionId || null,
        provider,
        providerSessionId: providerSessionId || null,
        mode: validatedMode,
        prompt: inputMessage,
        userMessage: displayMessage,
        traceSink: this.traceSink,
        onTurnUpdated: (turnSnapshot, { semantic = true } = {}) => {
          const sessId = turnSnapshot.providerSessionId || state?.providerSessionId;
          if (sessId && this.transcriptCache?.recordCanonicalTurn) {
            turnSnapshot.prompt = turnSnapshot.prompt || inputMessage;
            turnSnapshot.userMessage = turnSnapshot.userMessage || { text: displayMessage, createdAt: startedAt };
            this.transcriptCache.recordCanonicalTurn(turnSnapshot.provider, sessId, turnSnapshot);
          }
          if (state && semantic) {
            this.#emit(state, 'turn.updated', { turn: turnSnapshot });
          }
        },
      });
      coordinator.touchActivity(this.clock().getTime());

      const state = {
        turnId,
        coordinator,
        provider,
        providerSessionId: providerSessionId || undefined,
        identity: providerSessionId ? { provider, providerSessionId } : undefined,
        key,
        mode: validatedMode,
        idempotencyKey,
        onSessionEstablished,
        isSessionEstablished,
        // Distinguishes "this providerSessionId was already known when the turn started"
        // (a caller-supplied ID, possibly still unconfirmed by the provider) from an ID
        // the provider allocates during this very turn — only the former can receive a
        // later provider-confirmation notification; the latter is already fully handled
        // by the initial-binding branch below and must not be notified a second time.
        hadInitialProviderSessionId: Boolean(providerSessionId),
        providerConfirmed: false,
        finished: false,
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
        if (!allocatedSessionId) return;

        if (!state.providerSessionId) {
          state.coordinator.bindProviderSessionId(allocatedSessionId);
          state.providerSessionId = allocatedSessionId;
          state.identity = { provider: state.provider, providerSessionId: allocatedSessionId };
          state.key = sessionKey(state.provider, allocatedSessionId);
          this.#activeBySession.set(state.key, state.turnId);
          this.#eventStream.bindSession(state.turnId, { provider: state.provider, providerSessionId: allocatedSessionId });
          if (this.transcriptCache?.recordCanonicalTurn) {
            const snap = state.coordinator.getCanonicalSnapshot();
            snap.prompt = inputMessage;
            snap.userMessage = snap.userMessage || { text: displayMessage, createdAt: startedAt };
            this.transcriptCache.recordCanonicalTurn(state.provider, allocatedSessionId, snap);
          }
          if (this.transcriptCache) {
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
          return;
        }

        // The turn already carried a providerSessionId (e.g. a locally pre-allocated
        // placeholder). This is the provider's first authoritative confirmation that a
        // real conversation now exists under that exact ID — durably persist that fact
        // (once) so later turns on this session resume instead of repeating first-turn
        // creation semantics.
        if (
          state.hadInitialProviderSessionId &&
          !state.providerConfirmed &&
          state.providerSessionId === allocatedSessionId &&
          state.onSessionEstablished
        ) {
          state.providerConfirmed = true;
          try {
            await state.onSessionEstablished(allocatedSessionId);
          } catch (err) {
            console.warn(`[ai] Failed to persist provider session confirmation for ${state.provider}:${allocatedSessionId}: ${err?.message || err}`);
          }
        }
      };

      this.#turns.set(turnId, state);
      if (!isNewSession) {
        this.#activeBySession.set(key, turnId);
      }
      this.#notifyProviderState(state);
      this.#emit(state, 'turn.started', {
        mode: state.mode,
        // Broadcasts the clean, user-visible text — never the enriched/injected prompt
        // actually sent to the provider (see displayMessage above).
        userPrompt: displayMessage,
        userMessage: {
          id: `user-${turnId}`,
          role: 'user',
          text: displayMessage,
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
      isSessionEstablished: state.isSessionEstablished,
      identity: state.identity,
      mode: state.mode,
      signal: state.abortController.signal,
      setOperation: operation => { state.privateOperation = operation; },
      emitCommentaryDelta: (text, commentaryId) => this.#emitCommentaryDelta(state, text, commentaryId),
      emitReasoningDelta: (text, reasoningId, representation) => this.#emitReasoningDelta(state, text, reasoningId, representation),
      emitFinalAnswerDelta: (text, finalAnswerId, confidence) => this.#emitFinalAnswerDelta(state, text, finalAnswerId, confidence),
      setFinalAnswer: finalAnswerData => this.#setFinalAnswer(state, finalAnswerData),
      emitToolStarted: tool => this.#emitToolStarted(state, tool),
      emitToolUpdated: tool => this.#emitToolUpdated(state, tool),
      emitToolCompleted: tool => this.#emitToolCompleted(state, tool),
      addToolAction: (toolId, action) => this.#addToolAction(state, toolId, action),
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
        state.coordinator.recordInteractionRequested({ interaction });
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
        state.coordinator.recordInteractionRequested({ interaction: nextInteraction });
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

  #emitCommentaryDelta(state, text, commentaryId = `commentary-${state.turnId}`) {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid commentary delta.', { status: 502 });
    }
    state.coordinator.recordCommentaryDelta(text, commentaryId);
    this.#emit(state, 'text.delta', { messageId: commentaryId, text, delta: text });
  }

  #emitFinalAnswerDelta(state, text, finalAnswerId = 'final-answer', confidence = undefined) {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid final answer delta.', { status: 502 });
    }
    state.coordinator.recordFinalAnswerDelta(text, finalAnswerId, confidence);
    this.#emit(state, 'text.delta', { messageId: finalAnswerId, text, delta: text });
  }

  #setFinalAnswer(state, finalAnswerData) {
    if (this.#isTerminal(state)) return null;
    return state.coordinator.setFinalAnswer(finalAnswerData);
  }

  #emitReasoningDelta(state, text, messageId = `reasoning-${state.turnId}`, representation = 'raw_text') {
    if (this.#isTerminal(state)) return;
    if (typeof text !== 'string' || text.length === 0 || text.length > 50_000) {
      throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider emitted an invalid reasoning delta.', { status: 502 });
    }
    state.coordinator.recordReasoningDelta(text, messageId, representation);
    this.#emit(state, 'reasoning.delta', { messageId, text });
  }

  #emitToolStarted(state, { toolId, toolName, input, kind, title, description, actions, status } = {}) {
    if (this.#isTerminal(state)) return;
    const normalizedStatus = normalizeTransitionalToolStatus(status, 'active');
    state.coordinator.recordToolStarted({ toolId, toolName, input, kind, title, description, actions, status: normalizedStatus });
    this.#emit(state, 'tool.started', { toolId, toolName, input: input === undefined ? {} : input });
  }

  #emitToolUpdated(state, { toolId, output, status, progress, durationMs, exitCode, actions } = {}) {
    if (this.#isTerminal(state)) return;
    const normalizedStatus = normalizeTransitionalToolStatus(status, 'active');
    state.coordinator.recordToolUpdated({ toolId, output, status: normalizedStatus, progress, durationMs, exitCode, actions });
    this.#emit(state, 'tool.updated', { toolId, output, status: normalizedStatus });
  }

  #emitToolCompleted(state, { toolId, output, durationMs, status, exitCode, actions, closureReason } = {}) {
    if (this.#isTerminal(state)) return;
    const normalizedStatus = normalizeTransitionalToolStatus(status, 'completed');
    state.coordinator.recordToolCompleted({ toolId, output, durationMs, status: normalizedStatus, exitCode, actions, closureReason });
    this.#emit(state, 'tool.completed', { toolId, output, durationMs, status: normalizedStatus });
  }

  #addToolAction(state, toolId, actionData) {
    if (this.#isTerminal(state)) return null;
    return state.coordinator.addToolAction(toolId, actionData);
  }

  #emitUsageUpdated(state, { tokensIn, tokensOut, cost } = {}) {
    if (this.#isTerminal(state)) return;
    state.coordinator.touchActivity(this.clock().getTime());
    this.#emit(state, 'usage.updated', { tokensIn, tokensOut, cost });
  }

  #requestInteraction(state, value, { resumePolicy = 'restart' } = {}) {
    if (this.#isTerminal(state)) throw new AiError('AI_TURN_TERMINAL', 'The turn is already terminal.', { status: 409 });
    if (state.coordinator.pendingInteraction) throw new AiError('AI_INTERACTION_PENDING', 'The turn already has a pending interaction.', { status: 409 });
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
    state.coordinator.recordInteractionRequested({ interaction });
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
      transcriptCache: this.transcriptCache,
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

    if (this.#isTerminal(state) || state.coordinator.isCancelling) {
      throw new AiNotFoundError('The turn is already cancelling or terminal.', { turnId: state.turnId, interactionId });
    }

    const pending = state.coordinator.pendingInteraction;
    if (!pending || pending.id !== interactionId) {
      throw new AiNotFoundError('The pending interaction was not found for this turn.', { turnId: state.turnId, interactionId });
    }
    const normalized = validateInteractionResponse(pending, response);
    const interaction = structuredClone(pending);

    state.coordinator.recordInteractionResolved({ interactionId, response: normalized });
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

    const isWaiting = state.coordinator.status.status === 'requiresAttention' || state.coordinator.pendingInteraction;
    const accepted = state.coordinator.requestCancellation({ initiator: 'user' });
    if (!accepted) return this.getSnapshot(turnId);

    if (isWaiting) {
      const error = new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 });
      if (state.privateOperation) {
        await this.#cancelRunningTurn(state, error);
      } else {
        this.#finish(state, 'turn.failed', error, { outcome: 'cancelled', initiator: 'user' });
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
    this.#finish(state, 'turn.failed', error, { outcome: 'cancelled', initiator: 'user' });
  }

  /**
   * Best-effort termination path used by the idle watchdog: a hung turn must still reach
   * a terminal state even when the provider doesn't declare `cancelTurn` capability, or
   * provider-level cancellation itself fails.
   */
  async #timeoutRunningTurn(state, error) {
    if (state.finished) return;
    const accepted = state.coordinator.requestTimeoutIntent({ cause: 'timeout/protocol-silence', initiator: 'runtime' });
    if (!accepted) return;
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
    await this.#finish(state, 'turn.failed', error, { outcome: 'failed', initiator: 'runtime', cause: 'timeout/protocol-silence' });
  }

  #checkIdleTurns() {
    if (this.idleTimeoutMs <= 0) return;
    const now = this.clock().getTime();
    for (const state of this.#turns.values()) {
      if (state.finished) continue;
      const check = state.coordinator.checkProtocolSilence(now, this.idleTimeoutMs);
      if (check.fired) {
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
      providerSessionId: state.coordinator?.turn?.providerSessionId || state.providerSessionId,
      status: this.#mapLegacyStatus(state.coordinator?.status),
      startedAt: state.startedAt,
      ...(state.completedAt ? { completedAt: state.completedAt } : {}),
      lastEventId: this.#eventStream.getTurnSequence(state.turnId),
      pendingInteraction: state.coordinator?.pendingInteraction ? structuredClone(state.coordinator.pendingInteraction) : null,
      events: this.#eventStream.getTurnEvents(state.turnId, 0),
    };
  }

  getCanonicalTurn(turnId) {
    const state = this.#turns.get(turnId);
    return state?.coordinator?.turn ?? null;
  }

  setFinalAnswer(turnId, finalAnswerData) {
    const state = this.#get(turnId);
    const answer = state.coordinator.setFinalAnswer(finalAnswerData);
    this.#notifyProviderState(state);
    return answer;
  }

  getCoordinator(turnId) {
    const state = this.#turns.get(turnId);
    return state?.coordinator ?? null;
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
      if (this.#isTerminal(state)) {
        if (state.provider && state.providerSessionId && this.transcriptCache) {
          transcriptFlushes.push(this.transcriptCache.flush(state.provider, state.providerSessionId).catch(() => {}));
        }
        continue;
      }
      if (state.coordinator.status.status === 'requiresAttention' && state.coordinator.pendingInteraction?.resumePolicy !== 'live-operation') {
        if (state.provider && state.providerSessionId && this.transcriptCache) {
          transcriptFlushes.push(this.transcriptCache.flush(state.provider, state.providerSessionId).catch(() => {}));
        }
        continue;
      }
      state.abortController.abort();
      transcriptFlushes.push(
        this.#finish(
          state,
          'turn.failed',
          new AiError('AI_TURN_INTERRUPTED', 'The server stopped before the turn completed.', { status: 503 }),
          { outcome: 'interrupted', initiator: 'shutdown' },
        ),
      );
    }
    if (this.transcriptCache?.flushAll) {
      transcriptFlushes.push(this.transcriptCache.flushAll().catch(() => {}));
    }
    this.#shutdownPromise = Promise.all(transcriptFlushes).then(() => this.registry?.dispose?.());
    return this.#shutdownPromise;
  }

  #finish(state, type, error, options = {}) {
    if (state.finished) return Promise.resolve();
    state.finished = true;

    const outcome = options.outcome ?? (type === 'turn.completed' ? 'completed' : 'failed');
    const cause = options.cause ?? error?.code;
    const terminalStatus = state.coordinator.settleTerminal({
      outcome,
      initiator: options.initiator ?? 'provider',
      cause,
      error: error ? publicFailure(error) : undefined,
    });

    state.completedAt = this.#timestamp();
    this.#activeBySession.delete(state.key);
    this.#notifyProviderState(state);

    // Authoritative external event derivation from accepted canonical outcome
    let effectiveEventType = 'turn.completed';
    let eventData = {};

    if (terminalStatus.outcome === 'completed') {
      effectiveEventType = 'turn.completed';
      eventData = {};
    } else {
      effectiveEventType = 'turn.failed';
      const terminalErr = terminalStatus.error;
      const status = terminalErr?.code === 'AI_TURN_TIMEOUT'
        ? 504
        : (terminalErr?.code === 'AI_TURN_CANCELLED' ? 409 : (error?.status || 500));
      eventData = {
        error: publicFailure(
          terminalErr
            ? new AiError(terminalErr.code, terminalErr.message, { status })
            : (error ?? new AiError('AI_TURN_FAILED', 'The turn failed.', { status: 500 })),
        ),
      };
    }

    console.log(
      `[ai] [turn:${effectiveEventType}] turnId=${state.turnId} provider=${state.provider} session=${state.providerSessionId}${
        eventData.error ? ` error="${eventData.error.message}"` : ''
      }`,
    );
    this.#emit(state, effectiveEventType, eventData);
    this.#eventStream.clearTurnSubscribers(state.turnId);
    this.#terminalOrder.push(state.turnId);
    while (this.#terminalOrder.length > this.maxRetainedTurns) {
      const evicted = this.#terminalOrder.shift();
      this.#turns.delete(evicted);
      this.#eventStream.releaseTurn(evicted);
    }
    let flushPromise = Promise.resolve();
    if (this.transcriptCache && state.provider && state.providerSessionId) {
      flushPromise = this.transcriptCache.flush(state.provider, state.providerSessionId).catch(() => {});
    }
    const tracePromise = state.coordinator.flushTrace().catch(() => {});
    return Promise.all([flushPromise, tracePromise]).then(() => {});
  }

  #emit(state, type, data = {}) {
    const event = this.#eventStream.emit(state.turnId, type, data);
    if (TURN_ACTIVITY_EVENT_TYPES.has(type)) {
      const now = this.clock().getTime();
      state.lastActivityAt = now;
      state.coordinator.touchActivity(now);
    }
    return event;
  }

  #notifyProviderState(state) {
    state.agentProvider.onTurnState?.({
      turnId: state.turnId,
      provider: state.provider,
      providerSessionId: state.providerSessionId,
      status: this.#mapLegacyStatus(state.coordinator?.status),
      canonicalStatus: state.coordinator?.status,
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
    return state?.finished || state?.coordinator?.isTerminal;
  }
}

export function createAgentTurnRuntime(options) {
  return new AgentTurnRuntime(options);
}
