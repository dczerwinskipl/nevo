import { mkdir, readdir, readFile, rm, unlink, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeTimestamp,
  validateAgentIdentity,
  validateAiEvent,
  AiValidationError,
} from './contracts.mjs';

function sanitizeFilename(value) {
  return encodeURIComponent(value).replace(/[*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function completeRunningToolCalls(state) {
  for (const msg of state.messages) {
    if (!msg.toolCalls) continue;
    for (const tool of msg.toolCalls) {
      if (tool.status === 'running') tool.status = 'completed';
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
   * Lists every session with a persisted transcript file on disk, including ones never
   * loaded into the in-memory cache yet (e.g. right after a process restart). Used by
   * boot-time orphaned-turn reconciliation, which otherwise has nothing to scan since
   * `entries()` only sees what's already been loaded.
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
   * Finalizes an orphaned `activeTurn` left behind by a session whose owning turn was
   * never terminated (e.g. an ungraceful server restart) — clears the ghost `activeTurn`,
   * completes any still-`running` tool calls, and appends a visible message so the next
   * read reflects reality instead of a stale "running" state. Requires the transcript to
   * already be loaded (via `getTranscript`); a no-op if there is no `activeTurn` to clear.
   */
  markTurnInterrupted(provider, providerSessionId, { text, createdAt = new Date().toISOString() } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    const state = this.#inMemory.get(key);
    if (!state || !state.activeTurn) return null;

    delete state.activeTurn;
    delete state.pendingInteraction;
    completeRunningToolCalls(state);
    state.lastEventSeq = (state.lastEventSeq || 0) + 1;

    const msg = {
      id: `system-${randomUUID()}`,
      role: 'assistant',
      text: typeof text === 'string' ? text : '',
      createdAt: normalizeTimestamp(createdAt, 'createdAt'),
    };
    state.messages.push(msg);
    state.updatedAt = msg.createdAt;
    this.#markDirty(provider, providerSessionId);
    return msg;
  }

  async getTranscript(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    if (this.#inMemory.has(key)) {
      return structuredClone(this.#inMemory.get(key));
    }

    const filePath = this.#getFilePath(provider, providerSessionId);
    try {
      const data = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.#inMemory.set(key, parsed);
      return structuredClone(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // file corruption or other error
      }
      const initial = {
        provider,
        providerSessionId,
        messages: [],
        lastEventSeq: 0,
        updatedAt: new Date().toISOString(),
      };
      this.#inMemory.set(key, initial);
      return structuredClone(initial);
    }
  }

  recordUserMessage(provider, providerSessionId, { text, messageId, createdAt = new Date().toISOString() } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const key = this.#key(provider, providerSessionId);
    let state = this.#inMemory.get(key);
    if (!state) {
      state = {
        provider,
        providerSessionId,
        messages: [],
        lastEventSeq: 0,
        updatedAt: createdAt,
      };
      this.#inMemory.set(key, state);
    }

    const id = messageId || `user-${randomUUID()}`;
    const existingIndex = state.messages.findIndex(m => m.id === id);
    const userMsg = {
      id,
      role: 'user',
      text: typeof text === 'string' ? text : '',
      createdAt: normalizeTimestamp(createdAt, 'createdAt'),
    };

    if (existingIndex >= 0) {
      state.messages[existingIndex] = userMsg;
    } else {
      state.messages.push(userMsg);
    }
    state.updatedAt = userMsg.createdAt;
    this.#markDirty(provider, providerSessionId);
    return userMsg;
  }

  applyEvent(provider, providerSessionId, rawEvent, { flush = false } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    const event = validateAiEvent(rawEvent);
    const key = this.#key(provider, providerSessionId);
    let state = this.#inMemory.get(key);
    if (!state) {
      state = {
        provider,
        providerSessionId,
        messages: [],
        lastEventSeq: 0,
        updatedAt: event.timestamp,
      };
      this.#inMemory.set(key, state);
    }

    const eventSeq = event.id ?? event.seq ?? 0;
    if (eventSeq > state.lastEventSeq) {
      state.lastEventSeq = eventSeq;
    }
    state.updatedAt = event.timestamp;

    const getOrCreateAssistantMsg = (msgId = `message-${event.turnId}`) => {
      let msg = state.messages.find(m => m.id === msgId);
      if (!msg) {
        // also check if there is an assistant message created for this turn
        msg = state.messages.find(m => m.id.endsWith(event.turnId) && m.role === 'assistant');
      }
      if (!msg) {
        msg = {
          id: msgId,
          role: 'assistant',
          text: '',
          createdAt: event.timestamp,
        };
        state.messages.push(msg);
      }
      return msg;
    };

    switch (event.type) {
      case 'turn.started': {
        state.activeTurn = {
          turnId: event.turnId,
          startedAt: event.timestamp,
          ...(event.mode ? { mode: event.mode } : {}),
        };
        break;
      }
      case 'message.started': {
        const msgId = event.messageId || `message-${event.turnId}`;
        let msg = state.messages.find(m => m.id === msgId);
        if (!msg) {
          msg = {
            id: msgId,
            role: event.role || 'assistant',
            text: '',
            createdAt: event.timestamp,
          };
          state.messages.push(msg);
        }
        break;
      }
      case 'text.delta': {
        const msg = getOrCreateAssistantMsg(event.messageId || `message-${event.turnId}`);
        const delta = event.text || '';
        msg.text += delta;
        break;
      }
      case 'reasoning.delta': {
        const msg = getOrCreateAssistantMsg(event.messageId || `message-${event.turnId}`);
        msg.reasoning = (msg.reasoning || '') + (event.text || '');
        break;
      }
      case 'tool.started': {
        const msg = getOrCreateAssistantMsg(`message-${event.turnId}`);
        if (!msg.toolCalls) msg.toolCalls = [];
        const existingTool = msg.toolCalls.find(t => t.id === event.toolId);
        if (!existingTool) {
          msg.toolCalls.push({
            id: event.toolId,
            name: event.toolName,
            input: event.input,
            status: 'running',
          });
        }
        break;
      }
      case 'tool.updated': {
        const msg = getOrCreateAssistantMsg(`message-${event.turnId}`);
        if (msg.toolCalls) {
          const tool = msg.toolCalls.find(t => t.id === event.toolId);
          if (tool) {
            if (event.output !== undefined) tool.output = event.output;
            if (event.status) tool.status = event.status;
          }
        }
        break;
      }
      case 'tool.completed': {
        const msg = getOrCreateAssistantMsg(`message-${event.turnId}`);
        if (!msg.toolCalls) msg.toolCalls = [];
        let tool = msg.toolCalls.find(t => t.id === event.toolId);
        if (!tool) {
          tool = { id: event.toolId, name: event.toolName || 'tool', status: 'completed' };
          msg.toolCalls.push(tool);
        }
        if (event.output !== undefined) tool.output = event.output;
        tool.status = 'completed';
        if (typeof event.durationMs === 'number') tool.durationMs = event.durationMs;
        break;
      }
      case 'interaction.requested': {
        state.pendingInteraction = structuredClone(event.interaction);
        const msg = getOrCreateAssistantMsg(`message-${event.turnId}`);
        msg.interaction = structuredClone(event.interaction);
        break;
      }
      case 'interaction.resolved': {
        delete state.pendingInteraction;
        const msg = getOrCreateAssistantMsg(`message-${event.turnId}`);
        if (msg.interaction && msg.interaction.id === event.interactionId) {
          if (event.response !== undefined) {
            msg.interaction.response = structuredClone(event.response);
          }
        }
        break;
      }
      case 'turn.completed': {
        delete state.activeTurn;
        completeRunningToolCalls(state);
        break;
      }
      case 'turn.failed': {
        delete state.activeTurn;
        delete state.pendingInteraction;
        completeRunningToolCalls(state);
        break;
      }
      default:
        break;
    }


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
