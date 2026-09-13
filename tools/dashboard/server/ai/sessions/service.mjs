import { randomUUID } from 'node:crypto';
import {
  AiValidationError,
  CapabilityNotSupportedError,
  validateAgentIdentity,
  validateAgentExecutionMode,
  computeCurrentActivity,
  serializePublicTurn,
} from '../contracts.mjs';
import { validateAgentModelDescriptor, normalizeModelIdentifier } from '../model/model-catalog.mjs';
import { compareBindingRecency } from './binding-service.mjs';
import { listChanges } from '../../../../specs/store.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a provider-supplied dynamic model catalog entry by entry so one malformed
 * model descriptor degrades gracefully (dropped, with an advisory warning) instead of
 * either corrupting the public catalog with an invalid `AgentModelDescriptor` or
 * throwing away the whole provider's model list over a single bad entry.
 */
function validateModelCatalog(models, providerId) {
  const valid = [];
  for (const model of Array.isArray(models) ? models : []) {
    try {
      valid.push(validateAgentModelDescriptor(model, `${providerId}.models[]`));
    } catch (err) {
      console.warn(`[ai] Dropping invalid model descriptor from provider '${providerId}': ${err?.message || err}`);
    }
  }
  return valid;
}

/**
 * Computes semantic session readiness — the single, server-owned projection of
 * CanonicalTurn.status onto the client-facing SessionReadiness contract (ADR-0008).
 * HTTP snapshot reads and SSE `turn.updated` events both call this with the same
 * canonical Turn, so they can never disagree.
 */
export function resolveSessionReadiness({ descriptor, transcript, turnSnapshot, error } = {}) {
  // 1. Persistence corruption / unreadable error
  if (transcript?.health === 'corrupt' || error) {
    return {
      status: 'unavailable',
      reason: 'persistence_corrupt',
      details: { error: error?.message || transcript?.error || 'Corrupt persistence state' },
    };
  }

  // 2. Provider disabled or unavailable
  if (descriptor && (descriptor.enabled === false || descriptor.available === false)) {
    return {
      status: 'readOnly',
      reason: 'provider_disabled',
      details: { unavailableReason: descriptor.unavailableReason },
    };
  }

  // 3. Canonical Turn projection. No active/latest turn at all is equivalent to terminal.
  const status = turnSnapshot?.status;
  if (!status || status.status === 'terminal') {
    return {
      status: 'ready',
      reason: 'idle',
    };
  }

  if (status.status === 'requiresAttention') {
    const reason =
      status.reason === 'question'
        ? 'question_required'
        : status.reason === 'confirmation'
          ? 'confirmation_required'
          : 'permission_required';
    const workItems = Array.isArray(turnSnapshot.work) ? turnSnapshot.work : [];
    const interactionWork = workItems.find((w) => w.type === 'interaction' && w.id === status.interactionId);
    return {
      status: 'requiresAttention',
      reason,
      details: {
        interactionId: status.interactionId,
        kind: interactionWork?.interaction?.kind || status.reason,
      },
    };
  }

  // active / waiting / cancelling / unknown — non-terminal, not awaiting user input.
  return {
    status: 'busy',
    reason: 'turn_in_progress',
    details: { turnId: turnSnapshot.id },
  };
}

/**
 * Computes server-owned workSummary for a Turn.
 */
export function computeWorkSummary(turn) {
  if (!turn) {
    return {
      status: 'idle',
      activityCount: 0,
      currentActivity: null,
      activeToolCount: 0,
      attention: null,
      expandable: false,
    };
  }

  const workItems = Array.isArray(turn.work) ? turn.work : [];
  const activityCount = workItems.length;
  const currentActivity = computeCurrentActivity(turn);

  const openTools = workItems.filter((w) => w.type === 'tool' && (w.status === 'active' || w.status === 'queued'));
  const activeToolCount = openTools.length;

  let attention = null;
  const pendingInteraction = workItems.find((w) => w.type === 'interaction' && w.status === 'pending');
  if (pendingInteraction) {
    attention = {
      required: true,
      kind: pendingInteraction.interaction?.kind || 'permission',
      interactionId: pendingInteraction.id,
      title:
        pendingInteraction.interaction?.title ||
        (pendingInteraction.interaction?.kind === 'question'
          ? 'Question needs answer'
          : 'Permission approval required'),
    };
  }

  let status = 'idle';
  if (turn.status) {
    if (turn.status.status === 'requiresAttention') {
      status = 'waitingForUser';
    } else if (
      turn.status.status === 'active' ||
      turn.status.status === 'waiting' ||
      turn.status.status === 'cancelling'
    ) {
      status = 'running';
    } else if (turn.status.status === 'terminal') {
      status = turn.status.outcome === 'completed' ? 'completed' : 'failed';
    }
  }

  return {
    status,
    activityCount,
    currentActivity,
    activeToolCount,
    attention,
    expandable: activityCount > 0,
  };
}

export function formatNevoWorkflowContext({ changeSlug, taskId, step = 'implementation', attempt = 1 } = {}) {
  return [
    '[Nevo Workflow Context]',
    `Specification: ${changeSlug || 'active'}`,
    `Task: ${taskId}`,
    `Step: ${step} (attempt ${attempt})`,
    '',
    'You are executing a deterministic Nevo workflow task.',
    'Before modifying any files or running tests, you MUST start your step:',
    `  node tools/specs.mjs workflow step start ${changeSlug || 'active'} ${taskId}`,
    '',
    'The JSON/YAML output returned by that command contains your authoritative StepContext:',
    '- allowed_paths: paths you may create or modify',
    '- forbidden_paths: paths you must not touch',
    '- verification: automated test commands you must pass',
    '- previousTransition: feedback from earlier attempts (if any)',
    '',
    'Rules:',
    '1. Do not manually edit change.yaml or manifest files.',
    '2. Do not run manual git commit, git push, or git tag commands.',
    '3. When implementation and verification are complete, inspect StepContext.finishContract.parameters and run:',
    `   node tools/specs.mjs workflow step finish ${changeSlug || 'active'} ${taskId} --input '{"commit.title":"..."}'`,
    '4. After successful step finish, summarize your work and STOP.',
  ].join('\n');
}

export function resolveDeterministicWorkflowInfo(specId, taskId, baseDir) {
  if (!specId) return null;
  try {
    const changes = listChanges(baseDir);
    const change = changes.find((c) => c.id === specId || c._slug === specId);
    if (!change) return null;
    if (change.workflow?.mode !== 'deterministic') return null;

    const rawTaskId = taskId ? String(taskId) : undefined;
    const task = rawTaskId ? (change.tasks || []).find((t) => String(t.id) === rawTaskId) : null;
    const resolvedTaskId = rawTaskId || (change.tasks && change.tasks.length > 0 ? String(change.tasks[0].id) : undefined);

    return {
      changeSlug: change._slug,
      specId: change.id,
      taskId: resolvedTaskId,
      step: task?.step || 'implementation',
      attempt: typeof task?.attempt === 'number' ? task.attempt : 1,
    };
  } catch {
    return null;
  }
}

export class AgentSessionService {
  constructor({ registry, turnRuntime, transcriptCache, bindingService } = {}) {
    this.registry = registry;
    this.turnRuntime = turnRuntime;
    this.transcriptCache = transcriptCache ?? turnRuntime?.transcriptCache;
    this.bindingService = bindingService;
  }

  async listProviders({ includeModels = true } = {}) {
    const descriptors = this.registry.descriptors();
    if (!includeModels) return descriptors;
    return Promise.all(
      descriptors.map(async (desc) => {
        try {
          const entry = this.registry.has(desc.id) ? this.registry.get(desc.id) : null;
          if (entry && typeof entry.provider.listModels === 'function') {
            const models = await entry.provider.listModels();
            return {
              ...desc,
              models: validateModelCatalog(models, desc.id),
            };
          }
          return { ...desc, models: [] };
        } catch (error) {
          return {
            ...desc,
            models: [],
            modelsError: error?.message || 'Failed to list models',
          };
        }
      }),
    );
  }

  async createSession(provider, options = {}) {
    if (typeof provider === 'object' && provider !== null && provider.provider) {
      options = provider;
      provider = options.provider;
    }
    const entry = this.registry.get(provider);
    const descriptor = entry.descriptor;
    const taskIds = Array.isArray(options.taskIds)
      ? options.taskIds.filter(Boolean)
      : options.taskId
        ? [options.taskId]
        : [];
    const primaryTaskId = options.taskId || (taskIds.length > 0 ? taskIds[0] : undefined);
    const purpose = options.purpose || options.title || (primaryTaskId ? `task:${primaryTaskId}` : 'interactive');
    const mode = options.mode ? validateAgentExecutionMode(options.mode, 'mode') : descriptor.defaultMode || 'edit';

    // Synchronous canonical sessionId UUID allocated at session creation time
    const sessionId = options.sessionId || randomUUID();

    let providerSessionId;
    let established = false;
    if (typeof entry.provider.createSession === 'function') {
      const created = await entry.provider.createSession({
        sessionId,
        specId: options.specId,
        taskId: primaryTaskId,
        taskIds: taskIds.length > 0 ? taskIds : undefined,
        purpose,
        mode,
        model: options.model,
        title: options.title,
      });
      providerSessionId = typeof created === 'string' ? created : created?.providerSessionId;
      if (created && typeof created === 'object' && created.established === true) {
        established = true;
      }
      validateAgentIdentity({ provider, providerSessionId });
    } else {
      // No provider-side session allocation exists yet: this ID is a locally
      // fabricated placeholder, not a real provider conversation. It must not be
      // treated as resumable until the provider actually confirms it on first use.
      providerSessionId = sessionId;
      established = false;
    }

    let binding;
    if (this.bindingService) {
      if (taskIds.length > 0) {
        for (const tId of taskIds) {
          binding = await this.bindingService.bindSession({
            provider,
            providerSessionId,
            sessionId,
            specId: options.specId,
            taskId: tId,
            activeTaskId: primaryTaskId,
            taskIds,
            purpose: options.purpose || options.title || `task:${tId}`,
            mode,
            model: options.model,
            established,
          });
        }
      } else {
        binding = await this.bindingService.bindSession({
          provider,
          providerSessionId,
          sessionId,
          specId: options.specId,
          taskId: undefined,
          purpose,
          mode,
          model: options.model,
          established,
        });
      }
    } else {
      binding = {
        provider,
        providerSessionId,
        sessionId,
        specId: options.specId,
        taskId: primaryTaskId,
        activeTaskId: primaryTaskId,
        taskIds,
        purpose,
        mode,
        model: options.model,
        title: options.title || `${provider} session`,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
    }
    return {
      ...binding,
      sessionId,
      providerSessionId,
      taskIds,
      taskId: primaryTaskId,
      activeTaskId: primaryTaskId,
      model: options.model,
      ...(established === false ? { established: false } : {}),
    };
  }

  async attachSession(provider, { providerSessionId, specId, taskId, taskIds, purpose, mode, model } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const resolvedTaskIds = Array.isArray(taskIds) ? taskIds.filter(Boolean) : taskId ? [taskId] : [];

    let binding;
    if (this.bindingService) {
      if (resolvedTaskIds.length > 0) {
        for (const tId of resolvedTaskIds) {
          binding = await this.bindingService.bindSession({
            provider,
            providerSessionId,
            specId,
            taskId: tId,
            purpose,
            mode,
            model,
          });
        }
      } else {
        binding = await this.bindingService.bindSession({
          provider,
          providerSessionId,
          specId,
          taskId,
          purpose,
          mode,
          model,
        });
      }
    } else {
      binding = { provider, providerSessionId, specId, taskId, mode, model };
    }

    return { ...binding, taskIds: resolvedTaskIds, taskId: taskId || resolvedTaskIds[0] || undefined };
  }

  async listSessions(filters = {}) {
    if (!this.bindingService) return [];
    const query = {};
    if (filters.specId) query.specId = filters.specId;
    if (filters.provider) query.provider = filters.provider;
    if (filters.providerSessionId) query.providerSessionId = filters.providerSessionId;

    const rawBindings = await this.bindingService.listBindings(query);

    const groups = new Map();
    for (const row of rawBindings) {
      const key = `${row.provider}:::${row.providerSessionId}:::${row.specId}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(row);
    }

    const logicalSessions = [];
    for (const rows of groups.values()) {
      if (filters.taskId && !rows.some((r) => r.taskId === filters.taskId)) {
        continue;
      }
      const sortedRows = rows.slice().sort(compareBindingRecency);
      const representative = sortedRows[0];
      const taskIds = Array.from(new Set(rows.map((r) => r.taskId).filter(Boolean)));

      logicalSessions.push({
        ...representative,
        sessionId: representative.providerSessionId,
        taskId: representative.taskId || taskIds[0] || undefined,
        taskIds,
      });
    }

    if (!this.transcriptCache) {
      return logicalSessions.map((session) => ({
        ...session,
        status: 'idle',
        activeTurn: null,
        pendingInteraction: null,
      }));
    }

    return Promise.all(
      logicalSessions.map(async (session) => {
        try {
          const transcript = await this.transcriptCache.getTranscript(session.provider, session.providerSessionId);
          if (transcript?.health === 'corrupt') {
            return {
              ...session,
              status: 'unavailable',
              activeTurn: null,
              pendingInteraction: null,
            };
          }
          const { status, activeTurn, pendingInteraction } = this.resolveSessionActivity(transcript);
          const hasRecordedActivity = Boolean(
            transcript?.turns?.length ||
            transcript?.lastEventSeq ||
            transcript?.activeTurn,
          );
          return {
            ...session,
            lastActivityAt: (hasRecordedActivity && transcript?.updatedAt) || session.lastSeenAt,
            status,
            activeTurn,
            pendingInteraction,
          };
        } catch {
          return {
            ...session,
            status: 'unavailable',
            activeTurn: null,
            pendingInteraction: null,
          };
        }
      }),
    );
  }

  resolveSessionActivity(transcript) {
    let activeTurn = null;
    let pendingInteraction = transcript?.pendingInteraction || null;

    if (transcript?.activeTurn?.turnId) {
      try {
        const turnSnapshot = this.getTurn(transcript.activeTurn.turnId);
        if (turnSnapshot && turnSnapshot.status !== 'completed' && turnSnapshot.status !== 'failed') {
          activeTurn = {
            turnId: turnSnapshot.turnId,
            startedAt: turnSnapshot.startedAt,
            status: turnSnapshot.status,
          };
          pendingInteraction = turnSnapshot.pendingInteraction || pendingInteraction;
        }
      } catch {
        activeTurn = {
          turnId: transcript.activeTurn.turnId,
          startedAt: transcript.activeTurn.startedAt,
          status: transcript.pendingInteraction ? 'waitingForUser' : 'running',
        };
      }
    }

    const status = activeTurn ? (activeTurn.status === 'waitingForUser' ? 'waitingForUser' : 'running') : 'idle';

    return { status, activeTurn, pendingInteraction };
  }

  async getSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.bindingService) {
      if (typeof this.bindingService.resolveCurrentBinding === 'function') {
        return this.bindingService.resolveCurrentBinding(provider, providerSessionId);
      }
      if (typeof this.bindingService.getBinding === 'function') {
        return this.bindingService.getBinding(provider, providerSessionId);
      }
      if (typeof this.bindingService.listBindings === 'function') {
        const list = await this.bindingService.listBindings({ provider, providerSessionId });
        return list?.find((b) => b.provider === provider && b.providerSessionId === providerSessionId) || null;
      }
    }
    return null;
  }

  async updateSessionMode(provider, providerSessionId, mode) {
    validateAgentIdentity({ provider, providerSessionId });
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    if (this.bindingService) {
      return this.bindingService.updateSessionMode(provider, providerSessionId, validatedMode);
    }
    return { provider, providerSessionId, mode: validatedMode };
  }

  /**
   * Overrides the durable current/last selected model for an existing session (D2:
   * capability-driven — a provider that does not declare `canOverrideTurnModel` must
   * not silently emulate mid-session switching).
   */
  async updateSessionModel(provider, providerSessionId, model) {
    validateAgentIdentity({ provider, providerSessionId });
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    const entry = this.registry?.get?.(provider);
    if (!entry?.descriptor?.capabilities?.canOverrideTurnModel) {
      throw new CapabilityNotSupportedError(provider, 'canOverrideTurnModel');
    }
    if (this.bindingService) {
      return this.bindingService.updateSessionModel(provider, providerSessionId, model.trim());
    }
    return { provider, providerSessionId, model: model.trim() };
  }

  async getSessionDetails(provider, providerSessionId, options = {}) {
    validateAgentIdentity({ provider, providerSessionId });

    const descriptor = this.registry?.has(provider) ? this.registry.get(provider).descriptor : undefined;
    const capabilities = descriptor?.capabilities || {};

    const binding = await this.getSession(provider, providerSessionId);
    const taskIds = binding?.taskIds || (binding?.taskId ? [binding.taskId] : []);
    const specId = binding?.specId;

    const transcript = await this.getTranscript(provider, providerSessionId);
    const { status, activeTurn, pendingInteraction } = this.resolveSessionActivity(transcript);
    const resolvedMode = binding?.mode ?? descriptor?.defaultMode ?? 'edit';

    const turns = Array.isArray(transcript?.turns) ? transcript.turns : [];
    const activeCanonical = activeTurn?.turnId ? this.getCanonicalTurn(activeTurn.turnId) : null;
    const combinedTurns = turns.map((t) => (t.id === activeTurn?.turnId && activeCanonical ? activeCanonical : t));
    if (activeTurn?.turnId && activeCanonical && !combinedTurns.some((t) => t.id === activeTurn.turnId)) {
      combinedTurns.push(activeCanonical);
    }

    const activeOrLatestTurn = activeCanonical || (combinedTurns.length > 0 ? combinedTurns.at(-1) : null);

    const readiness = resolveSessionReadiness({
      descriptor,
      transcript,
      turnSnapshot: activeOrLatestTurn,
    });
    const workSummary = computeWorkSummary(activeOrLatestTurn);
    const publicTurns = combinedTurns.map(serializePublicTurn);

    const baseSession = {
      provider,
      providerSessionId,
      sessionId: providerSessionId,
      status: readiness.status === 'unavailable' ? 'unavailable' : status,
      capabilities,
      mode: resolvedMode,
      model: binding?.model ?? null,
      specId: specId ?? binding?.specId,
      taskId: binding?.taskId,
      taskIds,
      purpose: binding?.purpose,
      title: binding?.title || binding?.purpose || `${provider} session`,
      createdAt: binding?.createdAt || transcript?.createdAt || transcript?.updatedAt || new Date().toISOString(),
      lastSeenAt: binding?.lastSeenAt || transcript?.updatedAt || new Date().toISOString(),
      lastActivityAt: binding?.lastSeenAt || transcript?.updatedAt || new Date().toISOString(),
      activeTurn,
      pendingInteraction,
      lastEventSeq: transcript?.lastEventSeq || 0,
      updatedAt: transcript?.updatedAt || new Date().toISOString(),
    };

    return {
      ...baseSession,
      readiness,
      workSummary,
      turns: publicTurns,
    };
  }

  async deleteSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.bindingService) {
      await this.bindingService.unbindSession(provider, providerSessionId);
    }
    if (this.transcriptCache) {
      await this.transcriptCache.deleteTranscript(provider, providerSessionId);
    }
    return { unbind: true, deleted: true };
  }

  async listTurns(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      return (transcript.turns || []).map(serializePublicTurn);
    }
    return [];
  }

  async getTranscript(provider, providerSessionId) {
    if (this.transcriptCache) {
      return this.transcriptCache.getTranscript(provider, providerSessionId);
    }
    return { turns: [], lastEventSeq: 0 };
  }

  async startTurn(provider, providerSessionId, options = {}) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    let opts = options;
    let prov = provider;
    let sessId = providerSessionId;

    if (typeof provider === 'object' && provider !== null) {
      opts = provider;
      prov = opts.provider;
      sessId = opts.providerSessionId;
    }

    let createdSession = null;
    let sessionBinding = null;

    if (!sessId) {
      createdSession = await this.createSession(prov, {
        specId: opts.specId,
        taskId: opts.activeTaskId || opts.taskId,
        taskIds: opts.taskIds,
        purpose: opts.purpose,
        mode: opts.mode,
        model: opts.model,
        title: opts.title,
        sessionId: opts.sessionId,
      });
      sessId = createdSession.providerSessionId;
      sessionBinding = createdSession;
    } else {
      validateAgentIdentity({ provider: prov, providerSessionId: sessId });
      sessionBinding = this.bindingService ? await this.getSession(prov, sessId) : null;
    }

    // Mode resolution
    let effectiveMode = opts.mode;
    if (effectiveMode && sessId && this.bindingService) {
      await this.updateSessionMode(prov, sessId, effectiveMode);
    } else if (!effectiveMode && sessionBinding?.mode) {
      effectiveMode = sessionBinding.mode;
    }
    if (!effectiveMode) {
      const entry = this.registry?.get?.(prov);
      effectiveMode = entry?.descriptor?.defaultMode || 'edit';
    }

    // Model resolution: validated here, but NOT persisted yet. Persisting a
    // turn-level model override before turnRuntime.startTurn() has actually
    // admitted a genuinely new turn would let a rejected (409 conflict),
    // idempotent-replay, or otherwise failed start silently mutate the
    // durably-stored session model even though the running turn never used
    // it — see modelNeedsPersist below, applied only after admission.
    let effectiveModel = opts.model;
    let modelNeedsPersist = false;
    if (sessId && sessionBinding) {
      if (effectiveModel && sessionBinding.model && effectiveModel !== sessionBinding.model) {
        const entry = this.registry?.get?.(prov);
        const canOverride = Boolean(entry?.descriptor?.capabilities?.canOverrideTurnModel);
        if (!canOverride) {
          throw new CapabilityNotSupportedError(prov, 'canOverrideTurnModel');
        }
        modelNeedsPersist = true;
      } else if (effectiveModel && !sessionBinding.model) {
        modelNeedsPersist = true;
      } else if (!effectiveModel && sessionBinding.model) {
        effectiveModel = sessionBinding.model;
      }
    }

    // Permissive passthrough (D1): an unrecognized model must never block a turn on a
    // provider that allows arbitrary overrides, but it should still be advisory-visible.
    // Best-effort and fire-and-forget — a slow/failing catalog fetch must never delay or
    // fail turn admission over a warning.
    if (effectiveModel) {
      const entry = this.registry?.get?.(prov);
      if (entry?.provider && typeof entry.provider.listModels === 'function') {
        entry.provider
          .listModels()
          .then((catalog) => normalizeModelIdentifier(effectiveModel, catalog))
          .catch(() => {});
      }
    }

    const effectiveCanonicalSessionId =
      sessionBinding?.sessionId || createdSession?.sessionId || opts.sessionId || (UUID_RE.test(sessId) ? sessId : undefined);

    const effectiveSpecId = opts.specId || sessionBinding?.specId;
    const effectiveTaskId = opts.activeTaskId || sessionBinding?.activeTaskId || opts.taskId || sessionBinding?.taskId;

    let effectivePrompt = opts.message ?? opts.prompt;
    let effectiveUserMessage = opts.userMessage;

    // Workflow header resolution
    const workflowInfo = resolveDeterministicWorkflowInfo(effectiveSpecId, effectiveTaskId);
    const hasExplicitWorkflowContext = opts.workflowContext !== undefined && opts.workflowContext !== false;
    const shouldInjectAutomatic = opts.workflowContext !== false && Boolean(workflowInfo);

    let needsHeader = false;
    if (hasExplicitWorkflowContext) {
      needsHeader = true;
    } else if (shouldInjectAutomatic) {
      needsHeader =
        !sessionBinding?.lastBootstrapTaskId ||
        sessionBinding.lastBootstrapTaskId !== workflowInfo.taskId ||
        sessionBinding.lastBootstrapStep !== workflowInfo.step ||
        sessionBinding.lastBootstrapAttempt !== workflowInfo.attempt;
    }

    if (needsHeader) {
      const contextToFormat =
        typeof opts.workflowContext === 'object' && opts.workflowContext !== null
          ? opts.workflowContext
          : workflowInfo;
      const header =
        typeof opts.workflowContext === 'string'
          ? opts.workflowContext
          : formatNevoWorkflowContext(contextToFormat);

      if (!effectiveUserMessage) {
        effectiveUserMessage = effectivePrompt;
      }
      effectivePrompt = `${header}\n\n${effectiveUserMessage}`;

      if (this.bindingService && (workflowInfo || (typeof opts.workflowContext === 'object' && opts.workflowContext !== null))) {
        const targetTaskId = workflowInfo?.taskId || opts.workflowContext?.taskId || effectiveTaskId;
        const targetStep = workflowInfo?.step || opts.workflowContext?.step || 'implementation';
        const targetAttempt = workflowInfo?.attempt ?? opts.workflowContext?.attempt ?? 1;
        await this.bindingService.recordBootstrapState(prov, sessId, {
          taskId: targetTaskId,
          step: targetStep,
          attempt: targetAttempt,
          sessionId: effectiveCanonicalSessionId,
        });
      }
    }

    const isSessionEstablished = createdSession
      ? createdSession.established === true
      : sessionBinding?.established !== false;

    let onSessionEstablished = opts.onSessionEstablished;
    const userOnSessionEstablished = opts.onSessionEstablished;
    if (!isSessionEstablished && this.bindingService) {
      onSessionEstablished = async (allocatedSessionId) => {
        await this.bindingService.markSessionEstablished(
          prov,
          effectiveCanonicalSessionId || sessId,
          allocatedSessionId,
        );
        if (typeof userOnSessionEstablished === 'function') {
          await userOnSessionEstablished(allocatedSessionId);
        }
      };
    }

    const { sessionId: _ignoredSessionId, ...cleanOpts } = opts;
    const result = await this.turnRuntime.startTurn({
      ...cleanOpts,
      provider: prov,
      providerSessionId: sessId,
      canonicalSessionId: effectiveCanonicalSessionId,
      nevoSessionId: effectiveCanonicalSessionId,
      specId: effectiveSpecId,
      taskId: effectiveTaskId,
      activeTaskId: effectiveTaskId,
      isSessionEstablished,
      message: effectivePrompt,
      prompt: effectivePrompt,
      userMessage: effectiveUserMessage,
      mode: effectiveMode,
      model: effectiveModel,
      effort: opts.effort ?? opts.reasoningEffort,
      onSessionEstablished,
    });

    // Only a genuinely new admission persists the override — an idempotent
    // replay returns the existing (already-running) turn, which never used
    // this model, so the durable binding must not change to reflect it.
    // A rejected/conflicting/validation-failed start never reaches here at
    // all (the await above throws first), so it can't mutate the binding either.
    if (modelNeedsPersist && !result?.idempotent && this.bindingService) {
      await this.bindingService.updateSessionModel(prov, sessId, effectiveModel);
    }

    return result;
  }

  subscribeToSession(provider, providerSessionId, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    let prov = provider;
    let sessId = providerSessionId;
    let opts = options;
    if (typeof provider === 'object' && provider !== null) {
      prov = provider.provider;
      sessId = provider.providerSessionId;
      opts = providerSessionId;
    }
    const { onEvent, ...subscriptionOptions } = opts || {};
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    return this.turnRuntime.subscribeToSession(
      { provider: prov, providerSessionId: sessId },
      {
        ...subscriptionOptions,
        onEvent: (event) => {
          if (event.type === 'turn.updated' && event.turn) {
            const publicTurn = serializePublicTurn(event.turn);
            const descriptor = this.registry?.has(prov) ? this.registry.get(prov).descriptor : undefined;
            const readiness = resolveSessionReadiness({
              descriptor,
              turnSnapshot: publicTurn,
            });
            onEvent({
              ...event,
              turn: publicTurn,
              readiness,
            });
            return;
          }
          onEvent(event);
        },
      },
    );
  }

  getTurn(turnId) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.getSnapshot(turnId);
  }

  getCanonicalTurn(turnId) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.getCanonicalTurn?.(turnId) ?? null;
  }

  cancelTurn(turnId, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.cancelTurn(turnId, options);
  }

  recoverTurn(turnId, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.recoverTurn(turnId, options);
  }


  resolveInteraction(turnId, interactionId, response, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.resolveInteraction(turnId, interactionId, response, options);
  }

  setFinalAnswer(turnId, finalAnswerData) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.setFinalAnswer(turnId, finalAnswerData);
  }

  async shutdown() {
    await this.turnRuntime?.shutdown?.();
    await this.transcriptCache?.flushAll?.();
  }
}

export function createAgentSessionService(options) {
  return new AgentSessionService(options);
}
