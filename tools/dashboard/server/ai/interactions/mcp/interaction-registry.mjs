import { AiError } from '../../contracts.mjs';

/**
 * Manages short-lived turn correlation tokens and pending interaction waiters
 * for server-owned MCP tools.
 */
export class McpInteractionRegistry {
  #pendingInteractions = new Map();
  #pendingByTurn = new Map();
  #pendingBySession = new Map();
  #activeTurns = new Map();
  #activeTurnsByToken = new Map();
  #activeTurnsBySession = new Map();

  /**
   * Registers an active turn with a short-lived token and its requestInteraction context.
   */
  registerActiveTurn(turnId, { token, provider = 'claude', providerSessionId, requestInteraction } = {}) {
    if (!turnId) {
      throw new TypeError('turnId is required');
    }
    const entry = { turnId, token, provider, providerSessionId, requestInteraction };
    this.#activeTurns.set(turnId, entry);

    if (token) {
      this.#activeTurnsByToken.set(token, turnId);
    }
    if (provider && providerSessionId) {
      this.#activeTurnsBySession.set(`${provider}:${providerSessionId}`, turnId);
    }
    return entry;
  }

  /**
   * Unregisters an active turn and immediately rejects any orphaned pending interaction waiters.
   */
  unregisterActiveTurn(turnId, error) {
    const entry = this.#activeTurns.get(turnId);
    if (!entry) return;

    if (entry.token) {
      this.#activeTurnsByToken.delete(entry.token);
    }
    if (entry.provider && entry.providerSessionId) {
      this.#activeTurnsBySession.delete(`${entry.provider}:${entry.providerSessionId}`);
    }
    this.#activeTurns.delete(turnId);

    // Any pending interactions for this turn must be terminated — no waiters may survive turn unregistration
    const terminationError =
      error ||
      new AiError('AI_TURN_TERMINATED', 'The turn terminated while an interaction was pending.', { status: 409 });
    this.cancelTurn(turnId, terminationError);
  }

  /**
   * Finds an active turn by its short-lived correlation token.
   */
  getActiveTurnByToken(token) {
    if (!token) return null;
    const turnId = this.#activeTurnsByToken.get(token);
    if (!turnId) return null;
    return this.#activeTurns.get(turnId) || null;
  }

  /**
   * Finds an active turn by turnId or session.
   */
  getActiveTurn({ turnId, provider, providerSessionId } = {}) {
    if (turnId) {
      const entry = this.#activeTurns.get(turnId);
      if (!entry) return null;
      if (provider && entry.provider && entry.provider !== provider) return null;
      if (providerSessionId && entry.providerSessionId && entry.providerSessionId !== providerSessionId) return null;
      return entry;
    }
    if (provider && providerSessionId) {
      const id = this.#activeTurnsBySession.get(`${provider}:${providerSessionId}`);
      if (id && this.#activeTurns.has(id)) {
        return this.#activeTurns.get(id);
      }
    }
    return null;
  }

  /**
   * Registers a pending MCP tool request awaiting a human user response in the dashboard.
   */
  registerPending(interactionId, { turnId, provider, providerSessionId } = {}) {
    if (!interactionId) {
      throw new TypeError('interactionId is required');
    }

    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const entry = {
      interactionId,
      turnId,
      provider,
      providerSessionId,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
      createdAt: Date.now(),
    };

    this.#pendingInteractions.set(interactionId, entry);

    if (turnId) {
      if (!this.#pendingByTurn.has(turnId)) {
        this.#pendingByTurn.set(turnId, new Set());
      }
      this.#pendingByTurn.get(turnId).add(interactionId);
    }

    if (providerSessionId) {
      if (!this.#pendingBySession.has(providerSessionId)) {
        this.#pendingBySession.set(providerSessionId, new Set());
      }
      this.#pendingBySession.get(providerSessionId).add(interactionId);
    }

    return entry;
  }

  hasPending(interactionId) {
    return this.#pendingInteractions.has(interactionId);
  }

  getPending(interactionId) {
    return this.#pendingInteractions.get(interactionId) || null;
  }

  waitForResponse(interactionId) {
    const entry = this.#pendingInteractions.get(interactionId);
    if (!entry) {
      return Promise.reject(new AiError('AI_INTERACTION_NOT_FOUND', `No pending interaction for '${interactionId}'.`));
    }
    return entry.promise;
  }

  resolveResponse(interactionId, response) {
    const entry = this.#pendingInteractions.get(interactionId);
    if (!entry) {
      return false;
    }
    this.#cleanup(entry);
    entry.resolve(response);
    return true;
  }

  cancelTurn(turnId, error = new AiError('AI_TURN_CANCELLED', 'The turn was cancelled.', { status: 409 })) {
    const interactionIds = this.#pendingByTurn.get(turnId);
    if (!interactionIds) return 0;
    let count = 0;
    for (const id of [...interactionIds]) {
      const entry = this.#pendingInteractions.get(id);
      if (entry) {
        this.#cleanup(entry);
        entry.reject(error);
        count++;
      }
    }
    return count;
  }

  cancelSession(providerSessionId, error = new AiError('AI_SESSION_TERMINATED', 'The session was terminated.')) {
    const interactionIds = this.#pendingBySession.get(providerSessionId);
    if (!interactionIds) return 0;
    let count = 0;
    for (const id of [...interactionIds]) {
      const entry = this.#pendingInteractions.get(id);
      if (entry) {
        this.#cleanup(entry);
        entry.reject(error);
        count++;
      }
    }
    return count;
  }

  #cleanup(entry) {
    this.#pendingInteractions.delete(entry.interactionId);
    if (entry.turnId && this.#pendingByTurn.has(entry.turnId)) {
      const set = this.#pendingByTurn.get(entry.turnId);
      set.delete(entry.interactionId);
      if (set.size === 0) this.#pendingByTurn.delete(entry.turnId);
    }
    if (entry.providerSessionId && this.#pendingBySession.has(entry.providerSessionId)) {
      const set = this.#pendingBySession.get(entry.providerSessionId);
      set.delete(entry.interactionId);
      if (set.size === 0) this.#pendingBySession.delete(entry.providerSessionId);
    }
  }

  shutdown(error = new AiError('AI_SERVER_SHUTDOWN', 'Server is shutting down.', { status: 503 })) {
    for (const entry of [...this.#pendingInteractions.values()]) {
      this.#cleanup(entry);
      entry.reject(error);
    }
    this.clear();
  }

  clear() {
    this.#pendingInteractions.clear();
    this.#pendingByTurn.clear();
    this.#pendingBySession.clear();
    this.#activeTurns.clear();
    this.#activeTurnsByToken.clear();
    this.#activeTurnsBySession.clear();
  }
}

export const mcpInteractionRegistry = new McpInteractionRegistry();
