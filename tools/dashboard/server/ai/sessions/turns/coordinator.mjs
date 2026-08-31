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

  constructor({
    turnId,
    sessionId = null,
    provider,
    providerSessionId = null,
    mode = 'edit',
    traceSink = null,
  }) {
    const effectiveSessionId = sessionId || turnId;
    this.#turn = createCanonicalTurn({
      id: turnId,
      sessionId: effectiveSessionId,
      provider,
      providerSessionId: providerSessionId || null,
      mode,
    });

    const sink = traceSink ?? getGlobalTraceSink();
    this.#tracer = sink?.createTurnTracer?.({
      turnId,
      sessionId: effectiveSessionId,
      provider,
      providerSessionId: providerSessionId || null,
    });

    this.#tracer?.record?.({
      source: 'coordinator',
      event: 'turn.started',
      disposition: 'accepted',
      afterStatus: this.#turn.status,
    });
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
    bindTurnProviderSessionId(this.#turn, allocatedSessionId);
    this.#tracer?.record?.({
      source: 'coordinator',
      event: 'provider_session.bound',
      subjectId: allocatedSessionId,
      disposition: 'accepted',
    });
    return allocatedSessionId;
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

    return item;
  }

  /**
   * Record arrival of a text delta.
   */
  recordTextDelta(text, messageId = `msg-${this.#turn.id}`) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    let currentItem = this.#activeCommentaryId
      ? this.#turn.work.find(w => w.id === this.#activeCommentaryId && w.type === 'commentary' && w.status === 'streaming')
      : null;

    if (!currentItem) {
      this.#activeCommentaryId = messageId || `commentary-${Date.now()}`;
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
    return currentItem;
  }

  /**
   * Record arrival of a reasoning delta.
   */
  recordReasoningDelta(text, messageId = `reasoning-${this.#turn.id}`) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

    let currentItem = this.#activeReasoningId
      ? this.#turn.work.find(w => w.id === this.#activeReasoningId && w.type === 'reasoning' && w.status === 'streaming')
      : null;

    if (!currentItem) {
      this.#activeReasoningId = messageId || `reasoning-${Date.now()}`;
      currentItem = appendWorkItem(this.#turn, {
        id: this.#activeReasoningId,
        type: 'reasoning',
        representation: 'raw_text',
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
    return currentItem;
  }

  /**
   * Record tool started.
   */
  recordToolStarted({ toolId, toolName, input, kind = 'command', title = null, status = 'active' }) {
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

    this.touchActivity();
    const normalizedStatus = normalizeTransitionalToolStatus(status, 'active');
    const item = appendWorkItem(this.#turn, {
      id: toolId,
      type: 'tool',
      toolName: toolName || 'tool',
      kind: kind || 'other',
      title: title || toolName || 'tool',
      status: normalizedStatus,
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

    return item;
  }

  /**
   * Record tool updated.
   */
  recordToolUpdated({ toolId, output, status = 'active', progress }) {
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
    });

    this.#tracer?.record?.({
      source: 'tool',
      event: 'tool.updated',
      subjectId: toolId,
      disposition: 'accepted',
      metadata: { status: normalizedStatus },
    });

    return item;
  }

  /**
   * Record tool completed.
   */
  recordToolCompleted({ toolId, output, durationMs, status = 'completed', exitCode, closureReason }) {
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

    return item;
  }

  /**
   * Record interaction requested.
   */
  recordInteractionRequested({ interaction }) {
    if (this.isTerminal || this.isCancelling) return null;
    this.touchActivity();

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
    return answer;
  }

  /**
   * Request user cancellation.
   */
  requestCancellation({ initiator = 'user', cause = 'user_cancelled' } = {}) {
    if (this.isTerminal) {
      this.#tracer?.record?.({
        source: 'runtime',
        event: 'cancel.ignored',
        disposition: 'ignored',
        initiator,
        cause,
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

    return true;
  }

  /**
   * Check and evaluate protocol silence timeout.
   */
  checkProtocolSilence(now = Date.now(), timeoutMs = 300_000) {
    if (this.isTerminal || timeoutMs <= 0) return { fired: false };

    // 1. Suppression checks
    if (this.isCancelling) {
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
      this.#isTerminal = true;
      this.#closeDanglingTools('failed', 'timeout/protocol-silence');
      if (this.#pendingInteractionId) {
        try {
          updateWorkItem(this.#turn, this.#pendingInteractionId, { status: 'denied' });
        } catch {}
        this.#pendingInteractionId = null;
      }
      setTurnStatus(this.#turn, {
        status: 'terminal',
        outcome: 'failed',
        initiator: 'runtime',
        cause: 'timeout/protocol-silence',
      });

      this.#tracer?.record?.({
        source: 'coordinator',
        event: 'timeout.fired',
        disposition: 'accepted',
        initiator: 'runtime',
        cause: 'timeout/protocol-silence',
        afterStatus: this.#turn.status,
        timeout: {
          kind: 'protocol-silence',
          deadlineMs: timeoutMs,
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
   * 2. If cancellation was accepted (status === 'cancelling' or #cancellationRequested) ->
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

    // Terminal arbitration: Cancellation intent prevails over normal provider completion or failure
    if (this.#cancellationRequested || this.#turn.status.status === 'cancelling') {
      if (outcome === 'completed' || outcome === 'failed') {
        effectiveOutcome = 'cancelled';
        effectiveInitiator = this.#cancellationInitiator || 'user';
        effectiveCause = this.#cancellationCause || 'user_cancelled';
      }
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

    const terminalStatus = setTurnStatus(this.#turn, {
      status: 'terminal',
      outcome: effectiveOutcome,
      initiator: effectiveInitiator,
      cause: effectiveCause,
      finishReason,
      ...(error ? { error } : {}),
    });

    this.#tracer?.record?.({
      source: 'coordinator',
      event: effectiveOutcome === 'completed' ? 'turn.completed' : 'turn.failed',
      disposition: 'accepted',
      afterStatus: terminalStatus,
      initiator: effectiveInitiator,
      cause: effectiveCause,
    });

    return terminalStatus;
  }

  getCurrentActivity() {
    return computeCurrentActivity(this.#turn);
  }

  async flushTrace() {
    await this.#tracer?.flush?.();
  }
}
