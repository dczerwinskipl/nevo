import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AiValidationError,
  normalizeTimestamp,
  validateAgentIdentity,
  validateAgentExecutionMode,
} from '../contracts.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Deterministic comparison for ranking session bindings to determine current association (D10 Option C).
 * Primary criterion: newest lastSeenAt (descending timestamp).
 * Tie-breaker 1: newest createdAt (descending timestamp).
 * Tie-breaker 2: stable alphabetical specId ascending (localeCompare).
 * Tie-breaker 3: stable alphabetical taskId ascending (localeCompare).
 */
export function compareBindingRecency(a, b) {
  const timeA = new Date(a.lastSeenAt || a.createdAt || 0).getTime();
  const timeB = new Date(b.lastSeenAt || b.createdAt || 0).getTime();
  if (timeA !== timeB) {
    return timeB - timeA;
  }

  const createdA = new Date(a.createdAt || 0).getTime();
  const createdB = new Date(b.createdAt || 0).getTime();
  if (createdA !== createdB) {
    return createdB - createdA;
  }

  const specComp = (a.specId || '').localeCompare(b.specId || '');
  if (specComp !== 0) {
    return specComp;
  }

  return (a.taskId || '').localeCompare(b.taskId || '');
}
 
export async function writeCodexExecutionContextBridge(repoRoot, threadId, { nevoSessionId, specId, taskId, activeTaskId } = {}) {
  if (!repoRoot || !threadId) return;
  const bridgeDir = resolve(repoRoot, '.nevo-ai-local', 'codex-context');
  await mkdir(bridgeDir, { recursive: true });
  const payload = JSON.stringify(
    {
      threadId,
      nevoSessionId,
      specId,
      taskId: activeTaskId || taskId,
      activeTaskId: activeTaskId || taskId,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const threadPath = join(bridgeDir, `${threadId}.json`);
  const tmpThreadPath = `${threadPath}.${randomUUID()}.tmp`;
  await writeFile(tmpThreadPath, payload, 'utf-8');
  await rename(tmpThreadPath, threadPath);

  const effTask = activeTaskId || taskId;
  if (specId && effTask) {
    const taskPath = join(bridgeDir, `${specId}-${effTask}.json`);
    const tmpTaskPath = `${taskPath}.${randomUUID()}.tmp`;
    await writeFile(tmpTaskPath, payload, 'utf-8');
    await rename(tmpTaskPath, taskPath);
  }
}

export async function removeCodexExecutionContextBridge(repoRoot, threadId, { specId, taskId, activeTaskId } = {}) {
  if (!repoRoot) return;
  const bridgeDir = resolve(repoRoot, '.nevo-ai-local', 'codex-context');
  try {
    if (threadId) {
      await unlink(join(bridgeDir, `${threadId}.json`)).catch(() => {});
    }
    const effTask = activeTaskId || taskId;
    if (specId && effTask) {
      await unlink(join(bridgeDir, `${specId}-${effTask}.json`)).catch(() => {});
    }
  } catch {}
}

export function readCodexExecutionContextBridgeSync(repoRoot, { specId, taskId, threadId } = {}) {
  if (!repoRoot) return null;
  const bridgeDir = resolve(repoRoot, '.nevo-ai-local', 'codex-context');
  let filePath = null;
  if (threadId) {
    filePath = join(bridgeDir, `${threadId}.json`);
  } else if (specId && taskId) {
    filePath = join(bridgeDir, `${specId}-${taskId}.json`);
  }
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readAgentExecutionContext(envOrOpts = process.env, opts = {}) {
  let env = process.env;
  let repoRoot = null;
  let specId = null;
  let taskId = null;

  if (envOrOpts && typeof envOrOpts === 'object') {
    if (
      'NEVO_AGENT_PROVIDER' in envOrOpts ||
      'NEVO_SESSION_ID' in envOrOpts ||
      'NEVO_AGENT_PROVIDER_SESSION_ID' in envOrOpts
    ) {
      env = envOrOpts;
      repoRoot = opts.repoRoot;
      specId = opts.specId;
      taskId = opts.taskId;
    } else {
      env = envOrOpts.env || process.env;
      repoRoot = envOrOpts.repoRoot;
      specId = envOrOpts.specId;
      taskId = envOrOpts.taskId;
    }
  }

  const provider = env.NEVO_AGENT_PROVIDER?.trim();
  const sessionId = env.NEVO_SESSION_ID?.trim();
  const providerSessionId = env.NEVO_AGENT_PROVIDER_SESSION_ID?.trim();

  if (provider && (providerSessionId || sessionId)) {
    return {
      provider,
      providerSessionId: providerSessionId || sessionId,
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (sessionId) {
    return {
      provider: provider || 'unknown',
      providerSessionId: providerSessionId || sessionId,
      sessionId,
    };
  }

  // Codex bridge fallback: when NEVO_AGENT_PROVIDER === 'codex' and persistent app-server has no per-thread env
  if (provider === 'codex' && repoRoot) {
    const bridge = readCodexExecutionContextBridgeSync(repoRoot, { specId, taskId, threadId: providerSessionId });
    if (bridge?.nevoSessionId) {
      return {
        provider: 'codex',
        providerSessionId: bridge.threadId || bridge.nevoSessionId,
        sessionId: bridge.nevoSessionId,
      };
    }
  }

  return null;
}

export class AgentSessionBindingService {
  #storageFile = null;
  #storageDir = null;
  #cache = new Map(); // specId -> bindings[] or '__all__' for singleFile

  constructor({ storageFile, storageDir = resolve(process.cwd(), '.nevo-ai-local/sessions') } = {}) {
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
        try {
          unlinkSync(legacyFile);
        } catch {}
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

  async bindSession({
    provider,
    providerSessionId,
    sessionId,
    specId,
    taskId,
    step,
    attempt,
    purpose,
    mode,
    model,
    createdAt,
    lastSeenAt,
    established,
    activeTaskId,
    taskIds,
  } = {}) {
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
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      throw new AiValidationError("'model' must be a non-empty string when provided.", { field: 'model' });
    }

    const now = new Date().toISOString();
    const bindings = await this.#loadForSpec(specId);

    const existingSessionBindings = bindings.filter(
      (b) =>
        b.provider === identity.provider &&
        (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
        b.specId === specId,
    );
    const accumulatedTaskIds = Array.from(
      new Set([
        ...existingSessionBindings.flatMap((b) => (Array.isArray(b.taskIds) ? b.taskIds : b.taskId ? [b.taskId] : [])),
        ...(Array.isArray(taskIds) ? taskIds : taskId ? [taskId] : []),
      ]),
    );

    // Check for exact match on (provider, providerSessionId, specId)
    const exactTaskMatch = bindings.find(
      (b) =>
        b.provider === identity.provider &&
        (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
        b.specId === specId &&
        (b.taskId || undefined) === (taskId || undefined),
    );

    if (exactTaskMatch) {
      exactTaskMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
      if (sessionId !== undefined) exactTaskMatch.sessionId = sessionId;
      if (purpose !== undefined) exactTaskMatch.purpose = purpose;
      if (step !== undefined) exactTaskMatch.step = step;
      if (attempt !== undefined) exactTaskMatch.attempt = attempt;
      if (mode !== undefined) exactTaskMatch.mode = mode;
      if (model !== undefined) exactTaskMatch.model = model.trim();
      const resolvedActive = activeTaskId !== undefined ? activeTaskId : (taskId || exactTaskMatch.activeTaskId);
      if (resolvedActive !== undefined) exactTaskMatch.activeTaskId = resolvedActive;
      exactTaskMatch.taskIds = accumulatedTaskIds;
      for (const b of existingSessionBindings) {
        b.taskIds = accumulatedTaskIds;
        if (resolvedActive !== undefined) b.activeTaskId = resolvedActive;
      }
      if (established !== undefined) {
        if (established === false) exactTaskMatch.established = false;
        else delete exactTaskMatch.established;
      }
      await this.#persistForSpec(specId, bindings);
      return structuredClone(exactTaskMatch);
    }

    // If binding has a taskId and a spec-only binding exists for this session, specialize/upgrade it
    if (taskId) {
      const specOnlyMatch = bindings.find(
        (b) =>
          b.provider === identity.provider &&
          (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
          b.specId === specId &&
          !b.taskId,
      );
      if (specOnlyMatch) {
        specOnlyMatch.taskId = taskId;
        specOnlyMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (sessionId !== undefined) specOnlyMatch.sessionId = sessionId;
        if (purpose !== undefined) specOnlyMatch.purpose = purpose;
        if (step !== undefined) specOnlyMatch.step = step;
        if (attempt !== undefined) specOnlyMatch.attempt = attempt;
        if (mode !== undefined) specOnlyMatch.mode = mode;
        if (model !== undefined) specOnlyMatch.model = model.trim();
        const resolvedActive = activeTaskId !== undefined ? activeTaskId : (taskId || specOnlyMatch.activeTaskId);
        if (resolvedActive !== undefined) specOnlyMatch.activeTaskId = resolvedActive;
        specOnlyMatch.taskIds = accumulatedTaskIds;
        for (const b of existingSessionBindings) {
          b.taskIds = accumulatedTaskIds;
          if (resolvedActive !== undefined) b.activeTaskId = resolvedActive;
        }
        if (established !== undefined) {
          if (established === false) specOnlyMatch.established = false;
          else delete specOnlyMatch.established;
        }
        await this.#persistForSpec(specId, bindings);
        return structuredClone(specOnlyMatch);
      }
    }

    // If binding is spec-only and a task-scoped binding already exists for this session, update lastSeenAt
    if (!taskId) {
      const existingSessionMatch = bindings.find(
        (b) =>
          b.provider === identity.provider &&
          (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
          b.specId === specId,
      );
      if (existingSessionMatch) {
        existingSessionMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (sessionId !== undefined) existingSessionMatch.sessionId = sessionId;
        if (purpose !== undefined) existingSessionMatch.purpose = purpose;
        if (step !== undefined) existingSessionMatch.step = step;
        if (attempt !== undefined) existingSessionMatch.attempt = attempt;
        if (mode !== undefined) existingSessionMatch.mode = mode;
        if (model !== undefined) existingSessionMatch.model = model.trim();
        if (activeTaskId !== undefined) existingSessionMatch.activeTaskId = activeTaskId;
        existingSessionMatch.taskIds = accumulatedTaskIds;
        for (const b of existingSessionBindings) {
          b.taskIds = accumulatedTaskIds;
          if (activeTaskId !== undefined) b.activeTaskId = activeTaskId;
        }
        if (established !== undefined) {
          if (established === false) existingSessionMatch.established = false;
          else delete existingSessionMatch.established;
        }
        await this.#persistForSpec(specId, bindings);
        return structuredClone(existingSessionMatch);
      }
    }

    const resolvedActiveTaskId = activeTaskId !== undefined ? activeTaskId : (taskId || undefined);
    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      ...(sessionId ? { sessionId } : {}),
      specId,
      ...(taskId ? { taskId } : {}),
      ...(step ? { step } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
      ...(purpose ? { purpose } : {}),
      ...(mode ? { mode } : {}),
      ...(model ? { model: model.trim() } : {}),
      ...(resolvedActiveTaskId ? { activeTaskId: resolvedActiveTaskId } : {}),
      ...(accumulatedTaskIds.length > 0 ? { taskIds: accumulatedTaskIds } : {}),
      ...(established === false ? { established: false } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    for (const b of existingSessionBindings) {
      b.taskIds = accumulatedTaskIds;
      if (resolvedActiveTaskId) b.activeTaskId = resolvedActiveTaskId;
    }
    bindings.push(newBinding);
    await this.#persistForSpec(specId, bindings);
    return structuredClone(newBinding);
  }

  bindSessionSync({
    provider,
    providerSessionId,
    sessionId,
    specId,
    taskId,
    step,
    attempt,
    purpose,
    mode,
    model,
    createdAt,
    lastSeenAt,
    established,
    activeTaskId,
    taskIds,
  } = {}) {
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
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      throw new AiValidationError("'model' must be a non-empty string when provided.", { field: 'model' });
    }

    const now = new Date().toISOString();
    const bindings = this.#loadForSpecSync(specId);

    const existingSessionBindings = bindings.filter(
      (b) =>
        b.provider === identity.provider &&
        (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
        b.specId === specId,
    );
    const accumulatedTaskIds = Array.from(
      new Set([
        ...existingSessionBindings.flatMap((b) => (Array.isArray(b.taskIds) ? b.taskIds : b.taskId ? [b.taskId] : [])),
        ...(Array.isArray(taskIds) ? taskIds : taskId ? [taskId] : []),
      ]),
    );

    const exactTaskMatch = bindings.find(
      (b) =>
        b.provider === identity.provider &&
        (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
        b.specId === specId &&
        (b.taskId || undefined) === (taskId || undefined),
    );

    if (exactTaskMatch) {
      exactTaskMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
      if (sessionId !== undefined) exactTaskMatch.sessionId = sessionId;
      if (purpose !== undefined) exactTaskMatch.purpose = purpose;
      if (step !== undefined) exactTaskMatch.step = step;
      if (attempt !== undefined) exactTaskMatch.attempt = attempt;
      if (mode !== undefined) exactTaskMatch.mode = mode;
      if (model !== undefined) exactTaskMatch.model = model.trim();
      const resolvedActive = activeTaskId !== undefined ? activeTaskId : (taskId || exactTaskMatch.activeTaskId);
      if (resolvedActive !== undefined) exactTaskMatch.activeTaskId = resolvedActive;
      exactTaskMatch.taskIds = accumulatedTaskIds;
      for (const b of existingSessionBindings) {
        b.taskIds = accumulatedTaskIds;
        if (resolvedActive !== undefined) b.activeTaskId = resolvedActive;
      }
      if (established !== undefined) {
        if (established === false) exactTaskMatch.established = false;
        else delete exactTaskMatch.established;
      }
      this.#persistForSpecSync(specId, bindings);
      return structuredClone(exactTaskMatch);
    }

    if (taskId) {
      const specOnlyMatch = bindings.find(
        (b) =>
          b.provider === identity.provider &&
          (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
          b.specId === specId &&
          !b.taskId,
      );
      if (specOnlyMatch) {
        specOnlyMatch.taskId = taskId;
        specOnlyMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (sessionId !== undefined) specOnlyMatch.sessionId = sessionId;
        if (purpose !== undefined) specOnlyMatch.purpose = purpose;
        if (step !== undefined) specOnlyMatch.step = step;
        if (attempt !== undefined) specOnlyMatch.attempt = attempt;
        if (mode !== undefined) specOnlyMatch.mode = mode;
        if (model !== undefined) specOnlyMatch.model = model.trim();
        const resolvedActive = activeTaskId !== undefined ? activeTaskId : (taskId || specOnlyMatch.activeTaskId);
        if (resolvedActive !== undefined) specOnlyMatch.activeTaskId = resolvedActive;
        specOnlyMatch.taskIds = accumulatedTaskIds;
        for (const b of existingSessionBindings) {
          b.taskIds = accumulatedTaskIds;
          if (resolvedActive !== undefined) b.activeTaskId = resolvedActive;
        }
        if (established !== undefined) {
          if (established === false) specOnlyMatch.established = false;
          else delete specOnlyMatch.established;
        }
        this.#persistForSpecSync(specId, bindings);
        return structuredClone(specOnlyMatch);
      }
    }

    if (!taskId) {
      const existingSessionMatch = bindings.find(
        (b) =>
          b.provider === identity.provider &&
          (b.providerSessionId === identity.providerSessionId || (sessionId && b.sessionId === sessionId)) &&
          b.specId === specId,
      );
      if (existingSessionMatch) {
        existingSessionMatch.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (sessionId !== undefined) existingSessionMatch.sessionId = sessionId;
        if (purpose !== undefined) existingSessionMatch.purpose = purpose;
        if (step !== undefined) existingSessionMatch.step = step;
        if (attempt !== undefined) existingSessionMatch.attempt = attempt;
        if (mode !== undefined) existingSessionMatch.mode = mode;
        if (model !== undefined) existingSessionMatch.model = model.trim();
        if (activeTaskId !== undefined) existingSessionMatch.activeTaskId = activeTaskId;
        existingSessionMatch.taskIds = accumulatedTaskIds;
        for (const b of existingSessionBindings) {
          b.taskIds = accumulatedTaskIds;
          if (activeTaskId !== undefined) b.activeTaskId = activeTaskId;
        }
        if (established !== undefined) {
          if (established === false) existingSessionMatch.established = false;
          else delete existingSessionMatch.established;
        }
        this.#persistForSpecSync(specId, bindings);
        return structuredClone(existingSessionMatch);
      }
    }

    const resolvedActiveTaskId = activeTaskId !== undefined ? activeTaskId : (taskId || undefined);
    const newBinding = {
      provider: identity.provider,
      providerSessionId: identity.providerSessionId,
      ...(sessionId ? { sessionId } : {}),
      specId,
      ...(taskId ? { taskId } : {}),
      ...(step ? { step } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
      ...(purpose ? { purpose } : {}),
      ...(mode ? { mode } : {}),
      ...(model ? { model: model.trim() } : {}),
      ...(resolvedActiveTaskId ? { activeTaskId: resolvedActiveTaskId } : {}),
      ...(accumulatedTaskIds.length > 0 ? { taskIds: accumulatedTaskIds } : {}),
      ...(established === false ? { established: false } : {}),
      createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
      lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
    };

    for (const b of existingSessionBindings) {
      b.taskIds = accumulatedTaskIds;
      if (resolvedActiveTaskId) b.activeTaskId = resolvedActiveTaskId;
    }
    bindings.push(newBinding);
    this.#persistForSpecSync(specId, bindings);
    return structuredClone(newBinding);
  }

  async resolveCurrentBinding(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const allBindings = await this.listBindings({ provider, providerSessionId });
    if (allBindings.length === 0) return null;

    const sorted = allBindings.slice().sort(compareBindingRecency);
    const winningBinding = sorted[0];
    const winningSpecId = winningBinding.specId;
    const specRows = allBindings.filter((b) => b.specId === winningSpecId);
    const taskIds = Array.from(new Set(specRows.map((r) => r.taskId).filter(Boolean)));

    return {
      ...structuredClone(winningBinding),
      specId: winningSpecId,
      taskIds,
    };
  }

  resolveCurrentBindingSync(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const allBindings = this.listBindingsSync({ provider, providerSessionId });
    if (allBindings.length === 0) return null;

    const sorted = allBindings.slice().sort(compareBindingRecency);
    const winningBinding = sorted[0];
    const winningSpecId = winningBinding.specId;
    const specRows = allBindings.filter((b) => b.specId === winningSpecId);
    const taskIds = Array.from(new Set(specRows.map((r) => r.taskId).filter(Boolean)));

    return {
      ...structuredClone(winningBinding),
      specId: winningSpecId,
      taskIds,
    };
  }

  async updateSessionMode(provider, providerSessionId, mode) {
    validateAgentIdentity({ provider, providerSessionId });
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const currentBinding = await this.resolveCurrentBinding(provider, providerSessionId);
    if (!currentBinding) return null;

    const specId = currentBinding.specId;
    const specBindings = await this.#loadForSpec(specId);
    const matches = specBindings.filter((b) => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.mode = validatedMode;
        match.lastSeenAt = now;
      }
      await this.#persistForSpec(specId, specBindings);
      return {
        ...structuredClone(matches[0]),
        taskIds: currentBinding.taskIds,
      };
    }
    return null;
  }

  updateSessionModeSync(provider, providerSessionId, mode) {
    validateAgentIdentity({ provider, providerSessionId });
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const currentBinding = this.resolveCurrentBindingSync(provider, providerSessionId);
    if (!currentBinding) return null;

    const specId = currentBinding.specId;
    const specBindings = this.#loadForSpecSync(specId);
    const matches = specBindings.filter((b) => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.mode = validatedMode;
        match.lastSeenAt = now;
      }
      this.#persistForSpecSync(specId, specBindings);
      return {
        ...structuredClone(matches[0]),
        taskIds: currentBinding.taskIds,
      };
    }
    return null;
  }

  async updateSessionModel(provider, providerSessionId, model) {
    validateAgentIdentity({ provider, providerSessionId });
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    const currentBinding = await this.resolveCurrentBinding(provider, providerSessionId);
    if (!currentBinding) return null;

    const specId = currentBinding.specId;
    const specBindings = await this.#loadForSpec(specId);
    const matches = specBindings.filter((b) => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.model = model.trim();
        match.lastSeenAt = now;
      }
      await this.#persistForSpec(specId, specBindings);
      return {
        ...structuredClone(matches[0]),
        taskIds: currentBinding.taskIds,
      };
    }
    return null;
  }

  updateSessionModelSync(provider, providerSessionId, model) {
    validateAgentIdentity({ provider, providerSessionId });
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    const currentBinding = this.resolveCurrentBindingSync(provider, providerSessionId);
    if (!currentBinding) return null;

    const specId = currentBinding.specId;
    const specBindings = this.#loadForSpecSync(specId);
    const matches = specBindings.filter((b) => b.provider === provider && b.providerSessionId === providerSessionId);
    if (matches.length > 0) {
      const now = new Date().toISOString();
      for (const match of matches) {
        match.model = model.trim();
        match.lastSeenAt = now;
      }
      this.#persistForSpecSync(specId, specBindings);
      return {
        ...structuredClone(matches[0]),
        taskIds: currentBinding.taskIds,
      };
    }
    return null;
  }

  async listBindings(query = {}) {
    const bindings = await this.#loadForSpec(query.specId);
    return bindings
      .filter((b) => {
        if (query.specId && b.specId !== query.specId) return false;
        if (query.taskId && b.taskId !== query.taskId) return false;
        if (query.provider && b.provider !== query.provider) return false;
        if (query.providerSessionId && b.providerSessionId !== query.providerSessionId) return false;
        return true;
      })
      .map((b) => structuredClone(b));
  }

  listBindingsSync(query = {}) {
    const bindings = this.#loadForSpecSync(query.specId);
    return bindings
      .filter((b) => {
        if (query.specId && b.specId !== query.specId) return false;
        if (query.taskId && b.taskId !== query.taskId) return false;
        if (query.provider && b.provider !== query.provider) return false;
        if (query.providerSessionId && b.providerSessionId !== query.providerSessionId) return false;
        return true;
      })
      .map((b) => structuredClone(b));
  }

  async getBinding(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const bindings = await this.#loadForSpec();
    const match = bindings.find(
      (b) => b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId),
    );
    return match ? structuredClone(match) : null;
  }

  /**
   * Preferred contract:
   *   markSessionEstablished(provider, canonicalSessionId, providerSessionId)
   * Compatibility overload:
   *   markSessionEstablished(provider, allocatedSessionId)
   *
   * Confirms a session once the native provider session ID is materialized.
   * Correlates strictly to the canonical Nevo sessionId or existing providerSessionId.
   * NEVER uses `established === false` as a fallback match criterion to prevent
   * mutating unrelated pending sessions.
   */
  async markSessionEstablished(provider, arg1, arg2) {
    const isExplicitThreeArg = arg2 !== undefined;
    const canonicalSessionId = isExplicitThreeArg ? arg1 : null;
    const allocatedId = isExplicitThreeArg ? arg2 : arg1;
    const lookupId = canonicalSessionId || allocatedId;
    validateAgentIdentity({ provider, providerSessionId: lookupId });

    const markRows = (rows) => {
      let changed = false;
      for (const row of rows) {
        if (row.provider !== provider) continue;
        const matches = isExplicitThreeArg
          ? (row.sessionId === canonicalSessionId || row.providerSessionId === canonicalSessionId)
          : (row.providerSessionId === allocatedId || row.sessionId === allocatedId);
        if (matches) {
          if (!row.sessionId) {
            row.sessionId = canonicalSessionId || row.providerSessionId;
          }
          row.providerSessionId = allocatedId;
          delete row.established;
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      const bindings = await this.#loadForSpec();
      if (markRows(bindings)) {
        this.#cache.set('__single__', bindings);
        await this.#persistForSpec(null, bindings);
      }
      return;
    }

    const all = await this.#loadForSpec();
    const matchingSpecs = new Set(
      all
        .filter((b) => {
          if (b.provider !== provider) return false;
          return isExplicitThreeArg
            ? (b.sessionId === canonicalSessionId || b.providerSessionId === canonicalSessionId)
            : (b.providerSessionId === allocatedId || b.sessionId === allocatedId);
        })
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = await this.#loadForSpec(specId);
      if (markRows(specBindings)) {
        await this.#persistForSpec(specId, specBindings);
      }
    }
  }

  markSessionEstablishedSync(provider, arg1, arg2) {
    const isExplicitThreeArg = arg2 !== undefined;
    const canonicalSessionId = isExplicitThreeArg ? arg1 : null;
    const allocatedId = isExplicitThreeArg ? arg2 : arg1;
    const lookupId = canonicalSessionId || allocatedId;
    validateAgentIdentity({ provider, providerSessionId: lookupId });

    const markRows = (rows) => {
      let changed = false;
      for (const row of rows) {
        if (row.provider !== provider) continue;
        const matches = isExplicitThreeArg
          ? (row.sessionId === canonicalSessionId || row.providerSessionId === canonicalSessionId)
          : (row.providerSessionId === allocatedId || row.sessionId === allocatedId);
        if (matches) {
          if (!row.sessionId) {
            row.sessionId = canonicalSessionId || row.providerSessionId;
          }
          row.providerSessionId = allocatedId;
          delete row.established;
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      const bindings = this.#loadForSpecSync();
      if (markRows(bindings)) {
        this.#cache.set('__single__', bindings);
        this.#persistForSpecSync(null, bindings);
      }
      return;
    }

    const all = this.#loadForSpecSync();
    const matchingSpecs = new Set(
      all
        .filter((b) => {
          if (b.provider !== provider) return false;
          return isExplicitThreeArg
            ? (b.sessionId === canonicalSessionId || b.providerSessionId === canonicalSessionId)
            : (b.providerSessionId === allocatedId || b.sessionId === allocatedId);
        })
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = this.#loadForSpecSync(specId);
      if (markRows(specBindings)) {
        this.#persistForSpecSync(specId, specBindings);
      }
    }
  }

  async recordBootstrapState(provider, providerSessionId, { taskId, step, attempt, sessionId } = {}) {
    validateAgentIdentity({ provider, providerSessionId: sessionId || providerSessionId });
    const updateRows = (rows) => {
      let changed = false;
      for (const row of rows) {
        if (row.provider !== provider) continue;
        const matches =
          (sessionId && (row.sessionId === sessionId || row.providerSessionId === sessionId)) ||
          row.providerSessionId === providerSessionId;
        if (matches) {
          row.lastBootstrapTaskId = taskId;
          row.lastBootstrapStep = step;
          row.lastBootstrapAttempt = attempt;
          row.lastSeenAt = new Date().toISOString();
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      const bindings = await this.#loadForSpec();
      if (updateRows(bindings)) {
        this.#cache.set('__single__', bindings);
        await this.#persistForSpec(null, bindings);
      }
      return;
    }

    const all = await this.#loadForSpec();
    const matchingSpecs = new Set(
      all
        .filter((b) => {
          if (b.provider !== provider) return false;
          return (
            (sessionId && (b.sessionId === sessionId || b.providerSessionId === sessionId)) ||
            b.providerSessionId === providerSessionId
          );
        })
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = await this.#loadForSpec(specId);
      if (updateRows(specBindings)) {
        await this.#persistForSpec(specId, specBindings);
      }
    }
  }

  recordBootstrapStateSync(provider, providerSessionId, { taskId, step, attempt, sessionId } = {}) {
    validateAgentIdentity({ provider, providerSessionId: sessionId || providerSessionId });
    const updateRows = (rows) => {
      let changed = false;
      for (const row of rows) {
        if (row.provider !== provider) continue;
        const matches =
          (sessionId && (row.sessionId === sessionId || row.providerSessionId === sessionId)) ||
          row.providerSessionId === providerSessionId;
        if (matches) {
          row.lastBootstrapTaskId = taskId;
          row.lastBootstrapStep = step;
          row.lastBootstrapAttempt = attempt;
          row.lastSeenAt = new Date().toISOString();
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      const bindings = this.#loadForSpecSync();
      if (updateRows(bindings)) {
        this.#cache.set('__single__', bindings);
        this.#persistForSpecSync(null, bindings);
      }
      return;
    }

    const all = this.#loadForSpecSync();
    const matchingSpecs = new Set(
      all
        .filter((b) => {
          if (b.provider !== provider) return false;
          return (
            (sessionId && (b.sessionId === sessionId || b.providerSessionId === sessionId)) ||
            b.providerSessionId === providerSessionId
          );
        })
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = this.#loadForSpecSync(specId);
      if (updateRows(specBindings)) {
        this.#persistForSpecSync(specId, specBindings);
      }
    }
  }

  async getTasksForSession(provider, providerSessionId, specId) {
    validateAgentIdentity({ provider, providerSessionId });
    const allBindings = await this.listBindings(specId ? { specId } : {});
    const sessionBindings = allBindings
      .filter(
        (b) => b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId),
      )
      .sort(compareBindingRecency);

    const seenTaskIds = new Set();
    const tasks = [];
    for (const b of sessionBindings) {
      const taskId = b.taskId || b.activeTaskId;
      if (taskId && !seenTaskIds.has(taskId)) {
        seenTaskIds.add(taskId);
        tasks.push(structuredClone(b));
      }
    }
    return tasks;
  }

  getTasksForSessionSync(provider, providerSessionId, specId) {
    validateAgentIdentity({ provider, providerSessionId });
    const allBindings = this.listBindingsSync(specId ? { specId } : {});
    const sessionBindings = allBindings
      .filter(
        (b) => b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId),
      )
      .sort(compareBindingRecency);

    const seenTaskIds = new Set();
    const tasks = [];
    for (const b of sessionBindings) {
      const taskId = b.taskId || b.activeTaskId;
      if (taskId && !seenTaskIds.has(taskId)) {
        seenTaskIds.add(taskId);
        tasks.push(structuredClone(b));
      }
    }
    return tasks;
  }

  async getSessionsForTask(specId, taskId) {
    if (!specId || typeof specId !== 'string') {
      throw new AiValidationError("'specId' must be a valid string.", { field: 'specId' });
    }
    if (!taskId || typeof taskId !== 'string') {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const specBindings = await this.#loadForSpec(specId);
    const matching = specBindings
      .filter(
        (b) =>
          b.taskId === taskId ||
          (Array.isArray(b.taskIds) && b.taskIds.includes(taskId)) ||
          b.activeTaskId === taskId,
      )
      .sort(compareBindingRecency);

    const seenSessions = new Set();
    const sessions = [];
    for (const b of matching) {
      const key = `${b.provider}:::${b.sessionId || b.providerSessionId}`;
      if (!seenSessions.has(key)) {
        seenSessions.add(key);
        sessions.push(structuredClone(b));
      }
    }
    return sessions;
  }

  getSessionsForTaskSync(specId, taskId) {
    if (!specId || typeof specId !== 'string') {
      throw new AiValidationError("'specId' must be a valid string.", { field: 'specId' });
    }
    if (!taskId || typeof taskId !== 'string') {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const specBindings = this.#loadForSpecSync(specId);
    const matching = specBindings
      .filter(
        (b) =>
          b.taskId === taskId ||
          (Array.isArray(b.taskIds) && b.taskIds.includes(taskId)) ||
          b.activeTaskId === taskId,
      )
      .sort(compareBindingRecency);

    const seenSessions = new Set();
    const sessions = [];
    for (const b of matching) {
      const key = `${b.provider}:::${b.sessionId || b.providerSessionId}`;
      if (!seenSessions.has(key)) {
        seenSessions.add(key);
        sessions.push(structuredClone(b));
      }
    }
    return sessions;
  }

  async setActiveTaskId(provider, providerSessionId, taskId, specIdOrOptions = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const cleanTaskId = taskId.trim();
    let targetSpecId = typeof specIdOrOptions === 'string' ? specIdOrOptions : specIdOrOptions?.specId;
    if (!targetSpecId) {
      const current = await this.resolveCurrentBinding(provider, providerSessionId);
      targetSpecId = current?.specId;
    }
    if (!targetSpecId) {
      throw new AiValidationError('Cannot set active task: session has no associated specification.', {
        field: 'specId',
      });
    }

    const bindings = await this.#loadForSpec(targetSpecId);
    const sessionBindings = bindings.filter(
      (b) =>
        b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId),
    );
    if (sessionBindings.length === 0) {
      throw new AiValidationError('Cannot set active task: session not found.', { field: 'providerSessionId' });
    }

    const now = new Date().toISOString();
    for (const b of sessionBindings) {
      b.activeTaskId = cleanTaskId;
      if (b.taskId === cleanTaskId) {
        b.lastSeenAt = now;
      }
      if (!Array.isArray(b.taskIds)) b.taskIds = b.taskId ? [b.taskId] : [];
      if (!b.taskIds.includes(cleanTaskId)) {
        b.taskIds.push(cleanTaskId);
      }
    }

    const taskBinding = sessionBindings.find((b) => b.taskId === cleanTaskId);
    if (!taskBinding) {
      const template = sessionBindings[0];
      const newBinding = {
        ...structuredClone(template),
        taskId: cleanTaskId,
        activeTaskId: cleanTaskId,
        taskIds: Array.from(new Set([...(template.taskIds || []), cleanTaskId])),
        createdAt: now,
        lastSeenAt: now,
      };
      delete newBinding.step;
      delete newBinding.attempt;
      bindings.push(newBinding);
    }

    await this.#persistForSpec(targetSpecId, bindings);
    const updated = sessionBindings.find((b) => b.taskId === cleanTaskId) || sessionBindings[0];
    return structuredClone(updated);
  }

  setActiveTaskIdSync(provider, providerSessionId, taskId, specIdOrOptions = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const cleanTaskId = taskId.trim();
    let targetSpecId = typeof specIdOrOptions === 'string' ? specIdOrOptions : specIdOrOptions?.specId;
    if (!targetSpecId) {
      const current = this.resolveCurrentBindingSync(provider, providerSessionId);
      targetSpecId = current?.specId;
    }
    if (!targetSpecId) {
      throw new AiValidationError('Cannot set active task: session has no associated specification.', {
        field: 'specId',
      });
    }

    const bindings = this.#loadForSpecSync(targetSpecId);
    const sessionBindings = bindings.filter(
      (b) =>
        b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId),
    );
    if (sessionBindings.length === 0) {
      throw new AiValidationError('Cannot set active task: session not found.', { field: 'providerSessionId' });
    }

    const now = new Date().toISOString();
    for (const b of sessionBindings) {
      b.activeTaskId = cleanTaskId;
      if (b.taskId === cleanTaskId) {
        b.lastSeenAt = now;
      }
      if (!Array.isArray(b.taskIds)) b.taskIds = b.taskId ? [b.taskId] : [];
      if (!b.taskIds.includes(cleanTaskId)) {
        b.taskIds.push(cleanTaskId);
      }
    }

    const taskBinding = sessionBindings.find((b) => b.taskId === cleanTaskId);
    if (!taskBinding) {
      const template = sessionBindings[0];
      const newBinding = {
        ...structuredClone(template),
        taskId: cleanTaskId,
        activeTaskId: cleanTaskId,
        taskIds: Array.from(new Set([...(template.taskIds || []), cleanTaskId])),
        createdAt: now,
        lastSeenAt: now,
      };
      delete newBinding.step;
      delete newBinding.attempt;
      bindings.push(newBinding);
    }

    this.#persistForSpecSync(targetSpecId, bindings);
    const updated = sessionBindings.find((b) => b.taskId === cleanTaskId) || sessionBindings[0];
    return structuredClone(updated);
  }

  async unbindSession(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const matchesSession = (b) =>
      b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId);

    if (this.#storageFile) {
      const bindings = await this.#loadForSpec();
      const initialLen = bindings.length;
      const filtered = bindings.filter((b) => !matchesSession(b));
      if (filtered.length !== initialLen) {
        this.#cache.set('__single__', filtered);
        await this.#persistForSpec(null, filtered);
      }
      return;
    }

    const all = await this.#loadForSpec();
    const matchingSpecs = new Set(
      all
        .filter(matchesSession)
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = await this.#loadForSpec(specId);
      const filtered = specBindings.filter((b) => !matchesSession(b));
      await this.#persistForSpec(specId, filtered);
    }
  }

  unbindSessionSync(provider, providerSessionId) {
    validateAgentIdentity({ provider, providerSessionId });
    const matchesSession = (b) =>
      b.provider === provider && (b.providerSessionId === providerSessionId || b.sessionId === providerSessionId);

    if (this.#storageFile) {
      const bindings = this.#loadForSpecSync();
      const initialLen = bindings.length;
      const filtered = bindings.filter((b) => !matchesSession(b));
      if (filtered.length !== initialLen) {
        this.#cache.set('__single__', filtered);
        this.#persistForSpecSync(null, filtered);
      }
      return;
    }

    const all = this.#loadForSpecSync();
    const matchingSpecs = new Set(
      all
        .filter(matchesSession)
        .map((b) => b.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      const specBindings = this.#loadForSpecSync(specId);
      const filtered = specBindings.filter((b) => !matchesSession(b));
      this.#persistForSpecSync(specId, filtered);
    }
  }
}

export function createAgentSessionBindingService(options) {
  return new AgentSessionBindingService(options);
}
