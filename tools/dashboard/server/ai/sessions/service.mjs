import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
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
import { listChanges, ROOT } from '../../../../specs/store.mjs';
import { resolveWorkflowPosition } from '../../../../specs/workflow/step-runner.mjs';
import { loadWorkflowDefinition } from '../../../../specs/workflow/definitions/loader.mjs';

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
    const change = changes.find((c) => c.spec_id === specId || c.id === specId || c._slug === specId);
    if (!change) return null;
    if (change.workflow?.mode !== 'deterministic') return null;

    const rawTaskId = taskId ? String(taskId) : undefined;
    const task = rawTaskId ? (change.tasks || []).find((t) => String(t.id) === rawTaskId) : null;
    const resolvedTaskId = rawTaskId || (change.tasks && change.tasks.length > 0 ? String(change.tasks[0].id) : undefined);
    const resolvedTask = task || (change.tasks && change.tasks.length > 0 ? change.tasks[0] : null);

    let step = 'implementation';
    let attempt = 1;

    if (resolvedTask) {
      try {
        const repoRoot = baseDir ? resolve(baseDir, '..', '..') : ROOT;
        const defName = change.workflow?.definition || 'standard-v1';
        const definition = loadWorkflowDefinition(defName, { repoRoot });
        const position = resolveWorkflowPosition(definition, resolvedTask);
        if (position && position.step) {
          step = position.step;
          attempt = position.attempt ?? 1;
        } else if (position?.phase === 'new') {
          step = definition.entryStep || Object.keys(definition.steps || {})[0] || 'implementation';
          attempt = 1;
        }
      } catch {
        step = resolvedTask.step || 'implementation';
        attempt = typeof resolvedTask.attempt === 'number' ? resolvedTask.attempt : 1;
      }
    }

    return {
      changeSlug: change._slug,
      specId: change.spec_id || change.id,
      taskId: resolvedTaskId,
      step,
      attempt,
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

    // A caller-supplied providerSessionId (manual pre-allocation, or a legacy
    // provider-identity route creating a session that didn't exist yet) is used
    // as-is and never re-derived from the provider's own createSession().
    let providerSessionId = options.providerSessionId || undefined;
    if (!providerSessionId && typeof entry.provider.createSession === 'function') {
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
      if (providerSessionId) {
        validateAgentIdentity({ provider, providerSessionId });
      }
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
    if (filters.sessionId) query.sessionId = filters.sessionId;
    if (filters.taskId) query.taskId = filters.taskId;

    let logicalSessions = [];
    if (typeof this.bindingService.listSessions === 'function') {
      const rawSessions = await this.bindingService.listSessions(query);
      logicalSessions = rawSessions.map((s) => ({
        ...s,
        sessionId: s.sessionId,
        providerSessionId: s.providerSessionId || undefined,
        taskId: s.activeTaskId || (Array.isArray(s.taskIds) ? s.taskIds[0] : undefined),
        taskIds: s.taskIds || [],
      }));
    } else {
      const rawBindings = await this.bindingService.listBindings(query);
      const groups = new Map();
      for (const row of rawBindings) {
        const key = row.sessionId || `${row.provider}:::${row.providerSessionId}:::${row.specId}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(row);
      }

      for (const rows of groups.values()) {
        if (filters.taskId && !rows.some((r) => r.taskId === filters.taskId)) {
          continue;
        }
        const sortedRows = rows.slice().sort(compareBindingRecency);
        const representative = sortedRows[0];
        const taskIds = Array.from(new Set(rows.map((r) => r.taskId).filter(Boolean)));

        logicalSessions.push({
          ...representative,
          sessionId: representative.sessionId || representative.providerSessionId,
          providerSessionId: representative.providerSessionId,
          taskId: representative.activeTaskId || representative.taskId || taskIds[0] || undefined,
          taskIds: representative.taskIds || taskIds,
        });
      }
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
          const transcriptId = session.sessionId || session.providerSessionId;
          const transcript = await this.transcriptCache.getTranscript(session.provider, transcriptId);
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

  async getSession(providerOrSessionId, providerSessionId) {
    if (!providerSessionId && UUID_RE.test(providerOrSessionId)) {
      return await this.bindingService?.getSession(providerOrSessionId);
    }
    const provider = providerOrSessionId;
    if (provider && providerSessionId) {
      validateAgentIdentity({ provider, providerSessionId });
    }
    if (this.bindingService) {
      if (typeof this.bindingService.resolveCurrentBinding === 'function') {
        return await this.bindingService.resolveCurrentBinding(provider, providerSessionId);
      }
      if (typeof this.bindingService.getBinding === 'function') {
        return await this.bindingService.getBinding(provider, providerSessionId);
      }
      if (typeof this.bindingService.listBindings === 'function') {
        const list = await this.bindingService.listBindings({ provider, providerSessionId });
        return list?.find((b) => b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId)) || null;
      }
    }
    return null;
  }

  async updateSessionMode(providerOrSessionId, modeOrSessionId, maybeMode) {
    let provider;
    let sessId;
    let mode;
    if (maybeMode !== undefined) {
      provider = providerOrSessionId;
      sessId = modeOrSessionId;
      mode = maybeMode;
      validateAgentIdentity({ provider, providerSessionId: sessId });
    } else {
      sessId = providerOrSessionId;
      mode = modeOrSessionId;
      const session = await this.bindingService?.getSession(sessId);
      if (session) {
        provider = session.provider;
      }
    }
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    if (this.bindingService) {
      return await this.bindingService.updateSessionMode(provider, sessId, validatedMode);
    }
    return { provider, providerSessionId: sessId, mode: validatedMode };
  }

  /**
   * Overrides the durable current/last selected model for an existing session (D2:
   * capability-driven — a provider that does not declare `canOverrideTurnModel` must
   * not silently emulate mid-session switching).
   */
  async updateSessionModel(providerOrSessionId, modelOrSessionId, maybeModel) {
    let provider;
    let sessId;
    let model;
    if (maybeModel !== undefined) {
      provider = providerOrSessionId;
      sessId = modelOrSessionId;
      model = maybeModel;
      validateAgentIdentity({ provider, providerSessionId: sessId });
    } else {
      sessId = providerOrSessionId;
      model = modelOrSessionId;
      const session = await this.bindingService?.getSession(sessId);
      if (session) {
        provider = session.provider;
      }
    }
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    if (provider) {
      const entry = this.registry?.get?.(provider);
      if (!entry?.descriptor?.capabilities?.canOverrideTurnModel) {
        throw new CapabilityNotSupportedError(provider, 'canOverrideTurnModel');
      }
    }
    if (this.bindingService) {
      return await this.bindingService.updateSessionModel(provider, sessId, model.trim());
    }
    return { provider, providerSessionId: sessId, model: model.trim() };
  }

  async getSessionDetails(providerOrSessionId, providerSessionId, options = {}) {
    let provider;
    let sessId;
    let sessionId;

    if (UUID_RE.test(providerOrSessionId) && (!providerSessionId || typeof providerSessionId === 'object')) {
      sessionId = providerOrSessionId;
      options = providerSessionId || {};
      const session = await this.bindingService?.getSession(sessionId);
      if (session) {
        provider = session.provider;
        sessId = session.providerSessionId;
      }
    } else {
      provider = providerOrSessionId;
      sessId = providerSessionId;
    }

    let binding = null;
    if (sessionId) {
      binding = await this.bindingService?.getSession(sessionId);
    } else if (provider && sessId) {
      binding = await this.getSession(provider, sessId);
      if (binding) {
        sessionId = binding.sessionId;
        provider = binding.provider;
        sessId = binding.providerSessionId || sessId;
      }
    }

    if (!binding && sessionId) {
      binding = await this.bindingService?.getSession(sessionId);
      if (binding) {
        provider = binding.provider;
        sessId = binding.providerSessionId;
      }
    }

    const descriptor = provider && this.registry?.has(provider) ? this.registry.get(provider).descriptor : undefined;
    const capabilities = descriptor?.capabilities || {};

    const taskIds = binding?.taskIds || (binding?.taskId ? [binding.taskId] : []);
    const specId = binding?.specId;

    // Transcript files are keyed by the native providerSessionId (see
    // SessionTranscriptCacheService#getFilePath), never by the canonical
    // sessionId — prefer sessId here. Once a session is established, sessId
    // (binding.providerSessionId) and sessionId (binding.sessionId) diverge;
    // falling back to sessionId first silently looks up a transcript file
    // that was never written under that key, returning an empty transcript
    // for a session that actually has history.
    const transcriptId = sessId || sessionId;
    const transcript = provider ? await this.getTranscript(provider, transcriptId) : { turns: [], lastEventSeq: 0 };
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
      provider: provider || binding?.provider,
      providerSessionId: sessId || binding?.providerSessionId,
      sessionId: sessionId || binding?.sessionId || sessId,
      status: readiness.status === 'unavailable' ? 'unavailable' : status,
      capabilities,
      mode: resolvedMode,
      model: binding?.model ?? null,
      specId: specId ?? binding?.specId,
      taskId: binding?.activeTaskId || binding?.taskId,
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

  async deleteSession(providerOrSessionId, providerSessionId) {
    let provider = providerOrSessionId;
    let sessId = providerSessionId;
    let sessionId;

    if (!providerSessionId && UUID_RE.test(providerOrSessionId)) {
      sessionId = providerOrSessionId;
      const session = await this.bindingService?.getSession(sessionId);
      if (session) {
        provider = session.provider;
        sessId = session.providerSessionId;
      }
    } else if (provider && providerSessionId) {
      validateAgentIdentity({ provider, providerSessionId });
      sessId = providerSessionId;
    }

    if (this.bindingService) {
      await this.bindingService.unbindSession(provider, sessionId || sessId);
    }
    if (this.transcriptCache && provider) {
      await this.transcriptCache.deleteTranscript(provider, sessionId || sessId);
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
      sessId = opts.sessionId || opts.providerSessionId;
    }

    let session = null;
    let canonicalSessionId = opts.sessionId || (sessId && UUID_RE.test(sessId) ? sessId : undefined);
    let effectiveProviderSessionId = sessId && sessId !== canonicalSessionId ? sessId : undefined;

    if (this.bindingService) {
      if (canonicalSessionId) {
        session = await this.bindingService.getSession(canonicalSessionId);
      }
      if (!session && sessId && prov) {
        session = await this.bindingService.findSessionByProviderIdentity(prov, sessId);
        if (session) {
          canonicalSessionId = session.sessionId;
          effectiveProviderSessionId = session.providerSessionId || sessId;
        }
      }
    }

    // Atomic first turn: if session was not found and no specific providerSessionId was given,
    // create the canonical session FIRST.
    if (!session && !sessId) {
      session = await this.createSession(prov, {
        specId: opts.specId,
        taskId: opts.activeTaskId || opts.taskId,
        taskIds: opts.taskIds,
        purpose: opts.purpose,
        mode: opts.mode,
        model: opts.model,
        title: opts.title,
        sessionId: canonicalSessionId,
      });
      canonicalSessionId = session.sessionId;
      effectiveProviderSessionId = session.providerSessionId;
    } else if (!session && canonicalSessionId && !sessId) {
      session = await this.createSession(prov, {
        specId: opts.specId,
        taskId: opts.activeTaskId || opts.taskId,
        taskIds: opts.taskIds,
        purpose: opts.purpose,
        mode: opts.mode,
        model: opts.model,
        title: opts.title,
        sessionId: canonicalSessionId,
      });
      canonicalSessionId = session.sessionId;
      effectiveProviderSessionId = session.providerSessionId;
    } else if (!session) {
      if (UUID_RE.test(sessId)) {
        canonicalSessionId = sessId;
        session = await this.createSession(prov, {
          specId: opts.specId,
          taskId: opts.activeTaskId || opts.taskId,
          taskIds: opts.taskIds,
          purpose: opts.purpose,
          mode: opts.mode,
          model: opts.model,
          title: opts.title,
          sessionId: canonicalSessionId,
        });
        effectiveProviderSessionId = session.providerSessionId;
      } else {
        session = await this.createSession(prov, {
          specId: opts.specId,
          taskId: opts.activeTaskId || opts.taskId,
          taskIds: opts.taskIds,
          purpose: opts.purpose,
          mode: opts.mode,
          model: opts.model,
          title: opts.title,
          providerSessionId: sessId,
        });
        canonicalSessionId = session.sessionId;
        effectiveProviderSessionId = session.providerSessionId;
      }
    } else {
      canonicalSessionId = session.sessionId;
      effectiveProviderSessionId = session.providerSessionId || effectiveProviderSessionId;
    }

    // Mode resolution
    let effectiveMode = opts.mode;
    if (effectiveMode && canonicalSessionId && this.bindingService) {
      await this.updateSessionMode(prov, canonicalSessionId, effectiveMode);
    } else if (!effectiveMode && session?.mode) {
      effectiveMode = session.mode;
    }
    if (!effectiveMode) {
      const entry = this.registry?.get?.(prov);
      effectiveMode = entry?.descriptor?.defaultMode || 'edit';
    }

    // Model resolution
    let effectiveModel = opts.model;
    let modelNeedsPersist = false;
    if (session) {
      if (effectiveModel && session.model && effectiveModel !== session.model) {
        const entry = this.registry?.get?.(prov);
        const canOverride = Boolean(entry?.descriptor?.capabilities?.canOverrideTurnModel);
        if (!canOverride) {
          throw new CapabilityNotSupportedError(prov, 'canOverrideTurnModel');
        }
        modelNeedsPersist = true;
      } else if (effectiveModel && !session.model) {
        modelNeedsPersist = true;
      } else if (!effectiveModel && session.model) {
        effectiveModel = session.model;
      }
    }

    if (effectiveModel) {
      const entry = this.registry?.get?.(prov);
      if (entry?.provider && typeof entry.provider.listModels === 'function') {
        entry.provider
          .listModels()
          .then((catalog) => normalizeModelIdentifier(effectiveModel, catalog))
          .catch(() => {});
      }
    }

    const effectiveSpecId = opts.specId || session?.specId;
    const effectiveTaskId = opts.activeTaskId || session?.activeTaskId || opts.taskId || session?.taskId;

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
        !session?.lastBootstrapTaskId ||
        session.lastBootstrapTaskId !== workflowInfo.taskId ||
        session.lastBootstrapStep !== workflowInfo.step ||
        session.lastBootstrapAttempt !== workflowInfo.attempt;
    }

    let bootstrapToRecord = null;
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

      if (workflowInfo || (typeof opts.workflowContext === 'object' && opts.workflowContext !== null)) {
        bootstrapToRecord = {
          taskId: workflowInfo?.taskId || opts.workflowContext?.taskId || effectiveTaskId,
          step: workflowInfo?.step || opts.workflowContext?.step || 'implementation',
          attempt: workflowInfo?.attempt ?? opts.workflowContext?.attempt ?? 1,
        };
      }
    }

    const handleProviderSessionId = async (allocatedSessionId) => {
      if (this.bindingService && canonicalSessionId && allocatedSessionId) {
        await this.bindingService.setProviderSessionId(canonicalSessionId, allocatedSessionId);
      }
      if (typeof opts.onProviderSessionIdAvailable === 'function') {
        await opts.onProviderSessionIdAvailable(allocatedSessionId);
      }
    };

    const { sessionId: _ignoredSessionId, ...cleanOpts } = opts;
    const result = await this.turnRuntime.startTurn({
      ...cleanOpts,
      provider: prov,
      sessionId: canonicalSessionId,
      providerSessionId: effectiveProviderSessionId,
      specId: effectiveSpecId,
      taskId: effectiveTaskId,
      activeTaskId: effectiveTaskId,
      message: effectivePrompt,
      prompt: effectivePrompt,
      userMessage: effectiveUserMessage,
      mode: effectiveMode,
      model: effectiveModel,
      effort: opts.effort ?? opts.reasoningEffort,
      onProviderSessionIdAvailable: handleProviderSessionId,
    });

    // Move recordBootstrapState post-admission (Finding 15)
    if (bootstrapToRecord && this.bindingService) {
      await this.bindingService.recordBootstrapState(prov, canonicalSessionId, {
        ...bootstrapToRecord,
        sessionId: canonicalSessionId,
      });
    }

    if (modelNeedsPersist && !result?.idempotent && this.bindingService && canonicalSessionId) {
      await this.bindingService.updateSessionModel(prov, canonicalSessionId, effectiveModel);
    }

    return {
      ...result,
      sessionId: canonicalSessionId,
    };
  }

  subscribeToSession(providerOrSessionId, providerSessionIdOrOptions, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    let prov;
    let sessId;
    let opts;
    let canonicalSessionId;

    if (typeof providerOrSessionId === 'object' && providerOrSessionId !== null) {
      prov = providerOrSessionId.provider;
      sessId = providerOrSessionId.providerSessionId;
      canonicalSessionId = providerOrSessionId.sessionId;
      opts = providerSessionIdOrOptions;
    } else if (UUID_RE.test(providerOrSessionId) && (typeof providerSessionIdOrOptions === 'object' || providerSessionIdOrOptions === undefined)) {
      canonicalSessionId = providerOrSessionId;
      opts = providerSessionIdOrOptions;
    } else {
      prov = providerOrSessionId;
      sessId = providerSessionIdOrOptions;
      opts = options;
    }

    const { onEvent, ...subscriptionOptions } = opts || {};
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');

    // A legacy provider/providerSessionId identity must resolve to the canonical
    // sessionId the turn was actually registered under — the runtime keys everything
    // by sessionId, never by the raw provider-native id.
    if (!canonicalSessionId && prov && sessId && typeof this.bindingService?.findSessionByProviderIdentitySync === 'function') {
      const resolved = this.bindingService.findSessionByProviderIdentitySync(prov, sessId);
      if (resolved) canonicalSessionId = resolved.sessionId;
    }

    const targetIdentity = canonicalSessionId || { provider: prov, providerSessionId: sessId };

    return this.turnRuntime.subscribeToSession(
      targetIdentity,
      {
        ...subscriptionOptions,
        onEvent: (event) => {
          if (event.type === 'turn.updated' && event.turn) {
            const publicTurn = serializePublicTurn(event.turn);
            const descriptor = prov && this.registry?.has(prov) ? this.registry.get(prov).descriptor : undefined;
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
