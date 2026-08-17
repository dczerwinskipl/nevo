import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AiValidationError,
  normalizeTimestamp,
  validateAgentIdentity,
} from './contracts.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAgentExecutionContext(env = process.env) {
  const provider = env.NEVO_AGENT_PROVIDER?.trim();
  const providerSessionId = env.NEVO_AGENT_PROVIDER_SESSION_ID?.trim();
  if (provider && providerSessionId) {
    return { provider, providerSessionId };
  }
  return null;
}

export class AgentSessionBindingService {
  #storageFile;
  #cache = null;

  constructor({ storageFile = resolve(process.cwd(), '.nevo-ai-local/sessions.json') } = {}) {
    this.#storageFile = storageFile;
  }

  async #load() {
    if (this.#cache !== null) return this.#cache;
    try {
      const content = await readFile(this.#storageFile, 'utf-8');
      const parsed = JSON.parse(content);
      this.#cache = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.#cache = [];
    }
    return this.#cache;
  }

  #loadSync() {
    if (this.#cache !== null) return this.#cache;
    try {
      if (existsSync(this.#storageFile)) {
        const content = readFileSync(this.#storageFile, 'utf-8');
        const parsed = JSON.parse(content);
        this.#cache = Array.isArray(parsed) ? parsed : [];
      } else {
        this.#cache = [];
      }
    } catch {
      this.#cache = [];
    }
    return this.#cache;
  }

  async #persist() {
    const list = this.#cache || [];
    await mkdir(dirname(this.#storageFile), { recursive: true });
    const tempFile = `${this.#storageFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    await rename(tempFile, this.#storageFile);
  }

  #persistSync() {
    const list = this.#cache || [];
    mkdirSync(dirname(this.#storageFile), { recursive: true });
    const tempFile = `${this.#storageFile}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    renameSync(tempFile, this.#storageFile);
  }

  async bindSession({ provider, providerSessionId, specId, taskId, purpose, createdAt, lastSeenAt } = {}) {
    const identity = validateAgentIdentity({ provider, providerSessionId });
    if (!specId || typeof specId !== 'string' || !UUID_RE.test(specId)) {
      throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
    }
    if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim().length === 0)) {
      throw new AiValidationError("'taskId' must be a non-empty string when provided.", { field: 'taskId' });
    }

    const now = new Date().toISOString();
    const bindings = await this.#load();

    // Check for exact match on (provider, providerSessionId, specId)
    const exactTaskMatch = bindings.find(b =>
      b.provider === identity.provider &&
      b.providerSessionId === identity.providerSessionId &&
      b.specId === specId &&
      (b.taskId || undefined) === (taskId || undefined)
    );

    if (exactTaskMatch) {
      exactTaskMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
      if (purpose !== undefined) exactTaskMatch.purpose = purpose;
      await this.#persist();
      return structuredClone(exactTaskMatch);
    }

    // If binding has a taskId and a spec-only binding exists for this session, specialize/upgrade it
    if (taskId) {
      const specOnlyMatch = bindings.find(b =>
        b.provider === identity.provider &&
        b.providerSessionId === identity.providerSessionId &&
        b.specId === specId &&
        !b.taskId
      );
      if (specOnlyMatch) {
        specOnlyMatch.taskId = taskId;
        specOnlyMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) specOnlyMatch.purpose = purpose;
        await this.#persist();
        return structuredClone(specOnlyMatch);
      }
    }

    // If binding is spec-only and a task-scoped binding already exists for this session, update lastSeenAt
    if (!taskId) {
      const existingSessionMatch = bindings.find(b =>
        b.provider === identity.provider &&
        b.providerSessionId === identity.providerSessionId &&
        b.specId === specId
      );
      if (existingSessionMatch) {
        existingSessionMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) existingSessionMatch.purpose = purpose;
        await this.#persist();
        return structuredClone(existingSessionMatch);
      }
    }

    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      specId,
      ...(taskId ? { taskId } : {}),
      ...(purpose ? { purpose } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    bindings.push(newBinding);
    await this.#persist();
    return structuredClone(newBinding);
  }

  bindSessionSync({ provider, providerSessionId, specId, taskId, purpose, createdAt, lastSeenAt } = {}) {
    const identity = validateAgentIdentity({ provider, providerSessionId });
    if (!specId || typeof specId !== 'string' || !UUID_RE.test(specId)) {
      throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
    }
    if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim().length === 0)) {
      throw new AiValidationError("'taskId' must be a non-empty string when provided.", { field: 'taskId' });
    }

    const now = new Date().toISOString();
    const bindings = this.#loadSync();

    const exactTaskMatch = bindings.find(b =>
      b.provider === identity.provider &&
      b.providerSessionId === identity.providerSessionId &&
      b.specId === specId &&
      (b.taskId || undefined) === (taskId || undefined)
    );

    if (exactTaskMatch) {
      exactTaskMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
      if (purpose !== undefined) exactTaskMatch.purpose = purpose;
      this.#persistSync();
      return structuredClone(exactTaskMatch);
    }

    if (taskId) {
      const specOnlyMatch = bindings.find(b =>
        b.provider === identity.provider &&
        b.providerSessionId === identity.providerSessionId &&
        b.specId === specId &&
        !b.taskId
      );
      if (specOnlyMatch) {
        specOnlyMatch.taskId = taskId;
        specOnlyMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) specOnlyMatch.purpose = purpose;
        this.#persistSync();
        return structuredClone(specOnlyMatch);
      }
    }

    if (!taskId) {
      const existingSessionMatch = bindings.find(b =>
        b.provider === identity.provider &&
        b.providerSessionId === identity.providerSessionId &&
        b.specId === specId
      );
      if (existingSessionMatch) {
        existingSessionMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) existingSessionMatch.purpose = purpose;
        this.#persistSync();
        return structuredClone(existingSessionMatch);
      }
    }

    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      specId,
      ...(taskId ? { taskId } : {}),
      ...(purpose ? { purpose } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    bindings.push(newBinding);
    this.#persistSync();
    return structuredClone(newBinding);
  }

  async listBindings(query = {}) {
    const bindings = await this.#load();
    return bindings.filter(b => {
      if (query.specId && b.specId !== query.specId) return false;
      if (query.taskId && b.taskId !== query.taskId) return false;
      if (query.provider && b.provider !== query.provider) return false;
      if (query.providerSessionId && b.providerSessionId !== query.providerSessionId) return false;
      return true;
    }).map(b => structuredClone(b));
  }

  listBindingsSync(query = {}) {
    const bindings = this.#loadSync();
    return bindings.filter(b => {
      if (query.specId && b.specId !== query.specId) return false;
      if (query.taskId && b.taskId !== query.taskId) return false;
      if (query.provider && b.provider !== query.provider) return false;
      if (query.providerSessionId && b.providerSessionId !== query.providerSessionId) return false;
      return true;
    }).map(b => structuredClone(b));
  }

  async getBinding(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const bindings = await this.#load();
    const match = bindings.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    return match ? structuredClone(match) : null;
  }

  async unbindSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const bindings = await this.#load();
    const initialLen = bindings.length;
    const filtered = bindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
    if (filtered.length !== initialLen) {
      this.#cache = filtered;
      await this.#persist();
    }
  }

  unbindSessionSync(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const bindings = this.#loadSync();
    const initialLen = bindings.length;
    const filtered = bindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
    if (filtered.length !== initialLen) {
      this.#cache = filtered;
      this.#persistSync();
    }
  }
}

export function createAgentSessionBindingService(options) {
  return new AgentSessionBindingService(options);
}
