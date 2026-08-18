import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiNotFoundError,
  validateAgentIdentity,
  validateAgentExecutionMode,
} from './contracts.mjs';

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
    const descriptor = this.registry.get(provider);
    if (!descriptor) {
      throw new AiNotFoundError(`Provider '${provider}' was not found.`);
    }
    const providerSessionId = randomUUID();
    const taskId = options.taskId || (Array.isArray(options.taskIds) && options.taskIds.length === 1 ? options.taskIds[0] : undefined);
    const purpose = options.purpose || options.title || (taskId ? `task:${taskId}` : 'interactive');
    const mode = options.mode
      ? validateAgentExecutionMode(options.mode, 'mode')
      : (descriptor.defaultMode || 'edit');

    const binding = this.bindingService
      ? await this.bindingService.bindSession({
          provider,
          providerSessionId,
          specId: options.specId,
          taskId,
          purpose,
          mode,
        })
      : {
          provider,
          providerSessionId,
          sessionId: providerSessionId,
          specId: options.specId,
          taskId,
          purpose,
          mode,
          title: options.title || `${provider} session`,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        };
    return binding;
  }

  async listSessions(filters = {}) {
    if (!this.bindingService) return [];
    const bindings = await this.bindingService.listBindings(filters);
    if (!this.transcriptCache) return bindings.map(binding => ({ ...binding, status: 'idle' }));
    return Promise.all(bindings.map(async (binding) => {
      try {
        const transcript = await this.transcriptCache.getTranscript(binding.provider, binding.providerSessionId);
        const { status, activeTurn, pendingInteraction } = this.resolveSessionActivity(transcript);
        return {
          ...binding,
          lastActivityAt: transcript?.updatedAt || binding.lastSeenAt,
          status,
          activeTurn,
          pendingInteraction,
        };
      } catch {
        return { ...binding, status: 'idle' };
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
      return this.bindingService.getBinding(provider, providerSessionId);
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
    if (providerSessionId && typeof this.bindingService?.getBinding === 'function') {
      existingBinding = await this.bindingService.getBinding(provider, providerSessionId);
    }
    const descriptor = this.registry.get(provider);

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
}

export function createAiSessionService(options) {
  return new AiSessionService(options);
}
