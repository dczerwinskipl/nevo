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

export class SessionChoiceValidationError extends AiValidationError {
  constructor(code, message, details) {
    super(message, details);
    this.code = code;
    this.name = 'SessionChoiceValidationError';
  }
}

/**
 * Derives the reuse candidate session for a workflow transition.
 */
export async function deriveReuseCandidate({
  task,
  definition,
  matchedTransition,
  canonicalSpecId,
  targetTaskId,
  repoRoot,
  bindingService: providedBindingService,
}) {
  const history = task?.workflow_progress?.history || [];
  const reuseFromStep = matchedTransition?.execution?.reuseFrom || null;

  if (!repoRoot && !providedBindingService) return null;

  let bindingService = providedBindingService;
  if (!bindingService && repoRoot) {
    try {
      const { createAgentSessionBindingService } = await import('../sessions/binding-service.mjs');
      bindingService = createAgentSessionBindingService({
        storageDir: join(repoRoot, '.nevo-ai-local', 'sessions'),
      });
    } catch {
      bindingService = null;
    }
  }

  let candidateSessionId = null;
  let candidateStep = null;
  let candidateAttempt = 1;

  if (reuseFromStep) {
    let foundInHistory = false;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.step === reuseFromStep) {
        foundInHistory = true;
        candidateStep = h.step;
        candidateAttempt = h.attempt ?? 1;
        if (h.sessionId) {
          candidateSessionId = h.sessionId;
          break;
        }
        if (bindingService) {
          try {
            const stepBindings = await bindingService.listBindings({
              specId: canonicalSpecId,
              taskId: targetTaskId,
              step: h.step,
              ...(h.attempt !== undefined ? { attempt: h.attempt } : {}),
            });
            if (stepBindings.length === 1) {
              candidateSessionId = stepBindings[0].sessionId;
            }
          } catch {}
        }
        break;
      }
    }

    if (!candidateSessionId && !foundInHistory && bindingService) {
      try {
        const stepBindings = await bindingService.listBindings({
          specId: canonicalSpecId,
          taskId: targetTaskId,
          step: reuseFromStep,
        });
        if (stepBindings.length === 1) {
          candidateSessionId = stepBindings[0].sessionId;
          candidateStep = reuseFromStep;
          candidateAttempt = stepBindings[0].attempt ?? 1;
        }
      } catch {}
    }
  } else if (history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const priorStepDef = definition?.steps?.[h.step];
      const priorExecutor = priorStepDef?.executor || 'agent';
      if (priorExecutor === 'human') {
        continue;
      }
      candidateStep = h.step;
      candidateAttempt = h.attempt ?? 1;
      if (h.sessionId) {
        candidateSessionId = h.sessionId;
        break;
      }
      if (bindingService) {
        try {
          const stepBindings = await bindingService.listBindings({
            specId: canonicalSpecId,
            taskId: targetTaskId,
            step: h.step,
            ...(h.attempt !== undefined ? { attempt: h.attempt } : {}),
          });
          if (stepBindings.length === 1) {
            candidateSessionId = stepBindings[0].sessionId;
            break;
          } else if (stepBindings.length > 1) {
            candidateSessionId = null;
            break;
          }
        } catch {}
      }
    }
  }

  if (!candidateSessionId) return null;

  let provider = null;
  if (bindingService) {
    try {
      const sess = await bindingService.getSession(candidateSessionId);
      if (sess?.provider) {
        provider = sess.provider;
      }
    } catch {}
  }

  const stepName = candidateStep || 'Step';
  const stepLabel = stepName.charAt(0).toUpperCase() + stepName.slice(1);
  const label = provider
    ? `${stepLabel}, attempt ${candidateAttempt}, ${provider}`
    : `${stepLabel}, attempt ${candidateAttempt}`;

  return {
    sessionId: candidateSessionId,
    step: candidateStep,
    attempt: candidateAttempt,
    provider,
    label,
  };
}

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

  let definition = null;
  if (deterministicTarget.resolvedWorkflow?.definition) {
    const { loadWorkflowDefinition } = await import('../../../../specs/workflow/definitions/loader.mjs');
    definition = loadWorkflowDefinition(deterministicTarget.resolvedWorkflow.definition, { repoRoot });
  }

  // Resolve the target task directly via canonical single-task readiness — never via a
  // durable queue file (batch-execution-generalization, task 01: the plain sequential
  // queue had no caller this actually needed, and was the mechanism responsible for the
  // original runaway-session incident). `selectedTaskIds` is scoped to exactly this
  // request's own candidates — never merged with unrelated historical state (ADR-0009:
  // an explicit execution action must target exactly the task it names).
  const { evaluateExecutionReadiness, isActivationOnlyBlocker } = await import('../../../../specs/workflow/readiness-policy.mjs');
  const { isTaskBarriered } = await import('../../../../specs/workflow/queue/reservation.mjs');

  const eligible = [];
  const warnings = [];
  const selectedSet = new Set(selectedTaskIds);

  for (const taskId of selectedTaskIds) {
    const task = deterministicTarget.change.tasks?.find((t) => t.id === taskId);
    if (!task) continue;
    if (isTaskBarriered(deterministicTarget.change, taskId, { repoRoot })) continue;

    const readiness = evaluateExecutionReadiness(task, deterministicTarget.change, 'agent', {
      definition,
      repoRoot,
    });

    if (!readiness.ready) {
      const isActivationOnly = isActivationOnlyBlocker(readiness, {
        repoRoot,
        task,
        change: deterministicTarget.change,
        record: readiness.priorRecord,
      });
      if (!isActivationOnly) {
        if (Array.isArray(readiness.blockedBy) && readiness.blockedBy.length > 0) {
          for (const depId of readiness.blockedBy) {
            if (!selectedSet.has(depId)) {
              warnings.push({ taskId, blockedByTaskId: depId });
            }
          }
        }
        continue;
      }
    }

    const stepId = readiness.targetStep?.id || readiness.projection?.nextStep?.id || readiness.projection?.currentStep;
    eligible.push({
      taskId,
      stepId,
      order: task.order ?? 999,
      executor: readiness.targetStep?.executor || 'agent',
      readiness,
    });
  }

  eligible.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const authoritativeTarget = eligible.length > 0 ? eligible[0] : null;

  if (!authoritativeTarget) {
    let singleTaskReadiness = null;
    if (selectedTaskIds.length === 1) {
      const singleTask = deterministicTarget.change.tasks?.find((t) => t.id === selectedTaskIds[0]);
      if (singleTask && definition) {
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
    return { noRunnableTask: true, warnings, selectedTaskIds, singleTaskReadiness };
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
  const declaredAllow = matchedTransition?.execution?.allow || null;
  const reuseFromStep = matchedTransition?.execution?.reuseFrom || null;

  const candidate = await deriveReuseCandidate({
    task,
    definition,
    matchedTransition,
    canonicalSpecId,
    targetTaskId,
    repoRoot,
  });
  const parentSessionId = candidate?.sessionId || null;

  let sessionPolicy = declaredSessionPolicy || 'fresh';

  if (body.sessionPolicy) {
    if (declaredAllow) {
      if (declaredAllow.includes(body.sessionPolicy)) {
        sessionPolicy = body.sessionPolicy;
      } else {
        throw new SessionChoiceValidationError(
          'SESSION_POLICY_NOT_ALLOWED',
          `Requested sessionPolicy '${body.sessionPolicy}' is not allowed for this workflow transition (allowed: ${declaredAllow.join(', ')}).`
        );
      }
    } else if (declaredSessionPolicy && body.sessionPolicy !== declaredSessionPolicy) {
      throw new AiValidationError(
        `Requested sessionPolicy '${body.sessionPolicy}' conflicts with server-resolved workflow session policy '${declaredSessionPolicy}'.`
      );
    }
  } else if (declaredSessionPolicy === 'reuse' && !parentSessionId && !body.sessionId && declaredAllow?.includes('fresh')) {
    // Graceful fallback to fresh when no candidate exists and fresh is allowed,
    // ensuring no behavior change for legacy requests that do not specify sessionPolicy
    sessionPolicy = 'fresh';
  }

  // Validate client lineage hints
  if (body.parentSessionId && body.parentSessionId !== parentSessionId) {
    throw new AiValidationError(
      `Requested parentSessionId '${body.parentSessionId}' does not match server-derived parentSessionId '${parentSessionId}'.`
    );
  }

  if (sessionPolicy === 'reuse') {
    if (!parentSessionId) {
      const searched = reuseFromStep ? `step '${reuseFromStep}'` : 'workflow history';
      throw new SessionChoiceValidationError(
        'REUSE_CANDIDATE_NOT_FOUND',
        `Target workflow transition requires session reuse, but no exact predecessor session could be resolved from ${searched}.`
      );
    }
    if (body.sessionId && body.sessionId !== parentSessionId) {
      throw new SessionChoiceValidationError(
        'SESSION_ID_MISMATCH',
        `Requested sessionId '${body.sessionId}' does not match server-derived session to reuse '${parentSessionId}'.`
      );
    }
    if (candidate?.provider && effectiveProvider && candidate.provider !== effectiveProvider) {
      throw new SessionChoiceValidationError(
        'PROVIDER_MISMATCH',
        `Candidate session '${parentSessionId}' uses provider '${candidate.provider}', which differs from target role provider '${effectiveProvider}'. Provider switching on session reuse is not permitted.`
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
    candidate,
    effectiveProvider,
    effectiveMode,
    effectiveModel,
    effectiveUserMessage,
    readiness: authoritativeTarget.readiness,
  };
}
