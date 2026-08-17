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

  async createSession(provider, input = {}) {
    const entry = this.registry.get(provider);
    if (typeof entry.adapter?.createSession === 'function') {
      return entry.adapter.createSession(input);
    }
    throw new AiError('AI_UNSUPPORTED_OPERATION', `Provider '${provider}' does not support creating sessions.`, {
      status: 400,
      details: { provider, operation: 'createSession' },
    });
  }


  async startTurn(provider, providerSessionId, input = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    return this.turnRuntime.startTurn({ provider, providerSessionId, ...input });
  }

  getTurn(turnId) {
    return this.turnRuntime.getSnapshot(turnId);
  }

  subscribeToTurn(turnId, options) {
    return this.turnRuntime.subscribe(turnId, options);
  }

  async resolveInteraction(turnId, interactionId, response) {
    return this.turnRuntime.resolveInteraction(turnId, interactionId, response);
  }

  async cancelTurn(turnId) {
    return this.turnRuntime.cancelTurn(turnId);
  }
}

export function createAiSessionService(options) {
  return new AiSessionService(options);
}
