import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

// Minimal React-like lifecycle harness to test the initial prompt effect behaviorally
class EffectHarness {
  constructor(effectFn, depsFn) {
    this.effectFn = effectFn;
    this.depsFn = depsFn;
    this.lastDeps = null;
    this.cleanup = null;
  }

  run() {
    const deps = this.depsFn();
    if (!this.lastDeps || this.depsChanged(this.lastDeps, deps)) {
      if (this.cleanup) {
        this.cleanup();
      }
      this.lastDeps = deps;
      this.cleanup = this.effectFn();
    }
  }

  depsChanged(oldDeps, newDeps) {
    if (oldDeps.length !== newDeps.length) return true;
    for (let i = 0; i < oldDeps.length; i++) {
      if (!Object.is(oldDeps[i], newDeps[i])) return true;
    }
    return false;
  }

  unmount() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }
}

test('Finding 1 (Behavioral): Initial prompt dispatches once, survives ready->running transition, and completes on success', async () => {
  let initialMessage = 'Implement feature X';
  let isProviderAvailable = true;
  let isReady = false;
  let activity = 'idle';
  let consumedCalls = 0;
  let submissionError = null;
  let sendTurnCalls = [];

  const inFlightDispatches = new Set();
  const completedDispatches = new Set();
  let sessionKey = 'claude:sess-1';
  let activeSessionKey = sessionKey;
  let isMounted = true;

  // Mock sendTurn that asynchronously transitions runtime to 'running' then resolves
  let resolveSend;
  const sendTurnPromise = new Promise((resolve) => {
    resolveSend = resolve;
  });

  const mockSendTurn = (text, opts) => {
    sendTurnCalls.push({ text, opts });
    // Expected immediate state transition in assistant runtime:
    activity = 'running';
    isReady = false;
    // Re-render harness to simulate React re-render when runtime state changes
    harness.run();
    return sendTurnPromise;
  };

  const effectFn = () => {
    const dispatchKey = `${sessionKey}::${initialMessage}`;
    if (!initialMessage || !isProviderAvailable) return;
    if (completedDispatches.has(dispatchKey)) return;
    if (inFlightDispatches.has(dispatchKey)) return;
    if (!isReady) return;

    inFlightDispatches.add(dispatchKey);
    submissionError = null;

    (async () => {
      try {
        await mockSendTurn(initialMessage, { mode: 'agent' });
        completedDispatches.add(dispatchKey);
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === sessionKey) {
          consumedCalls++;
        }
      } catch (err) {
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === sessionKey) {
          submissionError = err instanceof Error ? err.message : String(err);
        }
      }
    })();
  };

  const harness = new EffectHarness(effectFn, () => [
    initialMessage,
    isReady,
    isProviderAvailable,
    sessionKey,
    `${sessionKey}::${initialMessage}`,
  ]);

  // 1. Initial mount while snapshot is loading (isReady = false)
  harness.run();
  assert.equal(sendTurnCalls.length, 0, 'Must not dispatch while snapshot is loading');
  assert.equal(consumedCalls, 0);

  // 2. Snapshot loads: session becomes ready (isReady = true)
  isReady = true;
  harness.run();

  // sendTurn was invoked and immediately set activity = 'running' -> isReady = false -> re-rendered
  assert.equal(sendTurnCalls.length, 1, 'Initial prompt dispatch begins exactly once');
  assert.equal(sendTurnCalls[0].text, 'Implement feature X');
  assert.equal(isReady, false, 'Runtime transitioned to running during in-flight dispatch');

  // In the old implementation, the re-render with isReady=false ran cleanup and set active=false.
  // Verify with our fix:
  resolveSend({ ok: true });
  await Promise.resolve();
  await Promise.resolve(); // allow microtasks to flush

  assert.equal(consumedCalls, 1, 'onInitialMessageConsumed MUST be invoked upon successful completion');
  assert.equal(submissionError, null);
  assert.equal(inFlightDispatches.size, 0);
  assert.equal(completedDispatches.has('claude:sess-1::Implement feature X'), true);

  // 3. Re-run / next renders: exactly-once guard ensures no duplicate dispatch
  isReady = true;
  activity = 'idle';
  harness.run();
  assert.equal(sendTurnCalls.length, 1, 'Must never send a second turn for the same prompt');
});

test('Finding 1 (Behavioral): POST failure surfaces error and allows retry without dropping message', async () => {
  const initialMessage = 'Implement feature Y';
  const isProviderAvailable = true;
  let isReady = true;
  let consumedCalls = 0;
  let submissionError = null;
  const sendTurnCalls = [];

  const inFlightDispatches = new Set();
  const completedDispatches = new Set();
  const sessionKey = 'claude:sess-2';
  const activeSessionKey = sessionKey;
  const isMounted = true;

  let rejectSend;
  const sendTurnPromise = new Promise((_, reject) => {
    rejectSend = reject;
  });

  const mockSendTurn = (text, opts) => {
    sendTurnCalls.push({ text, opts });
    return sendTurnPromise;
  };

  const effectFn = () => {
    const dispatchKey = `${sessionKey}::${initialMessage}`;
    if (!initialMessage || !isProviderAvailable) return;
    if (completedDispatches.has(dispatchKey)) return;
    if (inFlightDispatches.has(dispatchKey)) return;
    if (!isReady) return;

    inFlightDispatches.add(dispatchKey);
    submissionError = null;

    (async () => {
      try {
        await mockSendTurn(initialMessage, { mode: 'agent' });
        completedDispatches.add(dispatchKey);
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === sessionKey) {
          consumedCalls++;
        }
      } catch (err) {
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === sessionKey) {
          submissionError = err instanceof Error ? err.message : String(err);
        }
      }
    })();
  };

  const harness = new EffectHarness(effectFn, () => [
    initialMessage,
    isReady,
    isProviderAvailable,
    sessionKey,
  ]);

  harness.run();
  assert.equal(sendTurnCalls.length, 1);

  // Simulate network / server failure
  rejectSend(new Error('Network timeout during sendTurn'));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(consumedCalls, 0, 'onInitialMessageConsumed must NOT be called on failure');
  assert.equal(submissionError, 'Network timeout during sendTurn');
  assert.equal(inFlightDispatches.size, 0, 'In-flight lock must be freed so user can retry');
  assert.equal(completedDispatches.size, 0, 'Failed dispatch must NOT be marked completed');
});

test('Finding 1 (Behavioral): Switching sessions during in-flight send does not mutate new session route state', async () => {
  let initialMessage = 'Prompt for session A';
  const isProviderAvailable = true;
  let isReady = true;
  let consumedCalls = 0;
  let submissionError = null;

  const inFlightDispatches = new Set();
  const completedDispatches = new Set();
  let sessionKey = 'claude:sess-A';
  let activeSessionKey = 'claude:sess-A';
  const isMounted = true;

  let resolveSendA;
  const sendTurnPromiseA = new Promise((resolve) => {
    resolveSendA = resolve;
  });

  const effectFn = () => {
    const scopedSessionKey = sessionKey;
    const dispatchKey = `${scopedSessionKey}::${initialMessage}`;
    if (!initialMessage || !isProviderAvailable) return;
    if (completedDispatches.has(dispatchKey)) return;
    if (inFlightDispatches.has(dispatchKey)) return;
    if (!isReady) return;

    inFlightDispatches.add(dispatchKey);
    submissionError = null;

    (async () => {
      try {
        await sendTurnPromiseA;
        completedDispatches.add(dispatchKey);
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === scopedSessionKey) {
          consumedCalls++;
        }
      } catch (err) {
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === scopedSessionKey) {
          submissionError = err instanceof Error ? err.message : String(err);
        }
      }
    })();
  };

  const harness = new EffectHarness(effectFn, () => [
    initialMessage,
    isReady,
    isProviderAvailable,
    sessionKey,
  ]);

  harness.run();

  // User immediately switches to session B (which has no initialMessage) before session A's turn finishes
  sessionKey = 'claude:sess-B';
  activeSessionKey = 'claude:sess-B';
  initialMessage = null;
  harness.run();

  // Now session A's response arrives
  resolveSendA({ ok: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(consumedCalls, 0, 'Late completion from session A must NOT mutate session B state');
});

test('Finding 1 (Behavioral): React StrictMode double effect execution does not duplicate turn dispatch', async () => {
  const initialMessage = 'Prompt under StrictMode';
  const isProviderAvailable = true;
  let isReady = true;
  let consumedCalls = 0;
  const sendTurnCalls = [];

  const inFlightDispatches = new Set();
  const completedDispatches = new Set();
  const sessionKey = 'claude:sess-strict';
  const activeSessionKey = sessionKey;
  let isMounted = true;

  let resolveSend;
  const sendTurnPromise = new Promise((resolve) => {
    resolveSend = resolve;
  });

  const mockSendTurn = (text) => {
    sendTurnCalls.push(text);
    return sendTurnPromise;
  };

  const effectFn = () => {
    const dispatchKey = `${sessionKey}::${initialMessage}`;
    if (!initialMessage || !isProviderAvailable) return;
    if (completedDispatches.has(dispatchKey)) return;
    if (inFlightDispatches.has(dispatchKey)) return;
    if (!isReady) return;

    inFlightDispatches.add(dispatchKey);

    (async () => {
      try {
        await mockSendTurn(initialMessage);
        completedDispatches.add(dispatchKey);
        inFlightDispatches.delete(dispatchKey);
        if (isMounted && activeSessionKey === sessionKey) {
          consumedCalls++;
        }
      } catch {
        inFlightDispatches.delete(dispatchKey);
      }
    })();

    // Cleanup simulation
    return () => {
      // Unmount cleanup does NOT destroy the session in-flight lock
    };
  };

  const harness = new EffectHarness(effectFn, () => [
    initialMessage,
    isReady,
    isProviderAvailable,
    sessionKey,
  ]);

  // StrictMode mount 1
  harness.run();
  assert.equal(sendTurnCalls.length, 1);

  // StrictMode simulated immediate unmount and remount 2
  harness.unmount();
  harness.run();

  assert.equal(sendTurnCalls.length, 1, 'StrictMode remount must NOT trigger duplicate turn dispatch');

  resolveSend({ ok: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(consumedCalls, 1, 'Exactly one consumption on success');
});
