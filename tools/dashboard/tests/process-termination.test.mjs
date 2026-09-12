import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import {
  isChildTerminated,
  isProcessAlive,
  waitForChildExit,
  terminateChildProcess,
  getProcessTreeSpawnOptions,
} from '../server/ai/providers/process-termination.mjs';

function createMockChild({ ignoreSigint = false, ignoreSigkill = false, exitDelayMs = 0, pid = null } = {}) {
  const emitter = new EventEmitter();
  emitter.killCalls = [];
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.pid = pid;

  emitter.kill = (signal) => {
    emitter.killCalls.push(signal);
    emitter.killed = true;

    if (signal === 'SIGINT' && ignoreSigint) {
      return true;
    }
    if (signal === 'SIGKILL' && ignoreSigkill) {
      return true;
    }

    const fireExit = () => {
      emitter.exitCode = signal === 'SIGKILL' ? null : 0;
      emitter.signalCode = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGINT';
      emitter.emit('exit', emitter.exitCode, emitter.signalCode);
      emitter.emit('close', emitter.exitCode);
    };

    if (exitDelayMs > 0) {
      setTimeout(fireExit, exitDelayMs);
    } else {
      setImmediate(fireExit);
    }
    return true;
  };

  return emitter;
}

test('isChildTerminated identifies alive vs terminated child processes', () => {
  assert.equal(isChildTerminated(null), true);

  const alive = { exitCode: null, signalCode: null };
  assert.equal(isChildTerminated(alive), false);

  const exitedWithCode = { exitCode: 0, signalCode: null };
  assert.equal(isChildTerminated(exitedWithCode), true);

  const exitedWithSignal = { exitCode: null, signalCode: 'SIGTERM' };
  assert.equal(isChildTerminated(exitedWithSignal), true);
});

test('waitForChildExit resolves immediately if child is already terminated', async () => {
  const child = { exitCode: 0, signalCode: null };
  const exited = await waitForChildExit(child, 100);
  assert.equal(exited, true);
});

test('waitForChildExit resolves when exit event is emitted', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;

  setTimeout(() => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  }, 10);

  const exited = await waitForChildExit(child, 200);
  assert.equal(exited, true);
});

test('waitForChildExit times out and returns false if process stays alive', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;

  const exited = await waitForChildExit(child, 20);
  assert.equal(exited, false);
});

test('terminateChildProcess: process exits cleanly on SIGINT (no SIGKILL sent)', async () => {
  const child = createMockChild({ ignoreSigint: false, exitDelayMs: 5 });
  const result = await terminateChildProcess(child, { graceMs: 100, forceGraceMs: 100 });

  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGINT');
  assert.deepEqual(child.killCalls, ['SIGINT']);
});

test('terminateChildProcess: escalates to explicit SIGKILL when SIGINT is ignored', async () => {
  const child = createMockChild({ ignoreSigint: true, ignoreSigkill: false, exitDelayMs: 5 });
  const result = await terminateChildProcess(child, { graceMs: 20, forceGraceMs: 100 });

  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.deepEqual(child.killCalls, ['SIGINT', 'SIGKILL']);
});

test('terminateChildProcess: returns immediately with no signals if child is already terminated', async () => {
  const child = createMockChild();
  child.exitCode = 0;

  const result = await terminateChildProcess(child, { graceMs: 50, forceGraceMs: 50 });
  assert.equal(result.terminated, true);
  assert.equal(result.signal, null);
  assert.deepEqual(child.killCalls, []);
});

test('terminateChildProcess: bounded execution does not hang forever if child ignores both signals', async () => {
  const child = createMockChild({ ignoreSigint: true, ignoreSigkill: true });
  const result = await terminateChildProcess(child, { graceMs: 20, forceGraceMs: 20 });

  assert.equal(result.terminated, false);
  assert.equal(result.signal, 'SIGKILL');
  assert.deepEqual(child.killCalls, ['SIGINT', 'SIGKILL']);
});

test('getProcessTreeSpawnOptions sets detached on POSIX and false on Windows', () => {
  const options = getProcessTreeSpawnOptions({ env: { FOO: 'bar' } });
  assert.equal(options.detached, process.platform !== 'win32');
  assert.equal(options.env.FOO, 'bar');
});

test('isProcessAlive tests real process liveness via process.kill(pid, 0)', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(99999999), false);
  assert.equal(isProcessAlive(null), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(0), false);
});

test('real process-tree integration: terminates parent and descendant processes', async () => {
  // The descendant deliberately does NOT set its own `detached`/process-group option —
  // it must inherit the parent's process group (the normal provider-child -> descendant
  // topology), not create a separate group that a group-targeted kill can't reach.
  const parentCode = `
    const { spawn } = require('node:child_process');
    const desc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    console.log(JSON.stringify({ parentPid: process.pid, descendantPid: desc.pid }));
    setInterval(() => {}, 1000);
  `;

  const spawnOptions = getProcessTreeSpawnOptions({ stdio: ['pipe', 'pipe', 'pipe'] });
  const parent = spawn(process.execPath, ['-e', parentCode], spawnOptions);

  const pids = await new Promise((resolve, reject) => {
    parent.stdout.once('data', (chunk) => {
      try {
        const parsed = JSON.parse(chunk.toString().trim());
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    parent.once('error', reject);
  });

  const { parentPid, descendantPid } = pids;
  assert.ok(parentPid > 0);
  assert.ok(descendantPid > 0);

  // Both processes are alive initially
  assert.equal(isProcessAlive(parentPid), true);
  assert.equal(isProcessAlive(descendantPid), true);

  // Terminate the process tree via terminateChildProcess
  const result = await terminateChildProcess(parent, { graceMs: 100, forceGraceMs: 2000 });
  assert.equal(result.terminated, true);

  // Wait briefly for OS to clean up
  for (let i = 0; i < 20; i++) {
    if (!isProcessAlive(parentPid) && !isProcessAlive(descendantPid)) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  // Confirm both parent and descendant PIDs are dead via OS check
  assert.equal(isProcessAlive(parentPid), false);
  assert.equal(isProcessAlive(descendantPid), false);
});

test('real process-tree integration: a descendant that outlives the parent past the graceful stage is still proven dead', async () => {
  // The descendant ignores SIGINT (installs a no-op handler) so it survives Stage 1's
  // graceful attempt and can only be reaped by Stage 2's forceful escalation — this is
  // exactly the scenario the old implementation got wrong: once the parent exited (or was
  // killed) first, it declared victory without any group-wide liveness proof, leaving this
  // kind of descendant alive and undetected.
  const parentCode = `
    const { spawn } = require('node:child_process');
    const desc = spawn(process.execPath, ['-e', 'process.on("SIGINT", () => {}); setInterval(() => {}, 1000);'], {
      stdio: 'ignore',
    });
    console.log(JSON.stringify({ parentPid: process.pid, descendantPid: desc.pid }));
    setInterval(() => {}, 1000);
  `;

  const spawnOptions = getProcessTreeSpawnOptions({ stdio: ['pipe', 'pipe', 'pipe'] });
  const parent = spawn(process.execPath, ['-e', parentCode], spawnOptions);

  const pids = await new Promise((resolve, reject) => {
    parent.stdout.once('data', (chunk) => {
      try {
        resolve(JSON.parse(chunk.toString().trim()));
      } catch (err) {
        reject(err);
      }
    });
    parent.once('error', reject);
  });

  const { parentPid, descendantPid } = pids;
  assert.equal(isProcessAlive(parentPid), true);
  assert.equal(isProcessAlive(descendantPid), true);

  const result = await terminateChildProcess(parent, { graceMs: 100, forceGraceMs: 2000 });
  assert.equal(result.terminated, true, 'termination must not report success while any group member remains alive');
  // On POSIX, a SIGINT-ignoring descendant forces escalation to SIGKILL; on Windows,
  // `taskkill /T /F` is tree-aware and forceful from Stage 1, so no escalation is needed.
  // The signal used is an implementation detail — the invariant under test is `terminated`
  // and, below, that the descendant is *actually* dead rather than presumed dead.
  assert.ok(['SIGINT', 'SIGKILL'].includes(result.signal));

  for (let i = 0; i < 20; i++) {
    if (!isProcessAlive(parentPid) && !isProcessAlive(descendantPid)) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.equal(isProcessAlive(parentPid), false);
  assert.equal(isProcessAlive(descendantPid), false, 'the SIGINT-ignoring descendant must actually be dead, not just presumed dead from the parent exiting');
});
