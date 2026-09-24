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
  const specId = change.id || change._slug;

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
  const history = task.workflow_progress?.history || [];
  if (history.length > 0) {
    const lastHistory = history[history.length - 1];
    const priorStepDef = definition.steps?.[lastHistory.step];
    matchedTransition = priorStepDef?.transitions?.find(
      (t) => (t.to === targetStepName || t.step === targetStepName) && (t.value === undefined || t.value === lastHistory.transitionResult)
    ) || priorStepDef?.transitions?.find((t) => t.to === targetStepName || t.step === targetStepName);

    continuationPolicy = matchedTransition?.continuation || null;
  }

  if (continuationPolicy !== 'auto') {
    return { action: 'noop', reason: 'NOT_AUTO_CONTINUATION', continuationPolicy };
  }

  // Destination is agent-owned: enqueue and admit
  if (executor === 'agent') {
    const changeSlug = change._slug || change.id;
    if (repoRoot) {
      enqueueTasks(repoRoot, changeSlug, [task.id]);
    }

    const queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: [task.id],
      definition,
      repoRoot,
    });

    if (queueState.nextRunnable) {
      let policy = null;
      try {
        const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');
        policy = executionPolicyService.resolveExecutionPolicy(changeSlug, task.id, { repoRoot });
      } catch {}

      const provider = policy?.provider || options.provider;
      const mode = policy?.mode || options.mode || 'agent';
      const sessionPolicy = matchedTransition?.execution?.session || 'fresh';
      const role = matchedTransition?.execution?.role;
      const parentSessionId = options.parentSessionId || options.priorSessionId || null;
      const genericTrigger = options.message || options.prompt || `Start workflow step '${targetStepName}' for task '${task.id}'.`;

      const candidate = {
        ...queueState.nextRunnable,
        provider,
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
  const { repoRoot, transcriptCache, sessionService, bindingService } = options;
  if (!repoRoot) return { reconciledClaims: 0, reconciledRequests: 0 };

  let reconciledClaims = 0;
  let reconciledRequests = 0;

  // 1. Reconcile workspace-writer claim snapshot (Hook 3, D100)
  const claimSnapshot = getWorkspaceWriterClaim(repoRoot);
  if (claimSnapshot && claimSnapshot.kind === 'agent') {
    const { ownerId, sessionId, turnId, turnStartState, specId, taskId } = claimSnapshot;
    const changeSlug = claimSnapshot.changeSlug || specId;

    // Unestablished identity: fail closed (D71, D97)
    if (!sessionId && !turnStartState) {
      // Do nothing, leave claim as found
    } else if (turnStartState === 'prepared') {
      // Prepared state: startTurn was never called. Settle directly (D99)
      const settlement = await assessExecutionSettlement({
        repoRoot,
        changeSlug,
        taskId,
      });

      if (settlement.settled) {
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
      // Invoking state: ambiguous start boundary (D99)
      // Resolve provider through canonical sessionId using sessionService / binding state (Item 7)
      let resolvedProvider = claimSnapshot.provider || null;
      if (!resolvedProvider && sessionId) {
        if (sessionService?.getSession) {
          const sess = await sessionService.getSession(sessionId).catch(() => null);
          if (sess?.provider) resolvedProvider = sess.provider;
        } else if (bindingService?.getSession) {
          const sess = await bindingService.getSession(sessionId).catch(() => null);
          if (sess?.provider) resolvedProvider = sess.provider;
        } else if (sessionService?.bindingService?.getSession) {
          const sess = await sessionService.bindingService.getSession(sessionId).catch(() => null);
          if (sess?.provider) resolvedProvider = sess.provider;
        }
      }

      // If provider cannot be resolved, fail closed
      if (!resolvedProvider) {
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
      } else {
        // Inspect transcriptCache for positive turn evidence attributable to this claim
        let recoveredTurnId = null;
        if (transcriptCache && sessionId) {
          try {
            const transcript = await transcriptCache.getTranscript(resolvedProvider, sessionId);
            const active = transcript?.activeTurn;
            if (active?.turnId) {
              if (
                (active.ownerId && active.ownerId === ownerId) ||
                (turnId && (active.turnId === turnId || active.id === turnId))
              ) {
                recoveredTurnId = active.turnId;
              }
            }
            if (!recoveredTurnId && Array.isArray(transcript?.turns) && transcript.turns.length > 0) {
              const matchingTurn = transcript.turns.find(
                (t) => (t.ownerId && t.ownerId === ownerId) || (turnId && (t.turnId === turnId || t.id === turnId))
              );
              if (matchingTurn) {
                recoveredTurnId = matchingTurn.turnId || matchingTurn.id;
              }
            }
          } catch {}
        }

        if (recoveredTurnId) {
          // Positive evidence: advance claim to started and check settlement
          await updateWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
            ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
            expectedTaskId: taskId,
            sessionId,
            turnId: recoveredTurnId,
            turnStartState: 'started',
          });

          const settlement = await assessExecutionSettlement({
            repoRoot,
            changeSlug,
            taskId,
          });

          if (settlement.settled) {
            await releaseWorkspaceWriterIfOwned({
              repoRoot,
              expectedOwnerId: ownerId,
              expectedKind: 'agent',
              expectedSpecId: specId,
              ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
              expectedTaskId: taskId,
              expectedSessionId: sessionId,
              expectedTurnId: recoveredTurnId,
            });
          } else {
            await markWorkspaceWriterRecoveryRequiredIfOwned({
              repoRoot,
              expectedOwnerId: ownerId,
              expectedKind: 'agent',
              expectedSpecId: specId,
              ...(claimSnapshot.changeSlug ? { expectedChangeSlug: claimSnapshot.changeSlug } : {}),
              expectedTaskId: taskId,
              expectedSessionId: sessionId,
              expectedTurnId: recoveredTurnId,
            });
          }
          reconciledClaims++;
        } else {
          // Inconclusive evidence: fail closed, mark recovery-required (D99)
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
      }
    } else if (turnStartState === 'started') {
      // Started state: authoritative (D99)
      const settlement = await assessExecutionSettlement({
        repoRoot,
        changeSlug,
        taskId,
      });

      if (settlement.settled) {
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
  const changeSlug = change._slug || change.id;
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

  if (queueState.nextRunnable) {
    const specId = change.id || changeSlug;
    let policy = null;
    try {
      const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');
      policy = executionPolicyService.resolveExecutionPolicy(changeSlug, queueState.nextRunnable.taskId, { repoRoot });
    } catch {}

    const provider = policy?.provider || options.provider;
    const mode = policy?.mode || options.mode || 'agent';
    const genericTrigger = options.message || options.prompt || `Start workflow task '${queueState.nextRunnable.taskId}'.`;
    const candidate = {
      ...queueState.nextRunnable,
      provider,
      mode,
      changeSlug,
      specId,
      sessionPolicy: 'fresh',
      parentSessionId: options.parentSessionId || options.priorSessionId || null,
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
