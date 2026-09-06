/**
 * Manages the lifecycle of active MCP client sessions bound to Nevo Turns.
 *
 * Invariant: Every MCP session is bound to exactly one Nevo Turn.
 * When the Nevo Turn becomes terminal (completion, cancellation, provider exit,
 * timeout, or shutdown), all MCP sessions bound to that Turn are closed,
 * their server/transport resources are released, and they are pruned from the session map.
 */
export class McpSessionManager {
  #sessions = new Map(); // sessionId -> { transport, server, turnId, token, sessionId }
  #sessionsByTurn = new Map(); // turnId -> Set<sessionId>

  /**
   * Registers a newly initialized MCP session and binds it to a Nevo Turn.
   */
  registerSession(sessionId, { transport, server, turnId, token } = {}) {
    if (!sessionId) {
      throw new TypeError('sessionId is required');
    }
    const entry = { transport, server, turnId, token, sessionId };
    this.#sessions.set(sessionId, entry);

    if (turnId) {
      if (!this.#sessionsByTurn.has(turnId)) {
        this.#sessionsByTurn.set(turnId, new Set());
      }
      this.#sessionsByTurn.get(turnId).add(sessionId);
    }
    return entry;
  }

  /**
   * Gets a session entry by its MCP session ID.
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    return this.#sessions.get(sessionId) || null;
  }

  /**
   * Returns whether a session with the given ID exists.
   */
  hasSession(sessionId) {
    return this.#sessions.has(sessionId);
  }

  /**
   * Returns all sessions currently bound to a given Turn ID.
   */
  getSessionsForTurn(turnId) {
    if (!turnId || !this.#sessionsByTurn.has(turnId)) return [];
    const sessionIds = this.#sessionsByTurn.get(turnId);
    return Array.from(sessionIds).map((id) => this.#sessions.get(id)).filter(Boolean);
  }

  /**
   * Closes a single MCP session and releases its transport and server.
   */
  async closeSession(sessionId) {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return;

    this.#sessions.delete(sessionId);
    if (entry.turnId && this.#sessionsByTurn.has(entry.turnId)) {
      const set = this.#sessionsByTurn.get(entry.turnId);
      set.delete(sessionId);
      if (set.size === 0) {
        this.#sessionsByTurn.delete(entry.turnId);
      }
    }

    try {
      if (entry.transport) {
        await entry.transport.close();
      }
    } catch {}

    try {
      if (entry.server) {
        await entry.server.close();
      }
    } catch {}
  }

  /**
   * Closes all MCP sessions bound to a specific Turn.
   */
  async closeSessionsForTurn(turnId) {
    if (!turnId) return;
    const sessionIds = this.#sessionsByTurn.get(turnId);
    if (!sessionIds || sessionIds.size === 0) return;

    const idsToClose = Array.from(sessionIds);
    await Promise.all(idsToClose.map((id) => this.closeSession(id)));
  }

  /**
   * Closes all active MCP sessions across all Turns.
   */
  async closeAll() {
    const ids = Array.from(this.#sessions.keys());
    await Promise.all(ids.map((id) => this.closeSession(id)));
    this.#sessions.clear();
    this.#sessionsByTurn.clear();
  }

  get size() {
    return this.#sessions.size;
  }
}

export const mcpSessionManager = new McpSessionManager();
