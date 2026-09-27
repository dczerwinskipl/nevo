import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  UUID_PATTERN,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from '../http.mjs';
import { authorize } from '../../access-policy.mjs';
import { AiValidationError } from '../../contracts.mjs';
import { loadChange, listChanges } from '../../../../../specs/store.mjs';
import { resolveWorkflowMode } from '../../../../../specs/workflow/compatibility.mjs';
import { resolveCanonicalSpec } from '../../../../../specs/identity.mjs';

const TURN_BODY_LIMIT = 128 * 1024;
const CANCEL_BODY_LIMIT = 512;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function resolveDeterministicExecutionTarget({ specId, slug, changeSlug, repoRoot }) {
  const effectiveRoot = repoRoot || process.cwd();
  const activeDir = join(effectiveRoot, 'specs', 'active');
  const archiveDir = join(effectiveRoot, 'specs', 'archive');
  const identifier = changeSlug || slug || specId;
  if (!identifier) {
    throw new AiValidationError('Specification identifier (slug or specId) is required for execution.');
  }

  let canonical;
  try {
    canonical = resolveCanonicalSpec(identifier, { activeDir, archiveDir });
  } catch (err) {
    throw new AiValidationError(err.message, { cause: err });
  }

  if (!canonical?.change) {
    throw new AiValidationError(`Specification '${identifier}' not found.`);
  }

  const isArchived = existsSync(join(archiveDir, canonical.slug)) || !existsSync(join(activeDir, canonical.slug));
  if (isArchived) {
    throw new AiValidationError(`specification '${identifier}' is archived and cannot be executed`);
  }

  const change = canonical.change;
  const resolvedWorkflow = resolveWorkflowMode(change, { repoRoot: effectiveRoot, activeDir });
  if (resolvedWorkflow?.mode !== 'deterministic') {
    return { isDeterministic: false, change };
  }

  return {
    isDeterministic: true,
    change,
    changeSlug: canonical.slug,
    specId: canonical.specId,
    resolvedWorkflow,
  };
}

export default async function turnRoutes(fastify, { service, accessPolicy, repoRoot }) {
  // Atomic first-turn + session creation.
  fastify.post('/api/agent-sessions/turns', { bodyLimit: TURN_BODY_LIMIT }, async (request, reply) => {
    authorize(accessPolicy, 'control', request);
    const body = assertBodyObject(request.body);
    const provider = body.provider ? validatedSegment(body.provider, PROVIDER_PATTERN, 'provider ID') : null;
    if (body.purpose !== 'execution' && !provider) {
      throw new AiValidationError('Provider ID is required.');
    }
    if (body.specId !== undefined && body.specId !== null) {
      if (typeof body.specId !== 'string' || !IDENTIFIER_PATTERN.test(body.specId)) {
        throw new AiValidationError('Invalid specification ID.');
      }
    }
    if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
    if (body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim())) {
      throw new AiValidationError('Model must be a non-empty string when provided.');
    }
    const effort = body.effort ?? body.reasoningEffort;
    if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) {
      throw new AiValidationError('Effort must be a non-empty string when provided.');
    }

    const effectiveRepoRoot = repoRoot || service.repoRoot || process.cwd();

    if (body.purpose === 'execution') {
      if (!body.taskId) {
        throw new AiValidationError('Task ID is required for deterministic execution.');
      }
      const deterministicTarget = resolveDeterministicExecutionTarget({
        specId: body.specId,
        slug: body.slug,
        changeSlug: body.changeSlug,
        repoRoot: effectiveRepoRoot,
      });

      if (!deterministicTarget?.isDeterministic) {
        throw new AiValidationError(
          `Specification '${body.changeSlug || body.slug || body.specId}' is not configured for deterministic execution.`
        );
      }

      const { changeSlug, specId: canonicalSpecId } = deterministicTarget;

      // If multiple taskIds provided (SequentialQueueTaskPicker batch), enqueue them (Item 12)
      if (Array.isArray(body.taskIds) && body.taskIds.length > 0) {
        const { enqueueTasks } = await import('../../../../../specs/workflow/queue/index.mjs');
        enqueueTasks(effectiveRepoRoot, changeSlug, body.taskIds);
      }

      let definition = null;
      if (deterministicTarget.resolvedWorkflow?.definition) {
        const { loadWorkflowDefinition } = await import('../../../../../specs/workflow/definitions/loader.mjs');
        definition = loadWorkflowDefinition(deterministicTarget.resolvedWorkflow.definition, { repoRoot: effectiveRepoRoot });
      }

      const { requireTask } = await import('../../../../../specs/store.mjs');
      const { resolveWorkflowPosition } = await import('../../../../../specs/workflow/step-runner.mjs');
      const activeDir = join(effectiveRepoRoot, 'specs', 'active');
      let task = deterministicTarget.change.tasks?.find((t) => t.id === body.taskId);
      if (!task) {
        try {
          task = requireTask(changeSlug, body.taskId, activeDir);
        } catch (err) {
          throw new AiValidationError(`Task '${body.taskId}' not found in specification '${changeSlug}'.`, { cause: err });
        }
      }

      const position = resolveWorkflowPosition(definition, task);
      if (position.phase === 'terminal') {
        throw new AiValidationError(`Task '${body.taskId}' is in terminal phase and cannot be executed.`);
      }

      const targetStepName = position.phase === 'new'
        ? definition.entryStep
        : (position.phase === 'active' ? position.step : position.nextStep);

      if (!targetStepName) {
        throw new AiValidationError(`Could not resolve target workflow step for task '${body.taskId}'.`);
      }

      if (body.stepId && body.stepId !== targetStepName) {
        throw new AiValidationError(
          `Requested stepId '${body.stepId}' does not match server-resolved target step '${targetStepName}'.`
        );
      }

      const targetStepDef = definition?.steps?.[targetStepName];

      // Resolve matched incoming transition if applicable
      let matchedTransition = null;
      const history = task.workflow_progress?.history || [];
      if (history.length > 0) {
        const lastHistory = history[history.length - 1];
        if (lastHistory.transitioned_to === targetStepName) {
          const priorStepDef = definition.steps?.[lastHistory.step];
          const candidateTransitions = (priorStepDef?.transitions || []).filter(
            (t) => (t.to === targetStepName || t.step === targetStepName)
          );
          const historyResult = lastHistory.result;
          const matching = candidateTransitions.filter((t) => {
            if (t.value !== undefined) {
              return t.value === historyResult;
            }
            return true;
          });
          if (matching.length === 1) {
            matchedTransition = matching[0];
          } else if (matching.length > 1) {
            const exactMatches = matching.filter((t) => t.value !== undefined && t.value === historyResult);
            if (exactMatches.length === 1) {
              matchedTransition = exactMatches[0];
            }
          }
        }
      }

      const authoritativeRole = matchedTransition?.execution?.role || targetStepDef?.execution?.role || targetStepDef?.role || 'implementer';

      if (body.role && body.role !== authoritativeRole) {
        throw new AiValidationError(
          `Requested role '${body.role}' does not match server-resolved role '${authoritativeRole}'.`
        );
      }

      const { executionPolicyService } = await import('../execution-policy-service.mjs');
      const resolvedPolicy = executionPolicyService.resolveExecutionPolicy(changeSlug, body.taskId, {
        role: authoritativeRole,
        repoRoot: effectiveRepoRoot,
      });

      const effectiveProvider = provider || resolvedPolicy?.provider;
      if (!effectiveProvider) {
        throw new AiValidationError('No execution provider specified or configured in execution policy.');
      }
      const effectiveMode = body.mode || resolvedPolicy?.mode || 'agent';
      const declaredSessionPolicy = matchedTransition?.execution?.session || targetStepDef?.execution?.session;
      let sessionPolicy = declaredSessionPolicy || resolvedPolicy?.session || 'fresh';

      if (body.sessionPolicy && declaredSessionPolicy && body.sessionPolicy !== declaredSessionPolicy) {
        throw new AiValidationError(
          `Requested sessionPolicy '${body.sessionPolicy}' conflicts with server-resolved workflow session policy '${declaredSessionPolicy}'.`
        );
      }

      // Persist spec-level execution policy from D21 if no policy exists yet and not a one-off execution
      if (!body.oneOff && effectiveProvider && effectiveMode) {
        try {
          const existing = executionPolicyService.getExecutionPolicy(changeSlug, { repoRoot: effectiveRepoRoot });
          if (!existing) {
            executionPolicyService.saveExecutionPolicy(
              changeSlug,
              { provider: effectiveProvider, mode: effectiveMode },
              { repoRoot: effectiveRepoRoot },
            );
          }
        } catch {}
      }

      let parentSessionId = body.parentSessionId || null;
      if (!parentSessionId && effectiveRepoRoot && history.length > 0) {
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
            const { createAgentSessionBindingService } = await import('../binding-service.mjs');
            const bindingService = createAgentSessionBindingService({
              storageDir: join(effectiveRepoRoot, '.nevo-ai-local', 'sessions'),
            });
            const stepBindings = await bindingService.listBindings({
              specId: canonicalSpecId,
              taskId: task.id,
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

      const { admitAgentExecution } = await import('../../orchestration/admission.mjs');

      const candidate = {
        taskId: body.taskId,
        stepId: targetStepName,
        provider: effectiveProvider,
        changeSlug,
        specId: canonicalSpecId,
        sessionPolicy,
        role: authoritativeRole,
        parentSessionId,
        sessionId: body.sessionId || (sessionPolicy === 'reuse' ? parentSessionId : undefined),
        message: body.message ?? body.prompt,
        userMessage: body.userMessage,
        mode: effectiveMode,
        model: body.model ? body.model.trim() : undefined,
        effort: effort ? effort.trim() : undefined,
        idempotencyKey: body.idempotencyKey,
      };

      console.log(
        `[ai] [deterministic:admit] provider=${effectiveProvider} specId=${canonicalSpecId} changeSlug=${changeSlug} taskId=${body.taskId} sessionPolicy=${sessionPolicy} role=${authoritativeRole}`,
      );

      const admission = await admitAgentExecution(canonicalSpecId, candidate, {
        repoRoot: effectiveRepoRoot,
        sessionService: service,
        turnRuntime: service.turnRuntime,
      });

      if (!admission.admitted) {
        reply.code(409).send({
          error: {
            code: admission.reason || 'ADMISSION_BLOCKED',
            message: `Agent execution admission failed: ${admission.reason}`,
            details: admission,
          },
        });
        return;
      }

      console.log(
        `[ai] [deterministic:started] provider=${provider} session=${admission.sessionId} turnId=${admission.turnId} ownerId=${admission.ownerId}`,
      );

      reply.code(201).send({
        sessionId: admission.sessionId,
        turnId: admission.turnId,
        ownerId: admission.ownerId,
        provider,
        idempotent: false,
      });
      return;
    }

    console.log(
      `[ai] [turn:start] provider=${provider} session=new specId=${body.specId || '-'} taskId=${body.taskId || '-'}${body.mode ? ` mode=${body.mode}` : ''}${body.model ? ` model=${body.model}` : ''}`,
    );
    const result = await service.startTurn(provider, undefined, {
      message: body.message ?? body.prompt,
      ...(typeof body.userMessage === 'string' ? { userMessage: body.userMessage } : {}),
      specId: body.specId,
      taskId: body.taskId,
      purpose: body.purpose,
      mode: body.mode,
      model: body.model ? body.model.trim() : undefined,
      effort: effort ? effort.trim() : undefined,
      idempotencyKey: body.idempotencyKey,
    });
    console.log(
      `[ai] [turn:started] provider=${provider} session=${result.sessionId || result.providerSessionId} turnId=${result.turnId} idempotent=${result.idempotent}`,
    );
    reply.code(result.idempotent ? 200 : 201).send(result);
  });

  // Canonical turn start on existing session by canonical sessionId UUID
  fastify.post(
    '/api/agent-sessions/:sessionId/turns',
    { bodyLimit: TURN_BODY_LIMIT },
    async (request, reply) => {
      authorize(accessPolicy, 'control', request);
      const body = assertBodyObject(request.body);
      const sessionId = validatedSessionId(request.params.sessionId);
      if (body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim())) {
        throw new AiValidationError('Model must be a non-empty string when provided.');
      }
      const effort = body.effort ?? body.reasoningEffort;
      if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) {
        throw new AiValidationError('Effort must be a non-empty string when provided.');
      }
      const session = await service.getSession(sessionId);
      const provider = session?.provider;

      if (body.specId !== undefined && body.specId !== null) {
        if (typeof body.specId !== 'string' || !IDENTIFIER_PATTERN.test(body.specId)) {
          throw new AiValidationError('Invalid specification ID.');
        }
      }
      if (body.purpose === 'execution') {
        const taskId = body.taskId || session?.activeTaskId;
        if (!taskId) {
          throw new AiValidationError('Task ID is required for deterministic execution.');
        }
        const deterministicTarget = resolveDeterministicExecutionTarget({
          specId: body.specId || session?.specId,
          slug: body.slug || body.changeSlug || session?.specId,
          changeSlug: body.changeSlug || body.slug,
          repoRoot: effectiveRepoRoot,
        });

        if (!deterministicTarget?.isDeterministic) {
          throw new AiValidationError(
            `Specification '${body.changeSlug || body.slug || body.specId || session?.specId}' is not configured for deterministic execution.`
          );
        }

        const { changeSlug, specId: canonicalSpecId } = deterministicTarget;
        const { admitAgentExecution } = await import('../../orchestration/admission.mjs');
        const candidate = {
          taskId,
          stepId: body.stepId,
          provider: session?.provider || provider,
          changeSlug,
          specId: canonicalSpecId,
          sessionPolicy: 'reuse',
          sessionId,
          message: body.message ?? body.prompt,
          userMessage: body.userMessage,
          mode: body.mode,
          model: body.model ? body.model.trim() : undefined,
          effort: effort ? effort.trim() : undefined,
          idempotencyKey: body.idempotencyKey,
        };

        const admission = await admitAgentExecution(canonicalSpecId, candidate, {
          repoRoot: effectiveRepoRoot,
          sessionService: service,
          turnRuntime: service.turnRuntime,
        });

        if (!admission.admitted) {
          reply.code(409).send({
            error: {
              code: admission.reason || 'ADMISSION_BLOCKED',
              message: `Agent execution admission failed: ${admission.reason}`,
              details: admission,
            },
          });
          return;
        }

        reply.code(202).send({
          sessionId: admission.sessionId,
          turnId: admission.turnId,
          ownerId: admission.ownerId,
          provider: session?.provider || provider,
          idempotent: false,
        });
        return;
      }

      console.log(
        `[ai] [turn:start] provider=${provider || 'unknown'} sessionId=${sessionId}${body.mode ? ` mode=${body.mode}` : ''}${body.model ? ` model=${body.model}` : ''} prompt="${(body.message ?? body.prompt ?? '').slice(0, 60)}"`,
      );
      // sessionId is explicitly canonical here (the path param this route is named for) —
      // passed via opts.sessionId, never the ambiguous legacy positional identity slot.
      const result = await service.startTurn(provider, undefined, {
        sessionId,
        message: body.message ?? body.prompt,
        ...(typeof body.userMessage === 'string' ? { userMessage: body.userMessage } : {}),
        mode: body.mode,
        model: body.model ? body.model.trim() : undefined,
        effort: effort ? effort.trim() : undefined,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      });
      console.log(
        `[ai] [turn:started] provider=${result.provider || provider} session=${result.sessionId || sessionId} turnId=${result.turnId} idempotent=${result.idempotent}`,
      );
      reply.code(result.idempotent ? 200 : 202).send(result);
    },
  );

  // Canonical cancel by canonical sessionId UUID
  fastify.post(
    '/api/agent-sessions/:sessionId/turns/:turnId/cancel',
    { bodyLimit: CANCEL_BODY_LIMIT },
    async (request, reply) => {
      const sessionId = validatedSessionId(request.params.sessionId);
      const turnId = validatedSegment(request.params.turnId, TURN_PATTERN, 'turn ID');
      authorize(accessPolicy, 'control', request);
      const body = request.body ? assertBodyObject(request.body) : {};
      const action = body.action ?? 'cancel';
      if (action !== 'cancel' && action !== 'force_cleanup') {
        throw new AiValidationError("Property 'action' must be 'cancel' or 'force_cleanup'.");
      }
      if (action === 'force_cleanup') {
        const session = await service.getSession(sessionId);
        console.log(`[ai] [turn:recover] action=force_cleanup session=${sessionId} turnId=${turnId}`);
        const turn = await service.recoverTurn(turnId, { provider: session?.provider, sessionId });
        return reply.send({ turn });
      }
      console.log(`[ai] [turn:cancel] session=${sessionId} turnId=${turnId}`);
      const turn = await service.cancelTurn(turnId, { sessionId });
      reply.send({ turn });
    },
  );

  // Subsequent turns on an existing session (compatibility resolver).
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/turns',
    { bodyLimit: TURN_BODY_LIMIT },
    async (request, reply) => {
      authorize(accessPolicy, 'control', request);
      const body = assertBodyObject(request.body);
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const sessionId = validatedSessionId(request.params.providerSessionId);
      if (body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim())) {
        throw new AiValidationError('Model must be a non-empty string when provided.');
      }
      const effort = body.effort ?? body.reasoningEffort;
      if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) {
        throw new AiValidationError('Effort must be a non-empty string when provided.');
      }
      console.log(
        `[ai] [turn:start] provider=${provider} session=${sessionId}${body.mode ? ` mode=${body.mode}` : ''}${body.model ? ` model=${body.model}` : ''} prompt="${(body.message ?? body.prompt ?? '').slice(0, 60)}"`,
      );
      const result = await service.startTurn(provider, sessionId, {
        message: body.message ?? body.prompt,
        ...(typeof body.userMessage === 'string' ? { userMessage: body.userMessage } : {}),
        mode: body.mode,
        model: body.model ? body.model.trim() : undefined,
        effort: effort ? effort.trim() : undefined,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      });
      console.log(
        `[ai] [turn:started] provider=${provider} session=${result.providerSessionId} turnId=${result.turnId} idempotent=${result.idempotent}`,
      );
      reply.code(result.idempotent ? 200 : 202).send(result);
    },
  );

  // Cancel, correlated to session + turn (supports action: 'cancel' | 'force_cleanup').
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel',
    { bodyLimit: CANCEL_BODY_LIMIT },
    async (request, reply) => {
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = validatedSessionId(request.params.providerSessionId);
      const turnId = validatedSegment(request.params.turnId, TURN_PATTERN, 'turn ID');
      authorize(accessPolicy, 'control', request);
      const body = request.body ? assertBodyObject(request.body) : {};
      const action = body.action ?? 'cancel';
      if (action !== 'cancel' && action !== 'force_cleanup') {
        throw new AiValidationError("Property 'action' must be 'cancel' or 'force_cleanup'.");
      }
      if (action === 'force_cleanup') {
        console.log(`[ai] [turn:recover] action=force_cleanup provider=${provider} session=${providerSessionId} turnId=${turnId}`);
        const turn = await service.recoverTurn(turnId, { provider, providerSessionId });
        return reply.send({ turn });
      }
      console.log(`[ai] [turn:cancel] provider=${provider} session=${providerSessionId} turnId=${turnId}`);
      const turn = await service.cancelTurn(turnId, { provider, providerSessionId });
      reply.send({ turn });
    },
  );

  // Dedicated remote recovery API for unknown / lost turns.
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/turns/:turnId/recover',
    { bodyLimit: CANCEL_BODY_LIMIT },
    async (request, reply) => {
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = validatedSessionId(request.params.providerSessionId);
      const turnId = validatedSegment(request.params.turnId, TURN_PATTERN, 'turn ID');
      authorize(accessPolicy, 'control', request);
      console.log(`[ai] [turn:recover] provider=${provider} session=${providerSessionId} turnId=${turnId}`);
      const turn = await service.recoverTurn(turnId, { provider, providerSessionId });
      reply.send({ turn });
    },
  );
}

