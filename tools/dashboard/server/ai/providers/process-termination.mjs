import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Shared cross-platform child process termination helper with bounded escalation:
 * 1. Send graceful SIGINT
 * 2. Wait up to graceMs for 'exit' / 'close' event
 * 3. If still alive, escalate to forceful SIGKILL / process-tree termination
 * 4. Wait up to forceGraceMs for 'exit' / 'close' event
 * 5. Verify PID liveness via OS check before resolution
 *
 * Epistemic boundary: Process tree termination proves only that OS process liveness
 * has ended; it does not determine or assert semantic provider result (completed / failed).
 */

/**
 * Returns OS-appropriate spawn options for process tree ownership.
 * On POSIX (Linux/macOS), detached: true creates a new process group leader,
 * enabling process.kill(-pid, signal) to cleanly terminate the entire tree.
 * On Windows, detached: false prevents unwanted detached console windows while
 * taskkill.exe /PID <pid> /T /F handles job/tree termination natively.
 *
 * @param {object} [customOptions={}]
 * @returns {object}
 */
export function getProcessTreeSpawnOptions(customOptions = {}) {
  return {
    ...customOptions,
    detached: process.platform !== 'win32',
  };
}

/**
 * Checks if a given OS process ID is currently running.
 * Uses process.kill(pid, 0) which tests for process existence without sending a signal.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but caller lacks permissions to signal it.
    // ESRCH means no such process exists.
    return err?.code === 'EPERM';
  }
}

/**
 * POSIX-only: checks whether ANY process remains in the process group `pgid`, using
 * `kill(-pgid, 0)` — a kernel-level query that covers every member of the group, not
 * just a specific tracked PID. This is what makes tree-liveness verification possible
 * without the caller having to know every descendant PID: as long as descendants
 * inherited the group (the normal case — see `getProcessTreeSpawnOptions`), a `SIGINT`/
 * `SIGKILL` sent to `-pgid` reaches them too, and this check proves whether any of them
 * are still alive after signalling, not just the original group leader.
 *
 * @param {number} pgid
 * @returns {boolean}
 */
export function isProcessGroupAlive(pgid) {
  if (process.platform === 'win32') return false;
  if (!pgid || typeof pgid !== 'number' || !Number.isInteger(pgid) || pgid <= 0) {
    return false;
  }
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Check if a child process has already reached a terminal state.
 *
 * @param {import('node:child_process').ChildProcess | object} child
 * @returns {boolean}
 */
export function isChildTerminated(child) {
  if (!child) return true;
  if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') {
    return true;
  }
  if (typeof child.pid === 'number' && child.pid > 0 && !isProcessAlive(child.pid)) {
    return true;
  }
  return false;
}

/**
 * Wait for a child process to emit 'exit' or 'close' within a bounded timeout.
 *
 * @param {import('node:child_process').ChildProcess | object} child
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true if process exited, false if timed out
 */
export function waitForChildExit(child, timeoutMs) {
  if (!child || isChildTerminated(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let timer = null;

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (typeof child.removeListener === 'function') {
        child.removeListener('exit', onExit);
        child.removeListener('close', onExit);
      } else if (typeof child.off === 'function') {
        child.off('exit', onExit);
        child.off('close', onExit);
      }
    };

    if (typeof timeoutMs === 'number' && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        cleanup();
        resolve(isChildTerminated(child));
      }, timeoutMs);
    }

    if (typeof child.once === 'function') {
      child.once('exit', onExit);
      child.once('close', onExit);
    } else if (typeof child.addEventListener === 'function') {
      child.addEventListener('exit', onExit, { once: true });
      child.addEventListener('close', onExit, { once: true });
    }
  });
}

/**
 * Terminate a child process using an OS-aware bounded two-stage escalation policy:
 * - Stage 1 (POSIX): graceful `SIGINT` to the owned process group, bounded `graceMs` wait.
 * - Stage 1 (Windows): `taskkill /PID <pid> /T /F` immediately. Windows has no real SIGINT
 *   delivery for arbitrary child processes — `child.kill('SIGINT')` just force-terminates
 *   the root alone (via TerminateProcess) with no grace and, critically, no tree awareness,
 *   which is exactly how a still-alive descendant used to go undetected: the root died
 *   instantly, the bounded wait below immediately saw it as terminated, and the tree-aware
 *   `taskkill /T` escalation in the old Stage 2 never ran at all. Running the tree-aware
 *   kill up front — while the root PID is still guaranteed valid — is the only way taskkill
 *   can still discover its descendants; once the root PID exits (or worse, gets recycled by
 *   the OS to an unrelated process), `taskkill /PID <pid> /T` can no longer find them.
 * - Stage 2: forceful escalation if Stage 1 didn't prove the tree gone.
 *   - Windows: retries `taskkill /PID <pid> /T /F`.
 *   - POSIX: `process.kill(-pid, 'SIGKILL')` (terminates the process group).
 * - Stage 3: post-termination liveness verification — POSIX checks the OWNED PROCESS GROUP
 *   (`isProcessGroupAlive`, not just a specific tracked PID) so a descendant that inherited
 *   the group but ignored `SIGINT` is still caught even when the caller never enumerated
 *   descendant PIDs. `descendantPids` remains supported for callers that do track them.
 *
 * @param {import('node:child_process').ChildProcess | object} child
 * @param {object} [options]
 * @param {number} [options.graceMs=2000] Grace period for SIGINT
 * @param {number} [options.forceGraceMs=2000] Grace period for forceful escalation
 * @returns {Promise<{ terminated: boolean, signal: 'SIGINT' | 'SIGKILL' | null }>}
 */
export async function terminateChildProcess(child, options = {}) {
  if (!child || isChildTerminated(child)) {
    return { terminated: true, signal: null };
  }

  const graceMs = typeof options.graceMs === 'number' ? options.graceMs : 2000;
  const forceGraceMs = typeof options.forceGraceMs === 'number' ? options.forceGraceMs : 2000;
  const pid = typeof child.pid === 'number' && Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null;
  const descendantPids = Array.isArray(options.descendantPids)
    ? options.descendantPids.filter((p) => typeof p === 'number' && Number.isInteger(p) && p > 0)
    : [];

  const isWindows = process.platform === 'win32';
  let windowsTreeKillVerified = false;

  // Stage 1: graceful (POSIX) / tree-aware (Windows) termination attempt
  if (isWindows && pid) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
      windowsTreeKillVerified = true;
    } catch {
      // Process may already have exited (race), PID may be stale, or taskkill itself may
      // be unavailable — fall back to a root-only kill; Stage 2 will retry the tree kill.
      try {
        if (typeof child.kill === 'function') child.kill();
      } catch {}
    }
  } else if (!isWindows && pid) {
    try {
      process.kill(-pid, 'SIGINT');
    } catch {
      if (typeof child.kill === 'function') {
        child.kill('SIGINT');
      } else {
        try {
          process.kill(pid, 'SIGINT');
        } catch {}
      }
    }
  } else if (typeof child.kill === 'function') {
    child.kill('SIGINT');
  }

  const exitedAfterStage1 = await waitForChildExit(child, graceMs);
  if (exitedAfterStage1 || isChildTerminated(child)) {
    if (isWindows) {
      if (windowsTreeKillVerified || descendantPids.every((p) => !isProcessAlive(p))) {
        return { terminated: true, signal: 'SIGINT' };
      }
    } else if (pid) {
      if (!isProcessGroupAlive(pid) && descendantPids.every((p) => !isProcessAlive(p))) {
        return { terminated: true, signal: 'SIGINT' };
      }
    } else if (descendantPids.length === 0 || descendantPids.every((p) => !isProcessAlive(p))) {
      return { terminated: true, signal: 'SIGINT' };
    }
  }

  // Stage 2: Forceful termination escalation (OS-aware process tree termination)
  if (isWindows && pid) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
      windowsTreeKillVerified = true;
    } catch {
      // taskkill may fail if process already exited or PID is invalid; fall back to child.kill
      try {
        if (typeof child.kill === 'function') {
          child.kill('SIGKILL');
        }
      } catch {}
    }
    for (const dPid of descendantPids) {
      if (isProcessAlive(dPid)) {
        try {
          await execFileAsync('taskkill.exe', ['/PID', String(dPid), '/F']);
        } catch {}
      }
    }
  } else if (pid) {
    // POSIX process-group kill
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    try {
      if (typeof child.kill === 'function') {
        child.kill('SIGKILL');
      }
    } catch {}
    for (const dPid of descendantPids) {
      if (isProcessAlive(dPid)) {
        try {
          process.kill(dPid, 'SIGKILL');
        } catch {}
      }
    }
  } else {
    // Mock / non-PID wrapper
    try {
      if (typeof child.kill === 'function') {
        child.kill('SIGKILL');
      }
    } catch {
      if (isChildTerminated(child)) return { terminated: true, signal: 'SIGKILL' };
    }
  }

  const exitedAfterSigkill = await waitForChildExit(child, forceGraceMs);

  // Stage 3: Post-termination verification checking that target PIDs/groups have ceased executing
  const allPids = [pid, ...descendantPids].filter(Boolean);
  let osConfirmedDead = true;
  if (allPids.length > 0 || (!isWindows && pid)) {
    const deadline = Date.now() + 500;
    const stillAlive = () =>
      allPids.some((p) => isProcessAlive(p)) || (!isWindows && pid && isProcessGroupAlive(pid));
    while (stillAlive() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    osConfirmedDead = !stillAlive();
  }

  return {
    terminated: (exitedAfterSigkill || isChildTerminated(child)) && osConfirmedDead,
    signal: 'SIGKILL',
  };
}
