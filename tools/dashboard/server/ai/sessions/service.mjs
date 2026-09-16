import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  AiValidationError,
  CapabilityNotSupportedError,
  AiDeterministicWorkflowUnavailableError,
  AiSpecContextUnavailableError,
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
import { resolveWorkflowMode } from '../../../../specs/workflow/compatibility.mjs';
// Side-effect import: registers CommitAndPushAction into defaultActionRegistry (see
// tools/specs/workflow/cli.mjs and actions/index.mjs). loadWorkflowDefinition() validates
// every step's `finalize` action IDs against that registry — without this import, any
// caller that constructs an AgentSessionService without also loading
// tools/dashboard/server/specs/actions.mjs first (e.g. createDefaultAgentSessionService()
// used standalone) would see loadWorkflowDefinition() reject the real standard-v1
// definition's 'commit-and-push' finalize action as "unknown", failing deterministic
// workflow resolution for every real spec. Explicit here rather than relying on
// import-order luck elsewhere in the process.
import '../../../../specs/workflow/actions/index.mjs';

// NOTE: there is deliberately no UUID-shape regex in this file. A canonical sessionId is
// an explicit, positionally/contextually-known identity — never inferred from "this
// string happens to look like a UUID." A provider-native providerSessionId is allowed to
// be UUID-shaped too (e.g. Codex thread ids), so shape alone can never discriminate
// between the two. Every method below dispatches canonical vs. compatibility identity by
// argument arity/type (how many arguments, string vs. object) or by resolving against the
// real store (bindingService.getSession / findSessionByProviderIdentity), never by regex.

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

// Discriminated resolution result, never a plain guessable object:
//   { mode: 'legacy' }                                 — no automatic workflow context;
//                                                          this is the global default and
//                                                          covers "no specId" and "spec
//                                                          found but not explicitly
//                                                          deterministic" alike.
//   { mode: 'deterministic', workflowInfo: {...} }      — authoritative position resolved.
// A spec that explicitly opts into `workflow.mode: deterministic` (via
// resolveWorkflowMode — the same authoritative mode resolver `tools/specs.mjs workflow`
// itself uses) but whose true position cannot be resolved THROWS
// AiDeterministicWorkflowUnavailableError instead of returning anything — silently
// continuing a deterministic turn without its authoritative context, or guessing
// step: 'implementation'/attempt: 1, would both be worse than an explicit, actionable
// failure. `repoRoot` must be the same authoritative root the rest of the session's
// provider/local-data paths were built from (see AgentSessionService#repoRoot) — this
// function never independently falls back to the process's own cwd or a different root.
//
// An explicit specId that fails to resolve to any real spec under that repoRoot is NOT
// treated as legacy either — "no specId at all" (a genuinely spec-less interaction) and
// "an explicit specId nobody can find" are different failure classes. The latter throws
// AiSpecContextUnavailableError, since it may signal a wrong repoRoot, a stale session
// binding, a deleted/moved spec, corrupted local session state, or a caller correlation
// bug — never silently masked by continuing without workflow context. This is distinct
// from AiDeterministicWorkflowUnavailableError: the spec's workflow mode is unknown until
// the spec itself is found, so this failure precedes any mode check.
export function resolveDeterministicWorkflowInfo(specId, taskId, repoRoot = ROOT) {
  if (!specId) return { mode: 'legacy' };

  let changes;
  try {
    changes = listChanges(resolve(repoRoot, 'specs', 'active'));
  } catch (err) {
    const message = `Failed to look up spec '${specId}' under repoRoot '${repoRoot}': ${err?.message || err}`;
    console.error(`[ai] [workflow] ${message}`);
    throw new AiSpecContextUnavailableError(message, { specId, repoRoot });
  }

  const change = changes.find((c) => c.spec_id === specId || c.id === specId || c._slug === specId);
  if (!change) {
    const message = `Spec '${specId}' was not found under repoRoot '${repoRoot}'.`;
    console.error(`[ai] [workflow] ${message}`);
    throw new AiSpecContextUnavailableError(message, { specId, repoRoot });
  }

  const resolvedMode = resolveWorkflowMode(change);
  if (resolvedMode.mode !== 'deterministic') return { mode: 'legacy' };

  // From here on the spec is explicitly, authoritatively deterministic — every remaining
  // failure path throws rather than falling back to "no workflow context".
  const rawTaskId = taskId ? String(taskId) : undefined;
  const task = rawTaskId ? (change.tasks || []).find((t) => String(t.id) === rawTaskId) : null;
  const resolvedTaskId = rawTaskId || (change.tasks && change.tasks.length > 0 ? String(change.tasks[0].id) : undefined);
  const resolvedTask = task || (change.tasks && change.tasks.length > 0 ? change.tasks[0] : null);

  if (!resolvedTask) {
    const message = `Deterministic spec '${specId}' has no resolvable task for '${taskId ?? '(none given)'}'.`;
    console.error(`[ai] [workflow] ${message}`);
    throw new AiDeterministicWorkflowUnavailableError(message, { specId, taskId });
  }

  let step;
  let attempt;
  try {
    const definition = loadWorkflowDefinition(resolvedMode.definition, { repoRoot });
    const position = resolveWorkflowPosition(definition, resolvedTask);
    if (position && position.step) {
      step = position.step;
      attempt = position.attempt ?? 1;
    } else if (position?.phase === 'new') {
      step = definition.entryStep || Object.keys(definition.steps || {})[0] || undefined;
      attempt = 1;
    }
  } catch (err) {
    const message = `Failed to resolve deterministic workflow position for spec '${specId}' task '${resolvedTaskId}': ${err?.message || err}`;
    console.error(`[ai] [workflow] ${message}`);
    throw new AiDeterministicWorkflowUnavailableError(message, {
      specId,
      taskId: resolvedTaskId,
      cause: err?.message,
    });
  }

  if (!step) {
    const message = `Deterministic workflow position for spec '${specId}' task '${resolvedTaskId}' could not be determined.`;
    console.error(`[ai] [workflow] ${message}`);
    throw new AiDeterministicWorkflowUnavailableError(message, { specId, taskId: resolvedTaskId });
  }

  return {
    mode: 'deterministic',
    workflowInfo: {
      changeSlug: change._slug,
      specId: change.spec_id || change.id,
      taskId: resolvedTaskId,
      step,
      attempt,
    },
  };
}

export class AgentSessionService {
  // The one authoritative repository root this service's deterministic workflow
  // resolution reads from — the same root createDefaultAgentSessionService() threads into
  // every provider's cwd and local-data (transcript/binding) paths. Defaults to the
  // process-global ROOT only for callers (tests, ad hoc scripts) that never had a custom
  // root to begin with; production construction always passes it explicitly.
  constructor({ registry, turnRuntime, transcriptCache, bindingService, repoRoot = ROOT } = {}) {
    this.registry = registry;
    this.turnRuntime = turnRuntime;
    this.transcriptCache = transcriptCache ?? turnRuntime?.transcriptCache;
    this.bindingService = bindingService;
    this.repoRoot = repoRoot;
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

    // The canonical AgentSession is now durably persisted (or, with no bindingService,
    // constructed) BEFORE any provider-native side effect runs — a provider.createSession()
    // call that throws, hangs, or only partially succeeds must never leave Nevo's own
    // canonical identity unrecorded. If the provider never confirms an id, the session is
    // intentionally left unestablished (providerSessionId absent), never fabricated. The
    // provider error itself is allowed to propagate — the session persisted above is not
    // rolled back, since the provider side effect may already have partially happened.
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
        if (this.bindingService) {
          await this.bindingService.setProviderSessionId(sessionId, providerSessionId);
        }
        binding = { ...binding, providerSessionId };
      }
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
    if (!providerSessionId) {
      // Single positional argument: the only real caller of this arity treats it as the
      // canonical sessionId — resolved against the real store, never inferred from string
      // shape (a provider-native id may itself be UUID-shaped). Without a second argument
      // there is no provider identity to compat-resolve against either way.
      return (await this.bindingService?.getSession(providerOrSessionId)) ?? null;
    }
    const provider = providerOrSessionId;
    validateAgentIdentity({ provider, providerSessionId });
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

  /**
   * Explicit compat-identity lookup: given a provider and its provider-native id, returns
   * the canonical AgentSession it belongs to (or null). This is the one sanctioned way to
   * resolve a legacy (provider, providerSessionId) pair to the canonical sessionId — never
   * UUID-shape sniffing, since a provider-native id can itself be UUID-shaped.
   */
  async findSessionByProviderIdentity(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (!this.bindingService) return null;
    return await this.bindingService.findSessionByProviderIdentity(provider, providerSessionId);
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

  /**
   * Authoritative activeTaskId switch for a multi-task session (D9 §7, D2, C10). The UI
   * never mutates its own local activeTaskId as the application contract — it sends this
   * intent, and only a successful persisted result (returned here via getSessionDetails)
   * is allowed to move the rendered active task. Validates that `taskId` is a real task of
   * the session's own specification before persisting, so an invalid or foreign task id can
   * never become the session's execution context.
   */
  async setActiveTaskId(sessionId, taskId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new AiValidationError("'sessionId' is required.", { field: 'sessionId' });
    }
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    if (!this.bindingService) throw new Error('No binding service configured.');

    const session = await this.bindingService.getSession(sessionId);
    if (!session) {
      throw new AiValidationError(`Session '${sessionId}' not found.`, { field: 'sessionId' });
    }

    const cleanTaskId = taskId.trim();
    if (session.specId) {
      let changes;
      try {
        changes = listChanges(resolve(this.repoRoot, 'specs', 'active'));
      } catch (err) {
        const message = `Failed to look up spec '${session.specId}' under repoRoot '${this.repoRoot}': ${err?.message || err}`;
        throw new AiSpecContextUnavailableError(message, { specId: session.specId, repoRoot: this.repoRoot });
      }
      const change = changes.find(
        (c) => c.spec_id === session.specId || c.id === session.specId || c._slug === session.specId,
      );
      if (!change) {
        const message = `Spec '${session.specId}' was not found under repoRoot '${this.repoRoot}'.`;
        throw new AiSpecContextUnavailableError(message, { specId: session.specId, repoRoot: this.repoRoot });
      }
      const taskExists = (change.tasks || []).some((t) => String(t.id) === cleanTaskId);
      if (!taskExists) {
        throw new AiValidationError(`Task '${cleanTaskId}' does not exist in specification '${session.specId}'.`, {
          field: 'taskId',
        });
      }
    }

    // setActiveTaskId is a SWITCH between tasks already bound to this session's context —
    // never an implicit bind of a new task. Binding a new task to a session happens only
    // through the session's own execution flow (createSession/attachSession with
    // taskId(s), or workflow step start/finish's ambient auto-binding); silently widening
    // `taskIds` here would let a "switch" API create a SessionTaskBinding as a side effect,
    // which is a different, separately-authorized operation.
    const boundTaskIds = Array.isArray(session.taskIds) ? session.taskIds : [];
    const isAlreadyBound = boundTaskIds.includes(cleanTaskId) || session.activeTaskId === cleanTaskId;
    if (!isAlreadyBound) {
      throw new AiValidationError(
        `Task '${cleanTaskId}' is not bound to session '${sessionId}' — switching active task requires the task to already be part of this session's context.`,
        { field: 'taskId' },
      );
    }

    await this.bindingService.setActiveTaskId(session.provider, sessionId, cleanTaskId, session.specId);
    return await this.getSessionDetails(sessionId);
  }

  async getSessionDetails(providerOrSessionId, providerSessionId, options = {}) {
    let provider;
    let sessId;
    let sessionId;

    // Dispatch is purely by argument shape/arity, never by string content: the canonical
    // form's second argument is always an options object (or omitted); the compatibility
    // form's second argument is always a providerSessionId string. A canonical sessionId
    // and a provider-native id are never distinguished by "looks like a UUID" — a
    // provider-native id may be UUID-shaped too.
    if (providerSessionId === undefined || (providerSessionId !== null && typeof providerSessionId === 'object')) {
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

    // The canonical transcript belongs to sessionId exactly once (see runtime.mjs's
    // setProviderSessionId / TurnEventStream.emit) — prefer the canonical sessionId here.
    // sessId (providerSessionId) is only a fallback for the rare case where no canonical
    // sessionId could be resolved at all (compatibility lookups that never found a bound
    // AgentSession), matching the same fallback runtime.mjs uses when writing.
    const transcriptId = sessionId || sessId;
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
      // No fallback to sessId/providerSessionId here — when no canonical AgentSession is
      // bound at all, there genuinely is no sessionId to report, and reporting the
      // provider-native id under the sessionId field would fabricate a canonical identity
      // that was never established.
      sessionId: sessionId || binding?.sessionId,
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
    let provider;
    let sessId;
    let sessionId;

    if (!providerSessionId) {
      // Single positional argument: the only real caller of this arity is the canonical
      // DELETE route — treated as the canonical sessionId, resolved against the real
      // store, never inferred from string shape.
      sessionId = providerOrSessionId;
      const session = await this.bindingService?.getSession(sessionId);
      if (session) {
        provider = session.provider;
        sessId = session.providerSessionId;
      }
    } else {
      provider = providerOrSessionId;
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
    // The canonical transcript belongs to sessionId exactly once — resolve a legacy
    // (provider, providerSessionId) compat identity to its canonical sessionId first,
    // same as getSessionDetails, rather than querying the transcript cache under the
    // raw provider-native id directly.
    let transcriptId = providerSessionId;
    if (this.bindingService) {
      const binding = await this.getSession(provider, providerSessionId);
      if (binding?.sessionId) transcriptId = binding.sessionId;
    }
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, transcriptId);
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
    // canonicalSessionId is only ever populated from an EXPLICIT sessionId (opts.sessionId,
    // or the legacy positional identity once a real store lookup — never string shape —
    // proves it already names an existing canonical session). It is never inferred from
    // "this string looks like a UUID": a provider-native id is allowed to be UUID-shaped
    // too, so shape alone can never discriminate between the two identities.
    let canonicalSessionId = opts.sessionId;
    let effectiveProviderSessionId = opts.providerSessionId;

    if (canonicalSessionId && this.bindingService) {
      session = await this.bindingService.getSession(canonicalSessionId);
    } else if (!canonicalSessionId && sessId && this.bindingService) {
      // Legacy single positional identity (from a compatibility HTTP route that only
      // knows one opaque string): resolve it against the real store — first as a
      // canonical sessionId, then as a provider-native identity — never by shape.
      session = await this.bindingService.getSession(sessId);
      if (session) {
        canonicalSessionId = sessId;
      } else if (prov) {
        session = await this.bindingService.findSessionByProviderIdentity(prov, sessId);
        if (session) {
          canonicalSessionId = session.sessionId;
          effectiveProviderSessionId = session.providerSessionId || sessId;
        }
      }
    }

    if (!session) {
      // No existing session was found under any known identity — create one.
      const createOptions = {
        specId: opts.specId,
        taskId: opts.activeTaskId || opts.taskId,
        taskIds: opts.taskIds,
        purpose: opts.purpose,
        mode: opts.mode,
        model: opts.model,
        title: opts.title,
      };
      if (canonicalSessionId) {
        // An explicit sessionId was given (opts.sessionId) but no session exists under it
        // yet — create it with exactly that canonical id.
        session = await this.createSession(prov, { ...createOptions, sessionId: canonicalSessionId });
      } else if (sessId) {
        // The legacy positional identity never resolved to an existing session at all —
        // it is a provider-native identity to register on the newly created session,
        // never treated as a canonical sessionId merely because of its shape.
        session = await this.createSession(prov, { ...createOptions, providerSessionId: sessId });
      } else {
        // Atomic first turn: nothing was given at all — the server allocates everything.
        session = await this.createSession(prov, createOptions);
      }
      canonicalSessionId = session.sessionId;
      effectiveProviderSessionId = session.providerSessionId;
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

    // Workflow header resolution. `workflowContext: false` is an explicit caller override
    // that suppresses the automatic deterministic machinery entirely (including its
    // fail-closed checks) — an intentional, pre-existing escape hatch. Every other case
    // still resolves: a deterministic-but-broken spec, or an explicit specId that can't be
    // found at all under this.repoRoot, must reject the turn rather than silently continue
    // without context (resolveDeterministicWorkflowInfo throws
    // AiDeterministicWorkflowUnavailableError / AiSpecContextUnavailableError for those
    // cases respectively, which propagate from here).
    const workflowResolution =
      opts.workflowContext === false
        ? { mode: 'legacy' }
        : resolveDeterministicWorkflowInfo(effectiveSpecId, effectiveTaskId, this.repoRoot);
    const deterministicWorkflowInfo = workflowResolution.mode === 'deterministic' ? workflowResolution.workflowInfo : null;
    const hasExplicitWorkflowContext = opts.workflowContext !== undefined && opts.workflowContext !== false;
    const shouldInjectAutomatic = opts.workflowContext !== false && Boolean(deterministicWorkflowInfo);

    let needsHeader = false;
    if (hasExplicitWorkflowContext) {
      needsHeader = true;
    } else if (shouldInjectAutomatic) {
      needsHeader =
        !session?.lastBootstrapTaskId ||
        session.lastBootstrapTaskId !== deterministicWorkflowInfo.taskId ||
        session.lastBootstrapStep !== deterministicWorkflowInfo.step ||
        session.lastBootstrapAttempt !== deterministicWorkflowInfo.attempt;
    }

    let bootstrapToRecord = null;
    if (needsHeader) {
      const contextToFormat =
        typeof opts.workflowContext === 'object' && opts.workflowContext !== null
          ? opts.workflowContext
          : deterministicWorkflowInfo;
      const header =
        typeof opts.workflowContext === 'string'
          ? opts.workflowContext
          : formatNevoWorkflowContext(contextToFormat);

      if (!effectiveUserMessage) {
        effectiveUserMessage = effectivePrompt;
      }
      effectivePrompt = `${header}\n\n${effectiveUserMessage}`;

      if (deterministicWorkflowInfo || (typeof opts.workflowContext === 'object' && opts.workflowContext !== null)) {
        bootstrapToRecord = {
          taskId: deterministicWorkflowInfo?.taskId || opts.workflowContext?.taskId || effectiveTaskId,
          step: deterministicWorkflowInfo?.step || opts.workflowContext?.step || 'implementation',
          attempt: deterministicWorkflowInfo?.attempt ?? opts.workflowContext?.attempt ?? 1,
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

    // Dispatch is purely by argument shape/arity, never by string content: the canonical
    // form's second argument is always an options object (or omitted); the compatibility
    // form's second argument is always a providerSessionId string. Never distinguished by
    // "looks like a UUID" — a provider-native id may be UUID-shaped too.
    if (typeof providerOrSessionId === 'object' && providerOrSessionId !== null) {
      prov = providerOrSessionId.provider;
      sessId = providerOrSessionId.providerSessionId;
      canonicalSessionId = providerOrSessionId.sessionId;
      opts = providerSessionIdOrOptions;
    } else if (providerSessionIdOrOptions === undefined || (providerSessionIdOrOptions !== null && typeof providerSessionIdOrOptions === 'object')) {
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

  // A legacy (provider, providerSessionId) compat identity must resolve to the canonical
  // sessionId before reaching the turn runtime: turns and their persisted transcripts are
  // keyed by sessionId exactly once (see runtime.mjs / TurnEventStream.emit), so restoring
  // a turn after a restart by the raw provider-native id alone would silently miss it. When
  // no bindingService/mapping exists at all (legacy provider-only test doubles), the raw
  // providerSessionId is passed through unchanged — the fallback identity runtime.mjs itself
  // uses when no canonical sessionId was ever established.
  async #resolveCompatOptions(options = {}) {
    const { provider, providerSessionId } = options;
    if (!provider || !providerSessionId || !this.bindingService) return options;
    const resolved = await this.bindingService.findSessionByProviderIdentity(provider, providerSessionId);
    if (!resolved?.sessionId) return options;
    return { ...options, providerSessionId: resolved.sessionId };
  }

  async cancelTurn(turnId, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.cancelTurn(turnId, await this.#resolveCompatOptions(options));
  }

  async recoverTurn(turnId, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.recoverTurn(turnId, await this.#resolveCompatOptions(options));
  }

  async resolveInteraction(turnId, interactionId, response, options) {
    if (!this.turnRuntime) throw new Error('No turn runtime configured.');
    return this.turnRuntime.resolveInteraction(turnId, interactionId, response, await this.#resolveCompatOptions(options));
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
