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

      const targetStepName = body.stepId || definition?.entryStep;
      const targetStepDef = definition?.steps?.[targetStepName];
      const authoritativeRole = body.role || targetStepDef?.execution?.role || targetStepDef?.role || 'implementer';

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
      let sessionPolicy = body.sessionPolicy || resolvedPolicy?.session || 'fresh';

      // Persist spec-level execution policy from D21 if no policy exists yet
      if (effectiveProvider && effectiveMode) {
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

      const { admitAgentExecution } = await import('../../orchestration/admission.mjs');

      const candidate = {
        taskId: body.taskId,
        stepId: body.stepId || targetStepName,
        provider: effectiveProvider,
        changeSlug,
        specId: canonicalSpecId,
        sessionPolicy,
        role: authoritativeRole,
        sessionId: body.sessionId,
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

