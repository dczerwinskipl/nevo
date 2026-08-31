import { mkdir, readdir, readFile, rm, unlink, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeTimestamp,
  validateAgentIdentity,
  validateAiEvent,
  projectChatV1,
} from '../contracts.mjs';

function sanitizeFilename(value) {
  return encodeURIComponent(value).replace(/[*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Closes unresolved tools in canonical Turn aggregate with explicit closure reason.
 */
function closeDanglingTurnWork(turn, outcome = 'failed', cause = null) {
  if (!turn || !Array.isArray(turn.work)) return;
  let closureReason = 'turn_failed';
  let toolStatus = 'failed';

  if (outcome === 'completed') {
    closureReason = 'turn_completed';
    toolStatus = 'failed';
  } else if (outcome === 'cancelled') {
    closureReason = 'turn_cancelled';
    toolStatus = 'cancelled';
  } else if (outcome === 'interrupted') {
    closureReason = 'turn_interrupted';
    toolStatus = 'interrupted';
  } else if (cause === 'timeout/protocol-silence' || cause === 'AI_TURN_TIMEOUT') {
    closureReason = 'timeout';
    toolStatus = 'failed';
  } else if (cause === 'process_exit') {
    closureReason = 'process_exit';
    toolStatus = 'failed';
  }

  for (const item of turn.work) {
    if (item.type === 'tool' && (item.status === 'active' || item.status === 'queued')) {
      item.status = toolStatus;
      item.closureReason = closureReason;
      item.updatedAt = new Date().toISOString();
    } else if (item.type === 'interaction' && item.status === 'pending') {
      item.status = outcome === 'cancelled' ? 'cancelled' : 'denied';
      item.updatedAt = new Date().toISOString();
    }
  }
}

export class SessionTranscriptCacheService {
  #baseDir;
  #inMemory = new Map();
  #dirty = new Set();
  #flushTimers = new Map();
  #flushDebounceMs;

  constructor({ baseDir = resolve(process.cwd(), '.nevo-ai-local/transcripts'), flushDebounceMs = 50 } = {}) {
    this.#baseDir = baseDir;
    this.#flushDebounceMs = flushDebounceMs;
  }

  #key(provider, providerSessionId) {
    return `${provider}\u0000${providerSessionId}`;
  }

  #getFilePath(provider, providerSessionId) {
    const safeProvider = sanitizeFilename(provider);
    const safeSessionId = sanitizeFilename(providerSessionId);
    return join(this.#baseDir, safeProvider, `${safeSessionId}.json`);
  }

  *entries() {
    for (const [key, state] of this.#inMemory.entries()) {
      yield [key, structuredClone(state)];
    }
  }

  /**
   * Lists every session with a persisted transcript file on disk.
   */
  async listPersistedSessions() {
    const results = [];
    let providerEntries;
    try {
      providerEntries = await readdir(this.#baseDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return results;
      throw err;
    }
    for (const providerEntry of providerEntries) {
      if (!providerEntry.isDirectory()) continue;
      const provider = decodeURIComponent(providerEntry.name);
      const providerDir = join(this.#baseDir, providerEntry.name);
      let fileEntries;
      try {
        fileEntries = await readdir(providerDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const fileEntry of fileEntries) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue;
        const providerSessionId = decodeURIComponent(fileEntry.name.slice(0, -'.json'.length));
        results.push({ provider, providerSessionId });
      }
    }
    return results;
  }

  /**
   * Finalizes an orphaned activeTurn left behind by a session whose owning turn was
   * never terminated (e.g. ungraceful server restart).
   */
  markTurnInterrupted(provider, providerSessionId, { text, createdAt = new Date().toISOString() } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    const state = this.#inMemory.get(key);
    if (!state || !state.activeTurn) return null;

    const interruptedTurnId = state.activeTurn.turnId;
    delete state.activeTurn;
    delete state.pendingInteraction;

    // Reconcile canonical Turn in state.turns
    if (Array.isArray(state.turns)) {
      const activeTurn = state.turns.find(t => t.id === interruptedTurnId);
      if (activeTurn) {
        closeDanglingTurnWork(activeTurn, 'interrupted', 'turn_interrupted');
        activeTurn.status = {
          status: 'terminal',
          outcome: 'interrupted',
          initiator: 'shutdown',
          cause: 'turn_interrupted',
          error: { message: text || 'Interrupted by server restart.' },
        };
        activeTurn.completedAt = normalizeTimestamp(createdAt, 'completedAt');
        activeTurn.updatedAt = activeTurn.completedAt;
      }
    }

    state.lastEventSeq = (state.lastEventSeq || 0) + 1;
    state.updatedAt = normalizeTimestamp(createdAt, 'updatedAt');
    this.#markDirty(provider, providerSessionId);
    return { id: `interrupted-${interruptedTurnId}`, turnId: interruptedTurnId };
  }

  /**
   * Record or update a full canonical Turn aggregate in persistence directly from TurnLifecycleCoordinator.
   */
  recordCanonicalTurn(provider, providerSessionId, turn) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    let state = this.#inMemory.get(key);
    if (!state) {
      state = {
        schemaVersion: 2,
        provider,
        providerSessionId,
        turns: [],
        lastEventSeq: 0,
        health: 'healthy',
        updatedAt: turn.updatedAt || new Date().toISOString(),
      };
      this.#inMemory.set(key, state);
    }

    if (!Array.isArray(state.turns)) state.turns = [];
    const index = state.turns.findIndex(t => t.id === turn.id);
    const cloned = structuredClone(turn);
    if (index >= 0) {
      state.turns[index] = cloned;
    } else {
      state.turns.push(cloned);
    }

    if (cloned.status?.status !== 'terminal') {
      state.activeTurn = {
        turnId: cloned.id,
        startedAt: cloned.startedAt,
        mode: cloned.mode,
      };
      if (cloned.status?.status === 'requiresAttention') {
        const pendingItem = cloned.work?.find(w => w.type === 'interaction' && w.status === 'pending');
        state.pendingInteraction = pendingItem?.interaction ? structuredClone(pendingItem.interaction) : null;
      } else {
        delete state.pendingInteraction;
      }
    } else {
      delete state.activeTurn;
      delete state.pendingInteraction;
    }

    state.updatedAt = cloned.updatedAt || cloned.completedAt || cloned.startedAt || new Date().toISOString();
    this.#markDirty(provider, providerSessionId);
  }

  async getTranscript(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    let state;
    if (this.#inMemory.has(key)) {
      state = this.#inMemory.get(key);
    } else {
      const filePath = this.#getFilePath(provider, providerSessionId);
      try {
        const data = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed.turns)) parsed.turns = [];
        parsed.health = parsed.health || 'healthy';
        this.#inMemory.set(key, parsed);
        state = parsed;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // File is corrupt or unreadable -> do not synthesize empty ready session
          const corruptState = {
            schemaVersion: 2,
            provider,
            providerSessionId,
            turns: [],
            lastEventSeq: 0,
            health: 'corrupt',
            error: err.message,
            updatedAt: new Date().toISOString(),
          };
          this.#inMemory.set(key, corruptState);
          return structuredClone(corruptState);
        }
        const initial = {
          schemaVersion: 2,
          provider,
          providerSessionId,
          turns: [],
          lastEventSeq: 0,
          health: 'healthy',
          updatedAt: new Date().toISOString(),
        };
        this.#inMemory.set(key, initial);
        state = initial;
      }
    }

    const cloned = structuredClone(state);
    if (!Array.isArray(cloned.messages) && Array.isArray(cloned.turns) && cloned.turns.length > 0) {
      cloned.messages = projectChatV1(cloned.turns);
    }
    return cloned;
  }

  recordUserMessage(provider, providerSessionId, { text, messageId, createdAt = new Date().toISOString() } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    let state = this.#inMemory.get(key);
    if (!state) {
      state = {
        schemaVersion: 2,
        provider,
        providerSessionId,
        turns: [],
        lastEventSeq: 0,
        health: 'healthy',
        updatedAt: createdAt,
      };
      this.#inMemory.set(key, state);
    }

    state.updatedAt = normalizeTimestamp(createdAt, 'createdAt');
    this.#markDirty(provider, providerSessionId);
    return { id: messageId || `user-${randomUUID()}`, role: 'user', text, createdAt: state.updatedAt };
  }

  applyEvent(provider, providerSessionId, rawEvent, { flush = false } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const event = validateAiEvent(rawEvent);
    const key = this.#key(provider, providerSessionId);
    let state = this.#inMemory.get(key);
    if (!state) {
      state = {
        schemaVersion: 2,
        provider,
        providerSessionId,
        turns: [],
        lastEventSeq: 0,
        health: 'healthy',
        updatedAt: event.timestamp,
      };
      this.#inMemory.set(key, state);
    }

    const eventSeq = event.id ?? event.seq ?? 0;
    if (eventSeq > state.lastEventSeq) {
      state.lastEventSeq = eventSeq;
    }
    state.updatedAt = event.timestamp;
    this.#markDirty(provider, providerSessionId);

    if (flush) {
      return this.flush(provider, providerSessionId);
    }
    return Promise.resolve();
  }

  #markDirty(provider, providerSessionId) {
    const key = this.#key(provider, providerSessionId);
    this.#dirty.add(key);

    if (this.#flushDebounceMs > 0 && !this.#flushTimers.has(key)) {
      const timer = setTimeout(() => {
        this.#flushTimers.delete(key);
        this.flush(provider, providerSessionId).catch(() => {});
      }, this.#flushDebounceMs);
      this.#flushTimers.set(key, timer);
    }
  }

  async flush(provider, providerSessionId) {
    const key = this.#key(provider, providerSessionId);
    const timer = this.#flushTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.#flushTimers.delete(key);
    }

    const state = this.#inMemory.get(key);
    if (!state) return;

    this.#dirty.delete(key);

    const filePath = this.#getFilePath(provider, providerSessionId);
    await mkdir(dirname(filePath), { recursive: true });

    const content = JSON.stringify(state, null, 2);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf-8');
    try {
      await rename(tempPath, filePath);
    } catch (renameErr) {
      if (process.platform === 'win32') {
        await new Promise(r => setTimeout(r, 10));
        try {
          await rename(tempPath, filePath);
        } catch {
          await writeFile(filePath, content, 'utf-8');
          await unlink(tempPath).catch(() => {});
        }
      } else {
        throw renameErr;
      }
    }
  }

  async flushAll() {
    const entries = [...this.#dirty];
    for (const key of entries) {
      const [provider, providerSessionId] = key.split('\u0000');
      await this.flush(provider, providerSessionId);
    }
  }

  async deleteTranscript(provider, providerSessionId) {
    const key = this.#key(provider, providerSessionId);
    const timer = this.#flushTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.#flushTimers.delete(key);
    }
    this.#inMemory.delete(key);
    this.#dirty.delete(key);

    const filePath = this.#getFilePath(provider, providerSessionId);
    try {
      await rm(filePath, { force: true });
    } catch {}
  }
}

export function createTranscriptCacheService(options) {
  return new SessionTranscriptCacheService(options);
}
