// Workflow position reconciliation and boot-time recovery orchestration (Task 29, D42, D45, D47, D75, D99, D100).

import { resolveWorkflowPosition } from '../../../../specs/workflow/step-runner.mjs';
import { loadWorkflowDefinition } from '../../../../specs/workflow/definitions/loader.mjs';
import { resolveWorkflowMode } from '../../../../specs/workflow/compatibility.mjs';
import { evaluateTaskQueue, enqueueTasks } from '../../../../specs/workflow/queue/index.mjs';
import { admitAgentExecution } from './admission.mjs';
import { describeHumanInteraction } from '../../../../specs/workflow/human-step/projection.mjs';
import {
  getWorkspaceWriterClaim,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
} from '../../../../specs/workflow/workspace-writer.mjs';
import {
  listWorkspaceRequests,
  transitionWorkspaceRequest,
} from '../../../../specs/workflow/workspace-request.mjs';
import { assessExecutionSettlement } from '../../../../specs/workflow/execution-settlement.mjs';
import {
  loadHumanSubmitOperation,
  updateHumanSubmitOperationStatus,
} from '../../../../specs/workflow/human-step/submit-request.mjs';
import { join } from 'node:path';
import { resolveStableSpecId } from '../../../../specs/identity.mjs';
import {
  resolveIncomingExecution,
  matchIncomingTransition,
} from '../../../../specs/workflow/resolve-incoming-execution.mjs';

export { resolveIncomingExecution, matchIncomingTransition };

/**
 * Reconciles a task's workflow position and drives automatic continuation (D42).
 *
 * @param {object} change - Change manifest
 * @param {object} task - Task record
 * @param {object} options
 * @param {string} options.repoRoot - Repository root
 * @param {object} [options.definition] - Optional pre-loaded workflow definition
 * @returns {Promise<{ action: 'agent-admitted'|'human-preview'|'noop', nextStep?: string, result?: any }>}
 */
export async function reconcileWorkflowPosition(change, task, options = {}) {
  const repoRoot = options.repoRoot;
  const specId = resolveStableSpecId(change);
  const changeSlug = change._slug || change.slug;

  let definition = options.definition;
  if (!definition) {
    const resolvedMode = resolveWorkflowMode(change, options);
    if (resolvedMode.definition) {
      definition = loadWorkflowDefinition(resolvedMode.definition, { repoRoot });
    }
  }

  if (!definition) {
    return { action: 'noop', reason: 'NO_DEFINITION' };
  }

  const position = resolveWorkflowPosition(definition, task);
  let targetStepName;
  let isNewOrCompleted = false;

  if (position.phase === 'new') {
    targetStepName = definition.entryStep;
    isNewOrCompleted = true;
  } else if (position.phase === 'completed') {
    targetStepName = position.nextStep;
    isNewOrCompleted = true;
  } else if (position.phase === 'active') {
    targetStepName = position.step;
  } else {
    // terminal
    return { action: 'noop', reason: 'WORKFLOW_TERMINAL' };
  }

  const stepDef = definition.steps?.[targetStepName];
  if (!stepDef) {
    return { action: 'noop', reason: 'STEP_NOT_FOUND', step: targetStepName };
  }

  const executor = stepDef.executor || 'agent';

  // Determine transition continuation policy
  // Check prior step's transition to targetStepName
  let continuationPolicy = null;
  let matchedTransition = null;
  const matchResult = matchIncomingTransition(task, definition, targetStepName);
  if (matchResult.ambiguous) {
    return { action: 'noop', reason: 'AMBIGUOUS_TRANSITION_MATCH', step: targetStepName, details: matchResult.reason };
  }
  matchedTransition = matchResult.transition;
  continuationPolicy = matchedTransition?.continuation || null;

  if (continuationPolicy !== 'auto') {
    return { action: 'noop', reason: 'NOT_AUTO_CONTINUATION', continuationPolicy };
  }

  // Destination is agent-owned: enqueue and admit
  if (executor === 'agent') {
    if (repoRoot) {
      enqueueTasks(repoRoot, changeSlug, [task.id]);
    }

    const queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: [task.id],
      definition,
      repoRoot,
    });

    if (queueState.nextRunnable?.readiness?.ready === false) {
      // nextRunnable is only "eligible" here because its readiness failure is
      // activation-only (dirty worktree / replayable finish) — remediation requires
      // explicit user instruction (remediation-protocol-exception.md), never automatic
      // continuation. Fail closed to a deterministic noop; an explicit admission (the
      // HTTP routes) may still pick this up for remediation.
      return {
        action: 'noop',
        reason: 'ACTIVATION_ONLY_BLOCKER_REQUIRES_EXPLICIT_ADMISSION',
        nextStep: targetStepName,
        queueState,
      };
    }

    if (queueState.nextRunnable) {
      const sessionPolicy = matchedTransition?.execution?.session || 'fresh';
      const role = matchedTransition?.execution?.role;

      let policy = null;
      try {
        const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');
        policy = executionPolicyService.resolveExecutionPolicy(changeSlug, task.id, { role, repoRoot });
      } catch {}

      const provider = policy ? policy.provider : options.provider;
      const model = policy ? policy.model : options.model;
      const mode = policy ? policy.mode : (options.mode || 'agent');
      let parentSessionId = options.parentSessionId || options.priorSessionId || null;
      if (!parentSessionId && repoRoot) {
        const history = task.workflow_progress?.history || [];
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          // 1. Direct history entry metadata (D26)
          if (h.sessionId) {
            parentSessionId = h.sessionId;
            break;
          }
          // 2. Human steps have no agent session; continue scanning backward
          const priorStepDef = definition.steps?.[h.step];
          const priorExecutor = priorStepDef?.executor || 'agent';
          if (priorExecutor === 'human') {
            continue;
          }
          // 3. Query bindingService for exact prior agent step & attempt
          try {
            const { createAgentSessionBindingService } = await import('../sessions/binding-service.mjs');
            const bindingService = options.bindingService || createAgentSessionBindingService({
              storageDir: join(repoRoot, '.nevo-ai-local', 'sessions'),
            });
            const stepBindings = await bindingService.listBindings({
              specId,
              taskId: task.id,
              step: h.step,
              ...(h.attempt !== undefined ? { attempt: h.attempt } : {}),
            });
            if (stepBindings.length === 1) {
              parentSessionId = stepBindings[0].sessionId;
              break;
            } else if (stepBindings.length > 1) {
              // Ambiguous candidate sessions: fail closed rather than guessing
              parentSessionId = null;
              break;
            }
          } catch {}
        }
      }
      const genericTrigger = options.message || options.prompt || `Start workflow step '${targetStepName}' for task '${task.id}'.`;

      const candidate = {
        ...queueState.nextRunnable,
        provider,
        ...(model ? { model } : {}),
        mode,
        changeSlug,
        specId,
        sessionPolicy,
        role,
        parentSessionId,
        ...(sessionPolicy === 'reuse' && parentSessionId ? { sessionId: parentSessionId } : {}),
        message: genericTrigger,
        prompt: genericTrigger,
        userMessage: genericTrigger,
      };

      const admissionRes = await admitAgentExecution(specId, candidate, options);
      return {
        action: 'agent-admitted',
        nextStep: targetStepName,
        admission: admissionRes,
      };
    }

    return {
      action: 'noop',
      reason: 'TASK_NOT_NEXT_RUNNABLE',
      queueState,
    };
  }

  // Destination is human-owned: ensure interaction preview is available (D47)
  // No admission, no mutation, no workspace-writer claim!
  if (executor === 'human') {
    const preview = describeHumanInteraction(stepDef, true);
    return {
      action: 'human-preview',
      nextStep: targetStepName,
      preview,
    };
  }

  return { action: 'noop' };
}

/**
 * Hook 3: Boot-time / first-request reconciliation of claims and workspace requests (D75, D99, D100).
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {object} [options.transcriptCache]
 * @returns {Promise<{ reconciledClaims: number, reconciledRequests: number }>}
 */
export async function reconcileBootState(options = {}) {
  const { repoRoot, transcriptCache, sessionService, bindingService, activeDir } = options;
  if (!repoRoot) return { reconciledClaims: 0, reconciledRequests: 0 };

  let reconciledClaims = 0;
  let reconciledRequests = 0;

  // 1. Reconcile workspace-writer claim snapshot (Hook 3, D100)
  const claimSnapshot = getWorkspaceWriterClaim(repoRoot);
  if (claimSnapshot && claimSnapshot.kind === 'agent') {
    const { ownerId, sessionId, turnId, turnStartState, specId } = claimSnapshot;
    const taskId = claimSnapshot.scope?.kind === 'task' ? claimSnapshot.scope.taskId : claimSnapshot.taskId;
    const changeSlug = claimSnapshot.changeSlug || specId;
    const isBatchClaim = claimSnapshot.scope?.kind === 'task-batch';

    if (isBatchClaim) {
      // Batch claim reconciliation (Issue #3 fix): cannot use single-task assessExecutionSettlement.
      // Use batchExecutionId from the durable claim to drive assessBatchExecutionSettlement.
      const batchExecutionId = claimSnapshot.batchExecutionId;

      if (!sessionId && !turnStartState) {
        // Unestablished: fail closed, leave as-is (D71)
      } else if (turnStartState === 'invoking') {
        // Invoking: ambiguous start boundary, fail closed to recovery-required (D99)
        await markWorkspaceWriterRecoveryRequiredIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
          expectedScope: claimSnapshot.scope,
          expectedSessionId: sessionId,
        });
        reconciledClaims++;
      } else if (batchExecutionId && (turnStartState === 'prepared' || turnStartState === 'started')) {
        // Authoritative: check durable batch-finish state
        const { assessBatchExecutionSettlement, executeBatchCompletionSettlement } = await import('./batch-completion-settlement.mjs');
        const batchSettlement = assessBatchExecutionSettlement({ repoRoot, changeSlug, batchExecutionId });

        if (batchSettlement.settled) {
          // Batch-finish is complete but settlement saga didn't finish — resume it
          try {
            await executeBatchCompletionSettlement({
              repoRoot,
              changeSlug,
              specId,
              batchExecutionId,
              sessionId,
              ownerId,
              activeDir,
              options: { repoRoot, sessionService, bindingService },
            });
          } catch (err) {
            // Settlement failed: mark recovery-required so operator is aware
            await markWorkspaceWriterRecoveryRequiredIfOwned({
              repoRoot,
              expectedOwnerId: ownerId,
              expectedKind: 'agent',
              expectedSpecId: specId,
              ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
              expectedScope: claimSnapshot.scope,
              expectedSessionId: sessionId,
            }).catch(() => {});
          }
          reconciledClaims++;
        } else {
          // Batch-finish not completed: provider turn ended without completing batch-finish.
          // Fail closed to recovery-required (prevents premature reservation release).
          await markWorkspaceWriterRecoveryRequiredIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedScope: claimSnapshot.scope,
            expectedSessionId: sessionId,
            ...(turnId && turnStartState === 'started' ? { expectedTurnId: turnId } : {}),
          });
          reconciledClaims++;
        }
      } else {
        // Missing batchExecutionId: ambiguous identity, fail closed
        await markWorkspaceWriterRecoveryRequiredIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
          expectedScope: claimSnapshot.scope,
        });
        reconciledClaims++;
      }
    } else {
      // Single-task claim: existing behavior (D99)

      // Unestablished identity: fail closed (D71, D97)
      if (!sessionId && !turnStartState) {
        // Do nothing, leave claim as found
      } else if (turnStartState === 'prepared') {
        // Prepared state: startTurn was never called. Settle directly (D99)
        const settlement = await assessExecutionSettlement({
          repoRoot,
          changeSlug,
          taskId,
          neverActivated: true,
        });

        const outcome = settlement.outcome || (settlement.settled ? 'completed' : 'recovery-required');
        if ((outcome === 'completed' && settlement.settled) || outcome === 'resumable') {
          await releaseWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedTaskId: taskId,
            expectedSessionId: sessionId,
          });
          reconciledClaims++;
        } else {
          await markWorkspaceWriterRecoveryRequiredIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedTaskId: taskId,
            expectedSessionId: sessionId,
          });
          reconciledClaims++;
        }
      } else if (turnStartState === 'invoking') {
        // Invoking state: ambiguous start boundary (D99).
        // Under D99, claims in turnStartState: 'invoking' do not yet carry turnId (which is persisted atomically
        // alongside 'started' after startTurn resolves). Furthermore, Turn aggregates carry no workspace-claim
        // ownerId (D98) and transcripts provide no execution-specific correlation token. Therefore, upon crash
        // recovery in 'invoking', no authoritative correlation exists to prove whether a turn in the transcript
        // belongs to this exact execution or an earlier execution on a reused session.
        // To guarantee safety and prevent misattribution, 'invoking' fails closed to recovery-required (D99).
        await markWorkspaceWriterRecoveryRequiredIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
          ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
          expectedTaskId: taskId,
          expectedSessionId: sessionId,
        });
        reconciledClaims++;
      } else if (turnStartState === 'started') {
        // Started state: authoritative (D99)
        const settlement = await assessExecutionSettlement({
          repoRoot,
          changeSlug,
          taskId,
        });

        const outcome = settlement.outcome || (settlement.settled ? 'completed' : 'recovery-required');
        if ((outcome === 'completed' && settlement.settled) || outcome === 'resumable') {
          await releaseWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedTaskId: taskId,
            expectedSessionId: sessionId,
            expectedTurnId: turnId,
          });
          reconciledClaims++;
        } else {
          await markWorkspaceWriterRecoveryRequiredIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedTaskId: taskId,
            expectedSessionId: sessionId,
            expectedTurnId: turnId,
          });
          reconciledClaims++;
        }
      }
    }
  }

  // Generic request-backed claim reconciliation (Item 7)
  const isRequestBacked = ['human-submit', 'publish', 'batch-publish'].includes(claimSnapshot?.kind);
  if (claimSnapshot && isRequestBacked) {
    const { reconcileRequestBackedWorkspaceClaim } = await import('../../../../specs/workflow/workspace-claim-reconciliation.mjs');
    const claimRecon = await reconcileRequestBackedWorkspaceClaim({
      repoRoot,
      claimSnapshot,
    });
    if (claimRecon.reconciled) {
      reconciledClaims++;
    }
  }

  // 2. Reconcile workspace requests (Hook 3, D75, D88, D96)
  const pendingRequests = listWorkspaceRequests({
    repoRoot,
    status: ['queued', 'waiting-for-workspace', 'running'],
  });

  const { reconcileRequestBackedWorkspaceClaim } = await import('../../../../specs/workflow/workspace-claim-reconciliation.mjs');

  for (const req of pendingRequests) {
    if (claimSnapshot && claimSnapshot.requestId === req.requestId) {
      continue;
    }

    const syntheticSnapshot = {
      ownerId: req.workspaceOwnerId || 'unassigned',
      requestId: req.requestId,
      kind: req.kind,
      specId: req.specId,
      taskId: req.taskId,
      operationRef: req.operationRef,
    };

    const res = await reconcileRequestBackedWorkspaceClaim({
      repoRoot,
      claimSnapshot: syntheticSnapshot,
    });
    if (res.reconciled) {
      reconciledRequests++;
    }
  }

  return { reconciledClaims, reconciledRequests };
}

/**
 * Drives automatic workflow continuation for a change: checks single-task auto-continuation first,
 * and if none or if task is complete, checks the durable queue for the change to admit nextRunnable (D38, D42, Item 5, Item 12).
 *
 * @param {object} change - Change manifest
 * @param {object} [task] - Task record
 * @param {object} [options]
 * @returns {Promise<{ action: 'agent-admitted'|'queue-agent-admitted'|'human-preview'|'noop', nextStep?: string, admission?: any, nextRunnable?: any }>}
 */
export async function reconcileContinuation(change, task, options = {}) {
  // 1. Single-task continuation check (if task provided)
  if (task) {
    const taskCont = await reconcileWorkflowPosition(change, task, options);
    if (taskCont.action === 'agent-admitted' || taskCont.action === 'human-preview') {
      return taskCont;
    }
  }

  // 2. Multi-task durable queue continuation check (Item 12, D38)
  const repoRoot = options.repoRoot;
  const changeSlug = change._slug || change.slug;
  if (!repoRoot || !changeSlug) {
    return { action: 'noop' };
  }

  const { loadTaskQueue, dequeueTask } = await import('../../../../specs/workflow/queue/store.mjs');
  const queueRecord = loadTaskQueue(repoRoot, changeSlug);
  if (!queueRecord || !Array.isArray(queueRecord.taskIds) || queueRecord.taskIds.length === 0) {
    return { action: 'noop' };
  }

  // Purge any tasks that are already terminal or completed
  for (const tid of [...queueRecord.taskIds]) {
    const t = change.tasks?.find((x) => x.id === tid);
    if (t && (t.status === 'completed' || t.status === 'verified' || t.status === 'closed' || t.workflow_progress?.state === 'completed')) {
      dequeueTask(repoRoot, changeSlug, tid);
    }
  }

  const refreshedQueue = loadTaskQueue(repoRoot, changeSlug);
  if (!refreshedQueue || !Array.isArray(refreshedQueue.taskIds) || refreshedQueue.taskIds.length === 0) {
    return { action: 'noop' };
  }

  let definition = options.definition;
  if (!definition) {
    const resolvedMode = resolveWorkflowMode(change, options);
    if (resolvedMode.definition) {
      definition = loadWorkflowDefinition(resolvedMode.definition, { repoRoot });
    }
  }

  const queueState = evaluateTaskQueue({
    change,
    selectedTaskIds: refreshedQueue.taskIds,
    queueRecord: refreshedQueue,
    definition,
    repoRoot,
  });

  if (queueState.nextRunnable?.readiness?.ready === false) {
    // Same explicit-admission-only rule as reconcileWorkflowPosition above: durable-queue
    // draining must not auto-admit a candidate that is only eligible via an
    // activation-only blocker.
    return {
      action: 'noop',
      reason: 'ACTIVATION_ONLY_BLOCKER_REQUIRES_EXPLICIT_ADMISSION',
      queueState,
    };
  }

  if (queueState.nextRunnable) {
    const specId = resolveStableSpecId(change);
    const targetTaskId = queueState.nextRunnable.taskId;
    const targetStep = queueState.nextRunnable.stepId;
    const task = change.tasks?.find((t) => t.id === targetTaskId);
    const matchResult = matchIncomingTransition(task, definition, targetStep);
    if (matchResult.ambiguous) {
      return { action: 'noop', reason: 'AMBIGUOUS_TRANSITION_MATCH', step: targetStep, details: matchResult.reason };
    }
    const role = matchResult?.transition?.execution?.role || null;
    const sessionPolicy = matchResult?.transition?.execution?.session || 'fresh';

    let policy = null;
    try {
      const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');
      policy = executionPolicyService.resolveExecutionPolicy(changeSlug, targetTaskId, {
        ...(role ? { role } : {}),
        repoRoot,
      });
    } catch {}

    const provider = policy ? policy.provider : options.provider;
    const model = policy ? policy.model : options.model;
    const mode = policy ? policy.mode : (options.mode || 'agent');
    const genericTrigger = options.message || options.prompt || `Start workflow task '${targetTaskId}'.`;
    const candidate = {
      ...queueState.nextRunnable,
      provider,
      ...(model ? { model } : {}),
      mode,
      changeSlug,
      specId,
      sessionPolicy,
      role,
      parentSessionId: null, // Ordinary queued task advancement does not fabricate lineage from prior task
      message: genericTrigger,
      prompt: genericTrigger,
      userMessage: genericTrigger,
    };

    const admissionRes = await admitAgentExecution(specId, candidate, {
      ...options,
      repoRoot,
      changeSlug,
    });
    return {
      action: 'queue-agent-admitted',
      nextRunnable: candidate,
      admission: admissionRes,
    };
  }

  return { action: 'noop', queueState };
}
