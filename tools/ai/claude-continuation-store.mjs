import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AiError, AiValidationError } from './contracts.mjs';

export function canonicalize(val) {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalize);
  }
  const keys = Object.keys(val).sort();
  const res = {};
  for (const k of keys) {
    res[k] = canonicalize(val[k]);
  }
  return res;
}

export function canonicalToolFingerprint(toolName, toolInput) {
  const canonical = JSON.stringify({
    toolName,
    toolInput: canonicalize(toolInput || {}),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function continuationKey({ providerSessionId, toolUseId }) {
  if (!providerSessionId) {
    throw new AiValidationError('providerSessionId is required');
  }
  if (!toolUseId) {
    throw new AiValidationError('toolUseId is required for Claude continuation correlation');
  }
  return `${providerSessionId}:${toolUseId}`;
}

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

  #atomicWriteJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8');
    renameSync(tempPath, path);
  }

  saveDeferred({
    providerSessionId,
    interactionId,
    toolUseId,
    toolName,
    toolInput,
    kind = 'question',
  }) {
    if (!providerSessionId || !interactionId) {
      throw new AiValidationError('providerSessionId and interactionId are required to persist continuation.');
    }
    const fingerprint = canonicalToolFingerprint(toolName, toolInput);
    const record = {
      version: 1,
      providerSessionId,
      interactionId,
      toolUseId: toolUseId || null,
      toolName,
      toolInput: toolInput || {},
      toolFingerprint: fingerprint,
      kind,
      state: 'deferred',
      response: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveredAt: null,
    };
    this.#atomicWriteJson(this.#getFilePath(providerSessionId, interactionId), record);
    return record;
  }

  resolveResponse({ providerSessionId, interactionId, userResponse }) {
    const existing = this.getContinuation(providerSessionId, interactionId);
    if (!existing) {
      throw new AiError('AI_CONTINUATION_NOT_FOUND', `Continuation for ${providerSessionId}/${interactionId} not found.`);
    }
    existing.state = 'resolved';
    existing.response = userResponse;
    existing.updatedAt = new Date().toISOString();
    this.#atomicWriteJson(this.#getFilePath(providerSessionId, interactionId), existing);
    return existing;
  }

  markDelivered({ providerSessionId, interactionId, deliveredAt = new Date().toISOString() }) {
    const existing = this.getContinuation(providerSessionId, interactionId);
    if (!existing) return null;
    existing.state = 'delivered';
    existing.deliveredAt = deliveredAt;
    existing.updatedAt = new Date().toISOString();
    this.#atomicWriteJson(this.#getFilePath(providerSessionId, interactionId), existing);
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

  findMatchingContinuation({ providerSessionId, toolUseId, toolName, toolInput }) {
    if (!existsSync(this.#baseDir)) return null;
    const safePrefix = `${encodeURIComponent(providerSessionId)}__`;
    try {
      const files = readdirSync(this.#baseDir);
      for (const file of files) {
        if (!file.startsWith(safePrefix) || !file.endsWith('.json')) continue;
        const filePath = join(this.#baseDir, file);
        const raw = readFileSync(filePath, 'utf-8');
        const record = JSON.parse(raw);

        if (record.providerSessionId !== providerSessionId) continue;
        if (record.state !== 'resolved' && record.state !== 'delivered') continue;

        const fingerprint = canonicalToolFingerprint(toolName, toolInput);
        const matches = toolUseId
          ? record.toolUseId === toolUseId
          : record.toolFingerprint === fingerprint;


        if (matches) {
          return record;
        }
      }
    } catch {}
    return null;
  }

  complete({ providerSessionId, interactionId }) {
    const filePath = this.#getFilePath(providerSessionId, interactionId);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
  }
}

export function createClaudeContinuationStore(options) {
  return new ClaudeContinuationStore(options);
}
