import {
  AiError,
  AiValidationError,
  createCanonicalTurn,
  appendWorkItem,
  updateWorkItem,
  addToolAction as appendToolAction,
  setFinalAnswer as assignFinalAnswer,
  setTurnStatus,
  computeCurrentActivity,
  getGlobalTraceSink,
} from '../../contracts.mjs';

/**
 * TurnLifecycleCoordinator: Serialized owner of Turn status transitions,
 * ordered Work sequence, multi-tool tracking, timeout decisions, and lifecycle trace.
 */
export class TurnLifecycleCoordinator {
  #turn;
  #tracer;
  #openToolIds = new Set();
  #pendingInteractionId = null;
  #isRecoverableWait = false;
  #lastQualifyingActivityAt = Date.now();
  #queue = Promise.resolve();
  #isTerminal = false;

  constructor({
    turnId,
    sessionId = 'default-session',
    provider,
    providerSessionId = null,
    traceSink = null,
  }) {
    const effectiveProviderSessionId = providerSessionId || sessionId || 'default-session';
    this.#turn = createCanonicalTurn({
      id: turnId,
      sessionId,
      provider,
      providerSessionId: effectiveProviderSessionId,
    });

    const sink = traceSink ?? getGlobalTraceSink();
    this.#tracer = sink?.createTurnTracer?.({
      turnId,
      sessionId,
      provider,
      providerSessionId: effectiveProviderSessionId,
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

  get hasOpenTools() {
    return this.#openToolIds.size > 0;
  }

  get openToolCount() {
    return this.#openToolIds.size;
  }

  get pendingInteractionId() {
    return this.#pendingInteractionId;
  }

  get lastQualifyingActivityAt() {
    return this.#lastQualifyingActivityAt;
  }

  get tracer() {
    return this.#tracer;
  }

  touchActivity() {
    this.#lastQualifyingActivityAt = Date.now();
  }

  setRecoverableWait(value = true) {
    this.#isRecoverableWait = Boolean(value);
  }

  #runSerialized(action) {
    const next = this.#queue.then(async () => {
      return action();
    });
    this.#queue = next.catch(() => {});
    return next;
  }

  /**
   * Request status transition through the coordinator.
   */
  requestStatusTransition(newStatusData, { source = 'coordinator', initiator } = {}) {
    return this.#runSerialized(() => {
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
        // Close any dangling open tools with inferred closure
        this.#closeDanglingTools(after.outcome === 'completed' ? 'turn_completed' : 'turn_failed');
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
    });
  }

  #closeDanglingTools(closureReason) {
    for (const toolId of this.#openToolIds) {
      try {
        updateWorkItem(this.#turn, toolId, {
          status: 'failed',
          closureReason,
        });
      } catch {}
    }
    this.#openToolIds.clear();
  }

  /**
   * Append a new top-level Work item with monotonic sequence.
   */
  appendWork(itemData, { source = 'adapter' } = {}) {
    return this.#runSerialized(() => {
      if (this.isTerminal) {
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

      if (item.type === 'tool' && (item.status === 'active' || item.status === 'waiting_for_result')) {
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
    });
  }

  /**
   * Update an existing Work item in place.
   */
  updateWork(itemId, deltaData, { source = 'adapter' } = {}) {
    return this.#runSerialized(() => {
      this.touchActivity();
      const item = updateWorkItem(this.#turn, itemId, deltaData);

      if (item.type === 'tool') {
        if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
          this.#openToolIds.delete(item.id);
        }
      } else if (item.type === 'interaction') {
        if (item.status === 'resolved' || item.status === 'rejected' || item.status === 'expired') {
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
    });
  }

  /**
   * Add a nested ToolAction to a tool WorkItem.
   */
  addToolAction(toolWorkId, actionData, { source = 'adapter' } = {}) {
    return this.#runSerialized(() => {
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
    });
  }

  /**
   * Set the authoritative final answer.
   */
  setFinalAnswer(finalAnswerData, { source = 'adapter' } = {}) {
    return this.#runSerialized(() => {
      const answer = assignFinalAnswer(this.#turn, finalAnswerData);
      this.#tracer?.record?.({
        source,
        event: 'final_answer.set',
        disposition: 'accepted',
        metadata: { status: answer.status },
      });
      return answer;
    });
  }

  /**
   * Request user cancellation.
   */
  requestCancellation({ initiator = 'user', cause = 'user_cancelled' } = {}) {
    return this.#runSerialized(() => {
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
    });
  }

  /**
   * Check and evaluate protocol silence timeout.
   */
  checkProtocolSilence(now = Date.now(), timeoutMs = 300_000) {
    return this.#runSerialized(() => {
      if (this.isTerminal || timeoutMs <= 0) return { fired: false };

      // 1. Suppression checks
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
        // Fire protocol silence timeout
        this.#isTerminal = true;
        this.#closeDanglingTools('turn_failed');
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
    });
  }

  /**
   * Settle the terminal state of the turn.
   */
  settleTerminal({ outcome = 'completed', initiator = 'provider', cause, finishReason } = {}) {
    return this.#runSerialized(() => {
      if (this.isTerminal) {
        this.#tracer?.record?.({
          source: 'coordinator',
          event: 'terminal.ignored',
          disposition: 'ignored',
          metadata: { attemptedOutcome: outcome, attemptedCause: cause },
        });
        return this.#turn.status;
      }

      this.#isTerminal = true;
      this.#closeDanglingTools(outcome === 'completed' ? 'turn_completed' : 'turn_failed');

      const terminalStatus = setTurnStatus(this.#turn, {
        status: 'terminal',
        outcome,
        initiator,
        cause,
        finishReason,
      });

      this.#tracer?.record?.({
        source: 'coordinator',
        event: outcome === 'completed' ? 'turn.completed' : 'turn.failed',
        disposition: 'accepted',
        afterStatus: terminalStatus,
        initiator,
        cause,
      });

      return terminalStatus;
    });
  }

  getCurrentActivity() {
    return computeCurrentActivity(this.#turn);
  }

  async flushTrace() {
    await this.#tracer?.flush?.();
  }
}
