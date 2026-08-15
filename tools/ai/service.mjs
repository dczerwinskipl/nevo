import { sortAiSessions, validateAiSession } from './contracts.mjs';

export class AiSessionService {
  constructor({ registry, turnRuntime } = {}) {
    this.registry = registry;
    this.turnRuntime = turnRuntime;
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

  async getSession(provider, sessionId) {
    const adapter = this.registry.require(provider, 'sessionMetadata', 'getSession');
    return validateAiSession(await adapter.getSession(sessionId));
  }

  async listMessages(provider, sessionId) {
    const adapter = this.registry.require(provider, 'messages', 'listMessages');
    return adapter.listMessages(sessionId);
  }

  async createSession(provider, input) {
    const adapter = this.registry.require(provider, 'createSession', 'createSession');
    return validateAiSession(await adapter.createSession(input));
  }

  async startTurn(provider, sessionId, input) {
    this.registry.require(provider, 'startTurn', 'startTurn');
    return this.turnRuntime.startTurn({ provider, sessionId, ...input });
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
