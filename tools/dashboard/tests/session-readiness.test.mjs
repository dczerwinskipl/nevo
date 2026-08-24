import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pendingDispatchStore } from '../src/lib/pending-dispatch-store.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

// In-memory sessionStorage polyfill for Node test environment
if (typeof globalThis.sessionStorage === 'undefined') {
  const storageMap = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };
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

test('Finding 1 (Store): Pending dispatch store creates and preserves stable idempotency key', () => {
  pendingDispatchStore.clearAll();

  const record1 = pendingDispatchStore.setPending('claude', 'sess-100', 'Initial message for task');
  assert.ok(record1.idempotencyKey.startsWith('turn_'));
  assert.equal(record1.prompt, 'Initial message for task');
  assert.equal(record1.status, 'pending');

  // Re-setting same pending prompt preserves the same idempotency key
  const record2 = pendingDispatchStore.setPending('claude', 'sess-100', 'Initial message for task');
  assert.equal(record2.idempotencyKey, record1.idempotencyKey, 'Must reuse stable idempotency key');

  // Mark in-flight
  pendingDispatchStore.markInFlight('claude', 'sess-100');
  assert.equal(pendingDispatchStore.getPending('claude', 'sess-100')?.status, 'in-flight');

  // Mark failed preserves same key for retry
  pendingDispatchStore.markFailed('claude', 'sess-100', 'Network error');
  const failed = pendingDispatchStore.getPending('claude', 'sess-100');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.error, 'Network error');
  assert.equal(failed?.idempotencyKey, record1.idempotencyKey);

  // Clear completed
  pendingDispatchStore.clearPending('claude', 'sess-100');
  assert.equal(pendingDispatchStore.getPending('claude', 'sess-100'), null);
});

test('Finding 1 & 2 (Behavioral): A dispatch starts -> unmount/navigate to B -> A POST succeeds -> remount A -> no second turn', async () => {
  pendingDispatchStore.clearAll();

  const provider = 'claude';
  const sessionIdA = 'session-A';
  const sessionIdB = 'session-B';
  const promptA = 'Prompt for session A';

  pendingDispatchStore.setPending(provider, sessionIdA, promptA);

  const turnsDispatchedA = [];
  let resolveSendA;
  const sendTurnPromiseA = new Promise((resolve) => {
    resolveSendA = resolve;
  });

  const mockSendTurnA = async (text, opts) => {
    turnsDispatchedA.push({ text, opts });
    return sendTurnPromiseA;
  };

  // Mount Session A
  let isReadyA = true;
  let submissionErrorA = null;

  const effectFnA = () => {
    if (!isReadyA) return;
    const pending = pendingDispatchStore.getPending(provider, sessionIdA);
    if (!pending || pending.status === 'in-flight' || pending.status === 'completed') return;

    pendingDispatchStore.markInFlight(provider, sessionIdA);
    submissionErrorA = null;

    (async () => {
      try {
        await mockSendTurnA(pending.prompt, {
          mode: 'agent',
          idempotencyKey: pending.idempotencyKey,
        });
        pendingDispatchStore.clearPending(provider, sessionIdA);
      } catch (err) {
        pendingDispatchStore.markFailed(provider, sessionIdA, err.message);
      }
    })();
  };

  const harnessA = new EffectHarness(effectFnA, () => [isReadyA]);
  harnessA.run();

  // 1. Dispatch A started
  assert.equal(turnsDispatchedA.length, 1);
  const keyA = turnsDispatchedA[0].opts.idempotencyKey;
  assert.ok(keyA.startsWith('turn_'));

  // 2. User switches to session B (Session A unmounts while POST is in flight)
  harnessA.unmount();

  // 3. POST for session A completes while A is unmounted
  resolveSendA({ ok: true });
  await new Promise((r) => setTimeout(r, 10));

  // Session A's pending dispatch is cleared from store
  assert.equal(pendingDispatchStore.getPending(provider, sessionIdA), null);

  // 4. User navigates back to Session A (Session A mounts again)
  const remountHarnessA = new EffectHarness(effectFnA, () => [isReadyA]);
  remountHarnessA.run();

  // No second turn is ever dispatched!
  assert.equal(turnsDispatchedA.length, 1, 'Must NOT create a second logical turn upon remount');
});

test('Finding 2a (Behavioral): Failed initial dispatch -> production retryPending() -> successful dispatch with same idempotency key', async () => {
  pendingDispatchStore.clearAll();

  const provider = 'claude';
  const sessionId = 'session-retry';
  const prompt = 'Prompt needing retry';

  pendingDispatchStore.setPending(provider, sessionId, prompt);

  const dispatchedTurns = [];
  let shouldFail = true;
  let isReady = true;
  let submissionError = null;
  let retryTrigger = 0;

  const mockSendTurn = async (text, opts) => {
    dispatchedTurns.push({ text, opts });
    if (shouldFail) {
      throw new Error('500 Internal Server Error');
    }
    return { ok: true };
  };

  const effectFn = () => {
    if (!isReady) return;
    const pending = pendingDispatchStore.getPending(provider, sessionId);
    if (!pending || pending.status === 'in-flight' || pending.status === 'completed') return;

    pendingDispatchStore.markInFlight(provider, sessionId);
    submissionError = null;

    (async () => {
      try {
        await mockSendTurn(pending.prompt, {
          mode: 'agent',
          idempotencyKey: pending.idempotencyKey,
        });
        pendingDispatchStore.clearPending(provider, sessionId);
      } catch (err) {
        pendingDispatchStore.markFailed(provider, sessionId, err.message);
        submissionError = err.message;
      }
    })();
  };

  const harness = new EffectHarness(effectFn, () => [isReady, retryTrigger]);

  // Attempt 1: fails
  harness.run();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(dispatchedTurns.length, 1);
  assert.equal(submissionError, '500 Internal Server Error');
  const failedRecord = pendingDispatchStore.getPending(provider, sessionId);
  assert.equal(failedRecord?.status, 'failed');

  // Attempt 2: user clicks "Ponów próbę" in UI, invoking production retryPending()
  shouldFail = false;
  const retriedRecord = pendingDispatchStore.retryPending(provider, sessionId);
  assert.equal(retriedRecord?.status, 'pending');
  assert.equal(retriedRecord?.idempotencyKey, dispatchedTurns[0].opts.idempotencyKey, 'Must preserve stable idempotency key');

  // Trigger retry in component lifecycle
  retryTrigger++;
  harness.run();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(dispatchedTurns.length, 2);
  assert.equal(dispatchedTurns[0].opts.idempotencyKey, dispatchedTurns[1].opts.idempotencyKey, 'Retry MUST reuse the identical idempotency key');
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Cleared upon success');
});

test('Finding 2b (Behavioral): Persisted in-flight state -> reload/new runtime -> recovers to pending and dispatches exactly once', async () => {
  pendingDispatchStore.clearAll();

  const provider = 'claude';
  const sessionId = 'session-crash-recovery';
  const prompt = 'Prompt interrupted by page reload';

  // 1. Initial page set pending and marked in-flight before crash
  const record = pendingDispatchStore.setPending(provider, sessionId, prompt);
  pendingDispatchStore.markInFlight(provider, sessionId);
  assert.equal(record.status, 'in-flight');

  // 2. Simulate page reload / new JS runtime by clearing memoryStore while leaving sessionStorage
  pendingDispatchStore.clearAll();

  // 3. New runtime loads pending dispatch for session
  const recovered = pendingDispatchStore.getPending(provider, sessionId);
  assert.ok(recovered, 'Must recover persisted dispatch');
  assert.equal(recovered?.status, 'pending', 'Must safely transition persisted in-flight state to pending upon new runtime initialization');
  assert.equal(recovered?.idempotencyKey, record.idempotencyKey, 'Must preserve original idempotency key');

  // 4. New runtime dispatch lifecycle runs
  const dispatched = [];
  const mockSendTurn = async (text, opts) => {
    dispatched.push({ text, opts });
    return { ok: true };
  };

  let isReady = true;
  const effectFn = () => {
    if (!isReady) return;
    const pending = pendingDispatchStore.getPending(provider, sessionId);
    if (!pending || pending.status === 'in-flight' || pending.status === 'completed') return;

    pendingDispatchStore.markInFlight(provider, sessionId);

    (async () => {
      try {
        await mockSendTurn(pending.prompt, {
          mode: 'agent',
          idempotencyKey: pending.idempotencyKey,
        });
        pendingDispatchStore.clearPending(provider, sessionId);
      } catch (err) {
        pendingDispatchStore.markFailed(provider, sessionId, err.message);
      }
    })();
  };

  const harness = new EffectHarness(effectFn, () => [isReady]);
  harness.run();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(dispatched.length, 1, 'Exactly one logical dispatch after recovery');
  assert.equal(dispatched[0].opts.idempotencyKey, record.idempotencyKey);
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Cleared after successful recovery');
});

test('Finding 1: Source inspection confirms prompt text is removed from ChatSearch and URL schemas', () => {
  const routerTreeSource = readSource('router-tree.ts');
  const routerSource = readSource('router.tsx');
  const aiChatSource = readSource('components/ai-chat.tsx');

  // router-tree.ts does not declare initialPrompt in ChatSearch
  assert.ok(!routerTreeSource.includes('initialPrompt?: string;'), 'initialPrompt must be removed from ChatSearch');

  // router.tsx uses pendingDispatchStore and does not pass initialPrompt in search
  assert.ok(routerSource.includes('pendingDispatchStore.setPending'));
  assert.ok(!routerSource.includes('initialPrompt: initialPrompt'));

  // ai-chat.tsx uses pendingDispatchStore and retryPending
  assert.ok(aiChatSource.includes('pendingDispatchStore.getPending'));
  assert.ok(aiChatSource.includes('pendingDispatchStore.markInFlight'));
  assert.ok(aiChatSource.includes('pendingDispatchStore.retryPending'));
  assert.ok(aiChatSource.includes('pendingDispatchStore.clearPending'));
});

test('Finding 3: Tool card layout and pre blocks are constrained to chat width and support horizontal scroll', () => {
  const toolViewSource = readSource('components/ai-tool-view.tsx');
  const workSummarySource = readSource('components/work/work-summary.tsx');
  const chatMessageSource = readSource('components/conversation/chat-message.tsx');

  // AiToolView is constrained with min-w-0 max-w-full and pre blocks use overflow-auto whitespace-pre
  assert.ok(toolViewSource.includes('w-full min-w-0 max-w-full'));
  assert.ok(toolViewSource.includes('overflow-auto'));
  assert.ok(toolViewSource.includes('whitespace-pre'));

  // WorkSummary and ChatMessage containers allow flex shrinking with min-w-0 max-w-full
  assert.ok(workSummarySource.includes('w-full min-w-0 max-w-full'));
  assert.ok(chatMessageSource.includes('w-full min-w-0 max-w-full'));
});
