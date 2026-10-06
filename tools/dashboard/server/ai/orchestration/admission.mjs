// Server-side agent admission and workspace-writer claim orchestration (Task 29, D41, D49, D55, D57, D65, D66, D70, D71, D74, D89, D93, D97, D98, D99, D100).
// Ensures single active agent execution per specification (D33).
// Claims workspace-writer slot in canonical lock order, enriches with session identity and turnStartState,
// releases only upon proven execution settlement.

import { join } from 'node:path';
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
import {
  assertExecutionScope,
  createTaskScope,
  getScopeTaskIds,
} from '../../../../specs/workflow/execution-scope.mjs';
import { recordActivity, readActivities } from '../../../../specs/activity/store.mjs';
import { resolveAgentSessionActor, SYSTEM_ACTOR } from '../../../../specs/activity/actor-resolver.mjs';

// In-process admission tracking per specId
const activeExecutions = new Map(); // specId -> { ownerId, sessionId, turnId, taskId, candidate }
const startLocks = new Map(); // specId -> Promise chain mutex
let defaultSessionService = null;

export function setDefaultSessionService(service) {
  defaultSessionService = service;
}

export function getDefaultSessionService() {
  return defaultSessionService;
}

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

export async function waitForActiveExecutionSettled(specId) {
  const active = activeExecutions.get(specId);
  if (!active || active.settled) return null;
  return await active.settledPromise;
}

export function resetAdmissionStateForTest() {
  for (const record of activeExecutions.values()) {
    record.settled = true;
    record.resolveSettled?.({ reset: true });
  }
  activeExecutions.clear();
  startLocks.clear();
  defaultSessionService = null;
}

export function clearActiveAgentExecution(specId) {
  const active = activeExecutions.get(specId);
  if (active) {
    active.settled = true;
    active.resolveSettled?.({ cleared: true });
    activeExecutions.delete(specId);
    return true;
  }
  return false;
}

export function registerActiveAgentExecution(specId, record) {
  activeExecutions.set(specId, record);
}

/**
 * Best-effort trigger for durable pending grouped-handover work (batch-execution-
 * generalization, task 13, second-round review finding 1): whenever a single task's
 * own active-execution slot frees up here in Hook 1 — not only when a batch
 * settlement's own Stage 2 frees it — a sibling settlement for the same spec may have
 * a durably pending dispatch unit that just became admittable. Dynamic import avoids a
 * static circular dependency (batch-completion-settlement.mjs imports this module).
 * Never throws — `resumePendingHandoverForSpec` is itself already best-effort.
 */
async function triggerPendingHandoverResume({ repoRoot, changeSlug, activeDir, options }) {
  if (!repoRoot || !changeSlug) return;
  try {
    const { resumePendingHandoverForSpec } = await import('./batch-completion-settlement.mjs');
    await resumePendingHandoverForSpec({ repoRoot, changeSlug, excludeBatchExecutionId: null, activeDir, options });
  } catch (err) {
    console.error('[admission] Pending-handover resume trigger failed:', err);
  }
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
  const repoRoot = options.repoRoot;
  const sessionService = options.sessionService || defaultSessionService;
  const turnRuntime = options.turnRuntime || sessionService?.turnRuntime;
  const onTurnTerminal = options.onTurnTerminal;

  const candidateScope = candidate?.scope
    ? assertExecutionScope(candidate.scope)
    : (candidate?.taskIds
      ? assertExecutionScope({ kind: 'task-batch', taskIds: candidate.taskIds })
      : (candidate?.taskId ? createTaskScope(candidate.taskId) : null));

  if (!specId || !candidateScope) {
    throw new WorkflowError('admitAgentExecution requires specId and candidate.taskId, candidate.taskIds, or candidate.scope');
  }

  const changeSlug = candidate.changeSlug || options.changeSlug || specId;

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
    const candidateBatchExecutionId = candidateScope.kind === 'task-batch' ? (candidate?.batchExecutionId || null) : null;
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot,
      kind: 'agent',
      specId,
      changeSlug,
      scope: candidateScope,
      ...(candidateScope.kind === 'task' ? { taskId: candidateScope.taskId } : {}),
      ...(candidateBatchExecutionId ? { batchExecutionId: candidateBatchExecutionId } : {}),
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
    // 5. Resolve canonical session according to transition's session policy (fresh | reuse, D26, D98)
    const sessionPolicy = candidate.executionPolicy?.session || candidate.sessionPolicy || 'fresh';
    let canonicalSessionId = null;

    if (sessionPolicy === 'reuse') {
      canonicalSessionId = candidate.sessionId || candidate.parentSessionId || null;
      if (!canonicalSessionId) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedChangeSlug: changeSlug,
          expectedScope: candidateScope,
          ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
        });
        return {
          admitted: false,
          reason: 'REUSE_SESSION_NOT_RESOLVED',
          error: 'Target workflow transition requires session reuse, but no exact predecessor session was provided or resolved.',
        };
      }
    }

    try {
      if (!canonicalSessionId && sessionService) {
        const resolvedProvider = candidate.provider || sessionService?.registry?.list?.()?.[0];
        const created = await sessionService.createSession(resolvedProvider, {
          specId,
          ...(candidateScope.kind === 'task'
            ? { taskId: candidateScope.taskId }
            : { taskIds: candidateScope.taskIds }),
          executionScope: candidateScope,
          purpose: 'execution',
          mode: candidate.mode,
          model: candidate.model,
          role: candidate.role,
          parentSessionId: candidate.parentSessionId,
          ...(candidate.batchExecutionId ? { batchExecutionId: candidate.batchExecutionId } : {}),
        });
        canonicalSessionId = created.sessionId;
      }

      if (!canonicalSessionId) {
        // Fallback for direct unit tests without full session service
        canonicalSessionId = candidate.sessionId || `sess-${Date.now()}`;
      }

      // 6. First ownership-conditional enrichment: sessionId and turnStartState: 'prepared' (D89, D93, D99)
      const enrichRes1 = await updateWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: ownerId,
        expectedKind: 'agent',
        expectedSpecId: specId,
        expectedChangeSlug: changeSlug,
        expectedScope: candidateScope,
        ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
        sessionId: canonicalSessionId,
        turnStartState: 'prepared',
        ...(candidate.batchExecutionId ? { batchExecutionId: candidate.batchExecutionId } : {}),
      });

      if (!enrichRes1.updated) {
        // Failed enrichment: roll back claim and abort
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedChangeSlug: changeSlug,
          expectedScope: candidateScope,
          ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
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
        expectedChangeSlug: changeSlug,
        expectedScope: candidateScope,
        ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
      });
      throw sessionErr;
    }

    // Capture execution identity for closure-based Hook 1 reconciliation (D70, D100)
    let resolveSettled;
    const settledPromise = new Promise((resolve) => {
      resolveSettled = resolve;
    });

    let baselineProgress = null;
    // The single authoritative boundary for "this candidate was only admitted because its
    // readiness failure is activation-only" (D2, ADR-0009) — computed here from the
    // readiness verdict the caller resolved for this exact candidate (candidate.readiness),
    // never a route-local shortcut like `readiness.ready === false`. Every supported caller
    // of admitAgentExecution gets identical settlement semantics regardless of which route
    // or internal mechanism initiated admission. Absent a readiness verdict, this stays
    // false — never assumed true without proof.
    let preActivationBlocker = false;
    if (candidateScope.kind === 'task' && repoRoot && changeSlug && candidateScope.taskId) {
      try {
        const { requireChange, requireTask } = await import('../../../../specs/store.mjs');
        const activeDir = options.activeDir || (repoRoot ? join(repoRoot, 'specs', 'active') : undefined);
        const currentChange = requireChange(changeSlug, activeDir);
        const currentTask = requireTask(currentChange, candidateScope.taskId);
        if (currentTask.workflow_progress) {
          baselineProgress = {
            current_step: currentTask.workflow_progress.current_step,
            current_attempt: currentTask.workflow_progress.current_attempt,
            state: currentTask.workflow_progress.state,
            historyLength: currentTask.workflow_progress.history?.length || 0,
          };
        }
        if (candidate.readiness && candidate.readiness.ready === false) {
          const { isActivationOnlyBlocker } = await import('../../../../specs/workflow/readiness-policy.mjs');
          preActivationBlocker = isActivationOnlyBlocker(candidate.readiness, {
            repoRoot,
            task: currentTask,
            change: currentChange,
            record: candidate.readiness.priorRecord,
          });
        }
      } catch {}
    }

    const executionRecord = {
      ownerId,
      sessionId: canonicalSessionId,
      scope: candidateScope,
      ...(candidateScope.kind === 'task' ? { taskId: candidateScope.taskId } : {}),
      ...(candidate.batchExecutionId ? { batchExecutionId: candidate.batchExecutionId } : {}),
      specId,
      changeSlug,
      candidate,
      baselineProgress,
      preActivationBlocker,
      turnId: candidate.turnId || null,
      admittedAt: new Date().toISOString(),
      settled: false,
      settledPromise,
      resolveSettled,
    };

    activeExecutions.set(specId, executionRecord);

    // 7. Invoke turn if sessionService, runtime, or function provided
    let turnId = candidate.turnId || null;

    if (sessionService?.startTurn || turnRuntime || typeof candidate.invokeStartTurn === 'function') {
      // 8. Immediately before invoking startTurn: second enrichment, turnStartState: 'invoking' alone (D99)
      const enrichRes2 = await updateWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: ownerId,
        expectedKind: 'agent',
        expectedSpecId: specId,
        expectedChangeSlug: changeSlug,
        expectedScope: candidateScope,
        ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
        sessionId: canonicalSessionId,
        turnStartState: 'invoking',
        ...(candidate.batchExecutionId ? { batchExecutionId: candidate.batchExecutionId } : {}),
      });

      if (!enrichRes2.updated) {
        // MUST succeed ownership-conditionally. If not, DO NOT start the provider! Fail closed!
        activeExecutions.delete(specId);
        return {
          admitted: false,
          reason: 'INVOKING_STATE_TRANSITION_FAILED',
          currentClaim: enrichRes2.currentClaim,
        };
      }

      try {
        let startResult;
        if (typeof candidate.invokeStartTurn === 'function') {
          startResult = await candidate.invokeStartTurn({
            sessionId: canonicalSessionId,
            ...(candidateScope.kind === 'task' ? { taskId: candidateScope.taskId } : {}),
            scope: candidateScope,
            stepId: candidate.stepId,
            provider: candidate.provider,
          });
        } else if (sessionService?.startTurn) {
          let effectiveProvider = candidate.provider;
          if (canonicalSessionId && sessionPolicy === 'reuse') {
            try {
              const existingSess = sessionService?.getSession ? await sessionService.getSession(canonicalSessionId) : null;
              if (existingSess?.provider) {
                effectiveProvider = existingSess.provider;
              }
            } catch {}
          } else if (!effectiveProvider && canonicalSessionId && sessionService?.getSession) {
            try {
              const existingSess = await sessionService.getSession(canonicalSessionId);
              if (existingSess?.provider) {
                effectiveProvider = existingSess.provider;
              }
            } catch {}
          }
          startResult = await sessionService.startTurn(effectiveProvider, canonicalSessionId, {
            sessionId: canonicalSessionId,
            ...(candidateScope.kind === 'task' ? { taskId: candidateScope.taskId } : {}),
            ...(candidateScope.kind === 'task-batch' ? { taskIds: candidateScope.taskIds } : {}),
            executionScope: candidateScope,
            stepId: candidate.stepId,
            specId,
            purpose: 'execution',
            message: candidate.message ?? candidate.prompt,
            userMessage: candidate.userMessage,
            mode: candidate.mode,
            model: candidate.model,
            effort: candidate.effort,
            role: candidate.role,
            parentSessionId: candidate.parentSessionId,
            idempotencyKey: candidate.idempotencyKey,
          });
        } else if (turnRuntime?.startTurn) {
          startResult = await turnRuntime.startTurn({
            sessionId: canonicalSessionId,
            ...(candidateScope.kind === 'task' ? { taskId: candidateScope.taskId } : {}),
            scope: candidateScope,
            stepId: candidate.stepId,
            provider: candidate.provider,
            role: candidate.role,
            parentSessionId: candidate.parentSessionId,
          });
        }

        turnId = startResult?.turnId || turnId || `turn-${Date.now()}`;
        executionRecord.turnId = turnId;

        // 9. Third ownership-conditional enrichment: turnId and turnStartState: 'started' in one atomic merge (D99)
        const enrichRes3 = await updateWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedChangeSlug: changeSlug,
          expectedScope: candidateScope,
          ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
          sessionId: canonicalSessionId,
          turnId,
          turnStartState: 'started',
          ...(candidate.batchExecutionId ? { batchExecutionId: candidate.batchExecutionId } : {}),
        });

        if (!enrichRes3.updated) {
          // If that update fails: mark recovery-required to prevent leaking active state and abort cleanly (Finding 4)
          await markWorkspaceWriterRecoveryRequiredIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            expectedChangeSlug: changeSlug,
            expectedScope: candidateScope,
            ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
            sessionId: canonicalSessionId,
            turnStartState: 'invoking',
          }).catch(() => {});

          const currentActive = activeExecutions.get(specId);
          if (currentActive?.ownerId === ownerId) {
            activeExecutions.delete(specId);
          }

          return {
            admitted: false,
            reason: 'STARTED_STATE_TRANSITION_FAILED',
            recoveryRequired: true,
            turnId,
            currentClaim: enrichRes3.currentClaim,
          };
        }
      } catch (startErr) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedChangeSlug: changeSlug,
          expectedScope: candidateScope,
          ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
        }).catch(() => {});
        const currentActive = activeExecutions.get(specId);
        if (currentActive?.ownerId === ownerId) {
          activeExecutions.delete(specId);
        }
        throw startErr;
      }
    }

    // Register Hook 1 (per-turn subscription callback) closure with captured identity (D70, D100)
    const capturedOwnerId = ownerId;
    const capturedSessionId = canonicalSessionId;
    const capturedScope = candidateScope;
    const capturedTaskId = candidateScope.kind === 'task' ? candidateScope.taskId : null;
    const capturedChangeSlug = changeSlug;

    let unsub = null;

    const reconcileHook1 = async (turnOutcome = {}) => {
      let hookOutcome;
      try {
        if (unsub) {
          try { unsub(); } catch {}
          unsub = null;
        }

        const turnIdResolved = executionRecord.turnId || turnOutcome.turnId || null;
        const liveClaim = getWorkspaceWriterClaim(repoRoot);
        const expectedTurnId = (liveClaim?.turnId && turnIdResolved) ? turnIdResolved : undefined;

        // Settlement check before touching claim (D59, D60)
        let settlement = { settled: false, outcome: 'recovery-required' };
        if (capturedScope.kind === 'task') {
          settlement = await assessExecutionSettlement({
            repoRoot,
            changeSlug: capturedChangeSlug,
            taskId: capturedTaskId,
            activeDir: options.activeDir,
            baselineProgress: executionRecord.baselineProgress,
            preActivationBlocker: executionRecord.preActivationBlocker === true,
          });
        } else if (capturedScope.kind === 'task-batch') {
          // For batch scope, settlement is determined by the authoritative durable batch-finish record
          // — never by an arbitrary boolean from the callback caller (fixes Issue #2).
          // Resolve batchExecutionId: prefer durable claim, then candidate closure.
          const liveClaim = getWorkspaceWriterClaim(repoRoot);
          const durableBatchId = liveClaim?.batchExecutionId || candidate?.batchExecutionId || executionRecord?.batchExecutionId || capturedScope?.batchExecutionId;
          if (durableBatchId) {
            const { assessBatchExecutionSettlement } = await import('./batch-completion-settlement.mjs');
            settlement = assessBatchExecutionSettlement({
              repoRoot,
              changeSlug: capturedChangeSlug,
              batchExecutionId: durableBatchId,
            });
          }
          // If we can't resolve batchExecutionId, fail closed (settlement.settled remains false)
        }

        const outcome = settlement.outcome || (settlement.settled ? 'completed' : 'recovery-required');

        if (outcome === 'completed' && settlement.settled) {
          if (capturedScope.kind === 'task-batch') {
            const { executeBatchCompletionSettlement } = await import('./batch-completion-settlement.mjs');
            const batchExecutionId = candidate.batchExecutionId || executionRecord.batchExecutionId || capturedScope.batchExecutionId;
            let batchSettlement = null;
            if (batchExecutionId) {
              batchSettlement = await executeBatchCompletionSettlement({
                repoRoot,
                changeSlug: capturedChangeSlug,
                specId,
                batchExecutionId,
                sessionId: capturedSessionId,
                ownerId: capturedOwnerId,
                activeDir: options.activeDir,
                options: {
                  ...options,
                  sessionService,
                  turnRuntime,
                  parentSessionId: capturedSessionId,
                },
              });
            }
            if (typeof onTurnTerminal === 'function') {
              await onTurnTerminal({ specId, scope: capturedScope, settled: true, outcome: 'completed', batchSettlement });
            }
            hookOutcome = { settled: true, outcome: 'completed', batchSettlement };
            return hookOutcome;
          }

          const relRes = await releaseWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: capturedOwnerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            expectedChangeSlug: capturedChangeSlug,
            expectedScope: capturedScope,
            ...(capturedTaskId ? { expectedTaskId: capturedTaskId } : {}),
            ...(capturedSessionId ? { expectedSessionId: capturedSessionId } : {}),
            ...(expectedTurnId ? { expectedTurnId } : {}),
          });
          const currentActiveSettled = activeExecutions.get(specId);
          let slotFreedBySettlement = false;
          if (currentActiveSettled?.ownerId === capturedOwnerId) {
            activeExecutions.delete(specId);
            slotFreedBySettlement = true;
          }
          if (typeof onTurnTerminal === 'function') {
            await onTurnTerminal({ specId, scope: capturedScope, taskId: capturedTaskId, settled: true, outcome: 'completed', released: relRes.released });
          }
          hookOutcome = { settled: true, outcome: 'completed', released: relRes.released };

          // Automatic continuation for settled turn (Item 5 & Item 12)
          if (repoRoot && capturedChangeSlug && capturedTaskId) {
            try {
              const { requireChange, requireTask } = await import('../../../../specs/store.mjs');
              const { reconcileContinuation } = await import('./reconciliation.mjs');
              const activeDir = options.activeDir || (repoRoot ? join(repoRoot, 'specs', 'active') : undefined);
              const reloadedChange = requireChange(capturedChangeSlug, activeDir);
              let reloadedTask = null;
              try {
                reloadedTask = requireTask(reloadedChange, capturedTaskId);
              } catch {}
              const contRes = await reconcileContinuation(reloadedChange, reloadedTask, {
                repoRoot,
                sessionService,
                turnRuntime,
                activeDir,
                parentSessionId: capturedSessionId,
              });
              hookOutcome.continuation = contRes;
            } catch (contErr) {
              console.error('[admission] Hook 1 continuation failed:', contErr);
            }
          }

          // The one-active-execution-per-spec slot just freed (and the own-task
          // continuation above, if any, has already had first claim on it) — a
          // sibling settlement's own durable pending handover group (task 11/13, gap 1)
          // may now be admittable.
          if (slotFreedBySettlement && repoRoot && capturedChangeSlug) {
            await triggerPendingHandoverResume({
              repoRoot,
              changeSlug: capturedChangeSlug,
              activeDir: options.activeDir,
              options: { ...options, sessionService, turnRuntime },
            });
          }
        } else if (outcome === 'resumable') {
          // outcome: 'resumable' -> release the claim without continuation, leave workflow_progress untouched (D1, D3, D4)
          const relRes = await releaseWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: capturedOwnerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            expectedChangeSlug: capturedChangeSlug,
            expectedScope: capturedScope,
            ...(capturedTaskId ? { expectedTaskId: capturedTaskId } : {}),
            ...(capturedSessionId ? { expectedSessionId: capturedSessionId } : {}),
            ...(expectedTurnId ? { expectedTurnId } : {}),
          });
          const currentActiveResumable = activeExecutions.get(specId);
          let slotFreedByResumable = false;
          if (currentActiveResumable?.ownerId === capturedOwnerId) {
            activeExecutions.delete(specId);
            slotFreedByResumable = true;
          }

          if (typeof onTurnTerminal === 'function') {
            await onTurnTerminal({ specId, scope: capturedScope, taskId: capturedTaskId, settled: false, outcome: 'resumable', released: relRes.released });
          }

          // Emit resumable activity audit record (D5, Task 08)
          try {
            let currentTaskProgress = executionRecord.baselineProgress;
            if (repoRoot && capturedChangeSlug && capturedTaskId) {
              try {
                const { requireChange, requireTask } = await import('../../../../specs/store.mjs');
                const activeDir = options.activeDir || (repoRoot ? join(repoRoot, 'specs', 'active') : undefined);
                const currentChange = requireChange(capturedChangeSlug, activeDir);
                const currentTask = requireTask(currentChange, capturedTaskId);
                if (currentTask?.workflow_progress) {
                  currentTaskProgress = currentTask.workflow_progress;
                }
              } catch {}
            }

            const step = settlement.details?.step ||
                         settlement.details?.finishOperation?.step ||
                         currentTaskProgress?.current_step ||
                         executionRecord.baselineProgress?.current_step ||
                         candidate?.stepId ||
                         candidate?.step ||
                         null;
            const attempt = settlement.details?.attempt ??
                            settlement.details?.finishOperation?.attempt ??
                            currentTaskProgress?.current_attempt ??
                            executionRecord.baselineProgress?.current_attempt ??
                            candidate?.attempt ??
                            1;

            const occurredAt = new Date().toISOString();
            recordActivity(
              {
                type: 'workflow.execution.resumable',
                occurredAt,
                actor: capturedSessionId ? resolveAgentSessionActor(capturedSessionId) : SYSTEM_ACTOR,
                scope: {
                  specId,
                  ...(capturedTaskId ? { taskId: capturedTaskId } : {}),
                },
                data: {
                  changeSlug: capturedChangeSlug,
                  sessionId: capturedSessionId,
                  turnId: turnIdResolved,
                  step,
                  attempt,
                  outcome: 'resumable',
                  timestamp: occurredAt,
                },
              },
              {
                repoRoot,
                ...(options.activityDir ? { activityDir: options.activityDir } : {}),
              }
            );
          } catch (activityErr) {
            console.error('[admission] Failed to record resumable activity:', activityErr);
          }

          hookOutcome = { settled: false, outcome: 'resumable', released: relRes.released };

          // The slot just freed here too — a sibling's durable pending handover group
          // (task 11/13, gap 1) may now be admittable even though this task itself is
          // merely resumable, not finished.
          if (slotFreedByResumable && repoRoot && capturedChangeSlug) {
            await triggerPendingHandoverResume({
              repoRoot,
              changeSlug: capturedChangeSlug,
              activeDir: options.activeDir,
              options: { ...options, sessionService, turnRuntime },
            });
          }
        } else {
          const markRes = await markWorkspaceWriterRecoveryRequiredIfOwned({
            repoRoot,
            expectedOwnerId: capturedOwnerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            expectedChangeSlug: capturedChangeSlug,
            expectedScope: capturedScope,
            ...(capturedTaskId ? { expectedTaskId: capturedTaskId } : {}),
            ...(capturedSessionId ? { expectedSessionId: capturedSessionId } : {}),
            ...(expectedTurnId ? { expectedTurnId } : {}),
          });
          const currentActiveFailed = activeExecutions.get(specId);
          let slotFreedByRecovery = false;
          if (currentActiveFailed?.ownerId === capturedOwnerId) {
            activeExecutions.delete(specId);
            slotFreedByRecovery = true;
          }
          if (typeof onTurnTerminal === 'function') {
            await onTurnTerminal({ specId, scope: capturedScope, taskId: capturedTaskId, settled: false, outcome: 'recovery-required', markedRecovery: markRes.marked });
          }
          hookOutcome = { settled: false, outcome: 'recovery-required', markedRecovery: markRes.marked };

          // The slot just freed here too — a sibling's durable pending handover group
          // (task 11/13, gap 1) may now be admittable even though this task itself now
          // requires recovery.
          if (slotFreedByRecovery && repoRoot && capturedChangeSlug) {
            await triggerPendingHandoverResume({
              repoRoot,
              changeSlug: capturedChangeSlug,
              activeDir: options.activeDir,
              options: { ...options, sessionService, turnRuntime },
            });
          }
        }

        return hookOutcome;
      } finally {
        executionRecord.settled = true;
        resolveSettled?.(hookOutcome);
      }
    };

    executionRecord.reconcile = reconcileHook1;

    // Install real per-turn terminal subscription (Hook 1, Item 5)
    if (sessionService?.subscribeToSession && canonicalSessionId) {
      try {
        unsub = sessionService.subscribeToSession(canonicalSessionId, {
          onEvent: async (event) => {
            // subscribeToSession replays the session's buffered event backlog from the
            // start on every new subscription (turn-event-stream.mjs) — on a *reused*
            // session, that backlog can still contain a PRIOR turn's own terminal event.
            // Without this turnId filter, that stale replay would fire this execution's
            // own reconcileHook1 immediately on subscribe, releasing (or recovery-marking)
            // the claim this admission JUST acquired, for a turn that never actually ran.
            if (event.turnId && event.turnId !== turnId) return;
            if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.cancelled') {
              if (unsub) {
                try { unsub(); } catch {}
                unsub = null;
              }
              await reconcileHook1({ turnId: event.turnId || turnId, terminalEvent: event });
            }
          },
        });
      } catch (subErr) {
        console.error('[admission] Failed to subscribe to session for Hook 1:', subErr);
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          expectedChangeSlug: changeSlug,
          expectedScope: candidateScope,
          ...(candidateScope.kind === 'task' ? { expectedTaskId: candidateScope.taskId } : {}),
        }).catch(() => {});
        const currentActive = activeExecutions.get(specId);
        if (currentActive?.ownerId === ownerId) {
          activeExecutions.delete(specId);
        }
        return {
          admitted: false,
          reason: 'SESSION_SUBSCRIPTION_FAILED',
          error: subErr?.message || String(subErr),
        };
      }
    }

    // Record resume audit trail if resuming an earlier resumable execution (D5, Task 08)
    if (candidateScope.kind === 'task' && changeSlug && candidateScope.taskId) {
      try {
        const taskId = candidateScope.taskId;
        const step = executionRecord.baselineProgress?.current_step || candidate.stepId || candidate.step || null;
        const attempt = executionRecord.baselineProgress?.current_attempt ?? candidate.attempt ?? 1;

        if (executionRecord.baselineProgress?.state !== 'completed' && step !== null) {
          const activities = readActivities(specId, {
            repoRoot,
            ...(options.activityDir ? { activityDir: options.activityDir } : {}),
          });

          const alreadyResumedTriggerIds = new Set(
            activities
              .filter((a) => a.type === 'workflow.execution.resumed' && a.triggeredBy)
              .map((a) => a.triggeredBy)
          );

          const matchingResumables = activities.filter((a, idx) => {
            if (a.type !== 'workflow.execution.resumable') return false;
            const aTask = a.scope?.taskId || a.data?.taskId;
            const aChange = a.data?.changeSlug;
            const aStep = a.data?.step;
            const aAttempt = a.data?.attempt;
            if (
              aTask !== taskId ||
              aChange !== changeSlug ||
              aStep !== step ||
              aAttempt !== attempt ||
              alreadyResumedTriggerIds.has(a.id)
            ) {
              return false;
            }

            // Check if any subsequent record in activities indicates this step/attempt was completed
            const subsequentCompleted = activities.slice(idx + 1).some(
              (later) =>
                later.type === 'workflow.step.completed' &&
                (later.scope?.taskId === taskId || later.data?.taskId === taskId) &&
                (later.data?.step === undefined || later.data?.step === step) &&
                (later.data?.attempt === undefined || later.data?.attempt === attempt)
            );
            if (subsequentCompleted) return false;

            return true;
          });

          if (matchingResumables.length > 0) {
            const priorRecord = matchingResumables[matchingResumables.length - 1];
            const occurredAt = new Date().toISOString();
            recordActivity(
              {
                type: 'workflow.execution.resumed',
                occurredAt,
                actor: canonicalSessionId ? resolveAgentSessionActor(canonicalSessionId) : SYSTEM_ACTOR,
                scope: {
                  specId,
                  taskId,
                },
                triggeredBy: priorRecord.id,
                data: {
                  changeSlug,
                  sessionId: canonicalSessionId,
                  turnId: executionRecord.turnId,
                  step,
                  attempt,
                  priorActivityId: priorRecord.id,
                  priorSessionId: priorRecord.data?.sessionId,
                  priorTurnId: priorRecord.data?.turnId,
                  timestamp: occurredAt,
                },
              },
              {
                repoRoot,
                ...(options.activityDir ? { activityDir: options.activityDir } : {}),
              }
            );
          }
        }
      } catch (auditErr) {
        console.error('[admission] Failed to record resume audit activity:', auditErr);
      }
    }

    return {
      admitted: true,
      ownerId,
      sessionId: canonicalSessionId,
      turnId: executionRecord.turnId,
      reconcile: reconcileHook1,
      reconcileHook1,
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
