import { sortAiSessions, validateAiSession, validateAgentIdentity } from './contracts.mjs';

export class AiSessionService {
  constructor({ registry, turnRuntime, transcriptCache } = {}) {
    this.registry = registry;
    this.turnRuntime = turnRuntime;
    this.transcriptCache = transcriptCache ?? turnRuntime?.transcriptCache;
  }

  listProviders() {
    return this.registry.descriptors();
  }

  async listSessions(filters = {}) {
    const providers = filters.provider ? [filters.provider] : this.registry.descriptors().filter(item => item.enabled).map(item => item.id);
    const sessions = [];
    for (const provider of providers) {
      const adapter = this.registry.require(provider, 'listSessions', 'listSessions');
      const values = await adapter.listSessions(filters);
      sessions.push(...values.map(validateAiSession));
    }
    return sortAiSessions(sessions.filter(session => (
      (!filters.specId || session.specId === filters.specId)
      && (!filters.taskId || session.taskIds.includes(filters.taskId))
    )));
  }

  async getSession(provider, providerSessionId) {
    const adapter = this.registry.require(provider, 'sessionMetadata', 'getSession');
    return validateAiSession(await adapter.getSession(providerSessionId));
  }

  async listMessages(provider, providerSessionId) {
    if (this.registry.has(provider)) {
      const descriptor = this.registry.get(provider).descriptor;
      if (descriptor.capabilities.messages) {
        const adapter = this.registry.require(provider, 'messages', 'listMessages');
        return adapter.listMessages(providerSessionId);
      }
    }
    if (this.transcriptCache) {
      const transcript = await this.transcriptCache.getTranscript(provider, providerSessionId);
      return transcript.messages || [];
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
    const adapter = this.registry.require(provider, 'createSession', 'createSession');
    return validateAiSession(await adapter.createSession(input));
  }

  async startTurn(provider, providerSessionId, input) {
    this.registry.require(provider, 'startTurn', 'startTurn');
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

