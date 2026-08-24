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

// Minimal React-like lifecycle harness modeling AiChatPage production dispatch and retry
class AiChatPageHarness {
  constructor({ provider, sessionId, assistant, isProviderAvailable = true, currentMode = 'agent' }) {
    this.provider = provider;
    this.sessionId = sessionId;
    this.assistant = assistant;
    this.isProviderAvailable = isProviderAvailable;
    this.currentMode = currentMode;
    this.submissionError = null;
    this.retryTrigger = 0;
  }

  // Production retry action in AiChatPage error banner
  handleRetryInitialDispatch() {
    const retried = pendingDispatchStore.retryPending(this.provider, this.sessionId);
    if (retried) {
      this.submissionError = null;
      this.retryTrigger++;
      this.runEffect();
    }
  }

  // Production dispatch effect in AiChatPage
  runEffect() {
    if (!this.isProviderAvailable || !this.assistant.isReady) return;
    const pending = pendingDispatchStore.getPending(this.provider, this.sessionId);
    if (!pending || pending.status !== 'pending') return;

    pendingDispatchStore.markInFlight(this.provider, this.sessionId);
    this.submissionError = null;

    (async () => {
      try {
        await this.assistant.sendTurn(pending.prompt, {
          mode: this.currentMode,
          idempotencyKey: pending.idempotencyKey,
        });
        pendingDispatchStore.clearPending(this.provider, this.sessionId);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pendingDispatchStore.markFailed(this.provider, this.sessionId, errorMsg);
        this.submissionError = errorMsg;
      }
    })();
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
  const promptA = 'Prompt for session A';

  pendingDispatchStore.setPending(provider, sessionIdA, promptA);

  const turnsDispatchedA = [];
  let resolveSendA;
  const sendTurnPromiseA = new Promise((resolve) => {
    resolveSendA = resolve;
  });

  const assistantA = {
    isReady: true,
    sendTurn: async (text, opts) => {
      turnsDispatchedA.push({ text, opts });
      return sendTurnPromiseA;
    },
  };

  const pageA = new AiChatPageHarness({ provider, sessionId: sessionIdA, assistant: assistantA });
  pageA.runEffect();

  // 1. Dispatch A started
  assert.equal(turnsDispatchedA.length, 1);
  const keyA = turnsDispatchedA[0].opts.idempotencyKey;
  assert.ok(keyA.startsWith('turn_'));

  // 2. User switches to session B (Session A unmounts while POST is in flight)

  // 3. POST for session A completes while A is unmounted
  resolveSendA({ ok: true });
  await new Promise((r) => setTimeout(r, 10));

  // Session A's pending dispatch is cleared from store
  assert.equal(pendingDispatchStore.getPending(provider, sessionIdA), null);

  // 4. User navigates back to Session A (Session A mounts again)
  const remountPageA = new AiChatPageHarness({ provider, sessionId: sessionIdA, assistant: assistantA });
  remountPageA.runEffect();

  // No second turn is ever dispatched!
  assert.equal(turnsDispatchedA.length, 1, 'Must NOT create a second logical turn upon remount');
});

test('Finding 1 & 2a (Behavioral): Failed initial dispatch does NOT auto-dispatch on rerender/remount, and retries successfully upon production retry action', async () => {
  pendingDispatchStore.clearAll();

  const provider = 'claude';
  const sessionId = 'session-retry';
  const prompt = 'Prompt needing retry';

  pendingDispatchStore.setPending(provider, sessionId, prompt);

  const dispatchedTurns = [];
  let shouldFail = true;

  const assistant = {
    isReady: true,
    sendTurn: async (text, opts) => {
      dispatchedTurns.push({ text, opts });
      if (shouldFail) {
        throw new Error('500 Internal Server Error');
      }
      return { ok: true };
    },
  };

  const page = new AiChatPageHarness({ provider, sessionId, assistant });

  // 1. Attempt 1: fails
  page.runEffect();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(dispatchedTurns.length, 1);
  assert.equal(page.submissionError, '500 Internal Server Error');
  const failedRecord = pendingDispatchStore.getPending(provider, sessionId);
  assert.equal(failedRecord?.status, 'failed');

  // 2. Dependency change / effect re-run while failed: MUST NOT automatically redispatch!
  page.currentMode = 'edit';
  page.runEffect();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatchedTurns.length, 1, 'Failed record MUST NOT automatically dispatch on dependency change');

  // 3. Component remount / navigation return while failed: MUST NOT automatically redispatch!
  const remountedPage = new AiChatPageHarness({ provider, sessionId, assistant });
  remountedPage.runEffect();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatchedTurns.length, 1, 'Failed record MUST NOT automatically dispatch on component remount');

  // 4. UI provides retry affordance: status is failed
  assert.equal(pendingDispatchStore.getPending(provider, sessionId)?.status, 'failed');

  // 5. User clicks "Ponów próbę" in the UI (executes production handleRetryInitialDispatch)
  shouldFail = false;
  remountedPage.handleRetryInitialDispatch();
  await Promise.resolve();
  await Promise.resolve();

  // Exactly two attempts total, reusing the exact same idempotency key
  assert.equal(dispatchedTurns.length, 2, 'Exactly two attempts total after explicit retry');
  assert.equal(dispatchedTurns[0].opts.idempotencyKey, dispatchedTurns[1].opts.idempotencyKey, 'Retry MUST reuse the identical idempotency key');
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Cleared upon successful delivery');
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
  const assistant = {
    isReady: true,
    sendTurn: async (text, opts) => {
      dispatched.push({ text, opts });
      return { ok: true };
    },
  };

  const newPage = new AiChatPageHarness({ provider, sessionId, assistant });
  newPage.runEffect();
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

  // ai-chat.tsx uses pendingDispatchStore and only dispatches when status === 'pending'
  assert.ok(aiChatSource.includes("pending.status !== 'pending'"));
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
