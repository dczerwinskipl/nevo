// Durable workspace-writer slot and workspace-control lock (D55, D56, D65, D70, D80, D82, D89, D92, D99).
// Keyed by physical worktree (.nevo-ai-local/locks/workspace-writer.lock), never specId.
// All read-decide-mutate operations are atomic under workspace-control.lock.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

export function isProcessAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function getLocksDir(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'locks');
}

export function getWorkspaceWriterLockPath(repoRoot) {
  return path.join(getLocksDir(repoRoot), 'workspace-writer.lock');
}

function getWorkspaceControlLockPath(repoRoot) {
  return path.join(getLocksDir(repoRoot), 'workspace-control.lock');
}

function atomicWriteWorkspaceWriterClaim(repoRoot, claim) {
  const locksDir = getLocksDir(repoRoot);
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true });
  }
  const lockFile = getWorkspaceWriterLockPath(repoRoot);
  const tempFile = path.join(locksDir, `workspace-writer.${randomUUID()}.tmp`);
  fs.writeFileSync(tempFile, JSON.stringify(claim, null, 2), 'utf8');
  fs.renameSync(tempFile, lockFile);
}

/**
 * Short-lived cross-process lock protecting read-decide-mutate operations on the
 * workspace-writer record and atomic requestSequence allocation (D80, D81, D92).
 *
 * @param {Function} fn - Function to run inside lock
 * @param {object} params
 * @param {string} params.repoRoot - Repository root
 * @param {number} [params.timeoutMs=5000] - Acquisition timeout
 * @param {number} [params.retryIntervalMs=25] - Retry interval
 * @returns {Promise<any>}
 */
export async function withWorkspaceControlLock(fn, { repoRoot, timeoutMs = 5000, retryIntervalMs = 25 } = {}) {
  if (!repoRoot) {
    throw new WorkflowError('withWorkspaceControlLock requires repoRoot');
  }

  const lockFile = getWorkspaceControlLockPath(repoRoot);
  const locksDir = path.dirname(lockFile);
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true });
  }

  const startTime = Date.now();
  let acquired = false;

  while (Date.now() - startTime <= timeoutMs) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
      acquired = true;
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      let existing = null;
      try {
        const raw = fs.readFileSync(lockFile, 'utf8');
        existing = JSON.parse(raw);
      } catch {
        try { fs.unlinkSync(lockFile); } catch {}
        continue;
      }

      if (!existing?.pid || !isProcessAlive(existing.pid)) {
        try { fs.unlinkSync(lockFile); } catch {}
        continue;
      }

      await new Promise(r => setTimeout(r, retryIntervalMs));
    }
  }

  if (!acquired) {
    throw new WorkflowError(`Failed to acquire workspace-control lock within ${timeoutMs}ms`, { code: 'WORKSPACE_CONTROL_LOCK_TIMEOUT' });
  }

  try {
    return await fn();
  } finally {
    try {
      const raw = fs.readFileSync(lockFile, 'utf8');
      const existing = JSON.parse(raw);
      if (existing.pid === process.pid) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Ignore if gone or unreadable
    }
  }
}

// In-process pending waiters list for dashboard wakeup hint (D57, D72)
const pendingWaiters = [];

/**
 * Returns pending workspace writer requests as a local in-process wakeup hint.
 *
 * @param {string} [specId] - Optional filter by specId
 * @returns {Array<{ kind: string, requestedAt: string }>}
 */
export function listPendingWorkspaceWriters(specId) {
  let list = pendingWaiters;
  if (specId) {
    list = list.filter(w => !w.specId || w.specId === specId);
  }
  return list.map(w => ({ kind: w.kind, requestedAt: w.requestedAt }));
}

/**
 * Reads the current workspace-writer claim if one exists.
 *
 * @param {string} repoRoot
 * @returns {object|null}
 */
export function getWorkspaceWriterClaim(repoRoot) {
  const lockFile = getWorkspaceWriterLockPath(repoRoot);
  try {
    if (!fs.existsSync(lockFile)) return null;
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (err) {
    return {
      status: 'recovery-required',
      reason: 'corrupt-claim',
      rawError: err.message,
    };
  }
}

/**
 * Two-phase acquisition of workspace-writer slot (D92).
 * Phase A: inspects/acquires inside withWorkspaceControlLock.
 * Phase B: outside lock, reconciles dead request-backed claims and retries.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {'agent'|'cli-manual'|'human-submit'|'publish'|'batch-publish'} params.kind
 * @param {string} [params.requestId]
 * @param {any} [params.operationRef]
 * @param {string} params.specId
 * @param {string} [params.taskId]
 * @param {string} [params.sessionId]
 * @param {string} [params.turnId]
 * @param {'prepared'|'invoking'|'started'} [params.turnStartState]
 * @param {number} [params.timeoutMs=15000]
 * @param {number} [params.retryIntervalMs=50]
 * @returns {Promise<{ acquired: boolean, ownerId?: string, lease?: object, blocked?: boolean, contended?: boolean, reason?: string, currentClaim?: object }>}
 */
export async function acquireWorkspaceWriter(params = {}) {
  const {
    repoRoot,
    kind,
    requestId,
    operationRef,
    specId,
    taskId,
    sessionId,
    turnId,
    turnStartState,
    timeoutMs = 15000,
    retryIntervalMs = 50,
  } = params;

  if (!repoRoot) {
    throw new WorkflowError('acquireWorkspaceWriter requires repoRoot');
  }
  if (!kind || !specId) {
    throw new WorkflowError('acquireWorkspaceWriter requires kind and specId');
  }
  if (turnStartState !== undefined) {
    if (kind !== 'agent') {
      throw new WorkflowError(`turnStartState is legal only for kind: 'agent'`);
    }
    if (!['prepared', 'invoking', 'started'].includes(turnStartState)) {
      throw new WorkflowError(`Invalid turnStartState: '${turnStartState}'`);
    }
  }

  const lockFile = getWorkspaceWriterLockPath(repoRoot);
  const startTime = Date.now();

  while (Date.now() - startTime <= timeoutMs) {
    // Phase A: atomic check-and-acquire under control lock
    const phaseA = await withWorkspaceControlLock(async () => {
      if (!fs.existsSync(lockFile)) {
        const ownerId = randomUUID();
        const claim = {
          ownerId,
          kind,
          status: 'active',
          ...(requestId ? { requestId } : {}),
          ...(operationRef ? { operationRef } : {}),
          specId,
          ...(params.changeSlug ? { changeSlug: params.changeSlug } : {}),
          ...(taskId ? { taskId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(turnStartState ? { turnStartState } : {}),
          pid: process.pid,
          createdAt: new Date().toISOString(),
        };
        atomicWriteWorkspaceWriterClaim(repoRoot, claim);
        return { phase: 'acquired', claim };
      }

      let current;
      try {
        current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch (err) {
        const corruptClaim = {
          status: 'recovery-required',
          reason: 'corrupt-claim',
          rawError: err.message,
        };
        return { phase: 'blocked', reason: 'recovery-required', currentClaim: corruptClaim };
      }

      if (current.status === 'recovery-required') {
        return { phase: 'blocked', reason: 'recovery-required', currentClaim: current };
      }

      const isRequestBacked = ['human-submit', 'publish', 'batch-publish'].includes(current.kind);
      if (isRequestBacked && current.pid && !isProcessAlive(current.pid)) {
        return {
          phase: 'needsReconciliation',
          claimSnapshot: { ...current },
        };
      }

      return { phase: 'contended', currentClaim: current };
    }, { repoRoot });

    // Phase B: outside lock
    if (phaseA.phase === 'acquired') {
      const claim = phaseA.claim;
      return {
        acquired: true,
        ownerId: claim.ownerId,
        lease: {
          ...claim,
          release: () => releaseWorkspaceWriter({ repoRoot, ownerId: claim.ownerId }),
        },
      };
    }

    if (phaseA.phase === 'blocked') {
      return {
        acquired: false,
        blocked: true,
        reason: phaseA.reason,
        currentClaim: phaseA.currentClaim,
      };
    }

    if (phaseA.phase === 'needsReconciliation') {
      const { reconcileRequestBackedWorkspaceClaim } = await import('./workspace-claim-reconciliation.mjs');
      await reconcileRequestBackedWorkspaceClaim({
        repoRoot,
        claimSnapshot: phaseA.claimSnapshot,
      });
      // Retries from authoritative current state
      continue;
    }

    if (phaseA.phase === 'retry') {
      continue;
    }

    // Contended: register local wakeup hint and back off
    const waiterId = randomUUID();
    const waiter = { id: waiterId, kind, specId, requestedAt: new Date().toISOString() };
    pendingWaiters.push(waiter);
    try {
      if (Date.now() - startTime + retryIntervalMs > timeoutMs) {
        return {
          acquired: false,
          contended: true,
          reason: 'contended',
          currentClaim: phaseA.currentClaim,
        };
      }
      await new Promise(r => setTimeout(r, retryIntervalMs));
    } finally {
      const idx = pendingWaiters.findIndex(w => w.id === waiterId);
      if (idx !== -1) pendingWaiters.splice(idx, 1);
    }
  }

  return {
    acquired: false,
    contended: true,
    reason: 'timeout',
    currentClaim: getWorkspaceWriterClaim(repoRoot),
  };
}

/**
 * Normal self-release of workspace-writer claim by owner.
 *
 * @param {object} leaseOrParams
 * @returns {Promise<{ released: boolean }>}
 */
export async function releaseWorkspaceWriter({ repoRoot, ownerId }) {
  if (!repoRoot || !ownerId) return { released: false };
  return await releaseWorkspaceWriterIfOwned({ repoRoot, expectedOwnerId: ownerId });
}

/**
 * Ownership-conditional release of workspace-writer slot under workspace-control lock (D70, D80, D82).
 * Verifies expectedOwnerId and any optional expected fields before deleting.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.expectedOwnerId - Mandatory
 * @param {string} [params.expectedRequestId]
 * @param {string} [params.expectedKind]
 * @param {string} [params.expectedSpecId]
 * @param {string} [params.expectedTaskId]
 * @param {string} [params.expectedSessionId]
 * @param {string} [params.expectedTurnId]
 * @returns {Promise<{ released: boolean, reason?: string, currentClaim?: object }>}
 */
export async function releaseWorkspaceWriterIfOwned(params = {}) {
  const {
    repoRoot,
    expectedOwnerId,
    expectedRequestId,
    expectedKind,
    expectedSpecId,
    expectedChangeSlug,
    expectedTaskId,
    expectedSessionId,
    expectedTurnId,
  } = params;

  if (!repoRoot || !expectedOwnerId) {
    return { released: false, reason: 'missing-parameters' };
  }

  const lockFile = getWorkspaceWriterLockPath(repoRoot);

  return await withWorkspaceControlLock(async () => {
    if (!fs.existsSync(lockFile)) {
      return { released: false, reason: 'not-found' };
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch {
      return { released: false, reason: 'corrupt-record' };
    }

    if (current.ownerId !== expectedOwnerId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedRequestId !== undefined && current.requestId !== expectedRequestId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedKind !== undefined && current.kind !== expectedKind) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedSpecId !== undefined && current.specId !== expectedSpecId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedChangeSlug !== undefined && current.changeSlug !== expectedChangeSlug) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedTaskId !== undefined && current.taskId !== expectedTaskId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedSessionId !== undefined && current.sessionId !== expectedSessionId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedTurnId !== undefined && current.turnId !== expectedTurnId) {
      return { released: false, reason: 'not-current-owner', currentClaim: current };
    }

    try {
      fs.unlinkSync(lockFile);
    } catch {}

    return { released: true };
  }, { repoRoot });
}

/**
 * Ownership-conditional marking of recovery-required under workspace-control lock (D70, D80).
 *
 * @param {object} params
 * @returns {Promise<{ marked: boolean, reason?: string, currentClaim?: object }>}
 */
export async function markWorkspaceWriterRecoveryRequiredIfOwned(params = {}) {
  const {
    repoRoot,
    expectedOwnerId,
    expectedRequestId,
    expectedKind,
    expectedSpecId,
    expectedChangeSlug,
    expectedTaskId,
    expectedSessionId,
    expectedTurnId,
  } = params;

  if (!repoRoot || !expectedOwnerId) {
    return { marked: false, reason: 'missing-parameters' };
  }

  const lockFile = getWorkspaceWriterLockPath(repoRoot);

  return await withWorkspaceControlLock(async () => {
    if (!fs.existsSync(lockFile)) {
      return { marked: false, reason: 'not-found' };
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch {
      return { marked: false, reason: 'corrupt-record' };
    }

    if (current.ownerId !== expectedOwnerId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedRequestId !== undefined && current.requestId !== expectedRequestId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedKind !== undefined && current.kind !== expectedKind) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedSpecId !== undefined && current.specId !== expectedSpecId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedChangeSlug !== undefined && current.changeSlug !== expectedChangeSlug) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedTaskId !== undefined && current.taskId !== expectedTaskId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedSessionId !== undefined && current.sessionId !== expectedSessionId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedTurnId !== undefined && current.turnId !== expectedTurnId) {
      return { marked: false, reason: 'not-current-owner', currentClaim: current };
    }

    current.status = 'recovery-required';
    current.updatedAt = new Date().toISOString();
    atomicWriteWorkspaceWriterClaim(repoRoot, current);

    return { marked: true, currentClaim: current };
  }, { repoRoot });
}

/**
 * Ownership-conditional enrichment of workspace-writer record under workspace-control lock (D89, D93, D99).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.expectedOwnerId - Mandatory
 * @param {string} [params.sessionId]
 * @param {string} [params.turnId]
 * @param {'prepared'|'invoking'|'started'} [params.turnStartState]
 * @param {string} [params.specId]
 * @param {string} [params.changeSlug]
 * @param {string} [params.taskId]
 * @returns {Promise<{ updated: boolean, reason?: string, currentClaim?: object }>}
 */
export async function updateWorkspaceWriterIfOwned(params = {}) {
  const {
    repoRoot,
    expectedOwnerId,
    expectedRequestId,
    expectedKind,
    expectedSpecId,
    expectedChangeSlug,
    expectedTaskId,
    sessionId,
    turnId,
    turnStartState,
    specId,
    changeSlug,
    taskId,
  } = params;

  if (!repoRoot || !expectedOwnerId) {
    return { updated: false, reason: 'missing-parameters' };
  }

  const lockFile = getWorkspaceWriterLockPath(repoRoot);

  return await withWorkspaceControlLock(async () => {
    if (!fs.existsSync(lockFile)) {
      return { updated: false, reason: 'not-found' };
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch {
      return { updated: false, reason: 'corrupt-record' };
    }

    if (current.ownerId !== expectedOwnerId) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedRequestId !== undefined && current.requestId !== expectedRequestId) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedKind !== undefined && current.kind !== expectedKind) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedSpecId !== undefined && current.specId !== expectedSpecId) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedChangeSlug !== undefined && current.changeSlug !== expectedChangeSlug) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }
    if (expectedTaskId !== undefined && current.taskId !== expectedTaskId) {
      return { updated: false, reason: 'not-current-owner', currentClaim: current };
    }

    if (turnStartState !== undefined) {
      if (current.kind !== 'agent') {
        throw new WorkflowError(`turnStartState is legal only for kind: 'agent'`);
      }
      if (!['prepared', 'invoking', 'started'].includes(turnStartState)) {
        throw new WorkflowError(`Invalid turnStartState: '${turnStartState}'`);
      }
      current.turnStartState = turnStartState;
    }

    if (sessionId !== undefined) current.sessionId = sessionId;
    if (turnId !== undefined) current.turnId = turnId;
    if (specId !== undefined) current.specId = specId;
    if (changeSlug !== undefined) current.changeSlug = changeSlug;
    if (taskId !== undefined) current.taskId = taskId;

    current.updatedAt = new Date().toISOString();
    atomicWriteWorkspaceWriterClaim(repoRoot, current);

    return { updated: true, currentClaim: current };
  }, { repoRoot });
}

/**
 * Force release workspace writer record unconditionally.
 * Internal/test-only — not called by normal orchestration code (D70).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @returns {Promise<boolean>}
 */
export async function forceReleaseWorkspaceWriterUnsafe({ repoRoot }) {
  if (!repoRoot) return false;
  const lockFile = getWorkspaceWriterLockPath(repoRoot);
  return await withWorkspaceControlLock(async () => {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
      return true;
    } catch {
      return false;
    }
  }, { repoRoot });
}
