import {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
  statSync,
} from 'node:fs';
import { mkdir, readFile, rename, writeFile, readdir, unlink, open, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AiValidationError,
  normalizeTimestamp,
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

/**
 * Atomic Windows-safe JSON write using temp file and rename.
 */
async function safeWriteJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tempFile, filePath);
}

function safeWriteJsonSync(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tempFile, filePath);
}

// Cross-process advisory lock: mutual exclusion for the read-modify-write cycle around one
// spec's session storage file. Nevo has multiple independent writers against the same file —
// the long-running dashboard process and short-lived `workflow step start/finish` CLI
// invocations — so an in-process mutex alone cannot prevent a lost update (process A reads,
// process B reads+writes, process A writes back over B's change). Exclusive file creation
// (`wx`) is atomic on both POSIX and NTFS, so it works as a cross-platform mutex without a
// database or extra dependency. A stale lock (left behind by a crashed process) is reclaimed
// after `staleMs` based on the lock file's own mtime.
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;
const LOCK_RETRY_MIN_MS = 15;
const LOCK_RETRY_MAX_MS = 40;

function lockPathFor(filePath) {
  return `${filePath}.lock`;
}

async function acquireFileLock(filePath) {
  const lockPath = lockPathFor(filePath);
  await mkdir(dirname(lockPath), { recursive: true });
  const start = Date.now();
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new AiValidationError(`Timed out waiting for session storage lock: ${lockPath}`);
      }
      await new Promise((res) =>
        setTimeout(res, LOCK_RETRY_MIN_MS + Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS)),
      );
    }
  }
}

function acquireFileLockSync(filePath) {
  const lockPath = lockPathFor(filePath);
  mkdirSync(dirname(lockPath), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {}
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      try {
        const info = statSync(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(lockPath);
          } catch {}
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new AiValidationError(`Timed out waiting for session storage lock: ${lockPath}`);
      }
      // Synchronous backoff without a worker thread — CLI call sites are sync-only.
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS)),
      );
    }
  }
}

export async function writeCodexExecutionContextBridge(repoRoot, threadId, { sessionId, specId, taskId, activeTaskId } = {}) {
  if (!repoRoot || !threadId) return;
  const bridgeDir = resolve(repoRoot, '.nevo-ai-local', 'codex-context');
  await mkdir(bridgeDir, { recursive: true });
  const payload = {
    threadId,
    ...(sessionId ? { sessionId } : {}),
    specId,
    taskId: activeTaskId || taskId,
    activeTaskId: activeTaskId || taskId,
    createdAt: new Date().toISOString(),
  };

  const threadPath = join(bridgeDir, `${threadId}.json`);
  await safeWriteJson(threadPath, payload);

  const effTask = activeTaskId || taskId;
  if (specId && effTask) {
    const taskPath = join(bridgeDir, `${specId}-${effTask}.json`);
    await safeWriteJson(taskPath, payload);
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
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function readAgentExecutionContext(envOrOpts = process.env, opts = {}) {
  let env = envOrOpts;
  let repoRoot = opts?.repoRoot;
  let specId = opts?.specId;
  let taskId = opts?.taskId;

  if (envOrOpts && typeof envOrOpts === 'object' && ('env' in envOrOpts || 'repoRoot' in envOrOpts)) {
    env = envOrOpts.env || process.env;
    repoRoot = envOrOpts.repoRoot ?? repoRoot;
    specId = envOrOpts.specId ?? specId;
    taskId = envOrOpts.taskId ?? taskId;
  }
  if (!env) {
    env = process.env;
  }

  const provider = env.NEVO_AGENT_PROVIDER?.trim();
  const sessionId = env.NEVO_SESSION_ID?.trim();
  const providerSessionId = env.NEVO_AGENT_PROVIDER_SESSION_ID?.trim();

  if (sessionId) {
    return {
      provider: provider || 'unknown',
      sessionId,
      ...(providerSessionId ? { providerSessionId } : {}),
    };
  }

  if (provider && providerSessionId) {
    return {
      provider,
      providerSessionId,
    };
  }

  // Codex bridge fallback: when NEVO_AGENT_PROVIDER === 'codex' and persistent app-server has no per-thread env
  if (provider === 'codex' && repoRoot) {
    const bridge = readCodexExecutionContextBridgeSync(repoRoot, { specId, taskId, threadId: providerSessionId });
    if (bridge?.sessionId) {
      return {
        provider: 'codex',
        sessionId: bridge.sessionId,
        ...(bridge.threadId ? { providerSessionId: bridge.threadId } : {}),
      };
    }
  }

  return null;
}

/**
 * Normalizes raw storage content into `{ sessions: AgentSession[], bindings: SessionTaskBinding[] }`.
 * Seamlessly migrates legacy flat array rows.
 */
function normalizeStorageContent(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { sessions: [], bindings: [] };
  }

  if (Array.isArray(parsed)) {
    // Legacy flat array migration
    const sessionsMap = new Map();
    const bindings = [];

    for (const row of parsed) {
      const sId = row.sessionId || row.providerSessionId || randomUUID();
      let session = sessionsMap.get(sId);
      if (!session) {
        // A legacy row's providerSessionId is only treated as a fake/provisional
        // placeholder when explicitly marked `established: false`. Equal-string-value
        // alone (providerSessionId === sessionId) proves nothing — for Claude, Nevo
        // legitimately passes its own canonical UUID as the provider's --session-id, so a
        // REAL, established provider identity can equal the canonical sessionId too. This
        // also avoids a self-referential false positive: when a legacy row never recorded
        // a separate `sessionId` at all, `sId` above is itself derived FROM
        // `row.providerSessionId`, so comparing them would always match trivially.
        const isPlaceholder = row.established === false;
        const provSessionId = isPlaceholder ? undefined : (row.providerSessionId || undefined);
        session = {
          sessionId: sId,
          provider: row.provider,
          ...(provSessionId ? { providerSessionId: provSessionId } : {}),
          ...(row.specId ? { specId: row.specId } : {}),
          ...(row.mode ? { mode: row.mode } : {}),
          ...(row.model ? { model: row.model } : {}),
          ...(row.purpose ? { purpose: row.purpose } : {}),
          ...(row.activeTaskId || row.taskId ? { activeTaskId: row.activeTaskId || row.taskId } : {}),
          taskIds: Array.isArray(row.taskIds) ? [...row.taskIds] : (row.taskId ? [row.taskId] : []),
          createdAt: row.createdAt || new Date().toISOString(),
          lastSeenAt: row.lastSeenAt || new Date().toISOString(),
          ...(row.lastBootstrapTaskId ? { lastBootstrapTaskId: row.lastBootstrapTaskId } : {}),
          ...(row.lastBootstrapStep ? { lastBootstrapStep: row.lastBootstrapStep } : {}),
          ...(row.lastBootstrapAttempt !== undefined ? { lastBootstrapAttempt: row.lastBootstrapAttempt } : {}),
        };
        sessionsMap.set(sId, session);
      } else {
        if (row.mode && !session.mode) session.mode = row.mode;
        if (row.model && !session.model) session.model = row.model;
        if (row.activeTaskId) session.activeTaskId = row.activeTaskId;
        if (row.taskId && !session.taskIds.includes(row.taskId)) session.taskIds.push(row.taskId);
        if (Array.isArray(row.taskIds)) {
          for (const t of row.taskIds) {
            if (!session.taskIds.includes(t)) session.taskIds.push(t);
          }
        }
        if (new Date(row.lastSeenAt || 0) > new Date(session.lastSeenAt || 0)) {
          session.lastSeenAt = row.lastSeenAt;
        }
      }

      if (row.taskId) {
        bindings.push({
          sessionId: sId,
          taskId: row.taskId,
          ...(row.step ? { step: row.step } : {}),
          ...(row.attempt !== undefined ? { attempt: row.attempt } : {}),
          specId: row.specId,
          provider: row.provider,
          createdAt: row.createdAt || session.createdAt,
          lastSeenAt: row.lastSeenAt || session.lastSeenAt,
        });
      }
    }

    return {
      sessions: Array.from(sessionsMap.values()),
      bindings,
    };
  }

  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const bindings = Array.isArray(parsed.bindings) ? parsed.bindings : [];
  return { sessions, bindings };
}

export class AgentSessionBindingService {
  #storageFile = null;
  #storageDir = null;
  #cache = new Map(); // specId -> { sessions: [], bindings: [] } or '__single__'

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
            const normalized = normalizeStorageContent(items);
            await safeWriteJson(specFile, normalized);
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
            const normalized = normalizeStorageContent(items);
            safeWriteJsonSync(specFile, normalized);
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

  #getSpecKey(specId) {
    return specId && typeof specId === 'string' && specId.trim() ? specId.trim() : '_general';
  }

  // Always reads fresh from disk — never trusts a previously-cached document. Nevo's
  // session storage has multiple independent writers (the dashboard server and separately
  // spawned `workflow step start/finish` CLI processes); a persistent read-through cache
  // here would let this process apply a mutation on top of a document one of those other
  // writers has since changed, silently discarding their update on the next write.
  async #loadForSpec(specId) {
    if (this.#storageFile) {
      try {
        const content = await readFile(this.#storageFile, 'utf-8');
        const parsed = JSON.parse(content);
        const data = normalizeStorageContent(parsed);
        this.#cache.set('__single__', data);
        return data;
      } catch {
        const data = { sessions: [], bindings: [] };
        this.#cache.set('__single__', data);
        return data;
      }
    }

    await this.#migrateLegacyIfNeeded();

    if (specId !== undefined) {
      const key = this.#getSpecKey(specId);
      const specFile = join(this.#storageDir, `${key}.json`);
      try {
        const content = await readFile(specFile, 'utf-8');
        const parsed = JSON.parse(content);
        const data = normalizeStorageContent(parsed);
        this.#cache.set(key, data);
        return data;
      } catch {
        const data = { sessions: [], bindings: [] };
        this.#cache.set(key, data);
        return data;
      }
    }

    // Load all specs
    try {
      if (!existsSync(this.#storageDir)) return { sessions: [], bindings: [] };
      const files = await readdir(this.#storageDir);
      const allSessions = [];
      const allBindings = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const currentSpecId = file.slice(0, -5);
        const data = await this.#loadForSpec(currentSpecId);
        allSessions.push(...data.sessions);
        allBindings.push(...data.bindings);
      }
      return { sessions: allSessions, bindings: allBindings };
    } catch {
      return { sessions: [], bindings: [] };
    }
  }

  // Sync twin of #loadForSpec — same "never trust a cached document" rule; see its comment.
  #loadForSpecSync(specId) {
    if (this.#storageFile) {
      try {
        if (existsSync(this.#storageFile)) {
          const content = readFileSync(this.#storageFile, 'utf-8');
          const parsed = JSON.parse(content);
          const data = normalizeStorageContent(parsed);
          this.#cache.set('__single__', data);
          return data;
        }
        const data = { sessions: [], bindings: [] };
        this.#cache.set('__single__', data);
        return data;
      } catch {
        const data = { sessions: [], bindings: [] };
        this.#cache.set('__single__', data);
        return data;
      }
    }

    this.#migrateLegacyIfNeededSync();

    if (specId !== undefined) {
      const key = this.#getSpecKey(specId);
      const specFile = join(this.#storageDir, `${key}.json`);
      try {
        if (existsSync(specFile)) {
          const content = readFileSync(specFile, 'utf-8');
          const parsed = JSON.parse(content);
          const data = normalizeStorageContent(parsed);
          this.#cache.set(key, data);
          return data;
        }
        const data = { sessions: [], bindings: [] };
        this.#cache.set(key, data);
        return data;
      } catch {
        const data = { sessions: [], bindings: [] };
        this.#cache.set(key, data);
        return data;
      }
    }

    try {
      if (!existsSync(this.#storageDir)) return { sessions: [], bindings: [] };
      const files = readdirSync(this.#storageDir);
      const allSessions = [];
      const allBindings = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const currentSpecId = file.slice(0, -5);
        const data = this.#loadForSpecSync(currentSpecId);
        allSessions.push(...data.sessions);
        allBindings.push(...data.bindings);
      }
      return { sessions: allSessions, bindings: allBindings };
    } catch {
      return { sessions: [], bindings: [] };
    }
  }

  async #persistForSpec(specId, data) {
    if (this.#storageFile) {
      const all = data || { sessions: [], bindings: [] };
      const flatList = [];
      for (const s of all.sessions) {
        const matchingBindings = all.bindings.filter((b) => b.sessionId === s.sessionId);
        if (matchingBindings.length > 0) {
          for (const b of matchingBindings) {
            flatList.push({
              provider: s.provider,
              providerSessionId: s.providerSessionId,
              sessionId: s.sessionId,
              specId: s.specId,
              taskId: b.taskId,
              step: b.step,
              attempt: b.attempt,
              purpose: s.purpose,
              mode: s.mode,
              model: s.model,
              activeTaskId: s.activeTaskId,
              taskIds: s.taskIds,
              createdAt: b.createdAt || s.createdAt,
              lastSeenAt: b.lastSeenAt || s.lastSeenAt,
            });
          }
        } else {
          flatList.push({
            provider: s.provider,
            providerSessionId: s.providerSessionId,
            sessionId: s.sessionId,
            specId: s.specId,
            purpose: s.purpose,
            mode: s.mode,
            model: s.model,
            activeTaskId: s.activeTaskId,
            taskIds: s.taskIds,
            createdAt: s.createdAt,
            lastSeenAt: s.lastSeenAt,
          });
        }
      }
      await safeWriteJson(this.#storageFile, flatList);
      return;
    }

    const key = this.#getSpecKey(specId);
    this.#cache.set(key, data);
    const specFile = join(this.#storageDir, `${key}.json`);
    await safeWriteJson(specFile, data);
  }

  #persistForSpecSync(specId, data) {
    if (this.#storageFile) {
      const all = data || { sessions: [], bindings: [] };
      const flatList = [];
      for (const s of all.sessions) {
        const matchingBindings = all.bindings.filter((b) => b.sessionId === s.sessionId);
        if (matchingBindings.length > 0) {
          for (const b of matchingBindings) {
            flatList.push({
              provider: s.provider,
              providerSessionId: s.providerSessionId,
              sessionId: s.sessionId,
              specId: s.specId,
              taskId: b.taskId,
              step: b.step,
              attempt: b.attempt,
              purpose: s.purpose,
              mode: s.mode,
              model: s.model,
              activeTaskId: s.activeTaskId,
              taskIds: s.taskIds,
              createdAt: b.createdAt || s.createdAt,
              lastSeenAt: b.lastSeenAt || s.lastSeenAt,
            });
          }
        } else {
          flatList.push({
            provider: s.provider,
            providerSessionId: s.providerSessionId,
            sessionId: s.sessionId,
            specId: s.specId,
            purpose: s.purpose,
            mode: s.mode,
            model: s.model,
            activeTaskId: s.activeTaskId,
            taskIds: s.taskIds,
            createdAt: s.createdAt,
            lastSeenAt: s.lastSeenAt,
          });
        }
      }
      safeWriteJsonSync(this.#storageFile, flatList);
      return;
    }

    const key = this.#getSpecKey(specId);
    this.#cache.set(key, data);
    const specFile = join(this.#storageDir, `${key}.json`);
    safeWriteJsonSync(specFile, data);
  }

  #lockTargetFor(specId) {
    return this.#storageFile || join(this.#storageDir, `${this.#getSpecKey(specId)}.json`);
  }

  /**
   * Runs `mutator(data)` against the freshest on-disk document for `specId`, holding a
   * cross-process lock for the entire read-modify-write cycle, then persists the result.
   * `mutator` mutates `data` in place and may return a value to propagate as this method's
   * own return value — this is the only safe way to mutate session storage: every mutating
   * public method on this class goes through here so that reading, changing, and writing
   * back can never interleave with another process's own read-modify-write cycle.
   */
  async #mutateSpec(specId, mutator) {
    const release = await acquireFileLock(this.#lockTargetFor(specId));
    try {
      const data = await this.#loadForSpec(specId);
      const result = await mutator(data);
      await this.#persistForSpec(specId, data);
      return result;
    } finally {
      await release();
    }
  }

  #mutateSpecSync(specId, mutator) {
    const release = acquireFileLockSync(this.#lockTargetFor(specId));
    try {
      const data = this.#loadForSpecSync(specId);
      const result = mutator(data);
      this.#persistForSpecSync(specId, data);
      return result;
    } finally {
      release();
    }
  }

  /**
   * Look up an AgentSession by its canonical sessionId UUID.
   */
  async getSession(sessionId) {
    if (!sessionId) return null;
    const all = await this.#loadForSpec();
    const session = all.sessions.find((s) => s.sessionId === sessionId);
    return session ? structuredClone(session) : null;
  }

  getSessionSync(sessionId) {
    if (!sessionId) return null;
    const all = this.#loadForSpecSync();
    const session = all.sessions.find((s) => s.sessionId === sessionId);
    return session ? structuredClone(session) : null;
  }

  /**
   * Look up an AgentSession by provider native identity (provider, providerSessionId).
   */
  async findSessionByProviderIdentity(provider, providerSessionId) {
    if (!provider || !providerSessionId) return null;
    const all = await this.#loadForSpec();
    const matches = all.sessions
      .filter((s) => s.provider === provider && s.providerSessionId === providerSessionId)
      .sort(compareBindingRecency);
    return matches[0] ? structuredClone(matches[0]) : null;
  }

  findSessionByProviderIdentitySync(provider, providerSessionId) {
    if (!provider || !providerSessionId) return null;
    const all = this.#loadForSpecSync();
    const matches = all.sessions
      .filter((s) => s.provider === provider && s.providerSessionId === providerSessionId)
      .sort(compareBindingRecency);
    return matches[0] ? structuredClone(matches[0]) : null;
  }

  /**
   * Sets or confirms the providerSessionId on a canonical AgentSession.
   * Fail-closed rules:
   * - Session must exist.
   * - Missing providerSessionId -> sets it.
   * - Same existing value -> idempotent.
   * - Different existing value -> throws AiValidationError.
   */
  async setProviderSessionId(sessionId, providerSessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new AiValidationError("'sessionId' is required.", { field: 'sessionId' });
    }
    if (!providerSessionId || typeof providerSessionId !== 'string' || !providerSessionId.trim()) {
      throw new AiValidationError("'providerSessionId' must be a non-empty string.", { field: 'providerSessionId' });
    }
    const cleanProvSessionId = providerSessionId.trim();

    const specId = this.#storageFile ? null : (await this.#loadForSpec()).sessions.find((s) => s.sessionId === sessionId)?.specId;
    return this.#mutateSpec(specId ?? null, (data) => {
      const session = data.sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        throw new AiValidationError(`Session '${sessionId}' not found.`, { field: 'sessionId' });
      }
      if (session.providerSessionId && session.providerSessionId !== cleanProvSessionId) {
        throw new AiValidationError(
          `Cannot overwrite existing providerSessionId '${session.providerSessionId}' with '${cleanProvSessionId}'.`,
          { field: 'providerSessionId' },
        );
      }
      if (session.providerSessionId !== cleanProvSessionId) {
        session.providerSessionId = cleanProvSessionId;
        session.lastSeenAt = new Date().toISOString();
      }
      return structuredClone(session);
    });
  }

  setProviderSessionIdSync(sessionId, providerSessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new AiValidationError("'sessionId' is required.", { field: 'sessionId' });
    }
    if (!providerSessionId || typeof providerSessionId !== 'string' || !providerSessionId.trim()) {
      throw new AiValidationError("'providerSessionId' must be a non-empty string.", { field: 'providerSessionId' });
    }
    const cleanProvSessionId = providerSessionId.trim();

    const specId = this.#storageFile ? null : this.#loadForSpecSync().sessions.find((s) => s.sessionId === sessionId)?.specId;
    return this.#mutateSpecSync(specId ?? null, (data) => {
      const session = data.sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        throw new AiValidationError(`Session '${sessionId}' not found.`, { field: 'sessionId' });
      }
      if (session.providerSessionId && session.providerSessionId !== cleanProvSessionId) {
        throw new AiValidationError(
          `Cannot overwrite existing providerSessionId '${session.providerSessionId}' with '${cleanProvSessionId}'.`,
          { field: 'providerSessionId' },
        );
      }
      if (session.providerSessionId !== cleanProvSessionId) {
        session.providerSessionId = cleanProvSessionId;
        session.lastSeenAt = new Date().toISOString();
      }
      return structuredClone(session);
    });
  }

  /**
   * Compatibility wrapper for legacy markSessionEstablished callers.
   */
  async markSessionEstablished(provider, arg1, arg2) {
    const isExplicitThreeArg = arg2 !== undefined;
    const targetSessionId = isExplicitThreeArg ? arg1 : null;
    const allocatedId = isExplicitThreeArg ? arg2 : arg1;

    if (targetSessionId) {
      return await this.setProviderSessionId(targetSessionId, allocatedId);
    }

    const session = await this.findSessionByProviderIdentity(provider, allocatedId);
    if (session) {
      return await this.setProviderSessionId(session.sessionId, allocatedId);
    }

    // Lookup session where sessionId === allocatedId
    const sessionById = await this.getSession(allocatedId);
    if (sessionById) {
      return await this.setProviderSessionId(sessionById.sessionId, allocatedId);
    }
  }

  markSessionEstablishedSync(provider, arg1, arg2) {
    const isExplicitThreeArg = arg2 !== undefined;
    const targetSessionId = isExplicitThreeArg ? arg1 : null;
    const allocatedId = isExplicitThreeArg ? arg2 : arg1;

    if (targetSessionId) {
      return this.setProviderSessionIdSync(targetSessionId, allocatedId);
    }

    const session = this.findSessionByProviderIdentitySync(provider, allocatedId);
    if (session) {
      return this.setProviderSessionIdSync(session.sessionId, allocatedId);
    }

    const sessionById = this.getSessionSync(allocatedId);
    if (sessionById) {
      return this.setProviderSessionIdSync(sessionById.sessionId, allocatedId);
    }
  }

  /**
   * Binds or updates an AgentSession and its associated SessionTaskBinding.
   */
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
    activeTaskId,
    taskIds,
    established, // Ignored in target model (presence of providerSessionId dictates establishment)
  } = {}) {
    if (!provider || typeof provider !== 'string') {
      throw new AiValidationError("'provider' must be a valid string.", { field: 'provider' });
    }
    if (specId !== undefined && specId !== null) {
      if (typeof specId !== 'string' || !UUID_RE.test(specId)) {
        throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
      }
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
    const effectiveSessionId = sessionId || randomUUID();
    const cleanProvSessionId = providerSessionId ? providerSessionId.trim() : undefined;

    return this.#mutateSpec(specId !== undefined ? specId : null, (data) => {
      // 1. Update or create session
      let session = data.sessions.find(
        (s) =>
          s.sessionId === effectiveSessionId ||
          (cleanProvSessionId && s.provider === provider && s.providerSessionId === cleanProvSessionId),
      );

      const accumulatedTaskIds = Array.from(
        new Set([
          ...(session?.taskIds || []),
          ...(Array.isArray(taskIds) ? taskIds : taskId ? [taskId] : []),
        ]),
      );

      const resolvedActiveTaskId = activeTaskId !== undefined ? activeTaskId : (taskId || session?.activeTaskId || undefined);

      if (session) {
        session.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) session.purpose = purpose;
        if (mode !== undefined) session.mode = mode;
        if (model !== undefined) session.model = model.trim();
        if (cleanProvSessionId && !session.providerSessionId) session.providerSessionId = cleanProvSessionId;
        if (resolvedActiveTaskId !== undefined) session.activeTaskId = resolvedActiveTaskId;
        session.taskIds = accumulatedTaskIds;
      } else {
        session = {
          sessionId: effectiveSessionId,
          provider,
          ...(cleanProvSessionId ? { providerSessionId: cleanProvSessionId } : {}),
          specId,
          ...(mode ? { mode } : {}),
          ...(model ? { model: model.trim() } : {}),
          ...(purpose ? { purpose } : {}),
          ...(resolvedActiveTaskId ? { activeTaskId: resolvedActiveTaskId } : {}),
          taskIds: accumulatedTaskIds,
          createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
          lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
        };
        data.sessions.push(session);
      }

      // 2. Update or create task binding if taskId is present
      let binding = null;
      if (taskId) {
        binding = data.bindings.find(
          (b) => b.sessionId === session.sessionId && b.taskId === taskId,
        );
        if (binding) {
          binding.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
          if (step !== undefined) binding.step = step;
          if (attempt !== undefined) binding.attempt = attempt;
        } else {
          binding = {
            sessionId: session.sessionId,
            taskId,
            ...(step ? { step } : {}),
            ...(attempt !== undefined ? { attempt } : {}),
            specId,
            provider,
            createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
            lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
          };
          data.bindings.push(binding);
        }
      }

      // Composite return object compatible with callers expecting legacy binding shape.
      // providerSessionId is reported exactly as known — never substituted with sessionId.
      return {
        sessionId: session.sessionId,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        specId: session.specId,
        ...(taskId ? { taskId } : {}),
        ...(binding?.step ? { step: binding.step } : {}),
        ...(binding?.attempt !== undefined ? { attempt: binding.attempt } : {}),
        ...(session.purpose ? { purpose: session.purpose } : {}),
        ...(session.mode ? { mode: session.mode } : {}),
        ...(session.model ? { model: session.model } : {}),
        activeTaskId: session.activeTaskId,
        taskIds: session.taskIds,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      };
    });
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
    activeTaskId,
    taskIds,
    established,
  } = {}) {
    if (!provider || typeof provider !== 'string') {
      throw new AiValidationError("'provider' must be a valid string.", { field: 'provider' });
    }
    if (specId !== undefined && specId !== null) {
      if (typeof specId !== 'string' || !UUID_RE.test(specId)) {
        throw new AiValidationError("'specId' must be a valid canonical UUID.", { field: 'specId' });
      }
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
    const effectiveSessionId = sessionId || randomUUID();
    const cleanProvSessionId = providerSessionId ? providerSessionId.trim() : undefined;

    return this.#mutateSpecSync(specId !== undefined ? specId : null, (data) => {
      let session = data.sessions.find(
        (s) =>
          s.sessionId === effectiveSessionId ||
          (cleanProvSessionId && s.provider === provider && s.providerSessionId === cleanProvSessionId),
      );

      const accumulatedTaskIds = Array.from(
        new Set([
          ...(session?.taskIds || []),
          ...(Array.isArray(taskIds) ? taskIds : taskId ? [taskId] : []),
        ]),
      );

      const resolvedActiveTaskId = activeTaskId !== undefined ? activeTaskId : (taskId || session?.activeTaskId || undefined);

      if (session) {
        session.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
        if (purpose !== undefined) session.purpose = purpose;
        if (mode !== undefined) session.mode = mode;
        if (model !== undefined) session.model = model.trim();
        if (cleanProvSessionId && !session.providerSessionId) session.providerSessionId = cleanProvSessionId;
        if (resolvedActiveTaskId !== undefined) session.activeTaskId = resolvedActiveTaskId;
        session.taskIds = accumulatedTaskIds;
      } else {
        session = {
          sessionId: effectiveSessionId,
          provider,
          ...(cleanProvSessionId ? { providerSessionId: cleanProvSessionId } : {}),
          specId,
          ...(mode ? { mode } : {}),
          ...(model ? { model: model.trim() } : {}),
          ...(purpose ? { purpose } : {}),
          ...(resolvedActiveTaskId ? { activeTaskId: resolvedActiveTaskId } : {}),
          taskIds: accumulatedTaskIds,
          createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
          lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
        };
        data.sessions.push(session);
      }

      let binding = null;
      if (taskId) {
        binding = data.bindings.find(
          (b) => b.sessionId === session.sessionId && b.taskId === taskId,
        );
        if (binding) {
          binding.lastSeenAt = lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now;
          if (step !== undefined) binding.step = step;
          if (attempt !== undefined) binding.attempt = attempt;
        } else {
          binding = {
            sessionId: session.sessionId,
            taskId,
            ...(step ? { step } : {}),
            ...(attempt !== undefined ? { attempt } : {}),
            specId,
            provider,
            createdAt: createdAt ? normalizeTimestamp(createdAt, 'createdAt') : now,
            lastSeenAt: lastSeenAt ? normalizeTimestamp(lastSeenAt, 'lastSeenAt') : now,
          };
          data.bindings.push(binding);
        }
      }

      return {
        sessionId: session.sessionId,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        specId: session.specId,
        ...(taskId ? { taskId } : {}),
        ...(binding?.step ? { step: binding.step } : {}),
        ...(binding?.attempt !== undefined ? { attempt: binding.attempt } : {}),
        ...(session.purpose ? { purpose: session.purpose } : {}),
        ...(session.mode ? { mode: session.mode } : {}),
        ...(session.model ? { model: session.model } : {}),
        activeTaskId: session.activeTaskId,
        taskIds: session.taskIds,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      };
    });
  }

  async resolveCurrentBinding(provider, sessionIdOrProviderSessionId) {
    if (!sessionIdOrProviderSessionId) return null;
    const all = await this.#loadForSpec();
    const matches = all.sessions
      .filter(
        (s) =>
          s.sessionId === sessionIdOrProviderSessionId ||
          (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
          (s.providerSessionId === sessionIdOrProviderSessionId),
      )
      .sort(compareBindingRecency);
    // A canonical sessionId match is exact identity and always wins; a shared
    // provider-native id across specs (legacy, pre-canonical-identity data) falls back
    // to the most recently touched session rather than an arbitrary directory read order.
    const session = matches.find((s) => s.sessionId === sessionIdOrProviderSessionId) || matches[0];
    if (!session) return null;

    // The current-binding projection must represent exactly ONE task identity. Recency
    // may only choose among bindings that already belong to session.activeTaskId — it
    // must never reach across tasks and pair one task's step/attempt with a different
    // task's taskId (e.g. activeTaskId '01' at implementation/attempt 2, but a newer
    // binding for an unrelated task '02' at review/attempt 1). Absent activeTaskId means
    // no authoritative active task at all: no winning binding, no step, no attempt.
    const activeTaskBindings = session.activeTaskId
      ? all.bindings.filter((b) => b.sessionId === session.sessionId && b.taskId === session.activeTaskId)
      : [];
    const winningBinding = activeTaskBindings.slice().sort(compareBindingRecency)[0];

    return {
      sessionId: session.sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      specId: session.specId,
      // taskId mirrors activeTaskId exactly — never the most-recently-touched binding's
      // taskId, which can be a stale/inactive task. Absent activeTaskId means no
      // authoritative active task, not "pick the winning binding".
      taskId: session.activeTaskId ?? undefined,
      step: winningBinding?.step,
      attempt: winningBinding?.attempt,
      purpose: session.purpose,
      mode: session.mode,
      model: session.model,
      activeTaskId: session.activeTaskId ?? undefined,
      taskIds: session.taskIds || [],
      createdAt: winningBinding?.createdAt || session.createdAt,
      lastSeenAt: winningBinding?.lastSeenAt || session.lastSeenAt,
      lastBootstrapTaskId: session.lastBootstrapTaskId,
      lastBootstrapStep: session.lastBootstrapStep,
      lastBootstrapAttempt: session.lastBootstrapAttempt,
    };
  }

  resolveCurrentBindingSync(provider, sessionIdOrProviderSessionId) {
    if (!sessionIdOrProviderSessionId) return null;
    const all = this.#loadForSpecSync();
    const matches = all.sessions
      .filter(
        (s) =>
          s.sessionId === sessionIdOrProviderSessionId ||
          (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
          (s.providerSessionId === sessionIdOrProviderSessionId),
      )
      .sort(compareBindingRecency);
    const session = matches.find((s) => s.sessionId === sessionIdOrProviderSessionId) || matches[0];
    if (!session) return null;

    // See async resolveCurrentBinding above: recency may only choose among bindings that
    // already belong to session.activeTaskId, never across tasks.
    const activeTaskBindings = session.activeTaskId
      ? all.bindings.filter((b) => b.sessionId === session.sessionId && b.taskId === session.activeTaskId)
      : [];
    const winningBinding = activeTaskBindings.slice().sort(compareBindingRecency)[0];

    return {
      sessionId: session.sessionId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      specId: session.specId,
      // taskId mirrors activeTaskId exactly — see async resolveCurrentBinding above.
      taskId: session.activeTaskId ?? undefined,
      step: winningBinding?.step,
      attempt: winningBinding?.attempt,
      purpose: session.purpose,
      mode: session.mode,
      model: session.model,
      activeTaskId: session.activeTaskId ?? undefined,
      taskIds: session.taskIds || [],
      createdAt: winningBinding?.createdAt || session.createdAt,
      lastSeenAt: winningBinding?.lastSeenAt || session.lastSeenAt,
      lastBootstrapTaskId: session.lastBootstrapTaskId,
      lastBootstrapStep: session.lastBootstrapStep,
      lastBootstrapAttempt: session.lastBootstrapAttempt,
    };
  }

  async updateSessionMode(provider, sessionIdOrProviderSessionId, mode) {
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const current = await this.resolveCurrentBinding(provider, sessionIdOrProviderSessionId);
    if (!current) return null;

    return this.#mutateSpec(current.specId, (data) => {
      const session = data.sessions.find((s) => s.sessionId === current.sessionId);
      if (!session) return null;
      const now = new Date().toISOString();
      session.mode = validatedMode;
      session.lastSeenAt = now;
      for (const b of data.bindings) {
        if (b.sessionId === current.sessionId) {
          b.lastSeenAt = now;
        }
      }
      return {
        ...structuredClone(session),
        taskId: current.taskId,
        taskIds: current.taskIds,
      };
    });
  }

  updateSessionModeSync(provider, sessionIdOrProviderSessionId, mode) {
    const validatedMode = validateAgentExecutionMode(mode, 'mode');
    const current = this.resolveCurrentBindingSync(provider, sessionIdOrProviderSessionId);
    if (!current) return null;

    return this.#mutateSpecSync(current.specId, (data) => {
      const session = data.sessions.find((s) => s.sessionId === current.sessionId);
      if (!session) return null;
      const now = new Date().toISOString();
      session.mode = validatedMode;
      session.lastSeenAt = now;
      for (const b of data.bindings) {
        if (b.sessionId === current.sessionId) {
          b.lastSeenAt = now;
        }
      }
      return {
        ...structuredClone(session),
        taskId: current.taskId,
        taskIds: current.taskIds,
      };
    });
  }

  async updateSessionModel(provider, sessionIdOrProviderSessionId, model) {
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    const current = await this.resolveCurrentBinding(provider, sessionIdOrProviderSessionId);
    if (!current) return null;

    return this.#mutateSpec(current.specId, (data) => {
      const session = data.sessions.find((s) => s.sessionId === current.sessionId);
      if (!session) return null;
      const now = new Date().toISOString();
      session.model = model.trim();
      session.lastSeenAt = now;
      for (const b of data.bindings) {
        if (b.sessionId === current.sessionId) {
          b.lastSeenAt = now;
        }
      }
      return {
        ...structuredClone(session),
        taskId: current.taskId,
        taskIds: current.taskIds,
      };
    });
  }

  updateSessionModelSync(provider, sessionIdOrProviderSessionId, model) {
    if (typeof model !== 'string' || !model.trim()) {
      throw new AiValidationError("'model' must be a non-empty string.", { field: 'model' });
    }
    const current = this.resolveCurrentBindingSync(provider, sessionIdOrProviderSessionId);
    if (!current) return null;

    return this.#mutateSpecSync(current.specId, (data) => {
      const session = data.sessions.find((s) => s.sessionId === current.sessionId);
      if (!session) return null;
      const now = new Date().toISOString();
      session.model = model.trim();
      session.lastSeenAt = now;
      for (const b of data.bindings) {
        if (b.sessionId === current.sessionId) {
          b.lastSeenAt = now;
        }
      }
      return {
        ...structuredClone(session),
        taskId: current.taskId,
        taskIds: current.taskIds,
      };
    });
  }

  async listSessions(query = {}) {
    const all = await this.#loadForSpec(query.specId);
    return all.sessions
      .filter((s) => {
        if (query.specId && s.specId !== query.specId) return false;
        if (query.provider && s.provider !== query.provider) return false;
        if (query.sessionId && s.sessionId !== query.sessionId) return false;
        if (query.providerSessionId && s.providerSessionId !== query.providerSessionId) return false;
        if (query.taskId) {
          const hasTask = s.activeTaskId === query.taskId || (Array.isArray(s.taskIds) && s.taskIds.includes(query.taskId));
          if (!hasTask) return false;
        }
        return true;
      })
      .map((s) => structuredClone(s));
  }

  listSessionsSync(query = {}) {
    const all = this.#loadForSpecSync(query.specId);
    return all.sessions
      .filter((s) => {
        if (query.specId && s.specId !== query.specId) return false;
        if (query.provider && s.provider !== query.provider) return false;
        if (query.sessionId && s.sessionId !== query.sessionId) return false;
        if (query.providerSessionId && s.providerSessionId !== query.providerSessionId) return false;
        if (query.taskId) {
          const hasTask = s.activeTaskId === query.taskId || (Array.isArray(s.taskIds) && s.taskIds.includes(query.taskId));
          if (!hasTask) return false;
        }
        return true;
      })
      .map((s) => structuredClone(s));
  }

  async listBindings(query = {}) {
    const all = await this.#loadForSpec(query.specId);
    const sessionsMap = new Map(all.sessions.map((s) => [s.sessionId, s]));

    const results = [];
    for (const b of all.bindings) {
      if (query.specId && b.specId !== query.specId) continue;
      if (query.taskId && b.taskId !== query.taskId) continue;
      if (query.sessionId && b.sessionId !== query.sessionId) continue;
      const session = sessionsMap.get(b.sessionId);
      if (query.provider && session?.provider !== query.provider && b.provider !== query.provider) continue;
      if (query.providerSessionId && session?.providerSessionId !== query.providerSessionId && b.sessionId !== query.providerSessionId) continue;

      results.push({
        ...structuredClone(b),
        sessionId: b.sessionId,
        provider: session?.provider || b.provider,
        providerSessionId: session?.providerSessionId,
        mode: session?.mode,
        model: session?.model,
        purpose: session?.purpose,
        // Never fall back to this row's own b.taskId — that would fabricate an active
        // task merely because this particular binding row happened to be iterated.
        activeTaskId: session?.activeTaskId ?? undefined,
        taskIds: session?.taskIds || [b.taskId],
      });
    }
    // Also include spec-only sessions that have no task bindings if no taskId query
    if (!query.taskId) {
      for (const session of all.sessions) {
        if (query.specId && session.specId !== query.specId) continue;
        if (query.provider && session.provider !== query.provider) continue;
        if (query.sessionId && session.sessionId !== query.sessionId) continue;
        if (query.providerSessionId && session.providerSessionId !== query.providerSessionId && session.sessionId !== query.providerSessionId) continue;
        const hasBinding = all.bindings.some((b) => b.sessionId === session.sessionId);
        if (!hasBinding) {
          results.push({
            sessionId: session.sessionId,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            specId: session.specId,
            taskId: session.activeTaskId,
            mode: session.mode,
            model: session.model,
            purpose: session.purpose,
            activeTaskId: session.activeTaskId,
            taskIds: session.taskIds || [],
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
          });
        }
      }
    }
    return results;
  }

  listBindingsSync(query = {}) {
    const all = this.#loadForSpecSync(query.specId);
    const sessionsMap = new Map(all.sessions.map((s) => [s.sessionId, s]));

    const results = [];
    for (const b of all.bindings) {
      if (query.specId && b.specId !== query.specId) continue;
      if (query.taskId && b.taskId !== query.taskId) continue;
      if (query.sessionId && b.sessionId !== query.sessionId) continue;
      const session = sessionsMap.get(b.sessionId);
      if (query.provider && session?.provider !== query.provider && b.provider !== query.provider) continue;
      if (query.providerSessionId && session?.providerSessionId !== query.providerSessionId && b.sessionId !== query.providerSessionId) continue;

      results.push({
        ...structuredClone(b),
        sessionId: b.sessionId,
        provider: session?.provider || b.provider,
        providerSessionId: session?.providerSessionId,
        mode: session?.mode,
        model: session?.model,
        purpose: session?.purpose,
        // Never fall back to this row's own b.taskId — see async listBindings above.
        activeTaskId: session?.activeTaskId ?? undefined,
        taskIds: session?.taskIds || [b.taskId],
      });
    }
    if (!query.taskId) {
      for (const session of all.sessions) {
        if (query.specId && session.specId !== query.specId) continue;
        if (query.provider && session.provider !== query.provider) continue;
        if (query.sessionId && session.sessionId !== query.sessionId) continue;
        if (query.providerSessionId && session.providerSessionId !== query.providerSessionId && session.sessionId !== query.providerSessionId) continue;
        const hasBinding = all.bindings.some((b) => b.sessionId === session.sessionId);
        if (!hasBinding) {
          results.push({
            sessionId: session.sessionId,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            specId: session.specId,
            taskId: session.activeTaskId,
            mode: session.mode,
            model: session.model,
            purpose: session.purpose,
            activeTaskId: session.activeTaskId,
            taskIds: session.taskIds || [],
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
          });
        }
      }
    }
    return results;
  }

  async getBinding(provider, sessionIdOrProviderSessionId) {
    return await this.resolveCurrentBinding(provider, sessionIdOrProviderSessionId);
  }

  async recordBootstrapState(provider, sessionIdOrProviderSessionId, { taskId, step, attempt, sessionId } = {}) {
    const targetSessionId = sessionId || sessionIdOrProviderSessionId;
    const updateSession = (data) => {
      let changed = false;
      for (const session of data.sessions) {
        if (session.sessionId === targetSessionId || session.providerSessionId === sessionIdOrProviderSessionId) {
          session.lastBootstrapTaskId = taskId;
          session.lastBootstrapStep = step;
          session.lastBootstrapAttempt = attempt;
          session.lastSeenAt = new Date().toISOString();
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      await this.#mutateSpec(null, (data) => updateSession(data));
      return;
    }

    const all = await this.#loadForSpec();
    const matchingSpecs = new Set(
      all.sessions
        .filter((s) => s.sessionId === targetSessionId || s.providerSessionId === sessionIdOrProviderSessionId)
        .map((s) => s.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      await this.#mutateSpec(specId, (data) => updateSession(data));
    }
  }

  recordBootstrapStateSync(provider, sessionIdOrProviderSessionId, { taskId, step, attempt, sessionId } = {}) {
    const targetSessionId = sessionId || sessionIdOrProviderSessionId;
    const updateSession = (data) => {
      let changed = false;
      for (const session of data.sessions) {
        if (session.sessionId === targetSessionId || session.providerSessionId === sessionIdOrProviderSessionId) {
          session.lastBootstrapTaskId = taskId;
          session.lastBootstrapStep = step;
          session.lastBootstrapAttempt = attempt;
          session.lastSeenAt = new Date().toISOString();
          changed = true;
        }
      }
      return changed;
    };

    if (this.#storageFile) {
      this.#mutateSpecSync(null, (data) => updateSession(data));
      return;
    }

    const all = this.#loadForSpecSync();
    const matchingSpecs = new Set(
      all.sessions
        .filter((s) => s.sessionId === targetSessionId || s.providerSessionId === sessionIdOrProviderSessionId)
        .map((s) => s.specId)
        .filter(Boolean),
    );

    for (const specId of matchingSpecs) {
      this.#mutateSpecSync(specId, (data) => updateSession(data));
    }
  }

  async getTasksForSession(provider, sessionIdOrProviderSessionId, specId) {
    const current = await this.resolveCurrentBinding(provider, sessionIdOrProviderSessionId);
    if (!current) return [];
    const all = await this.#loadForSpec(specId || current.specId);
    const sessionBindings = all.bindings
      .filter((b) => b.sessionId === current.sessionId)
      .sort(compareBindingRecency);

    const seen = new Set();
    const tasks = [];
    for (const b of sessionBindings) {
      if (!seen.has(b.taskId)) {
        seen.add(b.taskId);
        tasks.push(structuredClone(b));
      }
    }
    return tasks;
  }

  getTasksForSessionSync(provider, sessionIdOrProviderSessionId, specId) {
    const current = this.resolveCurrentBindingSync(provider, sessionIdOrProviderSessionId);
    if (!current) return [];
    const all = this.#loadForSpecSync(specId || current.specId);
    const sessionBindings = all.bindings
      .filter((b) => b.sessionId === current.sessionId)
      .sort(compareBindingRecency);

    const seen = new Set();
    const tasks = [];
    for (const b of sessionBindings) {
      if (!seen.has(b.taskId)) {
        seen.add(b.taskId);
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
    const specData = await this.#loadForSpec(specId);
    const matchingSessionIds = new Set(
      specData.bindings.filter((b) => b.taskId === taskId).map((b) => b.sessionId),
    );
    for (const s of specData.sessions) {
      if (s.activeTaskId === taskId || (Array.isArray(s.taskIds) && s.taskIds.includes(taskId))) {
        matchingSessionIds.add(s.sessionId);
      }
    }

    return specData.sessions
      .filter((s) => matchingSessionIds.has(s.sessionId))
      .sort(compareBindingRecency)
      .map((s) => structuredClone(s));
  }

  getSessionsForTaskSync(specId, taskId) {
    if (!specId || typeof specId !== 'string') {
      throw new AiValidationError("'specId' must be a valid string.", { field: 'specId' });
    }
    if (!taskId || typeof taskId !== 'string') {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const specData = this.#loadForSpecSync(specId);
    const matchingSessionIds = new Set(
      specData.bindings.filter((b) => b.taskId === taskId).map((b) => b.sessionId),
    );
    for (const s of specData.sessions) {
      if (s.activeTaskId === taskId || (Array.isArray(s.taskIds) && s.taskIds.includes(taskId))) {
        matchingSessionIds.add(s.sessionId);
      }
    }

    return specData.sessions
      .filter((s) => matchingSessionIds.has(s.sessionId))
      .sort(compareBindingRecency)
      .map((s) => structuredClone(s));
  }

  async setActiveTaskId(provider, sessionIdOrProviderSessionId, taskId, specIdOrOptions = {}) {
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const cleanTaskId = taskId.trim();
    let targetSpecId = typeof specIdOrOptions === 'string' ? specIdOrOptions : specIdOrOptions?.specId;
    if (!targetSpecId) {
      const current = await this.resolveCurrentBinding(provider, sessionIdOrProviderSessionId);
      targetSpecId = current?.specId;
    }
    if (!targetSpecId) {
      throw new AiValidationError('Cannot set active task: session has no associated specification.', {
        field: 'specId',
      });
    }

    return this.#mutateSpec(targetSpecId, (data) => {
      const session = data.sessions.find(
        (s) =>
          s.sessionId === sessionIdOrProviderSessionId ||
          (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
          (s.providerSessionId === sessionIdOrProviderSessionId),
      );
      if (!session) {
        throw new AiValidationError('Cannot set active task: session not found.', { field: 'sessionId' });
      }

      const now = new Date().toISOString();
      session.activeTaskId = cleanTaskId;
      session.lastSeenAt = now;
      if (!Array.isArray(session.taskIds)) session.taskIds = [];
      if (!session.taskIds.includes(cleanTaskId)) session.taskIds.push(cleanTaskId);

      let binding = data.bindings.find(
        (b) => b.sessionId === session.sessionId && b.taskId === cleanTaskId,
      );
      if (!binding) {
        binding = {
          sessionId: session.sessionId,
          taskId: cleanTaskId,
          specId: targetSpecId,
          provider: session.provider,
          createdAt: now,
          lastSeenAt: now,
        };
        data.bindings.push(binding);
      } else {
        binding.lastSeenAt = now;
      }

      return {
        ...structuredClone(session),
        taskId: cleanTaskId,
      };
    });
  }

  setActiveTaskIdSync(provider, sessionIdOrProviderSessionId, taskId, specIdOrOptions = {}) {
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new AiValidationError("'taskId' must be a non-empty string.", { field: 'taskId' });
    }
    const cleanTaskId = taskId.trim();
    let targetSpecId = typeof specIdOrOptions === 'string' ? specIdOrOptions : specIdOrOptions?.specId;
    if (!targetSpecId) {
      const current = this.resolveCurrentBindingSync(provider, sessionIdOrProviderSessionId);
      targetSpecId = current?.specId;
    }
    if (!targetSpecId) {
      throw new AiValidationError('Cannot set active task: session has no associated specification.', {
        field: 'specId',
      });
    }

    return this.#mutateSpecSync(targetSpecId, (data) => {
      const session = data.sessions.find(
        (s) =>
          s.sessionId === sessionIdOrProviderSessionId ||
          (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
          (s.providerSessionId === sessionIdOrProviderSessionId),
      );
      if (!session) {
        throw new AiValidationError('Cannot set active task: session not found.', { field: 'sessionId' });
      }

      const now = new Date().toISOString();
      session.activeTaskId = cleanTaskId;
      session.lastSeenAt = now;
      if (!Array.isArray(session.taskIds)) session.taskIds = [];
      if (!session.taskIds.includes(cleanTaskId)) session.taskIds.push(cleanTaskId);

      let binding = data.bindings.find(
        (b) => b.sessionId === session.sessionId && b.taskId === cleanTaskId,
      );
      if (!binding) {
        binding = {
          sessionId: session.sessionId,
          taskId: cleanTaskId,
          specId: targetSpecId,
          provider: session.provider,
          createdAt: now,
          lastSeenAt: now,
        };
        data.bindings.push(binding);
      } else {
        binding.lastSeenAt = now;
      }

      return {
        ...structuredClone(session),
        taskId: cleanTaskId,
      };
    });
  }

  async unbindSession(provider, sessionIdOrProviderSessionId) {
    const matchesSession = (s) =>
      s.sessionId === sessionIdOrProviderSessionId ||
      (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
      (s.providerSessionId === sessionIdOrProviderSessionId);

    if (this.#storageFile) {
      await this.#mutateSpec(null, (data) => {
        const session = data.sessions.find(matchesSession);
        if (session) {
          data.sessions = data.sessions.filter((s) => s.sessionId !== session.sessionId);
          data.bindings = data.bindings.filter((b) => b.sessionId !== session.sessionId);
        }
      });
      return;
    }

    const all = await this.#loadForSpec();
    const matchingSessions = all.sessions.filter(matchesSession);
    const matchingSpecs = new Set(matchingSessions.map((s) => s.specId).filter(Boolean));

    for (const specId of matchingSpecs) {
      await this.#mutateSpec(specId, (specData) => {
        const toRemove = new Set(specData.sessions.filter(matchesSession).map((s) => s.sessionId));
        specData.sessions = specData.sessions.filter((s) => !toRemove.has(s.sessionId));
        specData.bindings = specData.bindings.filter((b) => !toRemove.has(b.sessionId));
      });
    }
  }

  unbindSessionSync(provider, sessionIdOrProviderSessionId) {
    const matchesSession = (s) =>
      s.sessionId === sessionIdOrProviderSessionId ||
      (provider && s.provider === provider && s.providerSessionId === sessionIdOrProviderSessionId) ||
      (s.providerSessionId === sessionIdOrProviderSessionId);

    if (this.#storageFile) {
      this.#mutateSpecSync(null, (data) => {
        const session = data.sessions.find(matchesSession);
        if (session) {
          data.sessions = data.sessions.filter((s) => s.sessionId !== session.sessionId);
          data.bindings = data.bindings.filter((b) => b.sessionId !== session.sessionId);
        }
      });
      return;
    }

    const all = this.#loadForSpecSync();
    const matchingSessions = all.sessions.filter(matchesSession);
    const matchingSpecs = new Set(matchingSessions.map((s) => s.specId).filter(Boolean));

    for (const specId of matchingSpecs) {
      this.#mutateSpecSync(specId, (specData) => {
        const toRemove = new Set(specData.sessions.filter(matchesSession).map((s) => s.sessionId));
        specData.sessions = specData.sessions.filter((s) => !toRemove.has(s.sessionId));
        specData.bindings = specData.bindings.filter((b) => !toRemove.has(b.sessionId));
      });
    }
  }
}

export function createAgentSessionBindingService(options) {
  return new AgentSessionBindingService(options);
}
