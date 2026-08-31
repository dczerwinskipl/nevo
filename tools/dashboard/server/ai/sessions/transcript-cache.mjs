import { mkdir, readdir, readFile, rm, unlink, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeTimestamp,
  validateAgentIdentity,
  validateAiEvent,
  AiValidationError,
  createCanonicalTurn,
  appendWorkItem,
  updateWorkItem,
  setTurnStatus,
  setFinalAnswer,
  computeCurrentActivity,
  normalizeTransitionalToolStatus,
} from '../contracts.mjs';

function sanitizeFilename(value) {
  return encodeURIComponent(value).replace(/[*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Resolves still-running tool calls to 'failed' in V1 messages.
 */
function completeRunningToolCalls(state, turnId) {
  for (const msg of state.messages || []) {
    if (turnId && msg.turnId !== turnId) continue;
    if (!msg.toolCalls) continue;
    for (const tool of msg.toolCalls) {
      if (tool.status === 'running' || tool.status === 'active') tool.status = 'failed';
    }
  }
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

    // 1. Reconcile canonical Turn in state.turns
    if (Array.isArray(state.turns)) {
      const activeTurn = state.turns.find(t => t.id === interruptedTurnId);
      if (activeTurn) {
        closeDanglingTurnWork(activeTurn, 'interrupted', 'turn_interrupted');
        activeTurn.status = {
          status: 'terminal',
          outcome: 'interrupted',
          initiator: 'shutdown',
          cause: 'turn_interrupted',
        };
        activeTurn.completedAt = normalizeTimestamp(createdAt, 'completedAt');
        activeTurn.updatedAt = activeTurn.completedAt;
      }
    }

    // 2. Reconcile V1 messages
    completeRunningToolCalls(state, interruptedTurnId);
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

  /**
   * Record or update a full canonical Turn aggregate in persistence.
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
        messages: [],
        lastEventSeq: 0,
        health: 'healthy',
        updatedAt: turn.updatedAt || new Date().toISOString(),
      };
      this.#inMemory.set(key, state);
    }

    if (!Array.isArray(state.turns)) state.turns = [];
    const index = state.turns.findIndex(t => t.id === turn.id);
    if (index >= 0) {
      state.turns[index] = structuredClone(turn);
    } else {
      state.turns.push(structuredClone(turn));
    }

    state.updatedAt = turn.updatedAt || new Date().toISOString();
    this.#markDirty(provider, providerSessionId);
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
      if (!Array.isArray(parsed.turns)) parsed.turns = [];
      if (!Array.isArray(parsed.messages)) parsed.messages = [];
      parsed.health = parsed.health || 'healthy';
      this.#inMemory.set(key, parsed);
      return structuredClone(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // File is corrupt or unreadable -> do not synthesize empty ready session
        const corruptState = {
          schemaVersion: 2,
          provider,
          providerSessionId,
          turns: [],
          messages: [],
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
        messages: [],
        lastEventSeq: 0,
        health: 'healthy',
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
        schemaVersion: 2,
        provider,
        providerSessionId,
        turns: [],
        messages: [],
        lastEventSeq: 0,
        health: 'healthy',
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
        schemaVersion: 2,
        provider,
        providerSessionId,
        turns: [],
        messages: [],
        lastEventSeq: 0,
        health: 'healthy',
        updatedAt: event.timestamp,
      };
      this.#inMemory.set(key, state);
    }

    if (!Array.isArray(state.turns)) state.turns = [];

    const eventSeq = event.id ?? event.seq ?? 0;
    if (eventSeq > state.lastEventSeq) {
      state.lastEventSeq = eventSeq;
    }
    state.updatedAt = event.timestamp;

    // Helper: get or create active Turn aggregate in state.turns
    const getOrCreateCanonicalTurn = (turnId, mode = 'edit') => {
      let turn = state.turns.find(t => t.id === turnId);
      if (!turn) {
        turn = createCanonicalTurn({
          id: turnId,
          sessionId: providerSessionId,
          provider,
          providerSessionId,
          mode,
          createdAt: event.timestamp,
        });
        state.turns.push(turn);
      }
      return turn;
    };

    const getOrCreateAssistantMsg = (explicitMsgId) => {
      let msg = null;
      if (explicitMsgId) {
        msg = state.messages.find(m => m.id === explicitMsgId);
      } else if (event.turnId) {
        msg = state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant');
      }
      if (!msg) {
        msg = {
          id: explicitMsgId || (event.turnId ? `message-${event.turnId}` : `msg-${randomUUID()}`),
          role: 'assistant',
          text: '',
          turnId: event.turnId,
          createdAt: event.timestamp,
        };
        state.messages.push(msg);
      }
      return msg;
    };

    // Apply event to both Canonical Turns and V1 Messages
    switch (event.type) {
      case 'turn.started': {
        state.activeTurn = {
          turnId: event.turnId,
          startedAt: event.timestamp,
          ...(event.mode ? { mode: event.mode } : {}),
        };
        getOrCreateCanonicalTurn(event.turnId, event.mode || 'edit');
        break;
      }
      case 'message.started': {
        const msgId = event.messageId || (event.turnId ? `message-${event.turnId}` : `msg-${randomUUID()}`);
        let msg = state.messages.find(m => m.id === msgId);
        if (!msg) {
          msg = {
            id: msgId,
            role: event.role || 'assistant',
            text: '',
            turnId: event.turnId,
            createdAt: event.timestamp,
          };
          state.messages.push(msg);
        }
        break;
      }
      case 'text.delta': {
        // V1
        const msg = getOrCreateAssistantMsg(event.messageId);
        const delta = event.text || '';
        msg.text += delta;

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const commentaryId = event.messageId || `commentary-${event.turnId}`;
          const existingWork = turn.work.find(w => w.id === commentaryId && w.type === 'commentary');
          if (existingWork) {
            existingWork.text = (existingWork.text || '') + delta;
            existingWork.updatedAt = event.timestamp;
          } else {
            appendWorkItem(turn, {
              id: commentaryId,
              type: 'commentary',
              text: delta,
              status: 'streaming',
              createdAt: event.timestamp,
            });
          }
        }
        break;
      }
      case 'reasoning.delta': {
        // V1
        const msg = getOrCreateAssistantMsg(event.messageId);
        msg.reasoning = (msg.reasoning || '') + (event.text || '');

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const reasoningId = event.messageId || `reasoning-${event.turnId}`;
          const existingWork = turn.work.find(w => w.id === reasoningId && w.type === 'reasoning');
          if (existingWork) {
            existingWork.text = (existingWork.text || '') + (event.text || '');
            existingWork.updatedAt = event.timestamp;
          } else {
            appendWorkItem(turn, {
              id: reasoningId,
              type: 'reasoning',
              representation: 'raw_text',
              text: event.text || '',
              status: 'streaming',
              createdAt: event.timestamp,
            });
          }
        }
        break;
      }
      case 'tool.started': {
        // V1
        const msg = (event.messageId && state.messages.find(m => m.id === event.messageId))
          || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
          || getOrCreateAssistantMsg(event.messageId);
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

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const existing = turn.work.find(w => w.id === event.toolId);
          if (!existing) {
            appendWorkItem(turn, {
              id: event.toolId,
              type: 'tool',
              toolName: event.toolName,
              kind: event.kind || 'command',
              title: event.title || event.toolName,
              status: 'active',
              input: event.input,
              createdAt: event.timestamp,
            });
          }
          setTurnStatus(turn, { status: 'active', detail: 'tool_execution', subjectId: event.toolId });
        }
        break;
      }
      case 'tool.updated': {
        // V1
        const msg = (event.toolId && state.messages.find(m => m.toolCalls?.some(t => t.id === event.toolId)))
          || (event.messageId && state.messages.find(m => m.id === event.messageId))
          || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
          || getOrCreateAssistantMsg(event.messageId);
        if (msg.toolCalls) {
          const tool = msg.toolCalls.find(t => t.id === event.toolId);
          if (tool) {
            if (event.output !== undefined) tool.output = event.output;
            if (event.input !== undefined) tool.input = event.input;
            if (event.status === 'running' || event.status === 'completed' || event.status === 'failed') {
              tool.status = event.status;
            }
          }
        }

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const existing = turn.work.find(w => w.id === event.toolId);
          if (existing && existing.type === 'tool') {
            const normalizedStatus = normalizeTransitionalToolStatus(event.status, 'active');
            updateWorkItem(turn, event.toolId, {
              ...(event.output !== undefined ? { output: event.output } : {}),
              status: normalizedStatus,
            });
          }
        }
        break;
      }
      case 'tool.completed': {
        // V1
        const msg = (event.toolId && state.messages.find(m => m.toolCalls?.some(t => t.id === event.toolId)))
          || (event.messageId && state.messages.find(m => m.id === event.messageId))
          || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
          || getOrCreateAssistantMsg(event.messageId);
        if (!msg.toolCalls) msg.toolCalls = [];
        let tool = msg.toolCalls.find(t => t.id === event.toolId);
        const resolvedStatus = (event.status === 'completed' || event.status === 'failed') ? event.status : 'failed';
        if (!tool) {
          tool = { id: event.toolId, name: event.toolName || 'tool', status: resolvedStatus };
          msg.toolCalls.push(tool);
        }
        if (event.output !== undefined) tool.output = event.output;
        tool.status = resolvedStatus;
        if (typeof event.durationMs === 'number') tool.durationMs = event.durationMs;

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const existing = turn.work.find(w => w.id === event.toolId);
          const validStatus = normalizeTransitionalToolStatus(event.status, 'completed');
          if (existing && existing.type === 'tool') {
            updateWorkItem(turn, event.toolId, {
              status: validStatus,
              ...(event.output !== undefined ? { output: event.output } : {}),
              ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
              ...(typeof event.exitCode === 'number' ? { exitCode: event.exitCode } : {}),
              ...(event.closureReason ? { closureReason: event.closureReason } : {}),
            });
          }
          const hasRemainingOpen = turn.work.some(w => w.type === 'tool' && (w.status === 'active' || w.status === 'queued'));
          if (!hasRemainingOpen && turn.status.status === 'active') {
            setTurnStatus(turn, { status: 'active', detail: 'processing' });
          }
        }
        break;
      }
      case 'interaction.requested': {
        // V1
        state.pendingInteraction = structuredClone(event.interaction);
        const msg = (event.messageId && state.messages.find(m => m.id === event.messageId))
          || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
          || getOrCreateAssistantMsg(event.messageId);
        msg.interaction = structuredClone(event.interaction);

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const existing = turn.work.find(w => w.id === event.interaction?.id);
          if (!existing && event.interaction) {
            appendWorkItem(turn, {
              id: event.interaction.id,
              type: 'interaction',
              interaction: structuredClone(event.interaction),
              status: 'pending',
              createdAt: event.timestamp,
            });
          }
          setTurnStatus(turn, {
            status: 'requiresAttention',
            reason: event.interaction?.kind || 'permission',
            interactionId: event.interaction?.id,
          });
        }
        break;
      }
      case 'interaction.resolved': {
        // V1
        delete state.pendingInteraction;
        const msg = (event.messageId && state.messages.find(m => m.id === event.messageId))
          || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
          || state.messages.find(m => m.interaction && m.interaction.id === event.interactionId);
        if (msg && msg.interaction && msg.interaction.id === event.interactionId) {
          if (event.response !== undefined) {
            msg.interaction.response = structuredClone(event.response);
          }
        }

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const existing = turn.work.find(w => w.id === event.interactionId);
          if (existing && existing.type === 'interaction') {
            updateWorkItem(turn, event.interactionId, {
              status: 'resolved',
              response: structuredClone(event.response),
              resolvedAt: event.timestamp,
            });
          }
          setTurnStatus(turn, { status: 'active', detail: 'processing' });
        }
        break;
      }
      case 'turn.completed': {
        delete state.activeTurn;
        completeRunningToolCalls(state, event.turnId);

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          closeDanglingTurnWork(turn, 'completed');
          // Complete streaming commentary
          for (const item of turn.work) {
            if (item.status === 'streaming') item.status = 'completed';
          }
          setTurnStatus(turn, {
            status: 'terminal',
            outcome: 'completed',
            initiator: 'provider',
          });
          turn.completedAt = event.timestamp;
          turn.updatedAt = event.timestamp;
        }
        break;
      }
      case 'turn.failed': {
        delete state.activeTurn;
        delete state.pendingInteraction;
        completeRunningToolCalls(state, event.turnId);

        if (event.error) {
          const msg = (event.messageId && state.messages.find(m => m.id === event.messageId))
            || (event.turnId && state.messages.find(m => m.turnId === event.turnId && m.role === 'assistant'))
            || getOrCreateAssistantMsg(event.messageId);
          msg.turnError = { code: event.error.code, message: event.error.message };
        }

        // V2 Canonical Turn Work
        if (event.turnId) {
          const turn = getOrCreateCanonicalTurn(event.turnId);
          const outcome = event.error?.code === 'AI_TURN_CANCELLED' ? 'cancelled' : 'failed';
          const initiator = outcome === 'cancelled' ? 'user' : 'provider';
          closeDanglingTurnWork(turn, outcome, event.error?.code);
          for (const item of turn.work) {
            if (item.status === 'streaming') item.status = 'completed';
          }
          setTurnStatus(turn, {
            status: 'terminal',
            outcome,
            initiator,
            cause: event.error?.code,
            ...(event.error ? { error: { code: event.error.code, message: event.error.message } } : {}),
          });
          turn.completedAt = event.timestamp;
          turn.updatedAt = event.timestamp;
        }
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
