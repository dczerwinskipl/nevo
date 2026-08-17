import { validateAgentIdentity } from './contracts.mjs';

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
    const providers = filters.provider ? [filters.provider] : this.registry.descriptors().filter(item => item.enabled).map(item => item.id);
    const sessions = [];
    for (const provider of providers) {
      const adapter = this.registry.get(provider);
      if (typeof adapter?.listSessions === 'function') {
        const values = await adapter.listSessions(filters);
        sessions.push(...values);
      }
    }
    return sessions;
  }

  async getSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.bindingService) {
      const binding = await this.bindingService.getBinding(provider, providerSessionId);
      if (binding) return binding;
    }
    const adapter = this.registry.get(provider);
    if (typeof adapter?.getSession === 'function') {
      return adapter.getSession(providerSessionId);
    }
    return { provider, providerSessionId };
  }

  async listMessages(provider, providerSessionId) {
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      return transcript.messages || [];
    }
    if (this.registry.has(provider)) {
      const adapter = this.registry.get(provider);
      if (typeof adapter.listMessages === 'function') {
        return adapter.listMessages(providerSessionId);
      }
    }
    return [];
  }

  async getTranscript(provider, providerSessionId) {
    if (this.transcriptCache) {
      return this.transcriptCache.getTranscript(provider, providerSessionId);
    }
    return {
      provider,
      providerSessionId,
      messages: await this.listMessages(provider, providerSessionId),
      lastEventSeq: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async createSession(provider, input) {
    const adapter = this.registry.get(provider);
    if (typeof adapter?.createSession === 'function') {
      return adapter.createSession(input);
    }
    throw new Error(`Provider '${provider}' does not support creating sessions.`);
  }

  async startTurn(provider, providerSessionId, input) {
    return this.turnRuntime.startTurn({ provider, providerSessionId, sessionId: providerSessionId, ...input });
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
