// Cross-process git-finalize lease (D47, D50, D51).
// Manages the shared, cross-process git-finalize lease around the narrow mutate-then-commit
// critical section at `.nevo-ai-local/locks/git-finalize.lock`.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

function isProcessAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function getLockFilePath(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
}

/**
 * Releases the git-finalize lease only if ownerId matches the current holder.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.ownerId
 * @returns {boolean}
 */
export function releaseGitFinalizeLease({ repoRoot, ownerId }) {
  if (!repoRoot || !ownerId) return false;
  const lockFile = getLockFilePath(repoRoot);
  try {
    if (!fs.existsSync(lockFile)) return true;
    const raw = fs.readFileSync(lockFile, 'utf8');
    const existing = JSON.parse(raw);
    if (existing.ownerId === ownerId) {
      fs.unlinkSync(lockFile);
      return true;
    }
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    return false;
  }
}

/**
 * Acquires a git-finalize lease with exclusive creation and stale PID reclamation.
 *
 * @param {object} params
 * @param {string} params.repoRoot - Repository root
 * @param {number} [params.timeoutMs=5000] - Acquisition timeout
 * @param {number} [params.retryIntervalMs=50] - Poll interval
 * @returns {Promise<{ ownerId: string, pid: number, createdAt: string, release: () => boolean }>}
 */
export async function acquireGitFinalizeLease({ repoRoot, timeoutMs = 5000, retryIntervalMs = 50 } = {}) {
  if (!repoRoot) {
    throw new WorkflowError('acquireGitFinalizeLease requires repoRoot');
  }

  const lockFile = getLockFilePath(repoRoot);
  const locksDir = path.dirname(lockFile);
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true });
  }

  const ownerId = randomUUID();
  const startTime = Date.now();
  let lastHolder = null;

  while (Date.now() - startTime <= timeoutMs) {
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({
      ownerId,
      pid: process.pid,
      createdAt,
    }, null, 2);

    try {
      fs.writeFileSync(lockFile, payload, { flag: 'wx' });
      return {
        ownerId,
        pid: process.pid,
        createdAt,
        release: () => releaseGitFinalizeLease({ repoRoot, ownerId }),
      };
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      let existing = null;
      try {
        const raw = fs.readFileSync(lockFile, 'utf8');
        existing = JSON.parse(raw);
        lastHolder = existing;
      } catch {
        // Corrupt or empty lock file, reclaim immediately
        try {
          fs.unlinkSync(lockFile);
        } catch {}
        continue;
      }

      if (!existing?.pid || !isProcessAlive(existing.pid)) {
        // PID confirmed dead; stale lease reclamation
        try {
          fs.unlinkSync(lockFile);
        } catch {}
        continue;
      }

      // PID is alive, wait and retry
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
  }

  const holderPid = lastHolder?.pid ?? 'unknown';
  const holderOwner = lastHolder?.ownerId ?? 'unknown';
  throw new WorkflowError(
    `Failed to acquire git-finalize lease within ${timeoutMs}ms. Held by PID ${holderPid} (owner: ${holderOwner}). Lock file: ${lockFile}`,
    { code: 'GIT_FINALIZE_LOCK_TIMEOUT', lockFile, holderPid, holderOwner }
  );
}

/**
 * Runs a function inside the git-finalize lock critical section (D50, D51).
 * If existingLease is provided, runs fn(existingLease) with zero additional acquisitions and no release.
 *
 * @param {Function} fn - async function to execute
 * @param {object} [existingLeaseOrOptions] - Existing lease or options
 * @param {object} [maybeOptions] - Options if existing lease was passed as 2nd arg
 * @returns {Promise<any>}
 */
export async function withGitFinalizeLock(fn, existingLeaseOrOptions, maybeOptions) {
  let existingLease = null;
  let options = {};

  if (existingLeaseOrOptions && (existingLeaseOrOptions.ownerId || typeof existingLeaseOrOptions.release === 'function')) {
    existingLease = existingLeaseOrOptions;
    options = maybeOptions || {};
  } else {
    options = existingLeaseOrOptions || {};
  }

  if (existingLease) {
    return await fn(existingLease);
  }

  const lease = await acquireGitFinalizeLease(options);
  try {
    return await fn(lease);
  } finally {
    lease.release();
  }
}
