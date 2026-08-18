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
    if (!this.transcriptCache) return bindings;
    return Promise.all(bindings.map(async (binding) => {
      try {
        const transcript = await this.transcriptCache.getTranscript(binding.provider, binding.providerSessionId);
        return { ...binding, lastActivityAt: transcript?.updatedAt || binding.lastSeenAt };
      } catch {
        return binding;
      }
    }));
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
