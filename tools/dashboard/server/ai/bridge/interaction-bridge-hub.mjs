import { AiError } from '../contracts.mjs';

/**
 * Coordinates pending interactions between external bridge tools (such as MCP servers)
 * and the Nevo dashboard turn runtime.
 */
export class InteractionBridgeHub {
  #pendingInteractions = new Map();
  #pendingByTurn = new Map();
  #pendingBySession = new Map();
  #activeTurns = new Map();
  #activeTurnsBySession = new Map();

  /**
   * Registers an active turn allowing bridge requests to locate its requestInteraction context.
   */
  registerActiveTurn(turnId, { provider, providerSessionId, bridgeToken, requestInteraction } = {}) {
    if (!turnId) {
      throw new TypeError('turnId is required');
    }
    const entry = { turnId, provider, providerSessionId, bridgeToken, requestInteraction };
    this.#activeTurns.set(turnId, entry);
    if (provider && providerSessionId) {
      this.#activeTurnsBySession.set(`${provider}:${providerSessionId}`, turnId);
    }
    return entry;
  }

  unregisterActiveTurn(turnId) {
    const entry = this.#activeTurns.get(turnId);
    if (entry) {
      this.#activeTurns.delete(turnId);
      if (entry.provider && entry.providerSessionId) {
        this.#activeTurnsBySession.delete(`${entry.provider}:${entry.providerSessionId}`);
      }
    }
  }

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
   * Registers a pending bridge request awaiting a user response.
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

  /**
   * Handles an incoming bridge ask request: converts to neutral question,
   * calls requestInteraction on the active turn, and awaits the user's response.
   */
  async handleAsk({
    provider,
    providerSessionId,
    turnId,
    bridgeToken,
    question,
    header,
    options,
    multiSelect,
  } = {}) {
    const activeTurn = this.getActiveTurn({ turnId, provider, providerSessionId });
    if (!activeTurn || typeof activeTurn.requestInteraction !== 'function') {
      throw new AiError('AI_INTERACTION_NOT_FOUND', 'No active turn found for bridge request.', { status: 404 });
    }

    if (activeTurn.bridgeToken && activeTurn.bridgeToken !== bridgeToken) {
      throw new AiError('AI_FORBIDDEN', 'Invalid or missing bridge token for active turn.', { status: 403 });
    }

    const questionText = String(question || '').trim();
    if (!questionText) {
      throw new AiError('AI_VALIDATION_ERROR', 'Question text is required for interaction bridge.', { status: 400 });
    }

    const formattedOptions =
      Array.isArray(options) && options.length > 0
        ? options.map((opt) => {
            if (typeof opt === 'string') return { label: opt, description: opt };
            return {
              label: String(opt.label || opt.text || opt.title || ''),
              description: String(opt.description || opt.desc || opt.label || opt.text || ''),
            };
          })
        : undefined;

    const neutral = {
      kind: 'question',
      questions: [
        {
          question: questionText,
          ...(header ? { header: String(header) } : {}),
          ...(formattedOptions ? { options: formattedOptions } : {}),
          multiSelect: Boolean(multiSelect),
        },
      ],
    };

    const interaction = await activeTurn.requestInteraction(neutral, { resumePolicy: 'live-operation' });
    this.registerPending(interaction.id, {
      turnId: activeTurn.turnId,
      provider: activeTurn.provider,
      providerSessionId: activeTurn.providerSessionId,
    });

    return this.waitForResponse(interaction.id);
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
    this.#activeTurnsBySession.clear();
  }
}

export const interactionBridgeHub = new InteractionBridgeHub();
