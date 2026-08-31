/**
 * Shared cross-platform child process termination helper with bounded escalation:
 * 1. Send graceful SIGINT
 * 2. Wait up to graceMs for 'exit' / 'close' event
 * 3. If still alive, escalate to forceful SIGKILL
 * 4. Wait up to forceGraceMs for 'exit' / 'close' event
 */

/**
 * Check if a child process has already reached a terminal state.
 *
 * @param {import('node:child_process').ChildProcess | object} child
 * @returns {boolean}
 */
export function isChildTerminated(child) {
  if (!child) return true;
  return typeof child.exitCode === 'number' || typeof child.signalCode === 'string';
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
 * Terminate a child process using a bounded two-stage escalation policy:
 * - Stage 1: Graceful SIGINT with bounded graceMs wait
 * - Stage 2: Forceful SIGKILL with bounded forceGraceMs wait
 *
 * @param {import('node:child_process').ChildProcess | object} child
 * @param {object} [options]
 * @param {number} [options.graceMs=2000] Grace period for SIGINT
 * @param {number} [options.forceGraceMs=2000] Grace period for SIGKILL
 * @returns {Promise<{ terminated: boolean, signal: 'SIGINT' | 'SIGKILL' | null }>}
 */
export async function terminateChildProcess(child, options = {}) {
  if (!child || isChildTerminated(child)) {
    return { terminated: true, signal: null };
  }

  const graceMs = typeof options.graceMs === 'number' ? options.graceMs : 2000;
  const forceGraceMs = typeof options.forceGraceMs === 'number' ? options.forceGraceMs : 2000;

  // Stage 1: Graceful SIGINT
  try {
    child.kill('SIGINT');
  } catch {
    if (isChildTerminated(child)) return { terminated: true, signal: 'SIGINT' };
  }

  const exitedAfterSigint = await waitForChildExit(child, graceMs);
  if (exitedAfterSigint || isChildTerminated(child)) {
    return { terminated: true, signal: 'SIGINT' };
  }

  // Stage 2: Forceful SIGKILL escalation
  try {
    child.kill('SIGKILL');
  } catch {
    if (isChildTerminated(child)) return { terminated: true, signal: 'SIGKILL' };
  }

  const exitedAfterSigkill = await waitForChildExit(child, forceGraceMs);
  return {
    terminated: exitedAfterSigkill || isChildTerminated(child),
    signal: 'SIGKILL',
  };
}
