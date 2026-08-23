import { randomUUID } from 'node:crypto';
import {
  validateAgentIdentity,
  validateAgentExecutionMode,
} from './contracts.mjs';
import { compareBindingRecency } from './binding-service.mjs';

export class AiSessionService {
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
    if (typeof entry.adapter.createSession === 'function') {
      const created = await entry.adapter.createSession({
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
      taskIds,
      taskId: primaryTaskId,
    };
  }

  async listSessions(filters = {}) {
    if (!this.bindingService) return [];
    const query = {};
    if (filters.specId) query.specId = filters.specId;
    if (filters.provider) query.provider = filters.provider;
    if (filters.providerSessionId) query.providerSessionId = filters.providerSessionId;

    const rawBindings = await this.bindingService.listBindings(query);

    // Group rows by `${binding.provider}:::${binding.providerSessionId}:::${binding.specId}`
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
        taskId: representative.taskId || (taskIds[0] || undefined),
        taskIds,
      });
    }

    if (!this.transcriptCache) {
      return logicalSessions.map(session => ({ ...session, status: 'idle' }));
    }

    return Promise.all(logicalSessions.map(async (session) => {
      try {
        const transcript = await this.transcriptCache.getTranscript(session.provider, session.providerSessionId);
        const { status, activeTurn, pendingInteraction } = this.resolveSessionActivity(transcript);
        // `getTranscript` synthesizes an empty, timestamped-`now` object for a session that
        // never had a turn — never treat that synthetic timestamp as real activity, or every
        // untouched session would show "just now" the moment it's first listed after a restart.
        const hasRecordedActivity = Boolean(transcript?.messages?.length || transcript?.lastEventSeq || transcript?.activeTurn);
        return {
          ...session,
          lastActivityAt: (hasRecordedActivity && transcript?.updatedAt) || session.lastSeenAt,
          status,
          activeTurn,
          pendingInteraction,
        };
      } catch {
        return { ...session, status: 'idle' };
      }
    }));
  }

  /**
   * Computes a session's live `status` (`idle` | `running` | `waitingForUser`) from a
   * transcript snapshot, cross-checked against the in-memory turn runtime. Shared by
   * `listSessions` and the single-session detail route so the dashboard home page and
   * the chat view can never disagree (D8).
   */
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
        // No in-memory turn for this persisted `activeTurn` (already reconciled at boot,
        // or a narrow race) — never assume "running" from a raw, status-less persisted
        // record; that was the exact bug behind a session showing a permanently
        // "running" ghost status after an ungraceful restart.
        activeTurn = null;
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

  async listMessages(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      return transcript.messages || [];
    }
    return [];
  }

  async getTranscript(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.transcriptCache) {
      return this.transcriptCache.getTranscript(provider, providerSessionId);
    }
    return {
      provider,
      providerSessionId,
      messages: [],
      lastEventSeq: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async startTurn(provider, providerSessionId, input = {}) {
    if (providerSessionId) {
      validateAgentIdentity({ provider, providerSessionId });
    }

    let resolvedMode;
    let existingBinding = null;
    if (providerSessionId) {
      existingBinding = await this.getSession(provider, providerSessionId);
    }
    const descriptor = this.registry.get(provider).descriptor;

    if (input.mode !== undefined) {
      resolvedMode = validateAgentExecutionMode(input.mode, 'mode');
      if (existingBinding && typeof this.bindingService?.updateSessionMode === 'function') {
        await this.bindingService.updateSessionMode(provider, providerSessionId, resolvedMode);
      }
    } else if (existingBinding?.mode) {
      resolvedMode = validateAgentExecutionMode(existingBinding.mode, 'mode');
    } else {
      resolvedMode = descriptor?.defaultMode || 'edit';
    }

    const onSessionEstablished = async (allocatedSessionId) => {
      if (input.specId && this.bindingService) {
        await this.bindingService.bindSession({
          provider,
          providerSessionId: allocatedSessionId,
          specId: input.specId,
          taskId: input.taskId,
          purpose: input.purpose || 'interactive',
          mode: resolvedMode,
        });
      }
    };

    return this.turnRuntime.startTurn({
      provider,
      providerSessionId,
      ...input,
      mode: resolvedMode,
      onSessionEstablished,
    });
  }

  getTurn(turnId) {
    return this.turnRuntime.getSnapshot(turnId);
  }

  subscribeToTurn(turnId, options) {
    return this.turnRuntime.subscribe(turnId, options);
  }

  subscribeToSession(provider, providerSessionId, options) {
    return this.turnRuntime.subscribeToSession({ provider, providerSessionId }, options);
  }

  async resolveInteraction(turnId, interactionId, response, options = {}) {
    return this.turnRuntime.resolveInteraction(turnId, interactionId, response, options);
  }

  async cancelTurn(turnId, options = {}) {
    return this.turnRuntime.cancelTurn(turnId, options);
  }

  shutdown() {
    return this.turnRuntime?.shutdown?.();
  }
}

export function createAiSessionService(options) {
  return new AiSessionService(options);
}
