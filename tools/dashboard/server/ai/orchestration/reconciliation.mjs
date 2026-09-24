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
  const history = task.workflow_progress?.history || [];
  if (history.length > 0) {
    const lastHistory = history[history.length - 1];
    const priorStepDef = definition.steps?.[lastHistory.step];
    const matchedTransition = priorStepDef?.transitions?.find(
      (t) => (t.to === targetStepName || t.step === targetStepName) && (t.value === undefined || t.value === lastHistory.transitionResult)
    ) || priorStepDef?.transitions?.find((t) => t.to === targetStepName || t.step === targetStepName);

    continuationPolicy = matchedTransition?.continuation || null;
  } else if (position.phase === 'new') {
    // Entry step defaults to auto continuation if selected
    continuationPolicy = 'auto';
  }

  if (continuationPolicy !== 'auto') {
    return { action: 'noop', reason: 'NOT_AUTO_CONTINUATION', continuationPolicy };
  }

  // Destination is agent-owned: enqueue and admit
  if (executor === 'agent') {
    if (repoRoot) {
      enqueueTasks(repoRoot, change._slug || change.id, [task.id]);
    }

    const queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: [task.id],
      definition,
      repoRoot,
    });

    if (queueState.nextRunnable) {
      const admissionRes = await admitAgentExecution(specId, queueState.nextRunnable, options);
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
  const { repoRoot, transcriptCache } = options;
  if (!repoRoot) return { reconciledClaims: 0, reconciledRequests: 0 };

  let reconciledClaims = 0;
  let reconciledRequests = 0;

  // 1. Reconcile workspace-writer claim snapshot (Hook 3, D100)
  const claimSnapshot = getWorkspaceWriterClaim(repoRoot);
  if (claimSnapshot && claimSnapshot.kind === 'agent') {
    const { ownerId, sessionId, turnId, turnStartState, specId, taskId } = claimSnapshot;

    // Unestablished identity: fail closed (D71, D97)
    if (!sessionId && !turnStartState) {
      // Do nothing, leave claim as found
    } else if (turnStartState === 'prepared') {
      // Prepared state: startTurn was never called. Settle directly (D99)
      const settlement = await assessExecutionSettlement({
        repoRoot,
        changeSlug: specId,
        taskId,
      });

      if (settlement.settled) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
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
          expectedTaskId: taskId,
          expectedSessionId: sessionId,
        });
        reconciledClaims++;
      }
    } else if (turnStartState === 'invoking') {
      // Invoking state: ambiguous start boundary (D99)
      // Inspect transcriptCache for positive turn evidence attributable to this claim
      let recoveredTurnId = null;
      if (transcriptCache && sessionId) {
        try {
          const transcript = transcriptCache.getTranscript?.(claimSnapshot.provider || 'mock', sessionId);
          if (transcript?.activeTurn?.id) {
            recoveredTurnId = transcript.activeTurn.id;
          } else if (Array.isArray(transcript?.turns) && transcript.turns.length > 0) {
            // Check for matching turn
            const matchingTurn = transcript.turns.find(
              (t) => t.id === turnId || t.taskId === taskId
            );
            if (matchingTurn) {
              recoveredTurnId = matchingTurn.id;
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
          expectedTaskId: taskId,
          sessionId,
          turnId: recoveredTurnId,
          turnStartState: 'started',
        });

        const settlement = await assessExecutionSettlement({
          repoRoot,
          changeSlug: specId,
          taskId,
        });

        if (settlement.settled) {
          await releaseWorkspaceWriterIfOwned({
            repoRoot,
            expectedOwnerId: ownerId,
            expectedKind: 'agent',
            expectedSpecId: specId,
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
          expectedTaskId: taskId,
          expectedSessionId: sessionId,
        });
        reconciledClaims++;
      }
    } else if (turnStartState === 'started') {
      // Started state: authoritative (D99)
      const settlement = await assessExecutionSettlement({
        repoRoot,
        changeSlug: specId,
        taskId,
      });

      if (settlement.settled) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId,
          expectedKind: 'agent',
          expectedSpecId: specId,
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
          expectedTaskId: taskId,
          expectedSessionId: sessionId,
          expectedTurnId: turnId,
        });
        reconciledClaims++;
      }
    }
  }

  // 2. Reconcile workspace requests (Hook 3, D75)
  const pendingRequests = listWorkspaceRequests(repoRoot, {
    status: ['queued', 'waiting-for-workspace', 'running'],
  });

  for (const req of pendingRequests) {
    if (req.kind === 'human-submit' && req.operationRef) {
      const { change, task, step, attempt } = req.operationRef;
      const op = loadHumanSubmitOperation({
        repoRoot,
        changeSlug: change,
        taskId: task,
        step,
        attempt,
      });

      if (op) {
        const settlement = await assessExecutionSettlement({
          repoRoot,
          changeSlug: change,
          taskId: task,
        });

        if (settlement.settled && (op.status === 'completed' || op.status === 'failed')) {
          await transitionWorkspaceRequest({
            repoRoot,
            requestId: req.requestId,
            expectedStatus: req.status,
            to: op.status,
          });
          if (claimSnapshot && claimSnapshot.requestId === req.requestId) {
            await releaseWorkspaceWriterIfOwned({
              repoRoot,
              expectedOwnerId: claimSnapshot.ownerId,
              expectedKind: 'human-submit',
              expectedSpecId: claimSnapshot.specId,
              expectedTaskId: claimSnapshot.taskId,
            });
          }
          reconciledRequests++;
        }
      }
    }
  }

  return { reconciledClaims, reconciledRequests };
}
