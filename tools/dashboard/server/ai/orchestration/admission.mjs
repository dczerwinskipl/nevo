// Server-side agent admission and workspace-writer claim orchestration (Task 29, D41, D49, D55, D57, D65, D66, D70, D71, D74, D89, D93, D97, D98, D99, D100).
// Ensures single active agent execution per specification (D33).
// Claims workspace-writer slot in canonical lock order, enriches with session identity and turnStartState,
// releases only upon proven execution settlement.

import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
  getWorkspaceWriterClaim,
} from '../../../../specs/workflow/workspace-writer.mjs';
import { listWorkspaceRequests } from '../../../../specs/workflow/workspace-request.mjs';
import { assessExecutionSettlement } from '../../../../specs/workflow/execution-settlement.mjs';
import { WorkflowError } from '../../../../specs/workflow/errors.mjs';

// In-process admission tracking per specId
const activeExecutions = new Map(); // specId -> { ownerId, sessionId, turnId, taskId, candidate }
const startLocks = new Map(); // specId -> Promise chain mutex

async function acquireStartLock(specId) {
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const previousLock = startLocks.get(specId) || Promise.resolve();
  startLocks.set(
    specId,
    previousLock.then(() => nextLock, () => nextLock)
  );
  await previousLock;
  return release;
}

export function hasActiveAgentExecution(specId) {
  return activeExecutions.has(specId);
}

export function getActiveAgentExecution(specId) {
  return activeExecutions.get(specId) || null;
}

export function resetAdmissionStateForTest() {
  activeExecutions.clear();
  startLocks.clear();
}

/**
 * Admits an agent execution for a specification (D41, D49, D55, D66).
 * Single active execution gate per spec; claims workspace-writer slot;
 * performs ownership-conditional enrichments (D93, D98, D99).
 *
 * @param {string} specId
 * @param {object} candidate - { taskId, stepId, provider, sessionPolicy, sessionId, executionPolicy }
 * @param {object} options
 * @param {string} options.repoRoot - Repository root
 * @param {object} [options.sessionService] - AgentSessionService instance
 * @param {object} [options.turnRuntime] - AgentTurnRuntime instance
 * @param {Function} [options.onTurnTerminal] - Callback when turn reaches terminal
 * @returns {Promise<{ admitted: boolean, reason?: string, ownerId?: string, sessionId?: string, turnId?: string, claim?: object }>}
 */
export async function admitAgentExecution(specId, candidate, options = {}) {
  const {
    repoRoot,
    sessionService,
    turnRuntime = sessionService?.turnRuntime,
    onTurnTerminal,
  } = options;

  if (!specId || !candidate?.taskId) {
    throw new WorkflowError('admitAgentExecution requires specId and candidate.taskId');
  }

  // 1. Acquire admission mutex for specId (D66)
  const releaseLock = await acquireStartLock(specId);

  try {
    // 2. Re-read active-execution state under mutex
    if (activeExecutions.has(specId)) {
      return {
        admitted: false,
        reason: 'ACTIVE_EXECUTION_EXISTS',
        activeExecution: activeExecutions.get(specId),
      };
    }

    // 3. Worktree-wide dispatch-priority check (D57, D65, D74)
    // Check if any non-agent durable workspace-request is queued or waiting anywhere in physical worktree
    if (repoRoot) {
      const pendingRequests = listWorkspaceRequests({
        repoRoot,
        status: ['queued', 'waiting-for-workspace'],
      });
      if (pendingRequests.length > 0) {
        return {
          admitted: false,
          reason: 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST',
          pendingRequests,
        };
      }
    }

    // 4. Claim workspace-writer slot (kind: 'agent', keyed by worktree, D55, D65)
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot,
      kind: 'agent',
      specId,
      taskId: candidate.taskId,
    });

    if (!acquireRes.acquired) {
      return {
        admitted: false,
        reason: acquireRes.blocked ? 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY' : 'WORKSPACE_WRITER_CONTENDED',
        blocked: acquireRes.blocked,
        currentClaim: acquireRes.currentClaim,
      };
    }

    const ownerId = acquireRes.ownerId;
    let canonicalSessionId = candidate.sessionId || null;

    // 5. Resolve canonical session according to transition's session policy (fresh | reuse, D26, D98)
    const sessionPolicy = candidate.executionPolicy?.session || candidate.sessionPolicy || 'fresh';

    try {
      if (!canonicalSessionId) {
        if (sessionPolicy === 'reuse' && sessionService) {
          // Resolve existing session for task/spec if available
          const existing = await sessionService.getSession(candidate.provider || 'mock', {
            specId,
            taskId: candidate.taskId,
          }).catch(() => null);
          if (existing?.sessionId) {
            canonicalSessionId = existing.sessionId;
          }
        }

        if (!canonicalSessionId && sessionService) {
          const created = await sessionService.createSession(candidate.provider || 'mock', {
            specId,
            taskId: candidate.taskId,
            purpose: 'execution',
          });
          canonicalSessionId = created.sessionId;
        }
      }

      if (!canonicalSessionId) {
        // Fallback for direct unit tests without full session service
        canonicalSessionId = `sess-${Date.now()}`;
      }

      // 6. First ownership-conditional enrichment: sessionId and turnStartState: 'prepared' (D89, D93, D99)
      const enrichRes1 = await updateWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: ownerId,
        expectedKind: 'agent',
        expectedSpecId: specId,
        expectedTaskId: candidate.taskId,
        sessionId: canonicalSessionId,
        turnStartState: 'prepared',
      });

      if (!enrichRes1.updated) {
        // Failed enrichment: roll back claim and abort
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedTaskId: candidate.taskId,
        });
        return {
          admitted: false,
          reason: 'CLAIM_ENRICHMENT_FAILED',
        };
      }
    } catch (sessionErr) {
      // Roll back workspace-writer claim if session creation fails
      await releaseWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: ownerId,
        expectedKind: 'agent',
        expectedSpecId: specId,
        expectedTaskId: candidate.taskId,
      });
      throw sessionErr;
    }

    // Capture execution identity for closure-based Hook 1 reconciliation (D70, D100)
    const executionRecord = {
      ownerId,
      sessionId: canonicalSessionId,
      taskId: candidate.taskId,
      specId,
      candidate,
      turnId: null,
      admittedAt: new Date().toISOString(),
    };

    activeExecutions.set(specId, executionRecord);

    // 7. Invoke turn if runtime or function provided
    let turnId = candidate.turnId || null;

    if (turnRuntime || typeof candidate.invokeStartTurn === 'function') {
      // 8. Immediately before invoking startTurn: second enrichment, turnStartState: 'invoking' alone (D99)
      await updateWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: ownerId,
        expectedKind: 'agent',
        expectedSpecId: specId,
        expectedTaskId: candidate.taskId,
        sessionId: canonicalSessionId,
        turnStartState: 'invoking',
      });

      try {
        let startResult;
        if (typeof candidate.invokeStartTurn === 'function') {
          startResult = await candidate.invokeStartTurn({
            sessionId: canonicalSessionId,
            taskId: candidate.taskId,
            stepId: candidate.stepId,
          });
        } else if (turnRuntime?.startTurn) {
          startResult = await turnRuntime.startTurn({
            sessionId: canonicalSessionId,
            taskId: candidate.taskId,
            stepId: candidate.stepId,
            provider: candidate.provider,
          });
        }

        turnId = startResult?.turnId || turnId || `turn-${Date.now()}`;
        executionRecord.turnId = turnId;

        // 9. Third ownership-conditional enrichment: turnId and turnStartState: 'started' in one atomic merge (D99)
        await updateWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedTaskId: candidate.taskId,
          sessionId: canonicalSessionId,
          turnId,
          turnStartState: 'started',
        });
      } catch (startErr) {
        // If startTurn throws, leave claim at 'invoking' (or assess settlement if not started)
        throw startErr;
      }
    }

    // Register Hook 1 (per-turn subscription callback) closure with captured identity (D70, D100)
    const capturedOwnerId = ownerId;
    const capturedSessionId = canonicalSessionId;
    const capturedTaskId = candidate.taskId;

    const reconcileHook1 = async (turnOutcome = {}) => {
      const turnIdResolved = executionRecord.turnId || turnOutcome.turnId || null;

      // Settlement check before touching claim (D59, D60)
      const settlement = await assessExecutionSettlement({
        repoRoot,
        changeSlug: specId,
        taskId: capturedTaskId,
      });

      if (settlement.settled) {
        const relRes = await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: capturedOwnerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedTaskId: capturedTaskId,
          ...(capturedSessionId ? { expectedSessionId: capturedSessionId } : {}),
          ...(turnIdResolved ? { expectedTurnId: turnIdResolved } : {}),
        });
        activeExecutions.delete(specId);
        if (typeof onTurnTerminal === 'function') {
          await onTurnTerminal({ specId, taskId: capturedTaskId, settled: true, released: relRes.released });
        }
        return { settled: true, released: relRes.released };
      } else {
        const markRes = await markWorkspaceWriterRecoveryRequiredIfOwned({
          repoRoot,
          expectedOwnerId: capturedOwnerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedTaskId: capturedTaskId,
          ...(capturedSessionId ? { expectedSessionId: capturedSessionId } : {}),
          ...(turnIdResolved ? { expectedTurnId: turnIdResolved } : {}),
        });
        activeExecutions.delete(specId);
        if (typeof onTurnTerminal === 'function') {
          await onTurnTerminal({ specId, taskId: capturedTaskId, settled: false, markedRecovery: markRes.marked });
        }
        return { settled: false, markedRecovery: markRes.marked };
      }
    };

    executionRecord.reconcile = reconcileHook1;

    return {
      admitted: true,
      ownerId,
      sessionId: canonicalSessionId,
      turnId: executionRecord.turnId,
      reconcile: reconcileHook1,
    };
  } finally {
    // Release admission mutex (step 5 / step 7)
    if (typeof releaseLock === 'function') {
      releaseLock();
    }
  }
}

/**
 * Reconciles and releases an admitted execution using its captured identity (Hook 1).
 *
 * @param {string} specId
 * @param {object} [outcome]
 * @returns {Promise<object>}
 */
export async function releaseAdmittedExecution(specId, outcome = {}) {
  const active = activeExecutions.get(specId);
  if (!active) {
    return { released: false, reason: 'NO_ACTIVE_EXECUTION' };
  }
  return await active.reconcile(outcome);
}
