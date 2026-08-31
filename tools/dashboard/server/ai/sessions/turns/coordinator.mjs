import {
  AiError,
  AiValidationError,
  createCanonicalTurn,
  bindTurnProviderSessionId,
  appendWorkItem,
  updateWorkItem,
  addToolAction as appendToolAction,
  setFinalAnswer as assignFinalAnswer,
  setTurnStatus,
  computeCurrentActivity,
  getGlobalTraceSink,
  normalizeTransitionalToolStatus,
} from '../../contracts.mjs';

/**
 * TurnLifecycleCoordinator: Authoritative synchronous in-memory owner of Turn status transitions,
 * ordered Work sequence, multi-tool tracking, timeout decisions, deterministic terminal arbitration,
 * and lifecycle trace recording.
 */
export class TurnLifecycleCoordinator {
  #turn;
  #tracer;
  #openToolIds = new Set();
  #pendingInteractionId = null;
  #isRecoverableWait = false;
  #lastQualifyingActivityAt = Date.now();
  #isTerminal = false;
  #activeCommentaryId = null;
  #activeReasoningId = null;
  #cancellationRequested = false;
  #cancellationInitiator = null;
  #cancellationCause = null;
  #timeoutRequested = false;
  #timeoutInitiator = null;
  #timeoutCause = null;
  #onTurnUpdated = null;
  #pendingUpdateTimer = null;

  constructor({
    turnId,
    sessionId = null,
    provider,
    providerSessionId = null,
    mode = 'edit',
    prompt = null,
    traceSink = null,
    turn = null,
    onTurnUpdated = null,
  }) {
    this.#onTurnUpdated = onTurnUpdated;
    this.#turn = turn ? structuredClone(turn) : createCanonicalTurn({
      id: turnId,
      sessionId: sessionId || providerSessionId || null,
      provider,
      providerSessionId: providerSessionId || null,
      mode,
    });
    if (prompt && !this.#turn.prompt) {
      this.#turn.prompt = prompt;
    }

    if (turn && Array.isArray(turn.work)) {
      for (const item of turn.work) {
        if (item.type === 'tool' && (item.status === 'active' || item.status === 'queued')) {
          this.#openToolIds.add(item.id);
        } else if (item.type === 'interaction' && item.status === 'pending') {
          this.#pendingInteractionId = item.id;
        }
      }
    }

    const sink = traceSink ?? getGlobalTraceSink();
    this.#tracer = sink?.createTurnTracer?.({
      turnId,
      sessionId: this.#turn.sessionId,
      provider,
      providerSessionId: this.#turn.providerSessionId,
    });

    this.#tracer?.record?.({
      source: 'coordinator',
      event: 'turn.started',
      disposition: 'accepted',
      afterStatus: this.#turn.status,
    });
    this.#notifyTurnUpdated({ semantic: false });
  }

  #notifyTurnUpdated({ semantic = true } = {}) {
    if (typeof this.#onTurnUpdated !== 'function') return;

    if (semantic === true) {
      if (this.#pendingUpdateTimer) {
        clearTimeout(this.#pendingUpdateTimer);
        this.#pendingUpdateTimer = null;
      }
      try {
        this.#onTurnUpdated(this.getCanonicalSnapshot(), { semantic: true });
      } catch {}
      return;
    }

    if (semantic === 'throttled') {
      if (this.#pendingUpdateTimer) {
        // High-frequency token delta: in-memory #turn updated in-place without snapshot cloning.
        return;
      }
      this.#pendingUpdateTimer = setTimeout(() => {
        this.#pendingUpdateTimer = null;
        if (!this.#isTerminal) {
          try {
            this.#onTurnUpdated(this.getCanonicalSnapshot(), { semantic: true });
          } catch {}
        }
      }, 50);
      this.#pendingUpdateTimer.unref?.();
    }
  }

  flushPendingUpdates() {
    if (this.#pendingUpdateTimer) {
      clearTimeout(this.#pendingUpdateTimer);
      this.#pendingUpdateTimer = null;
      try {
        this.#onTurnUpdated?.(this.getCanonicalSnapshot(), { semantic: true });
      } catch {}
    }
  }

  getCanonicalSnapshot() {
    return structuredClone(this.#turn);
  }

  get turn() {
    return this.#turn;
  }

  get status() {
    return this.#turn.status;
  }

  get isTerminal() {
    return this.#isTerminal || this.#turn.status.status === 'terminal';
  }

  get isCancelling() {
    return this.#cancellationRequested || this.#turn.status.status === 'cancelling';
  }

  get hasOpenTools() {
    return this.#openToolIds.size > 0;
  }

  get openToolCount() {
    return this.#openToolIds.size;
  }

  get pendingInteractionId() {
    return this.#pendingInteractionId;
  }

  get pendingInteraction() {
    if (!this.#pendingInteractionId || this.isTerminal) return null;
    const item = this.#turn.work.find(
      w => w.id === this.#pendingInteractionId && w.type === 'interaction' && w.status === 'pending',
    );
    return item?.interaction ? structuredClone(item.interaction) : null;
  }

  get lastQualifyingActivityAt() {
    return this.#lastQualifyingActivityAt;
  }

  get tracer() {
    return this.#tracer;
  }

  touchActivity(timestamp = Date.now()) {
    this.#lastQualifyingActivityAt = typeof timestamp === 'number' ? timestamp : Date.now();
  }

  setRecoverableWait(value = true) {
    this.#isRecoverableWait = Boolean(value);
  }

  /**
   * Bind providerSessionId late when provider confirms/allocates it.
   */
  bindProviderSessionId(allocatedSessionId) {
    const boundId = bindTurnProviderSessionId(this.#turn, allocatedSessionId);
    this.#tracer?.record?.({
      source: 'coordinator',
      event: 'provider_session.bound',
      subjectId: boundId,
      disposition: 'accepted',
      metadata: { providerSessionId: boundId, sessionId: this.#turn.sessionId },
    });
    this.#notifyTurnUpdated({ semantic: true });
    return boundId;
  }

  /**
   * Request status transition through the coordinator.
   */
  requestStatusTransition(newStatusData, { source = 'coordinator', initiator } = {}) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source,
        event: 'transition.ignored',
        disposition: 'ignored',
        beforeStatus: this.#turn.status,
        initiator,
        metadata: { requestedStatus: newStatusData },
      });
      return this.#turn.status;
    }

    const beforeStatus = structuredClone(this.#turn.status);
    const after = setTurnStatus(this.#turn, newStatusData);

    if (after.status === 'terminal') {
      this.#isTerminal = true;
      this.#closeDanglingTools(after.outcome, after.cause);
      if (this.#pendingInteractionId) {
        try {
          updateWorkItem(this.#turn, this.#pendingInteractionId, {
            status: after.outcome === 'cancelled' ? 'cancelled' : 'denied',
          });
        } catch {}
        this.#pendingInteractionId = null;
      }
    }

    this.#tracer?.record?.({
      source,
      event: 'transition.accepted',
      disposition: 'accepted',
      beforeStatus,
      afterStatus: after,
      initiator: initiator ?? after.initiator,
      cause: after.cause,
    });

    this.#notifyTurnUpdated({ semantic: true });
    return after;
  }

  #closeDanglingTools(outcome = 'failed', cause = null) {
    let closureReason = 'turn_failed';
    let toolStatus = 'failed';

    if (outcome === 'completed') {
      closureReason = 'turn_completed';
      toolStatus = 'failed';
    } else if (outcome === 'cancelled') {
      closureReason = 'turn_cancelled';
      toolStatus = 'cancelled';
    } else if (outcome === 'interrupted') {
      closureReason = 'turn_interrupted';
      toolStatus = 'interrupted';
    } else if (cause === 'timeout/protocol-silence' || cause === 'AI_TURN_TIMEOUT') {
      closureReason = 'timeout';
      toolStatus = 'failed';
    } else if (cause === 'process_exit') {
      closureReason = 'process_exit';
      toolStatus = 'failed';
    } else if (outcome === 'unknown') {
      closureReason = 'unknown';
      toolStatus = 'unknown';
    } else {
      closureReason = 'turn_failed';
      toolStatus = 'failed';
    }

    for (const toolId of this.#openToolIds) {
      try {
        updateWorkItem(this.#turn, toolId, {
          status: toolStatus,
          closureReason,
        });
        this.#tracer?.record?.({
          source: 'coordinator',
          event: 'tool.inferred_closed',
          subjectId: toolId,
          metadata: { status: toolStatus, closureReason },
        });
      } catch {}
    }
    this.#openToolIds.clear();
  }

  /**
   * Append a new top-level Work item with monotonic sequence.
   */
  appendWork(itemData, { source = 'adapter' } = {}) {
    if (this.isTerminal || this.isCancelling) {
      this.#tracer?.record?.({
        source,
        event: 'work.ignored',
        disposition: 'ignored',
        metadata: { itemType: itemData.type, itemId: itemData.id },
      });
      return null;
    }

    this.touchActivity();
    const item = appendWorkItem(this.#turn, itemData);

    if (item.type === 'tool' && (item.status === 'active' || item.status === 'queued')) {
      this.#openToolIds.add(item.id);
    } else if (item.type === 'interaction' && item.status === 'pending') {
      this.#pendingInteractionId = item.id;
    }

    this.#tracer?.record?.({
      source,
      event: `work.${item.type}.appended`,
      disposition: 'accepted',
      subjectId: item.id,
      metadata: { seq: item.seq, type: item.type },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Update an existing Work item in place.
   */
  updateWork(itemId, deltaData, { source = 'adapter' } = {}) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source,
        event: 'work.update_ignored',
        disposition: 'ignored',
        subjectId: itemId,
        metadata: deltaData,
      });
      return this.#turn.work.find(w => w.id === itemId) || null;
    }

    this.touchActivity();
    const item = updateWorkItem(this.#turn, itemId, deltaData);

    if (item.type === 'tool') {
      if (['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(item.status)) {
        this.#openToolIds.delete(item.id);
      }
    } else if (item.type === 'interaction') {
      if (['resolved', 'denied', 'rejected', 'cancelled', 'expired'].includes(item.status)) {
        if (this.#pendingInteractionId === item.id) {
          this.#pendingInteractionId = null;
        }
      }
    }

    this.#tracer?.record?.({
      source,
      event: `work.${item.type}.updated`,
      disposition: 'accepted',
      subjectId: item.id,
      metadata: { status: item.status },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Record arrival of a commentary delta in Work[].
   */
  recordCommentaryDelta(text, messageId = `commentary-${this.#turn.id}-${this.#turn.work.length + 1}`) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    let currentItem = this.#activeCommentaryId
      ? this.#turn.work.find(w => w.id === this.#activeCommentaryId && w.type === 'commentary' && w.status === 'streaming')
      : null;

    let isNewBlock = false;
    if (!currentItem) {
      isNewBlock = true;
      const generatedId = (messageId && !this.#turn.work.some(w => w.id === messageId))
        ? messageId
        : `commentary-${this.#turn.id}-${this.#turn.work.length + 1}`;
      this.#activeCommentaryId = generatedId;
      currentItem = appendWorkItem(this.#turn, {
        id: this.#activeCommentaryId,
        type: 'commentary',
        text,
        status: 'streaming',
      });
      this.#tracer?.record?.({
        source: 'adapter',
        event: 'commentary.started',
        subjectId: currentItem.id,
        disposition: 'accepted',
      });
    } else {
      currentItem = updateWorkItem(this.#turn, currentItem.id, {
        text: (currentItem.text || '') + text,
        status: 'streaming',
      });
    }
    this.#notifyTurnUpdated({ semantic: isNewBlock ? true : 'throttled' });
    return currentItem;
  }

  /**
   * Record arrival of a legacy text delta (maps to commentary).
   */
  recordTextDelta(text, messageId = `msg-${this.#turn.id}`) {
    return this.recordCommentaryDelta(text, messageId);
  }

  /**
   * Record arrival of a reasoning delta in Work[].
   */
  recordReasoningDelta(text, messageId = `reasoning-${this.#turn.id}`, representation = 'raw_text') {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    let currentItem = this.#activeReasoningId
      ? this.#turn.work.find(w => w.id === this.#activeReasoningId && w.type === 'reasoning' && w.status === 'streaming')
      : null;

    let isNewBlock = false;
    if (!currentItem) {
      isNewBlock = true;
      const generatedId = (messageId && !this.#turn.work.some(w => w.id === messageId))
        ? messageId
        : `reasoning-${this.#turn.id}-${this.#turn.work.length + 1}`;
      this.#activeReasoningId = generatedId;
      currentItem = appendWorkItem(this.#turn, {
        id: this.#activeReasoningId,
        type: 'reasoning',
        representation,
        text,
        status: 'streaming',
      });
      this.#tracer?.record?.({
        source: 'adapter',
        event: 'reasoning.started',
        subjectId: currentItem.id,
        disposition: 'accepted',
      });
    } else {
      currentItem = updateWorkItem(this.#turn, currentItem.id, {
        text: (currentItem.text || '') + text,
        status: 'streaming',
      });
    }
    this.#notifyTurnUpdated({ semantic: isNewBlock ? true : 'throttled' });
    return currentItem;
  }

  /**
   * Record arrival of a final answer delta outside Work[].
   */
  recordFinalAnswerDelta(text, finalAnswerId = 'final-answer', confidence = undefined) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    if (this.#activeCommentaryId) {
      try {
        updateWorkItem(this.#turn, this.#activeCommentaryId, { status: 'completed' });
      } catch {}
      this.#activeCommentaryId = null;
    }
    if (this.#activeReasoningId) {
      try {
        updateWorkItem(this.#turn, this.#activeReasoningId, { status: 'completed' });
      } catch {}
      this.#activeReasoningId = null;
    }

    let isNewBlock = false;
    const now = new Date().toISOString();
    if (!this.#turn.finalAnswer) {
      isNewBlock = true;
      this.#turn.finalAnswer = {
        id: finalAnswerId,
        text,
        status: 'streaming',
        ...(confidence ? { confidence } : {}),
        createdAt: now,
        updatedAt: now,
      };
      this.#tracer?.record?.({
        source: 'adapter',
        event: 'final_answer.started',
        subjectId: finalAnswerId,
        disposition: 'accepted',
      });
    } else {
      this.#turn.finalAnswer.text = (this.#turn.finalAnswer.text || '') + text;
      this.#turn.finalAnswer.status = 'streaming';
      if (confidence) this.#turn.finalAnswer.confidence = confidence;
      this.#turn.finalAnswer.updatedAt = now;
    }
    this.#notifyTurnUpdated({ semantic: isNewBlock ? true : 'throttled' });
    return this.#turn.finalAnswer;
  }

  /**
   * Record tool started.
   */
  recordToolStarted({ toolId, toolName, input, kind = 'command', title = null, description = null, actions = null, status = 'active' }) {
    if (this.isTerminal || this.isCancelling) {
      this.#tracer?.record?.({
        source: 'tool',
        event: 'tool.started_ignored',
        subjectId: toolId,
        disposition: 'ignored',
        metadata: { toolName },
      });
      return null;
    }

    if (this.#activeCommentaryId) {
      try {
        updateWorkItem(this.#turn, this.#activeCommentaryId, { status: 'completed' });
      } catch {}
      this.#activeCommentaryId = null;
    }
    if (this.#activeReasoningId) {
      try {
        updateWorkItem(this.#turn, this.#activeReasoningId, { status: 'completed' });
      } catch {}
      this.#activeReasoningId = null;
    }

    this.touchActivity();
    const normalizedStatus = normalizeTransitionalToolStatus(status, 'active');
    const item = appendWorkItem(this.#turn, {
      id: toolId,
      type: 'tool',
      toolName: toolName || 'tool',
      kind: kind || 'other',
      title: title || toolName || 'tool',
      status: normalizedStatus,
      ...(description != null ? { description } : {}),
      ...(Array.isArray(actions) ? { actions } : {}),
      ...(input !== undefined ? { input } : {}),
    });

    this.#openToolIds.add(toolId);
    setTurnStatus(this.#turn, {
      status: 'active',
      detail: 'tool_execution',
      subjectId: toolId,
    });

    this.#tracer?.record?.({
      source: 'tool',
      event: 'tool.started',
      subjectId: toolId,
      disposition: 'accepted',
      metadata: { toolName },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Record tool updated.
   */
  recordToolUpdated({ toolId, output, status = 'active', progress, durationMs, exitCode, actions }) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source: 'tool',
        event: 'tool.updated_ignored',
        subjectId: toolId,
        disposition: 'ignored',
        metadata: { status },
      });
      return null;
    }
    this.touchActivity();

    const normalizedStatus = normalizeTransitionalToolStatus(status, 'active');
    const item = updateWorkItem(this.#turn, toolId, {
      ...(output !== undefined ? { output } : {}),
      status: normalizedStatus,
      ...(progress !== undefined ? { progress } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
      ...(Array.isArray(actions) ? { actions } : {}),
    });

    this.#tracer?.record?.({
      source: 'tool',
      event: 'tool.updated',
      subjectId: toolId,
      disposition: 'accepted',
      metadata: { status: normalizedStatus },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Record tool completed.
   */
  recordToolCompleted({ toolId, output, durationMs, status = 'completed', exitCode, actions, closureReason }) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source: 'tool',
        event: 'tool.completed_ignored',
        subjectId: toolId,
        disposition: 'late',
        metadata: { status, durationMs },
      });
      return null;
    }

    this.touchActivity();
    const validStatus = normalizeTransitionalToolStatus(status, 'completed');

    const item = updateWorkItem(this.#turn, toolId, {
      status: validStatus,
      ...(output !== undefined ? { output } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
      ...(Array.isArray(actions) ? { actions } : {}),
      ...(closureReason ? { closureReason } : {}),
    });

    this.#openToolIds.delete(toolId);

    // If no more open tools, transition back to active model processing
    if (this.#openToolIds.size === 0 && this.#turn.status.status === 'active') {
      setTurnStatus(this.#turn, {
        status: 'active',
        detail: 'processing',
      });
    }

    this.#tracer?.record?.({
      source: 'tool',
      event: 'tool.completed',
      subjectId: toolId,
      disposition: 'accepted',
      metadata: { status: validStatus, durationMs },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Record interaction requested.
   */
  recordInteractionRequested({ interaction }) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    if (this.#activeCommentaryId) {
      try {
        updateWorkItem(this.#turn, this.#activeCommentaryId, { status: 'completed' });
      } catch {}
      this.#activeCommentaryId = null;
    }
    if (this.#activeReasoningId) {
      try {
        updateWorkItem(this.#turn, this.#activeReasoningId, { status: 'completed' });
      } catch {}
      this.#activeReasoningId = null;
    }

    const item = appendWorkItem(this.#turn, {
      id: interaction.id,
      type: 'interaction',
      interaction: structuredClone(interaction),
      status: 'pending',
    });

    this.#pendingInteractionId = interaction.id;
    setTurnStatus(this.#turn, {
      status: 'requiresAttention',
      reason: interaction.kind || 'permission',
      interactionId: interaction.id,
    });

    this.#tracer?.record?.({
      source: 'runtime',
      event: 'interaction.requested',
      subjectId: interaction.id,
      disposition: 'accepted',
      afterStatus: this.#turn.status,
      metadata: { kind: interaction.kind },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Record interaction resolved.
   */
  recordInteractionResolved({ interactionId, response }) {
    if (this.isTerminal || this.isCancelling) {
      this.#tracer?.record?.({
        source: 'runtime',
        event: 'interaction.resolved_ignored',
        disposition: 'ignored',
        subjectId: interactionId,
        metadata: { turnStatus: this.#turn.status.status },
      });
      return null;
    }
    this.touchActivity();

    const item = updateWorkItem(this.#turn, interactionId, {
      status: 'resolved',
      response: structuredClone(response),
      resolvedAt: new Date().toISOString(),
    });

    if (this.#pendingInteractionId === interactionId) {
      this.#pendingInteractionId = null;
    }

    setTurnStatus(this.#turn, {
      status: 'active',
      detail: 'processing',
    });

    this.#tracer?.record?.({
      source: 'runtime',
      event: 'interaction.resolved',
      subjectId: interactionId,
      disposition: 'accepted',
      afterStatus: this.#turn.status,
    });

    this.#notifyTurnUpdated({ semantic: true });
    return item;
  }

  /**
   * Add a nested ToolAction to a tool WorkItem.
   */
  addToolAction(toolWorkId, actionData, { source = 'adapter' } = {}) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();
    const tool = this.#turn.work.find(w => w.id === toolWorkId && w.type === 'tool');
    if (!tool) {
      throw new AiValidationError(`Tool invocation '${toolWorkId}' not found.`);
    }
    const action = appendToolAction(tool, actionData);

    this.#tracer?.record?.({
      source,
      event: 'tool.action.added',
      disposition: 'accepted',
      subjectId: toolWorkId,
      metadata: { actionId: action.id, kind: action.kind },
    });

    this.#notifyTurnUpdated({ semantic: true });
    return action;
  }

  /**
   * Set the authoritative final answer.
   */
  setFinalAnswer(finalAnswerData, { source = 'adapter' } = {}) {
    if (this.isTerminal || this.isCancelling) return null;
    const answer = assignFinalAnswer(this.#turn, finalAnswerData);
    this.#tracer?.record?.({
      source,
      event: 'final_answer.set',
      disposition: 'accepted',
      metadata: { status: answer.status },
    });
    this.#notifyTurnUpdated({ semantic: true });
    return answer;
  }

  /**
   * Request timeout intent. Sets timeout intention without marking turn terminal prematurely,
   * guaranteeing that timeout outcome arbitrates over subsequent provider completion.
   */
  requestTimeoutIntent({ initiator = 'runtime', cause = 'timeout/protocol-silence' } = {}) {
    if (this.isTerminal || this.#timeoutRequested || this.isCancelling) {
      this.#tracer?.record?.({
        source: 'runtime',
        event: 'timeout.intent_ignored',
        disposition: 'ignored',
        initiator,
        cause,
        metadata: {
          isTerminal: this.isTerminal,
          timeoutRequested: this.#timeoutRequested,
          isCancelling: this.isCancelling,
        },
      });
      return false;
    }

    this.#timeoutRequested = true;
    this.#timeoutInitiator = initiator;
    this.#timeoutCause = cause;

    this.#tracer?.record?.({
      source: 'runtime',
      event: 'timeout.intent_accepted',
      disposition: 'accepted',
      initiator,
      cause,
    });

    this.#notifyTurnUpdated({ semantic: true });
    return true;
  }

  /**
   * Request cancellation of the turn.
   */
  requestCancellation({ initiator = 'user', cause = 'user_cancelled' } = {}) {
    if (this.isTerminal || this.#cancellationRequested || this.isCancelling) {
      this.#tracer?.record?.({
        source: 'runtime',
        event: 'cancel.ignored',
        disposition: 'ignored',
        initiator,
        cause,
        metadata: {
          isTerminal: this.isTerminal,
          cancellationRequested: this.#cancellationRequested,
          isCancelling: this.isCancelling,
        },
      });
      return false;
    }

    this.#cancellationRequested = true;
    this.#cancellationInitiator = initiator;
    this.#cancellationCause = cause;

    setTurnStatus(this.#turn, {
      status: 'cancelling',
      initiator,
    });

    this.#tracer?.record?.({
      source: 'runtime',
      event: 'turn.cancel_requested',
      disposition: 'accepted',
      initiator,
      cause,
      afterStatus: this.#turn.status,
    });

    this.#notifyTurnUpdated({ semantic: true });
    return true;
  }

  /**
   * Check and evaluate protocol silence timeout.
   */
  checkProtocolSilence(now = Date.now(), timeoutMs = 300_000) {
    if (this.isTerminal || timeoutMs <= 0) return { fired: false };

    // 1. Suppression checks
    if (this.isCancelling || this.#cancellationRequested) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.suppressed',
        disposition: 'suppressed',
        timeout: {
          kind: 'protocol-silence',
          suppressionReason: 'cancelling',
        },
      });
      return { fired: false, suppressed: 'cancelling' };
    }

    if (this.#timeoutRequested) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.suppressed',
        disposition: 'suppressed',
        timeout: {
          kind: 'protocol-silence',
          suppressionReason: 'timeout_already_requested',
        },
      });
      return { fired: false, suppressed: 'timeout_already_requested' };
    }

    if (this.hasOpenTools) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.suppressed',
        disposition: 'suppressed',
        timeout: {
          kind: 'protocol-silence',
          suppressionReason: 'open_tools',
        },
      });
      return { fired: false, suppressed: 'open_tools' };
    }

    if (this.#pendingInteractionId || this.#turn.status.status === 'requiresAttention') {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.suppressed',
        disposition: 'suppressed',
        timeout: {
          kind: 'protocol-silence',
          suppressionReason: 'pending_interaction',
        },
      });
      return { fired: false, suppressed: 'pending_interaction' };
    }

    if (this.#isRecoverableWait) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.suppressed',
        disposition: 'suppressed',
        timeout: {
          kind: 'protocol-silence',
          suppressionReason: 'recoverable_wait',
        },
      });
      return { fired: false, suppressed: 'recoverable_wait' };
    }

    // 2. Deadline evaluation
    const elapsedSinceActivity = now - this.#lastQualifyingActivityAt;
    if (elapsedSinceActivity >= timeoutMs) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.fired',
        disposition: 'accepted',
        initiator: 'runtime',
        cause: 'timeout/protocol-silence',
        timeout: {
          kind: 'protocol-silence',
          deadlineMs: timeoutMs,
          elapsedMs: elapsedSinceActivity,
        },
      });

      return { fired: true, cause: 'timeout/protocol-silence' };
    }

    return { fired: false, elapsedMs: elapsedSinceActivity };
  }

  /**
   * Settle the terminal state of the turn.
   * Applies deterministic terminal arbitration:
   * 1. If turn is already terminal -> ignored.
   * 2. If timeout was requested -> timeout PREVAILS over provider completion or cleanup failure.
   * 3. If cancellation was accepted (status === 'cancelling' or #cancellationRequested) ->
   *    cancellation PREVAILS over provider completion or provider cleanup failure.
   */
  settleTerminal({ outcome = 'completed', initiator = 'provider', cause, finishReason, error } = {}) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'terminal.ignored',
        disposition: 'ignored',
        metadata: { attemptedOutcome: outcome, attemptedCause: cause },
      });
      return this.#turn.status;
    }

    let effectiveOutcome = outcome;
    let effectiveInitiator = initiator;
    let effectiveCause = cause;

    // Terminal arbitration: Timeout and cancellation intents prevail over normal provider completion or failure
    if (this.#timeoutRequested) {
      effectiveOutcome = 'failed';
      effectiveInitiator = this.#timeoutInitiator || 'runtime';
      effectiveCause = this.#timeoutCause || 'timeout/protocol-silence';
    } else if (this.#cancellationRequested || this.#turn.status.status === 'cancelling') {
      if (outcome === 'completed' || outcome === 'failed') {
        effectiveOutcome = 'cancelled';
        effectiveInitiator = this.#cancellationInitiator || 'user';
        effectiveCause = this.#cancellationCause || 'user_cancelled';
      }
    }

    let effectiveError = error;
    if (effectiveOutcome === 'completed') {
      effectiveError = undefined;
    } else if (effectiveOutcome === 'cancelled') {
      effectiveError = {
        code: 'AI_TURN_CANCELLED',
        message: 'The turn was cancelled.',
      };
    } else if (effectiveCause === 'timeout/protocol-silence' || effectiveCause === 'AI_TURN_TIMEOUT') {
      effectiveError = {
        code: 'AI_TURN_TIMEOUT',
        message: 'The turn was cancelled because it stopped responding.',
      };
    } else {
      effectiveError = error ? structuredClone(error) : {
        code: 'AI_TURN_FAILED',
        message: 'The turn failed.',
      };
    }

    this.#isTerminal = true;
    this.#closeDanglingTools(effectiveOutcome, effectiveCause);

    if (this.#pendingInteractionId) {
      try {
        updateWorkItem(this.#turn, this.#pendingInteractionId, {
          status: effectiveOutcome === 'cancelled' ? 'cancelled' : 'denied',
        });
      } catch {}
      this.#pendingInteractionId = null;
    }

    // Close active commentary / reasoning items
    for (const item of this.#turn.work) {
      if (item.status === 'streaming') {
        try {
          updateWorkItem(this.#turn, item.id, { status: 'completed' });
        } catch {}
      }
    }

    // Seal finalAnswer if it was streaming
    if (this.#turn.finalAnswer && this.#turn.finalAnswer.status === 'streaming') {
      const now = new Date().toISOString();
      this.#turn.finalAnswer.status = effectiveOutcome === 'completed' ? 'completed' : 'absent';
      if (effectiveOutcome === 'completed') {
        this.#turn.finalAnswer.completedAt = now;
      }
      this.#turn.finalAnswer.updatedAt = now;
    }

    const terminalStatus = setTurnStatus(this.#turn, {
      status: 'terminal',
      outcome: effectiveOutcome,
      initiator: effectiveInitiator,
      cause: effectiveCause,
      finishReason,
      ...(effectiveError ? { error: effectiveError } : {}),
    });

    this.#tracer?.record?.({
      source: 'coordinator',
      event: effectiveOutcome === 'completed' ? 'turn.completed' : 'turn.failed',
      disposition: 'accepted',
      afterStatus: terminalStatus,
      initiator: effectiveInitiator,
      cause: effectiveCause,
    });

    this.#notifyTurnUpdated({ semantic: true });
    return terminalStatus;
  }

  getCurrentActivity() {
    return computeCurrentActivity(this.#turn);
  }

  async flushTrace() {
    await this.#tracer?.flush?.();
  }
}
