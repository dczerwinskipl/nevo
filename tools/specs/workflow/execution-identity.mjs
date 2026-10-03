import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Reads Codex bridge context from `.nevo-ai-local/codex-context/` if present.
 */
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

/**
 * Neutral reader for ambient agent execution context.
 * Resolves NEVO_SESSION_ID, NEVO_AGENT_PROVIDER, NEVO_AGENT_PROVIDER_SESSION_ID,
 * or codex bridge fallback. Zero dashboard dependencies.
 */
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
 * Loads a persisted session record from `.nevo-ai-local/sessions/<specId>.json` via pure fs.
 * Strict zero-dashboard import boundary (C2, D16).
 *
 * @param {string} repoRoot
 * @param {string} specId
 * @param {string} sessionId
 * @returns {object|null}
 */
export function loadPersistedSessionSync(repoRoot, specId, sessionId) {
  if (!repoRoot || !specId || !sessionId) return null;
  const filePath = join(repoRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed) ? parsed : (parsed?.sessions || []);
    return sessions.find(s => s.sessionId === sessionId || s.providerSessionId === sessionId) || null;
  } catch {
    return null;
  }
}

/**
 * Updates lineage fields (predecessorSessions, parentSessionId) on persisted session record.
 * Zero dashboard dependencies.
 */
export function updatePersistedSessionLineageSync(repoRoot, sessionId, { predecessorSessions, parentSessionId = null } = {}, { specId } = {}) {
  if (!repoRoot || !sessionId) return null;
  const sessionsDir = join(repoRoot, '.nevo-ai-local', 'sessions');
  if (!existsSync(sessionsDir)) return null;
  const specFiles = specId ? [`${specId}.json`, '_global.json'] : ['_global.json'];
  for (const file of specFiles) {
    const filePath = join(sessionsDir, file);
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const isArray = Array.isArray(parsed);
      const sessions = isArray ? parsed : (parsed?.sessions || []);
      const session = sessions.find(s => s.sessionId === sessionId || s.providerSessionId === sessionId);
      if (session) {
        if (Array.isArray(predecessorSessions)) {
          session.predecessorSessions = [...predecessorSessions];
        }
        session.parentSessionId = parentSessionId;
        session.lastSeenAt = new Date().toISOString();
        const writeData = isArray ? sessions : { ...parsed, sessions };
        writeFileSync(filePath, JSON.stringify(writeData, null, 2), 'utf8');
        return session;
      }
    } catch {}
  }
  return null;
}

/**
 * Lists bindings from persisted session files for lineage resolution.
 * Zero dashboard dependencies.
 */
export function listPersistedBindingsSync(repoRoot, { specId, taskId, step } = {}) {
  if (!repoRoot) return [];
  const sessionsDir = join(repoRoot, '.nevo-ai-local', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const results = [];
  const files = specId ? [`${specId}.json`, '_global.json'] : ['_global.json'];
  for (const file of files) {
    const filePath = join(sessionsDir, file);
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const bindings = parsed?.bindings || [];
      for (const b of bindings) {
        if (taskId && b.taskId !== taskId) continue;
        if (step && b.step !== step) continue;
        if (specId && b.specId && b.specId !== specId) continue;
        results.push(b);
      }
    } catch {}
  }
  return results;
}

export function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Validates fail-closed batch execution identity across ambient session,
 * persisted session record, active workspace-writer claim, and queue reservation.
 * Zero dashboard imports.
 */
export function verifyBatchTrustedIdentity(params = {}) {
  const {
    repoRoot,
    changeSlug,
    specId,
    batchExecutionId,
    sessionId: explicitSessionId,
    taskIds,
    reservation,
    claim: explicitClaim,
  } = params;

  const effectiveSessionId = explicitSessionId || readAgentExecutionContext(process.env, { repoRoot, specId })?.sessionId || null;
  if (!effectiveSessionId) {
    const err = new Error('No trusted ambient session identity found for batch authorization');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'missing-trusted-session';
    throw err;
  }

  // 1. Live workspace-writer claim verification
  const claim = explicitClaim !== undefined ? explicitClaim : (params.getClaim ? params.getClaim(repoRoot) : null);
  if (!claim) {
    const err = new Error('No active workspace-writer claim found; cannot authorize batch');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'missing-claim';
    throw err;
  }

  if (!claim.sessionId) {
    const err = new Error('Workspace-writer claim is missing sessionId');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'claim-missing-session';
    throw err;
  }

  if (claim.sessionId !== effectiveSessionId) {
    const err = new Error(`Workspace-writer claim session '${claim.sessionId}' does not match caller session '${effectiveSessionId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'claim-session-mismatch';
    throw err;
  }

  if (claim.scope?.kind !== 'task-batch') {
    const err = new Error(`Workspace-writer claim scope kind is '${claim.scope?.kind}', expected 'task-batch'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'claim-scope-mismatch';
    throw err;
  }

  if (!claim.batchExecutionId || claim.batchExecutionId !== batchExecutionId) {
    const err = new Error(`Workspace-writer claim batchExecutionId '${claim.batchExecutionId}' does not match '${batchExecutionId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'claim-batch-id-mismatch';
    throw err;
  }

  if (!Array.isArray(claim.scope?.taskIds) || !arraysEqual(claim.scope.taskIds, taskIds)) {
    const err = new Error('Workspace-writer claim taskIds do not match batch taskIds');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'claim-task-ids-mismatch';
    throw err;
  }

  // 2. Reservation verification
  if (!reservation) {
    const err = new Error(`Reservation '${batchExecutionId}' not found for change '${changeSlug}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'reservation-not-found';
    throw err;
  }

  if (reservation.status !== 'reserved') {
    const err = new Error(`Reservation '${batchExecutionId}' is not active (status: ${reservation.status})`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'reservation-not-active';
    throw err;
  }

  if (reservation.batchExecutionId !== batchExecutionId) {
    const err = new Error(`Reservation batchExecutionId '${reservation.batchExecutionId}' does not match '${batchExecutionId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'reservation-batch-id-mismatch';
    throw err;
  }

  if (reservation.sessionId && reservation.sessionId !== effectiveSessionId) {
    const err = new Error(`Reservation session '${reservation.sessionId}' does not match caller session '${effectiveSessionId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'reservation-session-mismatch';
    throw err;
  }

  if (taskIds && !arraysEqual(reservation.taskIds, taskIds)) {
    const err = new Error('Reservation taskIds do not match batch taskIds');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'reservation-task-ids-mismatch';
    throw err;
  }

  // 3. Persisted AgentSession verification
  const session = loadPersistedSessionSync(repoRoot, specId, effectiveSessionId);
  if (!session) {
    const err = new Error(`Persisted AgentSession for '${effectiveSessionId}' not found`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'session-not-found';
    throw err;
  }

  if (!session.batchExecutionId || session.batchExecutionId !== batchExecutionId) {
    const err = new Error(`Persisted session batchExecutionId '${session.batchExecutionId}' does not match '${batchExecutionId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'session-batch-id-mismatch';
    throw err;
  }

  if (!session.executionScope || session.executionScope.kind !== 'task-batch') {
    const err = new Error(`Persisted session executionScope kind is '${session.executionScope?.kind}', expected 'task-batch'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'session-scope-kind-mismatch';
    throw err;
  }

  if (session.specId && session.specId !== specId) {
    const err = new Error(`Persisted session specId '${session.specId}' does not match '${specId}'`);
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'session-spec-id-mismatch';
    throw err;
  }

  if (Array.isArray(session.executionScope.taskIds) && taskIds && !arraysEqual(session.executionScope.taskIds, taskIds)) {
    const err = new Error('Persisted session taskIds do not match batch taskIds');
    err.code = 'BATCH_IDENTITY_MISMATCH';
    err.reason = 'session-task-ids-mismatch';
    throw err;
  }

  return { effectiveSessionId, session, claim };
}

