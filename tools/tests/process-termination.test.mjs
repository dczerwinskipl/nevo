import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  isChildTerminated,
  waitForChildExit,
  terminateChildProcess,
} from '../ai/process-termination.mjs';

function createMockChild({ ignoreSigint = false, ignoreSigkill = false, exitDelayMs = 0 } = {}) {
  const emitter = new EventEmitter();
  emitter.killCalls = [];
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;

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
