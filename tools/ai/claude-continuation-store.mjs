import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiError } from './contracts.mjs';

export class ClaudeContinuationStore {
  #baseDir;

  constructor({ baseDir = join(process.cwd(), '.nevo-ai-local', 'transcripts', 'claude', 'continuations') } = {}) {
    this.#baseDir = baseDir;
  }

  #getFilePath(providerSessionId, interactionId) {
    const safeSessionId = encodeURIComponent(providerSessionId);
    const safeInteractionId = encodeURIComponent(interactionId);
    return join(this.#baseDir, `${safeSessionId}__${safeInteractionId}.json`);
  }

  saveDeferred({ providerSessionId, interactionId, toolUseId, toolName, originalToolInput }) {
    if (!providerSessionId || !interactionId) {
      throw new AiError('AI_CONTINUATION_ERROR', 'providerSessionId and interactionId are required to persist continuation.');
    }
    const record = {
      providerSessionId,
      interactionId,
      toolUseId,
      toolName,
      originalToolInput,
      state: 'deferred',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.#writeAtomic(this.#getFilePath(providerSessionId, interactionId), record);
    return record;
  }

  resolveResponse({ providerSessionId, interactionId, userResponse }) {
    const existing = this.getContinuation(providerSessionId, interactionId);
    if (!existing) {
      throw new AiError('AI_CONTINUATION_NOT_FOUND', `Continuation for ${providerSessionId}/${interactionId} not found.`);
    }
    existing.state = 'resolved';
    existing.userResponse = userResponse;
    existing.updatedAt = new Date().toISOString();
    this.#writeAtomic(this.#getFilePath(providerSessionId, interactionId), existing);
    return existing;
  }

  getContinuation(providerSessionId, interactionId) {
    const filePath = this.#getFilePath(providerSessionId, interactionId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  findMatchingContinuation({ providerSessionId, toolUseId, toolName }) {
    if (!existsSync(this.#baseDir)) return null;
    const safePrefix = `${encodeURIComponent(providerSessionId)}__`;
    try {
      const files = readdirSync(this.#baseDir);
      for (const file of files) {
        if (!file.startsWith(safePrefix) || !file.endsWith('.json')) continue;
        const filePath = join(this.#baseDir, file);
        const raw = readFileSync(filePath, 'utf-8');
        const record = JSON.parse(raw);
        if (record.providerSessionId === providerSessionId && record.state === 'resolved') {
          if (!toolUseId || record.toolUseId === toolUseId || record.toolName === toolName) {
            return record;
          }
        }
      }
    } catch {}
    return null;
  }

  consumeContinuation({ providerSessionId, interactionId }) {
    const filePath = this.#getFilePath(providerSessionId, interactionId);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
  }

  #writeAtomic(filePath, data) {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }
}

export function createClaudeContinuationStore(options) {
  return new ClaudeContinuationStore(options);
}
