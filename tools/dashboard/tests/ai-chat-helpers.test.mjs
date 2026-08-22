import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  composeChatMessages,
  createTurnIdempotencyKey,
  initialPromptWithTaskContext,
} from '../src/lib/ai-chat-helpers.ts';
import { useNevoAssistantRuntime } from '../src/lib/nevo-assistant-runtime.ts';

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

test('selected stable task IDs and specification context are prepended to the initial prompt', () => {
  assert.equal(
    initialPromptWithTaskContext(' Review these tasks. ', ['task-a', 'task-b']),
    'Context: tasks task-a, task-b\n\nReview these tasks.'
  );
  assert.equal(initialPromptWithTaskContext(' General review. ', []), 'General review.');
  assert.equal(initialPromptWithTaskContext('   ', ['task-a']), null);

  const specPrompt = initialPromptWithTaskContext(
    'Please analyze this task.',
    ['task-1'],
    {
      slug: 'my-feature',
      title: 'My Feature',
      tasks: [{ id: 'task-1', title: 'First Task' }],
    }
  );
  assert.ok(specPrompt?.includes("[NEvo Context: Specification 'my-feature']"));
  assert.ok(specPrompt?.includes('Title: "My Feature"'));
  assert.ok(specPrompt?.includes('Location: specs/active/my-feature/'));
  assert.ok(specPrompt?.includes('Focus Tasks: task-1 ("First Task")'));
  assert.ok(specPrompt?.includes('Please analyze this task.'));

  const emptyMsgSpecPrompt = initialPromptWithTaskContext(
    '',
    [],
    { slug: 'my-feature', title: 'My Feature' }
  );
  assert.ok(emptyMsgSpecPrompt?.includes("[NEvo Context: Specification 'my-feature']"));
  assert.ok(emptyMsgSpecPrompt?.includes('Scope: Full specification'));

  const planningPrompt = initialPromptWithTaskContext(
    '',
    [],
    {
      slug: 'my-feature',
      title: 'My Feature',
      goal: 'Build awesome things',
      isPlanning: true,
    }
  );
  assert.ok(planningPrompt?.includes("[NEvo Context: Specification 'my-feature']"));
  assert.ok(planningPrompt?.includes('Status: draft (skeleton created: change.yaml, overview.md)'));
  assert.ok(planningPrompt?.includes('Goal: Build awesome things'));
  assert.ok(planningPrompt?.includes('Please review the skeleton files'));
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

  // 3. Verify applyAgentEvent state reduction — every event for one turn carries the
  // same turnId (the real, current-schema wire shape: contracts.mjs requires turnId on
  // every event), which is what correlates text/reasoning/tool activity into one message.
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', turnId: '1', messageId: 'msg-1', text: 'Hello ' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'text.delta', turnId: '1', messageId: 'msg-1', text: 'World' });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'reasoning.delta', turnId: '1', messageId: 'msg-1', text: 'Deep thought' });
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'tool.started', turnId: '1', toolId: 'tool-a', toolName: 'test_tool', input: { a: 1 } });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'tool.completed', turnId: '1', toolId: 'tool-a', output: { success: true }, status: 'completed' });

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

function createHookHarness() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.HTMLIFrameElement = class {};
  globalThis.HTMLElement = class {};
  globalThis.Element = class {};

  const doc = {
    nodeType: 9,
    nodeName: '#document',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    defaultView: globalThis,
    createElement: (tag) => {
      const el = {
        nodeType: 1,
        nodeName: tag.toUpperCase(),
        tagName: tag.toUpperCase(),
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        setAttribute: () => {},
        removeAttribute: () => {},
        appendChild: (c) => { c.parentNode = el; },
        removeChild: () => {},
        insertBefore: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        style: {},
        ownerDocument: doc,
      };
      return el;
    },
    createElementNS: (ns, tag) => {
      const el = doc.createElement(tag);
      el.namespaceURI = ns;
      return el;
    },
    createTextNode: (text) => ({ nodeType: 3, textContent: text, ownerDocument: doc }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = doc;
  globalThis.window = globalThis;

  const container = doc.createElement('div');
  const root = createRoot(container);

  let currentResult = null;
  let currentProps = null;

  function TestComponent(props) {
    currentResult = useNevoAssistantRuntime(props);
    return null;
  }

  return {
    async render(props) {
      currentProps = props;
      await act(async () => {
        root.render(React.createElement(TestComponent, props));
      });
      return currentResult;
    },
    async rerender(props) {
      currentProps = { ...currentProps, ...props };
      await act(async () => {
        root.render(React.createElement(TestComponent, currentProps));
      });
      return currentResult;
    },
    async act(fn) {
      await act(async () => {
        await fn();
      });
      return currentResult;
    },
    get result() {
      return currentResult;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

test('real useNevoAssistantRuntime mounting: EventSource lifecycle during snapshot failure and retry', async () => {
  const sseEvents = [];
  globalThis.EventSource = class MockEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sseEvents.push({ action: 'open', url });
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
      sseEvents.push({ action: 'close', url: this.url });
    }
  };

  let failSnapshot = true;
  let resolveInflightFetch = null;
  let blockFetchPromise = null;

  globalThis.fetch = async (url) => {
    if (failSnapshot) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { message: 'Session not found' } }),
      };
    }
    if (blockFetchPromise) {
      await blockFetchPromise;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          provider: 'claude',
          providerSessionId: 'sess-retry-test',
          messages: [{ id: 'm1', role: 'user', text: 'hello' }],
          lastEventSeq: 42,
        },
      }),
    };
  };

  const errorsReceived = [];
  const harness = createHookHarness();

  // 1. Initial snapshot fails (404)
  await harness.render({
    provider: 'claude',
    providerSessionId: 'sess-retry-test',
    onError: (err) => errorsReceived.push(err),
  });

  assert.equal(harness.result.loadError?.kind, 'not_found');
  assert.equal(harness.result.sessionDetails, null);
  assert.deepEqual(harness.result.messages, []);
  assert.equal(errorsReceived.length, 0, 'onError must NOT be called on snapshot load failure');
  assert.equal(sseEvents.length, 0, 'No EventSource should be opened when snapshot fails');

  // 2. Trigger retry while snapshot fetch is in-flight
  failSnapshot = false;
  blockFetchPromise = new Promise((resolve) => { resolveInflightFetch = resolve; });

  const retryPromise = harness.act(async () => {
    void harness.result.reload();
  });

  // While retry is in-flight and loadError is cleared, verify EventSource is STILL NOT created
  assert.equal(sseEvents.length, 0, 'EventSource must NOT be opened while retry snapshot is in-flight');

  // 3. Resolve snapshot fetch
  resolveInflightFetch();
  await retryPromise;

  // 4. Verify EventSource connects once snapshot succeeds, starting from exactly snapshot.lastEventSeq
  assert.equal(sseEvents.length, 1);
  assert.equal(sseEvents[0].action, 'open');
  assert.ok(sseEvents[0].url.includes('sess-retry-test') && sseEvents[0].url.includes('after=42'));
  assert.equal(harness.result.sessionDetails?.providerSessionId, 'sess-retry-test');
  assert.equal(harness.result.messages.length, 1);
  assert.equal(harness.result.loadError, null);
});

test('real useNevoAssistantRuntime mounting: session switch A -> failed B -> retry B prevents stale state and manages EventSource', async () => {
  const sseEvents = [];
  globalThis.EventSource = class MockEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sseEvents.push({ action: 'open', url });
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
      sseEvents.push({ action: 'close', url: this.url });
    }
  };

  let failB = false;
  globalThis.fetch = async (url) => {
    if (url.includes('sess-A')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            provider: 'claude',
            providerSessionId: 'sess-A',
            messages: [{ id: 'ma', role: 'user', text: 'msg in A' }],
            lastEventSeq: 10,
          },
        }),
      };
    }
    if (url.includes('sess-B')) {
      if (failB) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Error',
          json: async () => ({ error: { message: 'DB error' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            provider: 'claude',
            providerSessionId: 'sess-B',
            messages: [{ id: 'mb', role: 'user', text: 'msg in B' }],
            lastEventSeq: 5,
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const harness = createHookHarness();

  // 1. Successfully load session A
  await harness.render({ provider: 'claude', providerSessionId: 'sess-A' });
  assert.equal(harness.result.sessionDetails?.providerSessionId, 'sess-A');
  assert.equal(harness.result.messages[0].text, 'msg in A');
  assert.equal(sseEvents.length, 1);
  assert.ok(sseEvents[0].url.includes('sess-A') && sseEvents[0].url.includes('after=10'));

  // 2. Switch to session B while B snapshot fails (500)
  failB = true;
  await harness.rerender({ provider: 'claude', providerSessionId: 'sess-B' });

  // EventSource for A is closed immediately on switch
  assert.equal(sseEvents.length, 2);
  assert.equal(sseEvents[1].action, 'close');
  assert.ok(sseEvents[1].url.includes('sess-A'));

  // No stale state from session A remains visible or associated with B
  assert.equal(harness.result.sessionDetails, null);
  assert.deepEqual(harness.result.messages, []);
  assert.equal(harness.result.loadError?.kind, 'http');
  assert.equal(harness.result.loadError?.status, 500);

  // 3. Retry session B succeeds
  failB = false;
  await harness.act(async () => {
    await harness.result.reload();
  });

  assert.equal(harness.result.sessionDetails?.providerSessionId, 'sess-B');
  assert.equal(harness.result.messages[0].text, 'msg in B');
  assert.equal(harness.result.loadError, null);

  // EventSource for B opens with B's snapshot cursor (after=5)
  assert.equal(sseEvents.length, 3);
  assert.equal(sseEvents[2].action, 'open');
  assert.ok(sseEvents[2].url.includes('sess-B') && sseEvents[2].url.includes('after=5'));
});

test('real useNevoAssistantRuntime mounting: error domain separation between snapshot failures and turn execution failures', async () => {
  const errorsReceived = [];
  const harness = createHookHarness();

  globalThis.EventSource = class MockEventSource {
    constructor(url) { this.url = url; }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };

  let snapshotFail = true;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST' && url.includes('/turns')) {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: { message: 'Turn execution conflict' } }),
      };
    }
    if (snapshotFail) {
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        json: async () => ({ error: { message: 'Dashboard server error' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          provider: 'claude',
          providerSessionId: 'sess-domain-test',
          messages: [],
          lastEventSeq: 0,
        },
      }),
    };
  };

  // 1. Snapshot failure produces loadError but NEVER invokes onError
  await harness.render({
    provider: 'claude',
    providerSessionId: 'sess-domain-test',
    onError: (err) => errorsReceived.push(err.message),
  });

  assert.ok(harness.result.loadError);
  assert.equal(harness.result.loadError.kind, 'http');
  assert.equal(errorsReceived.length, 0, 'Snapshot failure must not invoke onError');

  // 2. Retry snapshot succeeds -> loadError clears, onError is still uncalled
  snapshotFail = false;
  await harness.act(async () => {
    await harness.result.reload();
  });

  assert.equal(harness.result.loadError, null);
  assert.equal(errorsReceived.length, 0, 'No stale turn error should exist after successful retry');

  // 3. Genuine sendTurn failure DOES invoke onError
  await harness.act(async () => {
    await harness.result.sendTurn('Test message');
  });

  assert.equal(errorsReceived.length, 1);
  assert.equal(errorsReceived[0], 'Turn execution conflict');
});
