import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  pendingDispatchStore,
  InitialDispatchController,
} from '../ui/features/agent-sessions/runtime/pending-dispatch-store.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
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

  const controllerA = new InitialDispatchController({
    provider,
    sessionId: sessionIdA,
    assistant: assistantA,
    isProviderAvailable: true,
    currentMode: 'agent',
  });

  // 1. Dispatch A started
  const dispatchPromise = controllerA.runDispatch();
  assert.equal(turnsDispatchedA.length, 1);
  const keyA = turnsDispatchedA[0].opts.idempotencyKey;
  assert.ok(keyA.startsWith('turn_'));

  // 2. User switches to session B (Session A unmounts while POST is in flight)

  // 3. POST for session A completes while A is unmounted
  resolveSendA({ ok: true });
  await dispatchPromise;

  // Session A's pending dispatch is cleared from store
  assert.equal(pendingDispatchStore.getPending(provider, sessionIdA), null);

  // 4. User navigates back to Session A (Session A mounts again with fresh controller)
  const remountControllerA = new InitialDispatchController({
    provider,
    sessionId: sessionIdA,
    assistant: assistantA,
    isProviderAvailable: true,
    currentMode: 'agent',
  });
  await remountControllerA.runDispatch();

  // No second turn is ever dispatched!
  assert.equal(turnsDispatchedA.length, 1, 'Must NOT create a second logical turn upon remount');
  assert.equal(remountControllerA.displayError, null);
  assert.equal(remountControllerA.canRetryInitial, false);
});

test('BLOCKING Fix (Behavioral): Failed dispatch survives remount/navigation -> exposes retry UI -> retries with identical key', async () => {
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

  const controller = new InitialDispatchController({
    provider,
    sessionId,
    assistant,
    isProviderAvailable: true,
    currentMode: 'agent',
  });

  // 1. Attempt 1: fails
  const attempt1Success = await controller.runDispatch();
  assert.equal(attempt1Success, false);
  assert.equal(dispatchedTurns.length, 1);
  assert.equal(controller.displayError, '500 Internal Server Error');
  assert.equal(controller.canRetryInitial, true);
  assert.equal(pendingDispatchStore.getPending(provider, sessionId)?.status, 'failed');

  // 2. Navigate away and mount afresh (Simulate new session mount with fresh controller)
  const remountedController = new InitialDispatchController({
    provider,
    sessionId,
    assistant,
    isProviderAvailable: true,
    currentMode: 'agent',
  });

  // Crucial test: Fresh mount sees the failed state and exposes the retry affordance!
  assert.equal(remountedController.displayError, '500 Internal Server Error', 'Remounted page MUST expose the failure error message');
  assert.equal(remountedController.canRetryInitial, true, 'Remounted page MUST expose the retry affordance');

  // 3. Automatic mount effect runs on remounted page: MUST NOT automatically redispatch!
  const autoDispatchResult = await remountedController.runDispatch();
  assert.equal(autoDispatchResult, false);
  assert.equal(dispatchedTurns.length, 1, 'Failed record MUST NOT automatically dispatch on component remount');

  // 4. User clicks "Ponów próbę" in the UI (triggers production handleRetryInitial)
  shouldFail = false;
  const retrySuccess = await remountedController.handleRetryInitial();
  assert.equal(retrySuccess, true);

  // Exactly two attempts total, reusing the exact same idempotency key
  assert.equal(dispatchedTurns.length, 2, 'Exactly two attempts total after explicit retry');
  assert.equal(dispatchedTurns[0].opts.idempotencyKey, dispatchedTurns[1].opts.idempotencyKey, 'Retry MUST reuse the identical idempotency key');
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Cleared from store upon successful delivery');
  assert.equal(remountedController.displayError, null, 'Error cleared after successful retry');
  assert.equal(remountedController.canRetryInitial, false, 'Retry affordance hidden after successful retry');
});

test('Sensible Dismiss Semantics: Dismissing failed error banner explicitly clears stranded pending record', async () => {
  pendingDispatchStore.clearAll();

  const provider = 'claude';
  const sessionId = 'session-dismiss';
  const prompt = 'Prompt to be dismissed';

  pendingDispatchStore.setPending(provider, sessionId, prompt);

  const assistant = {
    isReady: true,
    sendTurn: async () => {
      throw new Error('Network timeout');
    },
  };

  const controller = new InitialDispatchController({
    provider,
    sessionId,
    assistant,
    isProviderAvailable: true,
    currentMode: 'agent',
  });

  await controller.runDispatch();
  assert.equal(controller.displayError, 'Network timeout');
  assert.equal(controller.canRetryInitial, true);
  assert.equal(pendingDispatchStore.getPending(provider, sessionId)?.status, 'failed');

  // User dismisses error banner via "Zamknij" button
  controller.handleDismissError();

  assert.equal(controller.displayError, null, 'Display error cleared');
  assert.equal(controller.canRetryInitial, false, 'Retry affordance removed');
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Pending store cleared, no stranded record left');
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

  const newController = new InitialDispatchController({
    provider,
    sessionId,
    assistant,
    isProviderAvailable: true,
    currentMode: 'agent',
  });
  const success = await newController.runDispatch();

  assert.equal(success, true);
  assert.equal(dispatched.length, 1, 'Exactly one logical dispatch after recovery');
  assert.equal(dispatched[0].opts.idempotencyKey, record.idempotencyKey);
  assert.equal(pendingDispatchStore.getPending(provider, sessionId), null, 'Cleared after successful recovery');
});

test('Finding 1: Source inspection confirms prompt text is removed from ChatSearch and URL schemas', () => {
  const routerTreeSource = readSource('router-tree.ts');
  const appLayoutSource = readSource('features/specifications/specification-console-layout.tsx');
  const specificationRouteSource = readSource('features/specifications/detail/specification-route.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');
  const pendingDispatchStoreSource = readSource('features/agent-sessions/runtime/pending-dispatch-store.ts');

  // router-tree.ts does not declare initialPrompt in ChatSearch
  assert.ok(!routerTreeSource.includes('initialPrompt?: string;'), 'initialPrompt must be removed from ChatSearch');

  // app-layout.tsx and specification-route.tsx use pendingDispatchStore and do not pass initialPrompt in search
  assert.ok(appLayoutSource.includes('pendingDispatchStore.setPending'));
  assert.ok(specificationRouteSource.includes('pendingDispatchStore.setPending'));
  assert.ok(!appLayoutSource.includes('initialPrompt: initialPrompt'));
  assert.ok(!specificationRouteSource.includes('initialPrompt: initialPrompt'));

  // agent-session-page.tsx and pending-dispatch-store.ts enforce explicit pending status and production retry
  assert.ok(agentSessionPageSource.includes('useInitialDispatch'));
  assert.ok(pendingDispatchStoreSource.includes("pending.status !== 'pending'"));
  assert.ok(pendingDispatchStoreSource.includes('retryPending('));
  assert.ok(pendingDispatchStoreSource.includes('clearPending('));
});

test('Finding 3: Tool card layout and pre blocks are constrained to chat width and support horizontal scroll', () => {
  const toolCallViewSource = readSource('features/agent-sessions/turn-work/tool-call-view.tsx');
  const turnWorkSummarySource = readSource('features/agent-sessions/turn-work/turn-work-summary.tsx');
  const transcriptMessageSource = readSource('features/agent-sessions/transcript/transcript-message.tsx');

  // ToolCallView is constrained with min-w-0 max-w-full and pre blocks use overflow-auto whitespace-pre
  assert.ok(toolCallViewSource.includes('w-full min-w-0 max-w-full'));
  assert.ok(toolCallViewSource.includes('overflow-auto'));
  assert.ok(toolCallViewSource.includes('whitespace-pre'));

  // TurnWorkSummary and TranscriptMessage containers allow flex shrinking with min-w-0 max-w-full
  assert.ok(turnWorkSummarySource.includes('w-full min-w-0 max-w-full'));
  assert.ok(transcriptMessageSource.includes('w-full min-w-0 max-w-full'));
});
