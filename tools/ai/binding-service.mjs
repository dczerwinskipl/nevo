import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AiValidationError,
  normalizeTimestamp,
  validateAgentIdentity,
  validateAgentExecutionMode,
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
  #storageFile = null;
  #storageDir = null;
  #cache = new Map(); // specId -> bindings[] or '__all__' for singleFile

  constructor({
    storageFile,
    storageDir = resolve(process.cwd(), '.nevo-ai-local/sessions'),
  } = {}) {
    if (storageFile) {
      this.#storageFile = storageFile;
    } else {
      this.#storageDir = storageDir;
    }
  }

  get storageDir() {
    return this.#storageDir;
  }

  async #migrateLegacyIfNeeded() {
    if (this.#storageFile) return;
    const legacyFile = resolve(dirname(this.#storageDir), 'sessions.json');
    try {
      if (existsSync(legacyFile)) {
        const content = await readFile(legacyFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          await mkdir(this.#storageDir, { recursive: true });
          const bySpec = new Map();
          for (const item of parsed) {
            if (!item.specId) continue;
            if (!bySpec.has(item.specId)) bySpec.set(item.specId, []);
            bySpec.get(item.specId).push(item);
          }
          for (const [specId, items] of bySpec.entries()) {
            const specFile = join(this.#storageDir, `${specId}.json`);
            const tempFile = `${specFile}.${randomUUID()}.tmp`;
            await writeFile(tempFile, JSON.stringify(items, null, 2), 'utf-8');
            await rename(tempFile, specFile);
          }
        }
        await unlink(legacyFile).catch(() => {});
      }
    } catch {
      // Ignore migration errors and continue
    }
  }

  #migrateLegacyIfNeededSync() {
    if (this.#storageFile) return;
    const legacyFile = resolve(dirname(this.#storageDir), 'sessions.json');
    try {
      if (existsSync(legacyFile)) {
        const content = readFileSync(legacyFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          mkdirSync(this.#storageDir, { recursive: true });
          const bySpec = new Map();
          for (const item of parsed) {
            if (!item.specId) continue;
            if (!bySpec.has(item.specId)) bySpec.set(item.specId, []);
            bySpec.get(item.specId).push(item);
          }
          for (const [specId, items] of bySpec.entries()) {
            const specFile = join(this.#storageDir, `${specId}.json`);
            const tempFile = `${specFile}.${randomUUID()}.tmp`;
            writeFileSync(tempFile, JSON.stringify(items, null, 2), 'utf-8');
            renameSync(tempFile, specFile);
          }
        }
        try { unlinkSync(legacyFile); } catch {}
      }
    } catch {
      // Ignore migration errors and continue
    }
  }

  async #loadForSpec(specId) {
    if (this.#storageFile) {
      if (this.#cache.has('__single__')) {
        return this.#cache.get('__single__');
      }
      try {
        const content = await readFile(this.#storageFile, 'utf-8');
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : [];
        this.#cache.set('__single__', list);
        return list;
      } catch {
        const list = [];
        this.#cache.set('__single__', list);
        return list;
      }
    }

    await this.#migrateLegacyIfNeeded();

    if (specId) {
      if (this.#cache.has(specId)) return this.#cache.get(specId);
      const specFile = join(this.#storageDir, `${specId}.json`);
      try {
        const content = await readFile(specFile, 'utf-8');
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : [];
        this.#cache.set(specId, list);
        return list;
      } catch {
        const list = [];
        this.#cache.set(specId, list);
        return list;
      }
    }

    // Load all specs
    try {
      if (!existsSync(this.#storageDir)) return [];
      const files = await readdir(this.#storageDir);
      const all = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const currentSpecId = file.slice(0, -5);
        const list = await this.#loadForSpec(currentSpecId);
        all.push(...list);
      }
      return all;
    } catch {
      return [];
    }
  }

  #loadForSpecSync(specId) {
    if (this.#storageFile) {
      if (this.#cache.has('__single__')) {
        return this.#cache.get('__single__');
      }
      try {
        if (existsSync(this.#storageFile)) {
          const content = readFileSync(this.#storageFile, 'utf-8');
          const parsed = JSON.parse(content);
          const list = Array.isArray(parsed) ? parsed : [];
          this.#cache.set('__single__', list);
          return list;
        }
        const list = [];
        this.#cache.set('__single__', list);
        return list;
      } catch {
        const list = [];
        this.#cache.set('__single__', list);
        return list;
      }
    }

    this.#migrateLegacyIfNeededSync();

    if (specId) {
      if (this.#cache.has(specId)) return this.#cache.get(specId);
      const specFile = join(this.#storageDir, `${specId}.json`);
      try {
        if (existsSync(specFile)) {
          const content = readFileSync(specFile, 'utf-8');
          const parsed = JSON.parse(content);
          const list = Array.isArray(parsed) ? parsed : [];
          this.#cache.set(specId, list);
          return list;
        }
        const list = [];
        this.#cache.set(specId, list);
        return list;
      } catch {
        const list = [];
        this.#cache.set(specId, list);
        return list;
      }
    }

    try {
      if (!existsSync(this.#storageDir)) return [];
      const files = readdirSync(this.#storageDir);
      const all = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const currentSpecId = file.slice(0, -5);
        const list = this.#loadForSpecSync(currentSpecId);
        all.push(...list);
      }
      return all;
    } catch {
      return [];
    }
  }

  async #persistForSpec(specId, list) {
    if (this.#storageFile) {
      const all = this.#cache.get('__single__') || list || [];
      await mkdir(dirname(this.#storageFile), { recursive: true });
      const tempFile = `${this.#storageFile}.${randomUUID()}.tmp`;
      await writeFile(tempFile, JSON.stringify(all, null, 2), 'utf-8');
      await rename(tempFile, this.#storageFile);
      return;
    }

    this.#cache.set(specId, list);
    await mkdir(this.#storageDir, { recursive: true });
    const specFile = join(this.#storageDir, `${specId}.json`);
    const tempFile = `${specFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    await rename(tempFile, specFile);
  }

  #persistForSpecSync(specId, list) {
    if (this.#storageFile) {
      const all = this.#cache.get('__single__') || list || [];
      mkdirSync(dirname(this.#storageFile), { recursive: true });
      const tempFile = `${this.#storageFile}.${randomUUID()}.tmp`;
      writeFileSync(tempFile, JSON.stringify(all, null, 2), 'utf-8');
      renameSync(tempFile, this.#storageFile);
      return;
    }

    this.#cache.set(specId, list);
    mkdirSync(this.#storageDir, { recursive: true });
    const specFile = join(this.#storageDir, `${specId}.json`);
    const tempFile = `${specFile}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    renameSync(tempFile, specFile);
  }

  async bindSession({ provider, providerSessionId, specId, taskId, purpose, mode, createdAt, lastSeenAt } = {}) {
    const identity = validateAgentIdentity({ provider, providerSessionId });
    if (!specId || typeof specId !== 'string' || !UUID_RE.test(specId)) {
      throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
    }
    if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim().length === 0)) {
      throw new AiValidationError("'taskId' must be a non-empty string when provided.", { field: 'taskId' });
    }
    if (mode !== undefined) {
      validateAgentExecutionMode(mode, 'mode');
    }

    const now = new Date().toISOString();
    const bindings = await this.#loadForSpec(specId);

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
      if (mode !== undefined) exactTaskMatch.mode = mode;
      await this.#persistForSpec(specId, bindings);
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
        if (mode !== undefined) specOnlyMatch.mode = mode;
        await this.#persistForSpec(specId, bindings);
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
        if (mode !== undefined) existingSessionMatch.mode = mode;
        await this.#persistForSpec(specId, bindings);
        return structuredClone(existingSessionMatch);
      }
    }

    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      specId,
      ...(taskId ? { taskId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(mode ? { mode } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    bindings.push(newBinding);
    await this.#persistForSpec(specId, bindings);
    return structuredClone(newBinding);
  }

  bindSessionSync({ provider, providerSessionId, specId, taskId, purpose, mode, createdAt, lastSeenAt } = {}) {
    const identity = validateAgentIdentity({ provider, providerSessionId });
    if (!specId || typeof specId !== 'string' || !UUID_RE.test(specId)) {
      throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
    }
    if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim().length === 0)) {
      throw new AiValidationError("'taskId' must be a non-empty string when provided.", { field: 'taskId' });
    }
    if (mode !== undefined) {
      validateAgentExecutionMode(mode, 'mode');
    }

    const now = new Date().toISOString();
    const bindings = this.#loadForSpecSync(specId);

    const exactTaskMatch = bindings.find(b =>
      b.provider === identity.provider &&
      b.providerSessionId === identity.providerSessionId &&
      b.specId === specId &&
      (b.taskId || undefined) === (taskId || undefined)
    );

    if (exactTaskMatch) {
      exactTaskMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
      if (purpose !== undefined) exactTaskMatch.purpose = purpose;
      if (mode !== undefined) exactTaskMatch.mode = mode;
      this.#persistForSpecSync(specId, bindings);
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
        if (mode !== undefined) specOnlyMatch.mode = mode;
        this.#persistForSpecSync(specId, bindings);
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
        if (mode !== undefined) existingSessionMatch.mode = mode;
        this.#persistForSpecSync(specId, bindings);
        return structuredClone(existingSessionMatch);
      }
    }

    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      specId,
      ...(taskId ? { taskId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(mode ? { mode } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    bindings.push(newBinding);
    this.#persistForSpecSync(specId, bindings);
    return structuredClone(newBinding);
  }

  async updateSessionMode(provider, providerSessionId, mode) {
    validateAgentIdentity({ provider, providerSessionId });
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const all = await this.#loadForSpec();
    const target = all.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (!target) return null;
    const specId = target.specId;
    const specBindings = await this.#loadForSpec(specId);
    const matches = specBindings.filter(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.mode = validatedMode;
        match.lastSeenAt = now;
      }
      await this.#persistForSpec(specId, specBindings);
      return structuredClone(matches[0]);
    }
    return null;
  }

  updateSessionModeSync(provider, providerSessionId, mode) {
    validateAgentIdentity({ provider, providerSessionId });
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const all = this.#loadForSpecSync();
    const target = all.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (!target) return null;
    const specId = target.specId;
    const specBindings = this.#loadForSpecSync(specId);
    const matches = specBindings.filter(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.mode = validatedMode;
        match.lastSeenAt = now;
      }
      this.#persistForSpecSync(specId, specBindings);
      return structuredClone(matches[0]);
    }
    return null;
  }

  async listBindings(query = {}) {
    const bindings = await this.#loadForSpec(query.specId);
    return bindings.filter(b => {
      if (query.specId && b.specId !== query.specId) return false;
      if (query.taskId && b.taskId !== query.taskId) return false;
      if (query.provider && b.provider !== query.provider) return false;
      if (query.providerSessionId && b.providerSessionId !== query.providerSessionId) return false;
      return true;
    }).map(b => structuredClone(b));
  }

  listBindingsSync(query = {}) {
    const bindings = this.#loadForSpecSync(query.specId);
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
    const bindings = await this.#loadForSpec();
    const match = bindings.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    return match ? structuredClone(match) : null;
  }

  async unbindSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.#storageFile) {
      const bindings = await this.#loadForSpec();
      const initialLen = bindings.length;
      const filtered = bindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
      if (filtered.length !== initialLen) {
        this.#cache.set('__single__', filtered);
        await this.#persistForSpec(null, filtered);
      }
      return;
    }

    const all = await this.#loadForSpec();
    const target = all.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (!target) return;
    const specId = target.specId;
    const specBindings = await this.#loadForSpec(specId);
    const filtered = specBindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
    await this.#persistForSpec(specId, filtered);
  }

  unbindSessionSync(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    if (this.#storageFile) {
      const bindings = this.#loadForSpecSync();
      const initialLen = bindings.length;
      const filtered = bindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
      if (filtered.length !== initialLen) {
        this.#cache.set('__single__', filtered);
        this.#persistForSpecSync(null, filtered);
      }
      return;
    }

    const all = this.#loadForSpecSync();
    const target = all.find(b => b.provider === provider && b.providerSessionId === providerSessionId);
    if (!target) return;
    const specId = target.specId;
    const specBindings = this.#loadForSpecSync(specId);
    const filtered = specBindings.filter(b => !(b.provider === provider && b.providerSessionId === providerSessionId));
    this.#persistForSpecSync(specId, filtered);
  }
}

export function createAgentSessionBindingService(options) {
  return new AgentSessionBindingService(options);
}
