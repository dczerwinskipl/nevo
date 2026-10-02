// Single authoritative deterministic execution plan resolver (ADR-0009).
//
// Both HTTP entry points that can admit a deterministic agent execution — the
// new-session route (POST /api/agent-sessions/turns) and the existing-session route
// (POST /api/agent-sessions/:sessionId/turns) — must resolve the exact same execution
// plan for a given (spec, task) before admission: target step, authoritative role,
// declared session policy (fresh/reuse), execution policy (provider/model/mode), and
// the exact predecessor session when reuse is declared. The difference between the two
// HTTP entry points is caller intent/context (a brand-new session vs. continuing inside
// one that already exists) — never workflow semantics. Workflow session policy always
// wins over which URL the caller happened to call.
//
// This module owns that resolution exactly once; it throws AiValidationError for any
// caller-supplied hint (role, sessionPolicy, sessionId, parentSessionId,
// provider/mode/model) that conflicts with the server-resolved authoritative value,
// exactly like the pre-existing new-session route behavior this was extracted from.

import { join } from 'node:path';
import { AiValidationError } from '../contracts.mjs';

/**
 * @param {object} params
 * @param {object} params.deterministicTarget - Result of resolveDeterministicExecutionTarget
 * @param {string[]} params.selectedTaskIds - Candidate task ids for this request (usually one)
 * @param {object} params.body - Parsed request body (caller hints: role, sessionPolicy, sessionId, parentSessionId, provider, mode, model, oneOff, stepId, userMessage/message/prompt)
 * @param {string} [params.effort]
 * @param {string} params.repoRoot
 * @param {object} params.service - AgentSessionService (for policy persistence helpers only)
 * @returns {Promise<object>} Either `{ noRunnableTask: true, warnings, selectedTaskIds, singleTaskReadiness }`
 *   or the resolved plan: `{ targetTaskId, targetStepName, task, definition, authoritativeTarget,
 *   matchedTransition, authoritativeRole, sessionPolicy, parentSessionId, effectiveProvider,
 *   effectiveMode, effectiveModel, effectiveUserMessage, readiness, changeSlug, canonicalSpecId }`
 */
export async function resolveDeterministicExecutionPlan({
  deterministicTarget,
  selectedTaskIds,
  body,
  effort,
  repoRoot,
}) {
  const { changeSlug, specId: canonicalSpecId } = deterministicTarget;

  for (const tid of selectedTaskIds) {
    const exists = deterministicTarget.change.tasks?.some((t) => t.id === tid);
    if (!exists) {
      throw new AiValidationError(`Task '${tid}' not found in specification '${changeSlug}'.`);
    }
  }

  // candidateQueue is scoped to exactly this request's own selectedTaskIds — never merged
  // with whatever else happens to still be sitting in the durable queue file. Cross-request
  // batch continuation is reconcileContinuation's job (Hook 1, automatic), never an HTTP
  // handler's; merging in unrelated historical entries here let a stale, still-"eligible"
  // (but already-used) single-task entry silently outrank a brand new, unrelated explicit
  // task request via the FIFO tie-break (ADR-0009: an explicit execution action must target
  // exactly the task it names).
  const { loadTaskQueue, evaluateTaskQueue } = await import('../../../../specs/workflow/queue/index.mjs');
  const currentQueue = loadTaskQueue(repoRoot, changeSlug);
  const candidateQueue = {
    changeSlug,
    taskIds: [],
    eligibleAt: {},
    metadata: currentQueue?.metadata || {},
  };
  const now = Date.now();
  for (const id of selectedTaskIds) {
    if (!id || typeof id !== 'string') continue;
    if (candidateQueue.taskIds.includes(id)) continue;
    candidateQueue.taskIds.push(id);
    candidateQueue.eligibleAt[id] = currentQueue?.eligibleAt?.[id] ?? now;
  }

  let definition = null;
  if (deterministicTarget.resolvedWorkflow?.definition) {
    const { loadWorkflowDefinition } = await import('../../../../specs/workflow/definitions/loader.mjs');
    definition = loadWorkflowDefinition(deterministicTarget.resolvedWorkflow.definition, { repoRoot });
  }

  const queueState = evaluateTaskQueue({
    change: deterministicTarget.change,
    queueRecord: candidateQueue,
    definition,
    repoRoot,
  });

  const authoritativeTarget = queueState.nextRunnable;
  if (!authoritativeTarget) {
    let singleTaskReadiness = null;
    if (selectedTaskIds.length === 1) {
      const singleTask = deterministicTarget.change.tasks?.find((t) => t.id === selectedTaskIds[0]);
      if (singleTask && definition) {
        const { evaluateExecutionReadiness } = await import('../../../../specs/workflow/readiness-policy.mjs');
        singleTaskReadiness = evaluateExecutionReadiness(singleTask, deterministicTarget.change, 'agent', {
          definition,
          repoRoot,
        });
        if (singleTaskReadiness?.code === 'WORKFLOW_STEP_EXECUTOR_MISMATCH') {
          const stepName = singleTaskReadiness.targetStep?.id || singleTaskReadiness.stepId || 'human-verification';
          throw new AiValidationError(
            `Target workflow step '${stepName}' requires human execution and cannot be admitted for an agent turn.`
          );
        }
      }
    }
    return { noRunnableTask: true, warnings: queueState.warnings, selectedTaskIds, singleTaskReadiness };
  }

  const targetTaskId = authoritativeTarget.taskId;
  const targetStepName = authoritativeTarget.stepId;
  const task = deterministicTarget.change.tasks?.find((t) => t.id === targetTaskId);

  if (authoritativeTarget.executor !== 'agent') {
    throw new AiValidationError(
      `Target workflow step '${targetStepName}' requires ${authoritativeTarget.executor} execution and cannot be admitted for an agent turn.`
    );
  }

  if (body.stepId && body.stepId !== targetStepName) {
    throw new AiValidationError(
      `Requested stepId '${body.stepId}' does not match server-resolved target step '${targetStepName}'.`
    );
  }

  const { matchIncomingTransition } = await import('./reconciliation.mjs');
  const matchResult = matchIncomingTransition(task, definition, targetStepName);
  if (matchResult.ambiguous) {
    throw new AiValidationError(matchResult.reason || `Ambiguous incoming transition to '${targetStepName}'.`);
  }

  const matchedTransition = matchResult.transition;
  const authoritativeRole = matchedTransition?.execution?.role || null;

  if (body.role && body.role !== authoritativeRole) {
    throw new AiValidationError(
      `Requested role '${body.role}' does not match server-resolved role '${authoritativeRole}'.`
    );
  }

  const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');
  const resolvedPolicy = executionPolicyService.resolveExecutionPolicy(changeSlug, targetTaskId, {
    ...(authoritativeRole ? { role: authoritativeRole } : {}),
    repoRoot,
  });

  let effectiveProvider;
  let effectiveMode;
  let effectiveModel;

  if (body.oneOff === true) {
    effectiveProvider = body.provider || resolvedPolicy?.provider;
    effectiveMode = body.mode || resolvedPolicy?.mode || 'agent';
    if (body.model === null) {
      effectiveModel = undefined;
    } else if (body.model !== undefined) {
      effectiveModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    } else {
      effectiveModel = resolvedPolicy?.model;
    }
  } else if (resolvedPolicy?.provider) {
    if (body.provider && body.provider !== resolvedPolicy.provider) {
      throw new AiValidationError(
        `Requested provider '${body.provider}' does not match server-resolved execution policy provider '${resolvedPolicy.provider}'. Use oneOff to override.`
      );
    }
    if (body.mode && body.mode !== resolvedPolicy.mode) {
      throw new AiValidationError(
        `Requested mode '${body.mode}' does not match server-resolved execution policy mode '${resolvedPolicy.mode}'. Use oneOff to override.`
      );
    }
    if (body.model !== undefined) {
      const policyModel = resolvedPolicy.model ? resolvedPolicy.model.trim() : null;
      const requestedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
      if (requestedModel !== policyModel) {
        if (policyModel !== null && requestedModel === null) {
          throw new AiValidationError(
            `Requested provider default model does not match server-resolved execution policy model '${resolvedPolicy.model}'. Use oneOff to override.`
          );
        }
        if (policyModel === null && requestedModel !== null) {
          throw new AiValidationError(
            `Requested model '${body.model}' does not match server-resolved execution policy (provider default). Use oneOff to override.`
          );
        }
        throw new AiValidationError(
          `Requested model '${body.model}' does not match server-resolved execution policy model '${resolvedPolicy.model}'. Use oneOff to override.`
        );
      }
    }
    effectiveProvider = resolvedPolicy.provider;
    effectiveMode = resolvedPolicy.mode;
    effectiveModel = resolvedPolicy.model;
  } else {
    // First explicit start with no policy on disk yet (D21)
    effectiveProvider = body.provider || null;
    effectiveMode = body.mode || 'agent';
    effectiveModel = (body.model && typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : undefined;
  }

  if (!effectiveProvider) {
    throw new AiValidationError('No execution provider specified or configured in execution policy.');
  }

  const declaredSessionPolicy = matchedTransition?.execution?.session || null;
  const sessionPolicy = declaredSessionPolicy || 'fresh';

  if (body.sessionPolicy && declaredSessionPolicy && body.sessionPolicy !== declaredSessionPolicy) {
    throw new AiValidationError(
      `Requested sessionPolicy '${body.sessionPolicy}' conflicts with server-resolved workflow session policy '${declaredSessionPolicy}'.`
    );
  }

  let parentSessionId = null;
  const history = task?.workflow_progress?.history || [];
  if (repoRoot && history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.sessionId) {
        parentSessionId = h.sessionId;
        break;
      }
      const priorStepDef = definition?.steps?.[h.step];
      const priorExecutor = priorStepDef?.executor || 'agent';
      if (priorExecutor === 'human') {
        continue;
      }
      try {
        const { createAgentSessionBindingService } = await import('../sessions/binding-service.mjs');
        const bindingService = createAgentSessionBindingService({
          storageDir: join(repoRoot, '.nevo-ai-local', 'sessions'),
        });
        const stepBindings = await bindingService.listBindings({
          specId: canonicalSpecId,
          taskId: targetTaskId,
          step: h.step,
          ...(h.attempt !== undefined ? { attempt: h.attempt } : {}),
        });
        if (stepBindings.length === 1) {
          parentSessionId = stepBindings[0].sessionId;
          break;
        } else if (stepBindings.length > 1) {
          parentSessionId = null;
          break;
        }
      } catch {}
    }
  }

  // Validate client lineage hints
  if (body.parentSessionId && body.parentSessionId !== parentSessionId) {
    throw new AiValidationError(
      `Requested parentSessionId '${body.parentSessionId}' does not match server-derived parentSessionId '${parentSessionId}'.`
    );
  }

  if (sessionPolicy === 'reuse') {
    if (!parentSessionId) {
      throw new AiValidationError(
        'Target workflow transition requires session reuse, but no exact predecessor session could be resolved from workflow history.'
      );
    }
    if (body.sessionId && body.sessionId !== parentSessionId) {
      throw new AiValidationError(
        `Requested sessionId '${body.sessionId}' does not match server-derived session to reuse '${parentSessionId}'.`
      );
    }
  } else if (sessionPolicy === 'fresh') {
    if (body.sessionId) {
      throw new AiValidationError(
        `Cannot specify sessionId '${body.sessionId}' for fresh session policy.`
      );
    }
  }

  // Item 2: Build authoritative execution trigger from server-resolved targetTaskId
  const canonicalTrigger = `Execute the current workflow step for task ${targetTaskId}.`;
  let effectiveUserMessage = canonicalTrigger;
  const rawUserText = body.userMessage || body.prompt || body.message;
  if (rawUserText && typeof rawUserText === 'string') {
    const trimmed = rawUserText.trim();
    const isBoilerplate = /^Execute the current workflow step for task [^\s.]+\.?$/i.test(trimmed);
    if (!isBoilerplate && trimmed.length > 0) {
      effectiveUserMessage = `${canonicalTrigger}\n\n${trimmed}`;
    }
  }

  return {
    noRunnableTask: false,
    changeSlug,
    canonicalSpecId,
    targetTaskId,
    targetStepName,
    task,
    definition,
    authoritativeTarget,
    matchedTransition,
    authoritativeRole,
    sessionPolicy,
    parentSessionId,
    effectiveProvider,
    effectiveMode,
    effectiveModel,
    effectiveUserMessage,
    readiness: authoritativeTarget.readiness,
  };
}
