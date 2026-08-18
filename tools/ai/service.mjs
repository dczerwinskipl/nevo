import { AiError, validateAgentIdentity } from './contracts.mjs';

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

  async listSessions(filters = {}) {
    if (this.bindingService) {
      return this.bindingService.listBindings(filters);
    }
    return [];
  }

  async getSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.bindingService) {
      return this.bindingService.getBinding(provider, providerSessionId);
    }
    return null;
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
    const onSessionEstablished = async (allocatedSessionId) => {
      if (input.specId && this.bindingService) {
        await this.bindingService.bindSession({
          provider,
          providerSessionId: allocatedSessionId,
          specId: input.specId,
          taskId: input.taskId,
          purpose: input.purpose || 'interactive',
        });
      }
    };
    return this.turnRuntime.startTurn({
      provider,
      providerSessionId,
      ...input,
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
