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
import { AiValidationError, AiPolicyConflictError } from '../../contracts.mjs';
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
    if (
      body.model !== undefined &&
      body.model !== null &&
      (typeof body.model !== 'string' || !body.model.trim())
    ) {
      throw new AiValidationError('Model must be a non-empty string or null when provided.');
    }
    const effort = body.effort ?? body.reasoningEffort;
    if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) {
      throw new AiValidationError('Effort must be a non-empty string when provided.');
    }

    const effectiveRepoRoot = repoRoot || service.repoRoot || process.cwd();

    if (body.purpose === 'execution') {
      const selectedTaskIds = Array.isArray(body.taskIds) && body.taskIds.length > 0
        ? body.taskIds
        : (body.taskId ? [body.taskId] : []);

      if (selectedTaskIds.length === 0) {
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

      // Validate all selected task IDs against canonical change tasks first
      for (const tid of selectedTaskIds) {
        const exists = deterministicTarget.change.tasks?.some((t) => t.id === tid);
        if (!exists) {
          throw new AiValidationError(`Task '${tid}' not found in specification '${changeSlug}'.`);
        }
      }

      // Batch review execution ("Review together", Task 08, D6, D12, D13, D26, D33, D34, D38)
      if (body.reviewTogether === true || body.batchReview === true || body.scope?.kind === 'task-batch') {
        if (selectedTaskIds.length < 2) {
          throw new AiValidationError('Batch review requires at least 2 tasks.');
        }

        let definition = null;
        if (deterministicTarget.resolvedWorkflow?.definition) {
          const { loadWorkflowDefinition } = await import('../../../../../specs/workflow/definitions/loader.mjs');
          definition = loadWorkflowDefinition(deterministicTarget.resolvedWorkflow.definition, { repoRoot: effectiveRepoRoot });
        }

        const { validateBatchCompatibility, createGroupReservation } = await import('../../../../../specs/workflow/queue/index.mjs');
        const compat = validateBatchCompatibility({
          change: deterministicTarget.change,
          taskIds: selectedTaskIds,
          definition,
          repoRoot: effectiveRepoRoot,
        });

        if (!compat.compatible) {
          throw new AiValidationError(compat.reason || compat.error || `Incompatible batch review selection: task '${compat.incompatibleTaskId}'`);
        }

        if (compat.role !== 'reviewer') {
          throw new AiValidationError(`Batch execution is restricted to the 'reviewer' role in v1 (resolved role: '${compat.role}').`);
        }

        const { executionPolicyService } = await import('../execution-policy-service.mjs');
        // D12: Detect task override conflicts across selected tasks
        const resolvedPolicies = selectedTaskIds.map((tId) =>
          executionPolicyService.resolveExecutionPolicy(changeSlug, tId, {
            role: 'reviewer',
            repoRoot: effectiveRepoRoot,
          })
        );
        const firstPolicy = resolvedPolicies[0];
        const hasPolicyConflict = resolvedPolicies.some(
          (p) => p?.provider !== firstPolicy?.provider || p?.mode !== firstPolicy?.mode || p?.model !== firstPolicy?.model
        );
        if (hasPolicyConflict && !body.oneOff && !body.provider) {
          throw new AiPolicyConflictError(
            'Selected tasks have conflicting execution policy overrides. An explicit provider, model, and mode must be selected for the batch.'
          );
        }

        const resolvedPolicy = hasPolicyConflict ? null : firstPolicy;

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
          effectiveProvider = body.provider || null;
          effectiveMode = body.mode || 'agent';
          effectiveModel = (body.model && typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : undefined;
        }

        if (!effectiveProvider) {
          throw new AiValidationError('No execution provider specified or configured in execution policy for reviewer.');
        }

        // Context capacity snapshot (D26, D34, D38):
        // Capacity authority is ALWAYS the provider's canonical model catalog -- never client-supplied.
        let modelMaxTokens = null;
        try {
          const providerEntry = service.registry?.get?.(effectiveProvider);
          if (providerEntry && typeof providerEntry.provider?.listModels === 'function') {
            // Use the same canonical model listing path as service.listProviders()
            const models = await providerEntry.provider.listModels();
            const modelDesc = Array.isArray(models)
              ? models.find((m) => m.id === effectiveModel || m.name === effectiveModel)
              : null;
            if (typeof modelDesc?.traits?.maxContextTokens === 'number') {
              modelMaxTokens = modelDesc.traits.maxContextTokens;
            }
          }
        } catch {}

        let contextCapacity = null;
        if (typeof modelMaxTokens === 'number') {
          contextCapacity = { status: 'known', maxContextTokens: modelMaxTokens, source: 'catalog' };
        } else {
          contextCapacity = { status: 'unknown', reason: 'Catalog trait not available' };
        }

        const executionConfigSnapshot = {
          provider: effectiveProvider,
          model: effectiveModel,
          mode: effectiveMode,
          contextCapacity,
        };

        // Atomically reserve group and activate barrier (D18, D31, D38)
        const reservation = await createGroupReservation({
          repoRoot: effectiveRepoRoot,
          changeSlug,
          taskIds: selectedTaskIds,
          executionConfigSnapshot,
        });

        const batchExecutionId = reservation.batchExecutionId;
        const batchPrompt = `Execute batched review for tasks: ${selectedTaskIds.join(', ')}. Batch execution ID: ${batchExecutionId}.`;

        const { admitAgentExecution } = await import('../../orchestration/admission.mjs');
        const candidate = {
          scope: { kind: 'task-batch', taskIds: selectedTaskIds },
          taskIds: selectedTaskIds,
          batchExecutionId,
          stepId: compat.step || 'review',
          role: 'reviewer',
          provider: effectiveProvider,
          mode: effectiveMode,
          model: effectiveModel,
          changeSlug,
          specId: canonicalSpecId,
          sessionPolicy: 'fresh',
          parentSessionId: null,
          message: batchPrompt,
          userMessage: batchPrompt,
          effort: effort ? effort.trim() : undefined,
          idempotencyKey: body.idempotencyKey,
        };

        const admission = await admitAgentExecution(canonicalSpecId, candidate, {
          repoRoot: effectiveRepoRoot,
          sessionService: service,
          turnRuntime: service.turnRuntime,
          activeDir: join(effectiveRepoRoot, 'specs', 'active'),
        });

        if (!admission.admitted) {
          const { rollbackReservationSynchronously } = await import('../../../../../specs/workflow/queue/reservation.mjs');
          await rollbackReservationSynchronously({
            repoRoot: effectiveRepoRoot,
            changeSlug,
            batchExecutionId,
            error: new Error(admission.reason),
          });
          reply.code(409).send({
            error: {
              code: admission.reason || 'ADMISSION_BLOCKED',
              message: `Batch agent execution admission failed: ${admission.reason}`,
              details: admission,
            },
          });
          return;
        }

        reply.code(201).send({
          sessionId: admission.sessionId,
          ownerId: admission.ownerId,
          turnId: admission.turnId,
          batchExecutionId,
          contextCapacity,
          scope: candidate.scope,
        });
        return;
      }

      // A. Pure resolution and validation (no disk side-effects) — the one authoritative
      // deterministic execution plan, shared with the existing-session route below
      // (ADR-0009: the difference between HTTP entry points is caller intent/context,
      // never workflow semantics).
      const { resolveDeterministicExecutionPlan } = await import('../../orchestration/deterministic-execution-plan.mjs');
      const plan = await resolveDeterministicExecutionPlan({
        deterministicTarget,
        selectedTaskIds,
        body,
        effort,
        repoRoot: effectiveRepoRoot,
      });

      if (plan.noRunnableTask) {
        reply.code(409).send({
          error: {
            code: 'NO_RUNNABLE_TASK',
            message: 'No runnable task in sequential queue.',
            details: {
              warnings: plan.warnings,
              selectedTaskIds,
            },
          },
        });
        return;
      }

      const {
        targetTaskId,
        targetStepName,
        authoritativeTarget,
        authoritativeRole,
        sessionPolicy,
        parentSessionId,
        effectiveProvider,
        effectiveMode,
        effectiveModel,
        effectiveUserMessage,
      } = plan;

      const { executionPolicyService } = await import('../execution-policy-service.mjs');

      // Persist spec-level execution policy from D21 if no policy exists yet and not a one-off execution
      if (!body.oneOff && effectiveProvider && effectiveMode) {
        try {
          const existing = executionPolicyService.getExecutionPolicy(changeSlug, { repoRoot: effectiveRepoRoot });
          if (!existing) {
            executionPolicyService.saveExecutionPolicy(
              changeSlug,
              {
                provider: effectiveProvider,
                ...(effectiveModel ? { model: effectiveModel } : {}),
                mode: effectiveMode,
              },
              { repoRoot: effectiveRepoRoot },
            );
          }
        } catch {}
      }

      // C. Admission
      const { admitAgentExecution } = await import('../../orchestration/admission.mjs');

      const candidate = {
        taskId: targetTaskId,
        stepId: targetStepName,
        provider: effectiveProvider,
        changeSlug,
        specId: canonicalSpecId,
        sessionPolicy,
        role: authoritativeRole,
        parentSessionId,
        sessionId: sessionPolicy === 'reuse' ? parentSessionId : undefined,
        message: effectiveUserMessage,
        userMessage: effectiveUserMessage,
        mode: effectiveMode,
        model: effectiveModel || undefined,
        effort: effort ? effort.trim() : undefined,
        idempotencyKey: body.idempotencyKey,
        // The queue-resolved readiness verdict for this exact candidate (D2: may be
        // ready, or activation-only via DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT / a replayable
        // FINISH_OPERATION_UNRESOLVED) — admitAgentExecution is the single authoritative
        // boundary that classifies this into preActivationBlocker via
        // isActivationOnlyBlocker, never a route-local shortcut (ADR-0009).
        readiness: authoritativeTarget.readiness,
      };

      console.log(
        `[ai] [deterministic:admit] provider=${effectiveProvider} specId=${canonicalSpecId} changeSlug=${changeSlug} taskId=${targetTaskId} sessionPolicy=${sessionPolicy} role=${authoritativeRole}`,
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
        `[ai] [deterministic:started] provider=${effectiveProvider} session=${admission.sessionId} turnId=${admission.turnId} ownerId=${admission.ownerId}`,
      );

      reply.code(201).send({
        sessionId: admission.sessionId,
        turnId: admission.turnId,
        ownerId: admission.ownerId,
        provider: effectiveProvider,
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
      model: body.model === null ? null : body.model ? body.model.trim() : undefined,
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
      const effectiveRepoRoot = repoRoot || service.repoRoot || process.cwd();
      if (
        body.model !== undefined &&
        body.model !== null &&
        (typeof body.model !== 'string' || !body.model.trim())
      ) {
        throw new AiValidationError('Model must be a non-empty string or null when provided.');
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
        const taskId = body.taskId || body.activeTaskId || body.executionScope?.taskId;
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

        // The one authoritative deterministic execution plan — identical resolution to
        // the new-session route (ADR-0009: caller intent/context differs between HTTP
        // entry points, workflow semantics never do). This route must NOT treat "the
        // caller already had a session open" as authority to override the workflow's
        // own declared session policy: a transition declaring session: fresh must get a
        // fresh session even when the explicit action was invoked from inside an
        // existing one; a transition declaring session: reuse must reuse the exact
        // server-resolved predecessor, never whichever sessionId happens to appear in
        // this URL.
        const { resolveDeterministicExecutionPlan } = await import('../../orchestration/deterministic-execution-plan.mjs');
        const plan = await resolveDeterministicExecutionPlan({
          deterministicTarget,
          selectedTaskIds: [taskId],
          body,
          effort,
          repoRoot: effectiveRepoRoot,
        });

        if (plan.noRunnableTask) {
          reply.code(409).send({
            error: {
              code: 'NO_RUNNABLE_TASK',
              message: 'No runnable task in sequential queue.',
              details: { warnings: plan.warnings, selectedTaskIds: [taskId] },
            },
          });
          return;
        }

        const {
          targetTaskId,
          targetStepName,
          authoritativeRole,
          sessionPolicy,
          parentSessionId,
          effectiveProvider,
          effectiveMode,
          effectiveModel,
          effectiveUserMessage,
          changeSlug,
          canonicalSpecId,
          readiness,
        } = plan;

        // Exact-reuse invariant (deterministic-status-corrective Test 34): a reuse
        // transition may only continue the exact server-resolved predecessor session —
        // never an arbitrary same-task session merely because its id appears in this
        // URL.
        if (sessionPolicy === 'reuse' && sessionId !== parentSessionId) {
          throw new AiValidationError(
            `This session ('${sessionId}') does not match the server-derived session to reuse ('${parentSessionId}') for this workflow transition.`
          );
        }

        const { executionPolicyService } = await import('../execution-policy-service.mjs');
        if (!body.oneOff && effectiveProvider && effectiveMode) {
          try {
            const existing = executionPolicyService.getExecutionPolicy(changeSlug, { repoRoot: effectiveRepoRoot });
            if (!existing) {
              executionPolicyService.saveExecutionPolicy(
                changeSlug,
                {
                  provider: effectiveProvider,
                  ...(effectiveModel ? { model: effectiveModel } : {}),
                  mode: effectiveMode,
                },
                { repoRoot: effectiveRepoRoot },
              );
            }
          } catch {}
        }

        const { admitAgentExecution } = await import('../../orchestration/admission.mjs');
        const candidate = {
          taskId: targetTaskId,
          stepId: targetStepName,
          provider: effectiveProvider,
          changeSlug,
          specId: canonicalSpecId,
          sessionPolicy,
          role: authoritativeRole,
          parentSessionId,
          // 'fresh' never carries a sessionId — admitAgentExecution creates the required
          // new session itself (via sessionService.createSession) regardless of which
          // sessionId this request's own URL named; the URL's session is caller context,
          // not an authoritative admission target.
          sessionId: sessionPolicy === 'reuse' ? parentSessionId : undefined,
          message: effectiveUserMessage,
          userMessage: effectiveUserMessage,
          mode: effectiveMode,
          model: effectiveModel || undefined,
          effort: effort ? effort.trim() : undefined,
          idempotencyKey: body.idempotencyKey,
          readiness,
        };

        console.log(
          `[ai] [deterministic:admit] provider=${effectiveProvider} specId=${canonicalSpecId} changeSlug=${changeSlug} taskId=${targetTaskId} sessionPolicy=${sessionPolicy} role=${authoritativeRole} requestSessionId=${sessionId}`,
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

        reply.code(202).send({
          sessionId: admission.sessionId,
          turnId: admission.turnId,
          ownerId: admission.ownerId,
          provider: effectiveProvider,
          idempotent: false,
          // The caller's own session differs from the admitted one whenever the
          // workflow's declared session policy required a fresh session (or a
          // different exact predecessor) than the one this request was made through.
          // The caller must follow this id, never assume the URL's own sessionId.
          isNewSession: admission.sessionId !== sessionId,
        });
        return;
      }

      console.log(
        `[ai] [turn:start] provider=${provider || 'unknown'} sessionId=${sessionId}${body.mode ? ` mode=${body.mode}` : ''}${body.model ? ` model=${body.model}` : ''} prompt="${(body.message ?? body.prompt ?? '').slice(0, 60)}"`,
      );
      // sessionId is explicitly canonical here (the path param this route is named for) â€”
      // passed via opts.sessionId, never the ambiguous legacy positional identity slot.
      const result = await service.startTurn(provider, undefined, {
        sessionId,
        message: body.message ?? body.prompt,
        ...(typeof body.userMessage === 'string' ? { userMessage: body.userMessage } : {}),
        specId: body.specId,
        taskId: body.taskId,
        activeTaskId: body.activeTaskId,
        executionScope: body.executionScope,
        purpose: body.purpose,
        mode: body.mode,
        model: body.model === null ? null : body.model ? body.model.trim() : undefined,
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
      if (
        body.model !== undefined &&
        body.model !== null &&
        (typeof body.model !== 'string' || !body.model.trim())
      ) {
        throw new AiValidationError('Model must be a non-empty string or null when provided.');
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
        model: body.model === null ? null : body.model ? body.model.trim() : undefined,
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



