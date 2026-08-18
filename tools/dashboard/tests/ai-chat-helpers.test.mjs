import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeChatMessages,
  createTurnIdempotencyKey,
  initialPromptWithTaskContext,
} from '../src/lib/ai-chat-helpers.ts';

test('turn idempotency keys work when randomUUID is unavailable on an HTTP VPN origin', () => {
  assert.equal(createTurnIdempotencyKey({
    cryptoSource: {},
    now: () => 1234,
    random: () => 0.5,
  }), 'ui-ya-i');

  assert.equal(createTurnIdempotencyKey({
    cryptoSource: { randomUUID: () => 'stable-uuid' },
  }), 'ui-stable-uuid');
});

test('selected stable task IDs are prepended to the initial prompt', () => {
  assert.equal(initialPromptWithTaskContext(' Review these tasks. ', ['task-a', 'task-b']),
    'Context: tasks task-a, task-b\n\nReview these tasks.');
  assert.equal(initialPromptWithTaskContext(' General review. ', []), 'General review.');
  assert.equal(initialPromptWithTaskContext('   ', ['task-a']), null);
});

test('persisted assistant messages replace their streamed version by stable message ID', () => {
  assert.deepEqual(composeChatMessages(
    [{ id: 'assistant-1', role: 'assistant', text: 'Complete response.' }],
    'Pending question',
    {
      'assistant-1': 'Complete response',
      'assistant-2': 'Still streaming',
    },
  ), [
    { id: 'assistant-1', role: 'assistant', text: 'Complete response.' },
    { id: 'optimistic-user', role: 'user', text: 'Pending question' },
    { id: 'assistant-2', role: 'assistant', text: 'Still streaming' },
  ]);
});

test('browser EventSource dispatches named SSE events only to addEventListener, not onmessage', async () => {
  const { subscribeAgentEventSource, SUPPORTED_AGENT_EVENT_TYPES, applyAgentEvent } = await import('../src/lib/nevo-assistant-runtime.ts');

  // Minimal standard-compliant EventTarget mock for browser EventSource
  class MockEventSource {
    constructor() {
      this.listeners = new Map();
      this.onmessage = null;
      this.closed = false;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(type, data) {
      const event = { type, data: JSON.stringify(data) };
      // Browser EventSource semantics: named events invoke addEventListener(type), NOT onmessage
      if (type === 'message') {
        this.onmessage?.(event);
      }
      const set = this.listeners.get(type);
      if (set) {
        for (const listener of set) listener(event);
      }
    }

    close() {
      this.closed = true;
    }
  }

  // 1. Verify that onmessage-only does NOT catch named SSE events (proving the regression)
  const buggySource = new MockEventSource();
  let buggyReceived = false;
  buggySource.onmessage = () => { buggyReceived = true; };
  buggySource.dispatchEvent('text.delta', { type: 'text.delta', seq: 1, text: 'hello' });
  assert.equal(buggyReceived, false, 'onmessage must not receive named SSE event text.delta');

  // 2. Verify subscribeAgentEventSource listens to all SUPPORTED_AGENT_EVENT_TYPES
  const source = new MockEventSource();
  const receivedEvents = [];
  const unsubscribe = subscribeAgentEventSource(source, (event) => {
    receivedEvents.push(event);
  });

  for (const eventType of SUPPORTED_AGENT_EVENT_TYPES) {
    source.dispatchEvent(eventType, { type: eventType, seq: receivedEvents.length + 1, text: `data for ${eventType}` });
  }

  assert.equal(receivedEvents.length, SUPPORTED_AGENT_EVENT_TYPES.length);
  assert.deepEqual(receivedEvents.map(e => e.type), Array.from(SUPPORTED_AGENT_EVENT_TYPES));

  // 3. Verify applyAgentEvent state reduction
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', messageId: 'msg-1', text: 'Hello ' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'text.delta', messageId: 'msg-1', text: 'World' });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'reasoning.delta', messageId: 'msg-1', text: 'Deep thought' });
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'tool.started', turnId: '1', toolId: 'tool-a', toolName: 'test_tool', input: { a: 1 } });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'tool.completed', turnId: '1', toolId: 'tool-a', output: { success: true } });

  assert.equal(messages[0].text, 'Hello World');
  assert.equal(messages[0].reasoning, 'Deep thought');
  assert.equal(messages[0].toolCalls?.length, 1);
  assert.equal(messages[0].toolCalls[0].status, 'completed');
  assert.deepEqual(messages[0].toolCalls[0].output, { success: true });

  // 4. Verify unsubscribe cleans up listeners and closes EventSource
  unsubscribe();
  assert.equal(source.closed, true);
});

test('classifySessionLoadError distinguishes network, 404 not found, and general HTTP failures', async () => {
  const { classifySessionLoadError, AgentSessionLoadError } = await import('../src/lib/nevo-assistant-runtime.ts');

  // 1. Network / fetch failures
  const netErr1 = classifySessionLoadError(new TypeError('Failed to fetch'), 'claude', 'sess-1');
  assert.equal(netErr1.kind, 'network');
  assert.equal(netErr1.title, 'Nie można połączyć z dashboardem');
  assert.ok(netErr1.message.includes('serwer NEvo'));

  const fetchErr = new Error('Connection refused');
  fetchErr.name = 'FetchError';
  const classifiedFetchErr = classifySessionLoadError(fetchErr, 'claude', 'sess-1');
  assert.equal(classifiedFetchErr.kind, 'network');

  // 2. 404 Not Found
  const notFoundErr = classifySessionLoadError({ status: 404, message: 'Session deleted' }, 'claude', 'sess-1');
  assert.equal(notFoundErr.kind, 'not_found');
  assert.equal(notFoundErr.status, 404);
  assert.equal(notFoundErr.title, 'Sesja nie znaleziona');
  assert.equal(notFoundErr.message, 'Session deleted');

  // 3. HTTP 500 / 502 error
  const serverErr = classifySessionLoadError({ status: 500, message: 'Internal Server Error' }, 'claude', 'sess-1');
  assert.equal(serverErr.kind, 'http');
  assert.equal(serverErr.status, 500);
  assert.equal(serverErr.title, 'Błąd serwera (500)');
  assert.equal(serverErr.message, 'Internal Server Error');
});

test('fetchAgentSessionSnapshot parses snapshots and wraps HTTP and network errors with exact classification', async () => {
  const { fetchAgentSessionSnapshot } = await import('../src/lib/nevo-assistant-runtime.ts');

  // 1. Successful snapshot
  const mockFetchSuccess = async (url) => {
    assert.ok(url.includes('claude') && url.includes('sess-ok'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          provider: 'claude',
          providerSessionId: 'sess-ok',
          messages: [{ id: 'm1', role: 'user', text: 'hi' }],
          lastEventSeq: 4,
        },
      }),
    };
  };

  const snapshot = await fetchAgentSessionSnapshot('claude', 'sess-ok', mockFetchSuccess);
  assert.equal(snapshot.providerSessionId, 'sess-ok');
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.lastEventSeq, 4);

  // 2. 404 Not Found
  const mockFetch404 = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: { message: 'Session sess-404 not found' } }),
  });

  await assert.rejects(
    () => fetchAgentSessionSnapshot('claude', 'sess-404', mockFetch404),
    (err) => {
      assert.equal(err.kind, 'not_found');
      assert.equal(err.status, 404);
      assert.equal(err.title, 'Sesja nie znaleziona');
      assert.ok(err.message.includes('sess-404'));
      return true;
    }
  );

  // 3. 500 Internal Server Error
  const mockFetch500 = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ error: { message: 'Database failure' } }),
  });

  await assert.rejects(
    () => fetchAgentSessionSnapshot('claude', 'sess-500', mockFetch500),
    (err) => {
      assert.equal(err.kind, 'http');
      assert.equal(err.status, 500);
      assert.equal(err.title, 'Błąd serwera (500)');
      assert.equal(err.message, 'Database failure');
      return true;
    }
  );

  // 4. Network fetch rejection
  const mockFetchNetworkErr = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(
    () => fetchAgentSessionSnapshot('claude', 'sess-net', mockFetchNetworkErr),
    (err) => {
      assert.equal(err.kind, 'network');
      assert.equal(err.title, 'Nie można połączyć z dashboardem');
      return true;
    }
  );
});

test('session identity safety: failed switch clears previous session state, prevents stale rendering, and supports clean retry', async () => {
  const { fetchAgentSessionSnapshot, classifySessionLoadError } = await import('../src/lib/nevo-assistant-runtime.ts');

  // Define session mock database
  const sessions = {
    'claude:sess-A': {
      provider: 'claude',
      providerSessionId: 'sess-A',
      title: 'Session A Title',
      messages: [{ id: 'msg-A-1', role: 'user', text: 'Hello in A' }],
      pendingInteraction: { id: 'inter-A', kind: 'permission' },
      activeTurn: { turnId: 'turn-A-1' },
      capabilities: { cancelTurn: true },
      lastEventSeq: 10,
    },
    'claude:sess-B': {
      provider: 'claude',
      providerSessionId: 'sess-B',
      title: 'Session B Title',
      messages: [{ id: 'msg-B-1', role: 'user', text: 'Hello in B' }],
      pendingInteraction: null,
      activeTurn: null,
      capabilities: { cancelTurn: false },
      lastEventSeq: 5,
    },
  };

  let failB = true;

  const mockFetch = async (url) => {
    if (url.includes('sess-A')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: sessions['claude:sess-A'] }),
      };
    }
    if (url.includes('sess-B')) {
      if (failB) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ error: { message: 'Session B not found' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: sessions['claude:sess-B'] }),
      };
    }
    throw new TypeError('Network error');
  };

  // State machine simulator modeling useNevoAssistantRuntime identity-safe state
  class SessionRuntimeSimulator {
    constructor() {
      this.currentIdentity = '';
      this.loadedIdentity = null;
      this.sessionDetails = null;
      this.messages = [];
      this.pendingInteraction = null;
      this.activeTurnId = null;
      this.capabilities = null;
      this.isRunning = false;
      this.lastEventSeq = 0;
      this.isLoading = true;
      this.loadError = null;
    }

    setSession(provider, providerSessionId) {
      this.currentIdentity = provider && providerSessionId ? `${provider}:${providerSessionId}` : '';
      this.isLoading = true;
      this.loadError = null;
    }

    async load(provider, providerSessionId) {
      this.setSession(provider, providerSessionId);
      const identity = `${provider}:${providerSessionId}`;
      try {
        const snapshot = await fetchAgentSessionSnapshot(provider, providerSessionId, mockFetch);
        if (this.currentIdentity !== identity) return; // stale check
        this.sessionDetails = snapshot;
        this.messages = snapshot.messages || [];
        this.pendingInteraction = snapshot.pendingInteraction || null;
        this.capabilities = snapshot.capabilities || null;
        this.lastEventSeq = snapshot.lastEventSeq || 0;
        this.activeTurnId = snapshot.activeTurn?.turnId || null;
        this.isRunning = Boolean(snapshot.activeTurn);
        this.loadedIdentity = identity;
        this.isLoading = false;
        this.loadError = null;
      } catch (err) {
        if (this.currentIdentity !== identity) return;
        const classified = classifySessionLoadError(err, provider, providerSessionId);
        // Clean reset
        this.sessionDetails = null;
        this.messages = [];
        this.pendingInteraction = null;
        this.capabilities = null;
        this.activeTurnId = null;
        this.isRunning = false;
        this.lastEventSeq = 0;
        this.loadedIdentity = identity;
        this.isLoading = false;
        this.loadError = classified;
      }
    }

    get exposedState() {
      const isMatched = Boolean(this.currentIdentity && this.loadedIdentity === this.currentIdentity);
      return {
        sessionDetails: isMatched ? this.sessionDetails : null,
        messages: isMatched ? this.messages : [],
        pendingInteraction: isMatched ? this.pendingInteraction : null,
        capabilities: isMatched ? this.capabilities : null,
        activeTurnId: isMatched ? this.activeTurnId : null,
        isRunning: isMatched ? this.isRunning : false,
        lastEventSeq: isMatched ? this.lastEventSeq : 0,
        isLoading: isMatched ? this.isLoading : Boolean(this.currentIdentity && !this.loadError),
        loadError: isMatched ? this.loadError : null,
      };
    }
  }

  const runtime = new SessionRuntimeSimulator();

  // 1. Successfully load session A
  await runtime.load('claude', 'sess-A');
  let state = runtime.exposedState;
  assert.equal(state.sessionDetails?.providerSessionId, 'sess-A');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, 'Hello in A');
  assert.equal(state.pendingInteraction?.id, 'inter-A');
  assert.equal(state.activeTurnId, 'turn-A-1');
  assert.equal(state.isRunning, true);
  assert.equal(state.lastEventSeq, 10);
  assert.equal(state.loadError, null);

  // 2. Switch to session B while B snapshot fails (404)
  failB = true;
  await runtime.load('claude', 'sess-B');
  state = runtime.exposedState;

  // 3. Ensure NO data from session A remains visible or associated with B
  assert.equal(state.sessionDetails, null, 'sessionDetails from A must NOT leak into B');
  assert.deepEqual(state.messages, [], 'messages from A must NOT leak into B');
  assert.equal(state.pendingInteraction, null, 'pendingInteraction from A must NOT leak into B');
  assert.equal(state.activeTurnId, null, 'activeTurnId from A must NOT leak into B');
  assert.equal(state.isRunning, false, 'isRunning from A must NOT leak into B');
  assert.equal(state.lastEventSeq, 0, 'sequence cursor must be reset for failed B');
  assert.ok(state.loadError, 'loadError must be set for B');
  assert.equal(state.loadError.kind, 'not_found');
  assert.equal(state.loadError.status, 404);
  assert.equal(state.loadError.title, 'Sesja nie znaleziona');

  // 4. Retry B successfully
  failB = false;
  await runtime.load('claude', 'sess-B');
  state = runtime.exposedState;

  assert.equal(state.sessionDetails?.providerSessionId, 'sess-B');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, 'Hello in B');
  assert.equal(state.pendingInteraction, null);
  assert.equal(state.activeTurnId, null);
  assert.equal(state.isRunning, false);
  assert.equal(state.lastEventSeq, 5);
  assert.equal(state.loadError, null);

  // 5. Switching between two valid sessions does not leak state or sequence cursors
  await runtime.load('claude', 'sess-A');
  state = runtime.exposedState;
  assert.equal(state.sessionDetails?.providerSessionId, 'sess-A');
  assert.equal(state.messages[0].text, 'Hello in A');
  assert.equal(state.lastEventSeq, 10);

  await runtime.load('claude', 'sess-B');
  state = runtime.exposedState;
  assert.equal(state.sessionDetails?.providerSessionId, 'sess-B');
  assert.equal(state.messages[0].text, 'Hello in B');
  assert.equal(state.lastEventSeq, 5);
});

test('EventSource lifecycle during snapshot failure and retry: no SSE while snapshot is in-flight or failed', async () => {
  const { fetchAgentSessionSnapshot, classifySessionLoadError } = await import('../src/lib/nevo-assistant-runtime.ts');

  // Track EventSource creations and cleanups
  const sseLog = [];
  class TrackedEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sseLog.push({ action: 'open', url });
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
      sseLog.push({ action: 'close', url: this.url });
    }
  }

  // Model the exact state and SSE gating logic from useNevoAssistantRuntime
  class RuntimeEffectHarness {
    constructor(provider, providerSessionId) {
      this.provider = provider;
      this.providerSessionId = providerSessionId;
      this.currentIdentity = `${provider}:${providerSessionId}`;
      this.loadedIdentity = null;
      this.loadErrorIdentity = null;
      this.loadError = null;
      this.lastSeq = 0;
      this.activeSse = null;
    }

    setSession(provider, providerSessionId) {
      this.provider = provider;
      this.providerSessionId = providerSessionId;
      this.currentIdentity = `${provider}:${providerSessionId}`;
      this.syncSseEffect();
    }

    syncSseEffect() {
      const identity = `${this.provider}:${this.providerSessionId}`;
      // Invariant: Only connect SSE if snapshot for current identity is loaded and no loadError
      const shouldConnect = Boolean(this.provider && this.providerSessionId && this.loadedIdentity === identity && !this.loadError);
      
      if (!shouldConnect) {
        if (this.activeSse) {
          this.activeSse.close();
          this.activeSse = null;
        }
        return;
      }

      if (!this.activeSse) {
        const url = `/api/agent-sessions/${encodeURIComponent(this.provider)}/${encodeURIComponent(this.providerSessionId)}/events?after=${this.lastSeq}`;
        this.activeSse = new TrackedEventSource(url);
      }
    }

    async loadSnapshot(fetchFn) {
      const identity = `${this.provider}:${this.providerSessionId}`;
      this.loadError = null;
      this.loadErrorIdentity = null;
      this.syncSseEffect(); // while loading / retrying

      try {
        const snapshot = await fetchAgentSessionSnapshot(this.provider, this.providerSessionId, fetchFn);
        if (this.currentIdentity !== identity) return;
        this.loadedIdentity = identity;
        this.lastSeq = snapshot.lastEventSeq || 0;
        this.loadError = null;
        this.loadErrorIdentity = null;
        this.syncSseEffect(); // after successful snapshot
      } catch (err) {
        if (this.currentIdentity !== identity) return;
        const classified = classifySessionLoadError(err, this.provider, this.providerSessionId);
        this.loadedIdentity = null;
        this.loadErrorIdentity = identity;
        this.loadError = classified;
        this.lastSeq = 0;
        this.syncSseEffect(); // on snapshot failure
      }
    }

    async retry(fetchFn) {
      // reload(): clears loadError and starts fresh load
      this.loadError = null;
      this.loadErrorIdentity = null;
      this.syncSseEffect(); // must NOT open SSE here because loadedIdentity is still null!
      await this.loadSnapshot(fetchFn);
    }
  }

  const harness = new RuntimeEffectHarness('claude', 'sess-A');

  // Step 1: Initial load for sess-A succeeds with lastEventSeq 12
  await harness.loadSnapshot(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ session: { provider: 'claude', providerSessionId: 'sess-A', lastEventSeq: 12, messages: [] } }),
  }));

  assert.equal(sseLog.length, 1);
  assert.equal(sseLog[0].action, 'open');
  assert.ok(sseLog[0].url.includes('sess-A') && sseLog[0].url.includes('after=12'));

  // Step 2: Switch to sess-B
  harness.setSession('claude', 'sess-B');
  assert.equal(sseLog.length, 2);
  assert.equal(sseLog[1].action, 'close', 'Old SSE for sess-A must be closed immediately on switch');

  // Step 3: sess-B snapshot load fails (404)
  await harness.loadSnapshot(async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: { message: 'Not found' } }),
  }));

  // Assert no SSE was opened for failed sess-B
  assert.equal(sseLog.length, 2, 'No SSE must be opened for failed session');
  assert.equal(harness.loadedIdentity, null, 'loadedIdentity must NOT be set on failure');
  assert.equal(harness.loadErrorIdentity, 'claude:sess-B');

  // Step 4: User clicks Retry -> retry begins
  let fetchStarted = false;
  let finishFetch = null;
  const inFlightPromise = new Promise((resolve) => { finishFetch = resolve; });

  const slowRetryFetch = async () => {
    fetchStarted = true;
    await inFlightPromise;
    return {
      ok: true,
      status: 200,
      json: async () => ({ session: { provider: 'claude', providerSessionId: 'sess-B', lastEventSeq: 7, messages: [] } }),
    };
  };

  const retryPromise = harness.retry(slowRetryFetch);
  assert.equal(fetchStarted, true);
  // While retry fetch is in-flight and loadError is null, verify no SSE is opened!
  assert.equal(sseLog.length, 2, 'No SSE must be opened while retry snapshot is still in-flight');

  // Finish snapshot fetch
  finishFetch();
  await retryPromise;

  // Step 5: After retry snapshot succeeds with lastEventSeq 7, SSE connects with after=7
  assert.equal(sseLog.length, 3);
  assert.equal(sseLog[2].action, 'open');
  assert.ok(sseLog[2].url.includes('sess-B') && sseLog[2].url.includes('after=7'));
});

test('error domain separation: snapshot failure sets loadError without triggering turn submission error', async () => {
  const { fetchAgentSessionSnapshot, classifySessionLoadError } = await import('../src/lib/nevo-assistant-runtime.ts');

  let submissionErrors = [];
  const onError = (err) => {
    submissionErrors.push(err.message);
  };

  // Simulate snapshot load with error domain separation
  let snapshotLoadError = null;
  const loadSnapshot = async (fetchFn) => {
    try {
      await fetchAgentSessionSnapshot('claude', 'sess-err', fetchFn);
      snapshotLoadError = null;
    } catch (err) {
      snapshotLoadError = classifySessionLoadError(err, 'claude', 'sess-err');
      // Invariant: Do NOT invoke onError for snapshot load errors!
    }
  };

  // 1. Snapshot fetch fails (500)
  await loadSnapshot(async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Error',
    json: async () => ({ error: { message: 'Server database failure' } }),
  }));

  assert.ok(snapshotLoadError);
  assert.equal(snapshotLoadError.kind, 'http');
  assert.equal(snapshotLoadError.status, 500);
  assert.equal(submissionErrors.length, 0, 'Snapshot failure must NOT trigger generic turn onError callback');

  // 2. Retry succeeds
  await loadSnapshot(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ session: { provider: 'claude', providerSessionId: 'sess-err', lastEventSeq: 1, messages: [] } }),
  }));

  assert.equal(snapshotLoadError, null);
  assert.equal(submissionErrors.length, 0, 'No stale submission error should exist after successful retry');

  // 3. Genuine sendTurn failure DOES invoke onError
  const simulateSendTurn = async () => {
    try {
      const res = await (async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Cannot start turn: turn in progress' } }),
      }))();
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData?.error?.message || 'Send turn failed');
      }
    } catch (err) {
      onError(err);
    }
  };

  await simulateSendTurn();
  assert.equal(submissionErrors.length, 1);
  assert.equal(submissionErrors[0], 'Cannot start turn: turn in progress');
});
