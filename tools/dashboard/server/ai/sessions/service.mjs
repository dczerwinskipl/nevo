import { randomUUID } from 'node:crypto';
import {
  validateAgentIdentity,
  validateAgentExecutionMode,
  computeCurrentActivity,
  projectChatV1,
} from '../contracts.mjs';
import { compareBindingRecency } from './binding-service.mjs';

export { projectChatV1 };

/**
 * Computes semantic session readiness without falling back to 'ready' on corrupt state.
 */
export function resolveSessionReadiness({ descriptor, binding, transcript, activeTurn, turnSnapshot, error } = {}) {
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

  // 3. Active Turn / Pending Interaction
  if (activeTurn) {
    if (activeTurn.status === 'waitingForUser' || turnSnapshot?.pendingInteraction) {
      const interaction = turnSnapshot?.pendingInteraction || transcript?.pendingInteraction;
      return {
        status: 'requiresAttention',
        reason: interaction?.kind === 'question' ? 'question_required' : 'permission_required',
        details: { interactionId: interaction?.id, kind: interaction?.kind },
      };
    }
    return {
      status: 'busy',
      reason: 'turn_in_progress',
      details: { turnId: activeTurn.turnId },
    };
  }

  // 4. Ready / Idle
  return {
    status: 'ready',
    reason: 'idle',
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

  const openTools = workItems.filter(w => w.type === 'tool' && (w.status === 'active' || w.status === 'queued'));
  const activeToolCount = openTools.length;

  let attention = null;
  const pendingInteraction = workItems.find(w => w.type === 'interaction' && w.status === 'pending');
  if (pendingInteraction) {
    attention = {
      required: true,
      kind: pendingInteraction.interaction?.kind || 'permission',
      interactionId: pendingInteraction.id,
      title: pendingInteraction.interaction?.title || (pendingInteraction.interaction?.kind === 'question' ? 'Question needs answer' : 'Permission approval required'),
    };
  }

  let status = 'idle';
  if (turn.status) {
    if (turn.status.status === 'requiresAttention') {
      status = 'waitingForUser';
    } else if (turn.status.status === 'active' || turn.status.status === 'waiting' || turn.status.status === 'cancelling') {
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

export class AgentSessionService {
  constructor({ registry, turnRuntime, transcriptCache, bindingService } = {}) {
    this.registry = registry;
    this.turnRuntime = turnRuntime;
    this.transcriptCache = transcriptCache ?? turnRuntime?.transcriptCache;
    this.bindingService = bindingService;
  }

  listProviders() {
    return this.registry.descriptors();
  }

  async createSession(provider, options = {}) {
    const entry = this.registry.get(provider);
    const descriptor = entry.descriptor;
    const taskIds = Array.isArray(options.taskIds)
      ? options.taskIds.filter(Boolean)
      : (options.taskId ? [options.taskId] : []);
    const primaryTaskId = options.taskId || (taskIds.length > 0 ? taskIds[0] : undefined);
    const purpose = options.purpose || options.title || (primaryTaskId ? `task:${primaryTaskId}` : 'interactive');
    const mode = options.mode
      ? validateAgentExecutionMode(options.mode, 'mode')
      : (descriptor.defaultMode || 'edit');

    let providerSessionId;
    if (typeof entry.provider.createSession === 'function') {
      const created = await entry.provider.createSession({
        specId: options.specId,
        taskId: primaryTaskId,
        taskIds: taskIds.length > 0 ? taskIds : undefined,
        purpose,
        mode,
        title: options.title,
      });
      providerSessionId = typeof created === 'string' ? created : created?.providerSessionId;
      validateAgentIdentity({ provider, providerSessionId });
    } else {
      providerSessionId = randomUUID();
    }

    let binding;
    if (this.bindingService) {
      if (taskIds.length > 0) {
        for (const tId of taskIds) {
          binding = await this.bindingService.bindSession({
            provider,
            providerSessionId,
            specId: options.specId,
            taskId: tId,
            purpose: options.purpose || options.title || `task:${tId}`,
            mode,
          });
        }
      } else {
        binding = await this.bindingService.bindSession({
          provider,
          providerSessionId,
          specId: options.specId,
          taskId: undefined,
          purpose,
          mode,
        });
      }
    } else {
      binding = {
        provider,
        providerSessionId,
        sessionId: providerSessionId,
        specId: options.specId,
        taskId: primaryTaskId,
        purpose,
        mode,
        title: options.title || `${provider} session`,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
    }
    return {
      ...binding,
      sessionId: providerSessionId,
      taskIds,
      taskId: primaryTaskId,
    };
  }

  async attachSession(provider, { providerSessionId, specId, taskId, taskIds, purpose, mode } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const resolvedTaskIds = Array.isArray(taskIds) ? taskIds.filter(Boolean) : (taskId ? [taskId] : []);

    let binding;
    if (this.bindingService) {
      if (resolvedTaskIds.length > 0) {
        for (const tId of resolvedTaskIds) {
          binding = await this.bindingService.bindSession({ provider, providerSessionId, specId, taskId: tId, purpose, mode });
        }
      } else {
        binding = await this.bindingService.bindSession({ provider, providerSessionId, specId, taskId, purpose, mode });
      }
    } else {
      binding = { provider, providerSessionId, specId, taskId, mode };
    }

    return { ...binding, taskIds: resolvedTaskIds, taskId: taskId || (resolvedTaskIds[0] || undefined) };
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
      if (filters.taskId && !rows.some(r => r.taskId === filters.taskId)) {
        continue;
      }
      const sortedRows = rows.slice().sort(compareBindingRecency);
      const representative = sortedRows[0];
      const taskIds = Array.from(new Set(rows.map(r => r.taskId).filter(Boolean)));

      logicalSessions.push({
        ...representative,
        sessionId: representative.providerSessionId,
        taskId: representative.taskId || (taskIds[0] || undefined),
        taskIds,
      });
    }

    if (!this.transcriptCache) {
      return logicalSessions.map(session => ({
        ...session,
        status: 'idle',
        activeTurn: null,
        pendingInteraction: null,
      }));
    }

    return Promise.all(logicalSessions.map(async (session) => {
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
        const hasRecordedActivity = Boolean(transcript?.turns?.length || transcript?.messages?.length || transcript?.lastEventSeq || transcript?.activeTurn);
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
    }));
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

    const status = activeTurn
      ? (activeTurn.status === 'waitingForUser' ? 'waitingForUser' : 'running')
      : 'idle';

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
        return list?.find(b => b.provider === provider && b.providerSessionId === providerSessionId) || null;
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

  async getSessionDetails(provider, providerSessionId, options = {}) {
    validateAgentIdentity({ provider, providerSessionId });

    const descriptor = this.registry?.has(provider)
      ? this.registry.get(provider).descriptor
      : undefined;
    const capabilities = descriptor?.capabilities || {};

    const binding = await this.getSession(provider, providerSessionId);
    const taskIds = binding?.taskIds || (binding?.taskId ? [binding.taskId] : []);
    const specId = binding?.specId;

    const transcript = await this.getTranscript(provider, providerSessionId);
    const { status, activeTurn, pendingInteraction } = this.resolveSessionActivity(transcript);
    const resolvedMode = binding?.mode ?? descriptor?.defaultMode ?? 'edit';

    let turnSnapshot = null;
    if (activeTurn?.turnId) {
      try {
        turnSnapshot = this.getTurn(activeTurn.turnId);
      } catch {}
    }

    const readiness = resolveSessionReadiness({
      descriptor,
      binding,
      transcript,
      activeTurn,
      turnSnapshot,
    });

    const turns = Array.isArray(transcript?.turns) ? transcript.turns : [];
    const activeCanonical = activeTurn?.turnId ? this.getCanonicalTurn(activeTurn.turnId) : null;
    const combinedTurns = turns.map(t => (t.id === activeTurn?.turnId && activeCanonical ? activeCanonical : t));
    if (activeTurn?.turnId && activeCanonical && !combinedTurns.some(t => t.id === activeTurn.turnId)) {
      combinedTurns.push(activeCanonical);
    }

    const activeOrLatestTurn = activeCanonical || (combinedTurns.length > 0 ? combinedTurns.at(-1) : null);
    const workSummary = computeWorkSummary(activeOrLatestTurn);

    const baseSession = {
      provider,
      providerSessionId,
      sessionId: providerSessionId,
      status: readiness.status === 'unavailable' ? 'unavailable' : status,
      capabilities,
      mode: resolvedMode,
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

    const representation = options.representation;
    if (representation === 'v1') {
      return {
        ...baseSession,
        messages: projectChatV1(combinedTurns),
      };
    }

    if (representation === 'v2') {
      return {
        ...baseSession,
        readiness,
        workSummary,
        turns: combinedTurns,
      };
    }

    return {
      ...baseSession,
      readiness,
      workSummary,
      turns: combinedTurns,
      messages: projectChatV1(combinedTurns),
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

  async listMessages(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      if (Array.isArray(transcript?.turns) && transcript.turns.length > 0) {
        return projectChatV1(transcript.turns);
      }
      return transcript?.messages || [];
    }
    return [];
  }

  async listTurns(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      return transcript.turns || [];
    }
    return [];
  }

  async getTranscript(provider, providerSessionId) {
    if (this.transcriptCache) {
      return this.transcriptCache.getTranscript(provider, providerSessionId);
    }
    return { messages: [], turns: [], lastEventSeq: 0 };
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

    if (sessId) {
      validateAgentIdentity({ provider: prov, providerSessionId: sessId });
    }

    // Mode resolution
    let effectiveMode = opts.mode;
    if (effectiveMode && sessId && this.bindingService) {
      await this.updateSessionMode(prov, sessId, effectiveMode);
    } else if (!effectiveMode && sessId && this.bindingService) {
      const binding = await this.getSession(prov, sessId);
      if (binding?.mode) effectiveMode = binding.mode;
    }
    if (!effectiveMode) {
      const entry = this.registry?.get?.(prov);
      effectiveMode = entry?.descriptor?.defaultMode || 'edit';
    }

    let onSessionEstablished = opts.onSessionEstablished;
    if (!sessId && this.bindingService && !onSessionEstablished) {
      onSessionEstablished = async (allocatedSessionId) => {
        if (opts.taskIds && opts.taskIds.length > 0) {
          for (const tId of opts.taskIds) {
            await this.bindingService.bindSession({
              provider: prov,
              providerSessionId: allocatedSessionId,
              specId: opts.specId,
              taskId: tId,
              purpose: opts.purpose || `task:${tId}`,
              mode: effectiveMode,
            });
          }
        } else {
          await this.bindingService.bindSession({
            provider: prov,
            providerSessionId: allocatedSessionId,
            specId: opts.specId,
            taskId: opts.taskId,
            purpose: opts.purpose || (opts.taskId ? `task:${opts.taskId}` : 'interactive'),
            mode: effectiveMode,
          });
        }
      };
    }

    return this.turnRuntime.startTurn({
      ...opts,
      provider: prov,
      providerSessionId: sessId,
      message: opts.message ?? opts.prompt,
      prompt: opts.message ?? opts.prompt,
      mode: effectiveMode,
      onSessionEstablished,
    });
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
    return this.turnRuntime.subscribeToSession({ provider: prov, providerSessionId: sessId }, opts);
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
