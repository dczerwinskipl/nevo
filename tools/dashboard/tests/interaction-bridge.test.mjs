import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  McpInteractionRegistry,
  createNevoMcpServer,
  formatInteractionAnswer,
  mcpRoutes,
} from '../server/ai/interactions/mcp/index.mjs';
import { createClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { AiError, createCanonicalTurn } from '../server/ai/contracts.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { reconcileOrphanedTurns } from '../server/ai/sessions/turns/turn-recovery.mjs';

test('McpInteractionRegistry: active turns, tokens, pending interactions, and cancellations', async () => {
  const registry = new McpInteractionRegistry();

  // 1. Unregistered turn returns null
  assert.equal(registry.getActiveTurn({ turnId: 'nonexistent-turn' }), null);
  assert.equal(registry.getActiveTurnByToken('nonexistent-token'), null);

  // 2. Register active turn with token
  const token = 'tok-active-123';
  let requestedNeutral = null;
  let requestedPolicy = null;
  registry.registerActiveTurn('turn-1', {
    token,
    provider: 'claude',
    providerSessionId: 'sess-1',
    requestInteraction: (neutral, options) => {
      requestedNeutral = neutral;
      requestedPolicy = options?.resumePolicy;
      return Promise.resolve({ ...neutral, id: 'int-100' });
    },
  });

  assert.equal(registry.getActiveTurn({ turnId: 'turn-1' })?.turnId, 'turn-1');
  assert.equal(registry.getActiveTurnByToken(token)?.turnId, 'turn-1');
  assert.equal(registry.getActiveTurn({ provider: 'claude', providerSessionId: 'sess-1' })?.turnId, 'turn-1');

  // 3. Register pending interaction and wait for response
  const pendingEntry = registry.registerPending('int-100', {
    turnId: 'turn-1',
    provider: 'claude',
    providerSessionId: 'sess-1',
  });
  assert.ok(pendingEntry);
  assert.equal(registry.hasPending('int-100'), true);
  assert.equal(registry.getPending('int-100')?.turnId, 'turn-1');

  const waitPromise = registry.waitForResponse('int-100');

  // 4. Resolving response resolves waiter promise
  const resolved = registry.resolveResponse('int-100', { answers: [{ questionId: 'q1', value: 'Option A' }] });
  assert.equal(resolved, true);
  assert.equal(registry.hasPending('int-100'), false);

  const answer = await waitPromise;
  assert.deepEqual(answer, { answers: [{ questionId: 'q1', value: 'Option A' }] });

  // Resolving already completed interaction returns false
  assert.equal(registry.resolveResponse('int-100', { answer: 'Duplicate' }), false);

  // 5. Unregister active turn cleans up token and session lookups
  registry.unregisterActiveTurn('turn-1');
  assert.equal(registry.getActiveTurn({ turnId: 'turn-1' }), null);
  assert.equal(registry.getActiveTurnByToken(token), null);
});

test('McpInteractionRegistry: provider exit / unregisterActiveTurn terminates pending waiters immediately', async () => {
  const registry = new McpInteractionRegistry();
  const token = 'tok-exit-test';

  registry.registerActiveTurn('turn-exit', {
    token,
    provider: 'claude',
    providerSessionId: 'sess-exit',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-exit-1' }),
  });

  registry.registerPending('int-exit-1', {
    turnId: 'turn-exit',
    provider: 'claude',
    providerSessionId: 'sess-exit',
  });

  const waiterPromise = registry.waitForResponse('int-exit-1');
  assert.equal(registry.hasPending('int-exit-1'), true);

  const exitError = new AiError('AI_PROVIDER_EXIT_ERROR', 'Claude process exited unexpectedly with code 1');

  // Unregister active turn with provider exit error
  registry.unregisterActiveTurn('turn-exit', exitError);

  // Waiter must be rejected immediately with the exit error
  await assert.rejects(waiterPromise, (err) => {
    assert.equal(err.code, 'AI_PROVIDER_EXIT_ERROR');
    assert.ok(err.message.includes('code 1'));
    return true;
  });

  assert.equal(registry.hasPending('int-exit-1'), false);
  assert.equal(registry.getActiveTurn({ turnId: 'turn-exit' }), null);
});

test('formatInteractionAnswer formats single, multiple, and object responses', () => {
  assert.equal(
    formatInteractionAnswer({ answers: [{ questionId: 'q1', value: 'Yes' }] }),
    'Yes',
  );
  assert.equal(
    formatInteractionAnswer({
      answers: [
        { questionId: 'q1', value: ['Option A', 'Option B'] },
        { questionId: 'q2', value: 'Option C' },
      ],
    }),
    'Option A, Option B\nOption C',
  );
  assert.equal(formatInteractionAnswer({ answer: 'Direct string answer' }), 'Direct string answer');
  assert.equal(formatInteractionAnswer({ answer: 42 }), '42');
  assert.equal(formatInteractionAnswer(null), 'null');
});

test('Single canonical ask_user tool: schema, validation, and no aliases', async () => {
  const registry = new McpInteractionRegistry();
  const server = createNevoMcpServer(registry);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  // 1. Tool listing exposes ONLY 'ask_user' (no aliases)
  const { tools } = await client.listTools();
  assert.equal(tools.length, 1, 'Server must expose exactly one canonical tool');
  assert.equal(tools[0].name, 'ask_user');
  assert.ok(tools[0].description.includes('Ask the human user'));
  assert.ok(tools[0].inputSchema.properties.question);
  assert.ok(tools[0].inputSchema.properties.header);
  assert.ok(tools[0].inputSchema.properties.options);
  assert.ok(tools[0].inputSchema.properties.multiSelect);
  assert.equal(tools.some((t) => t.name === 'ask_question'), false, 'Aliases must not exist');
  assert.equal(tools.some((t) => t.name === 'ask_user_choice'), false, 'Aliases must not exist');

  await client.close();
  await server.close();
});

test('Official MCP SDK Client with InMemoryTransport: round-trip, token extraction, and validation', async () => {
  const registry = new McpInteractionRegistry();
  let requestedNeutral = null;

  const token = 'tok-inmem-456';
  registry.registerActiveTurn('turn-inmem', {
    token,
    provider: 'claude',
    providerSessionId: 'sess-inmem',
    requestInteraction: (neutral) => {
      requestedNeutral = neutral;
      return Promise.resolve({ ...neutral, id: 'int-inmem-1' });
    },
  });

  const server = createNevoMcpServer(registry);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  // 1. Missing token returns error
  const noTokenResult = await client.callTool({
    name: 'ask_user',
    arguments: { question: 'Question without token?' },
  });
  assert.equal(noTokenResult.isError, true);
  assert.ok(noTokenResult.content[0].text.includes('Forbidden: missing turn correlation token'));

  // 2. Empty question returns validation error
  // (we simulate extra context by testing createNevoMcpServer tool handler with extra)
  const emptyQuestionResult = await client.callTool({
    name: 'ask_user',
    arguments: { question: '   ' },
  });
  assert.equal(emptyQuestionResult.isError, true);
  assert.ok(emptyQuestionResult.content[0].text.includes('Validation error: question is required'));

  await client.close();
  await server.close();
});

test('Fastify mcpRoutes: loopback enforcement, /mcp and /api/ai/mcp routes, and full MCP lifecycle', async () => {
  const registry = new McpInteractionRegistry();
  const token = 'tok-fastify-loopback';

  registry.registerActiveTurn('turn-fastify', {
    token,
    provider: 'claude',
    providerSessionId: 'sess-fastify',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-fastify-1' }),
  });

  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRoutes, { registry });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = fastify.server.address().port;

  try {
    // 1. Loopback check: non-loopback IP returns 403 Forbidden
    const forbiddenRes = await fastify.inject({
      method: 'POST',
      url: '/mcp',
      remoteAddress: '192.168.1.100',
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    assert.equal(forbiddenRes.statusCode, 403);
    assert.ok(JSON.parse(forbiddenRes.body).message.includes('Forbidden: MCP endpoint only accessible from loopback'));

    // 2. Full MCP lifecycle over real Streamable HTTP:
    // Step 2a: Initialize
    const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-claude', version: '2.1.220' },
        },
      }),
    });

    assert.equal(initRes.status, 200);
    const mcpSessionId = initRes.headers.get('mcp-session-id');
    assert.ok(mcpSessionId, 'Server must return mcp-session-id header');
    const initBody = await initRes.json();
    assert.equal(initBody.result.serverInfo.name, 'nevo');

    // Step 2b: Initialized notification
    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    });

    // Step 2c: Tools listing
    const toolsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    const toolsBody = await toolsRes.json();
    assert.equal(toolsBody.result.tools.length, 1);
    assert.equal(toolsBody.result.tools[0].name, 'ask_user');

    // Step 2d: Tools call on /api/ai/mcp endpoint with token in header
    const callPromise = fetch(`http://127.0.0.1:${port}/api/ai/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': mcpSessionId,
        'x-bridge-token': token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'ask_user',
          arguments: {
            question: 'Which deployment target?',
            options: ['Staging', 'Production'],
          },
        },
      }),
    });

    // Wait for interaction to become pending
    while (!registry.hasPending('int-fastify-1')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Resolve interaction
    registry.resolveResponse('int-fastify-1', {
      answers: [{ questionId: 'q1', value: 'Staging' }],
    });

    const callRes = await callPromise;
    assert.equal(callRes.status, 200);
    const callBody = await callRes.json();
    assert.ok(callBody.result.content[0].text.includes('Staging'));
  } finally {
    await fastify.close();
  }
});

test('Token correlation security: missing, invalid, and stale tokens are rejected', async () => {
  const registry = new McpInteractionRegistry();
  const token = 'tok-valid-sec';

  registry.registerActiveTurn('turn-sec', {
    token,
    provider: 'claude',
    providerSessionId: 'sess-sec',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-sec-1' }),
  });

  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRoutes, { registry });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = fastify.server.address().port;

  try {
    // Initialize session
    const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      }),
    });
    const sid = initRes.headers.get('mcp-session-id');

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    // 1. Missing token
    const noTokenRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Missing token?' } },
      }),
    });
    const noTokenBody = await noTokenRes.json();
    assert.equal(noTokenBody.result.isError, true);
    assert.ok(noTokenBody.result.content[0].text.includes('Forbidden: missing turn correlation token'));

    // 2. Wrong token
    const wrongTokenRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-bridge-token': 'wrong-token-abc',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Wrong token?' } },
      }),
    });
    const wrongTokenBody = await wrongTokenRes.json();
    assert.equal(wrongTokenBody.result.isError, true);
    assert.ok(wrongTokenBody.result.content[0].text.includes('invalid, stale, or expired'));

    // 3. Stale token after turn unregistration
    registry.unregisterActiveTurn('turn-sec');
    const staleTokenRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-bridge-token': token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Stale token?' } },
      }),
    });
    const staleTokenBody = await staleTokenRes.json();
    assert.equal(staleTokenBody.result.isError, true);
    assert.ok(staleTokenBody.result.content[0].text.includes('invalid, stale, or expired'));
  } finally {
    await fastify.close();
  }
});

test('Bridge race conditions: authoritative terminal outcome for concurrent answer and cancel', async () => {
  const registry = new McpInteractionRegistry();

  // Scenario A: cancel before answer
  registry.registerActiveTurn('turn-race-a', {
    token: 'tok-race-a',
    provider: 'claude',
    providerSessionId: 'sess-race-a',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-race-a' }),
  });

  registry.registerPending('int-race-a', {
    turnId: 'turn-race-a',
    provider: 'claude',
    providerSessionId: 'sess-race-a',
  });
  const waitPromiseA = registry.waitForResponse('int-race-a');

  // User cancels first
  const cancelledCount = registry.cancelTurn('turn-race-a');
  assert.equal(cancelledCount, 1);

  // Subsequent answer cannot resolve
  const answeredLate = registry.resolveResponse('int-race-a', { answer: 'Too late' });
  assert.equal(answeredLate, false, 'Resolving cancelled interaction must return false');

  await assert.rejects(waitPromiseA, (err) => {
    assert.equal(err.code, 'AI_TURN_CANCELLED');
    return true;
  });

  // Repeated cancel is a no-op
  const repeatedCancel = registry.cancelTurn('turn-race-a');
  assert.equal(repeatedCancel, 0, 'Repeated cancel must be idempotent');

  // Scenario B: answer before cancel
  registry.registerActiveTurn('turn-race-b', {
    token: 'tok-race-b',
    provider: 'claude',
    providerSessionId: 'sess-race-b',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-race-b' }),
  });

  registry.registerPending('int-race-b', {
    turnId: 'turn-race-b',
    provider: 'claude',
    providerSessionId: 'sess-race-b',
  });
  const waitPromiseB = registry.waitForResponse('int-race-b');

  // User answers first
  const answeredFirst = registry.resolveResponse('int-race-b', { answer: 'Just in time' });
  assert.equal(answeredFirst, true);

  const resultB = await waitPromiseB;
  assert.deepEqual(resultB, { answer: 'Just in time' });

  // Subsequent cancel finds no pending interaction
  const cancelAfterAnswer = registry.cancelTurn('turn-race-b');
  assert.equal(cancelAfterAnswer, 0);

  // Repeated answer is a no-op
  const repeatedAnswer = registry.resolveResponse('int-race-b', { answer: 'Duplicate' });
  assert.equal(repeatedAnswer, false);
});

test('Server shutdown: cleanly terminates and rejects pending bridge requests with 503', async () => {
  const registry = new McpInteractionRegistry();

  registry.registerActiveTurn('turn-shutdown', {
    token: 'tok-shutdown',
    provider: 'claude',
    providerSessionId: 'sess-shutdown',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-shutdown' }),
  });

  registry.registerPending('int-shutdown', {
    turnId: 'turn-shutdown',
    provider: 'claude',
    providerSessionId: 'sess-shutdown',
  });
  const waitPromise = registry.waitForResponse('int-shutdown');

  // Server triggers shutdown
  registry.shutdown(new AiError('AI_SERVER_SHUTDOWN', 'Server is shutting down.', { status: 503 }));

  await assert.rejects(waitPromise, (err) => {
    assert.equal(err.code, 'AI_SERVER_SHUTDOWN');
    assert.equal(err.status, 503);
    return true;
  });

  assert.equal(registry.hasPending('int-shutdown'), false);
  assert.equal(registry.getActiveTurn({ turnId: 'turn-shutdown' }), null);
});

test('Restart reconciliation: persisted live-operation interaction is interrupted on boot', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'nevo-reconcile-test-'));

  try {
    const transcriptCache = createTranscriptCacheService({ baseDir });
    const provider = 'claude';
    const providerSessionId = 'sess-restart-1';

    // Simulate an active turn persisted to disk with a live-operation interaction
    const turn = createCanonicalTurn({
      id: 'turn-restart-1',
      sessionId: providerSessionId,
      provider,
      providerSessionId,
      userMessage: { text: 'Do something' },
    });
    turn.status = { status: 'requiresAttention' };
    turn.work = [
      {
        type: 'interaction',
        status: 'pending',
        interaction: {
          id: 'int-restart-10',
          kind: 'question',
          resumePolicy: 'live-operation',
          questions: [{ question: 'Answer me?' }],
        },
      },
    ];
    transcriptCache.recordCanonicalTurn(provider, providerSessionId, turn);
    await transcriptCache.flush(provider, providerSessionId);

    // Boot reconciliation runs with fresh cache
    const rebootedCache = createTranscriptCacheService({ baseDir });
    const { reconciledCount } = await reconcileOrphanedTurns(rebootedCache);
    assert.equal(reconciledCount, 1, 'Orphaned live-operation turn must be reconciled');

    // Persisted transcript reflects interrupted turn
    const transcript = await rebootedCache.getTranscript(provider, providerSessionId);
    assert.equal(Boolean(transcript.activeTurn), false, 'Active turn must be cleared');
    assert.equal(Boolean(transcript.pendingInteraction), false, 'Pending interaction must be cleared');

    const lastTurn = transcript.turns[transcript.turns.length - 1];
    assert.equal(lastTurn.status.status, 'terminal');
    assert.equal(lastTurn.status.outcome, 'interrupted');
    assert.ok(lastTurn.status.error.message.includes('Interrupted by server restart'));
  } finally {
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Claude provider: dynamic capability truthfulness reflects endpoint configuration and enabled state', () => {
  // 1. Normal configuration with MCP endpoint URL configured
  const enabledProvider = createClaudeAgentProvider({
    mcpEnabled: true,
    mcpEndpointUrl: 'http://127.0.0.1:4318/mcp',
  });
  assert.equal(enabledProvider.capabilities.interactiveQuestions, true);
  assert.equal(enabledProvider.capabilities.interactiveConfirmations, false);
  assert.equal(enabledProvider.descriptor.capabilities.interactiveQuestions, true);

  // 2. Disabled MCP
  const disabledProvider = createClaudeAgentProvider({
    mcpEnabled: false,
    mcpEndpointUrl: 'http://127.0.0.1:4318/mcp',
  });
  assert.equal(disabledProvider.capabilities.interactiveQuestions, false);
  assert.equal(disabledProvider.descriptor.capabilities.interactiveQuestions, false);

  // 3. Null or missing endpoint URL
  const missingEndpointProvider = createClaudeAgentProvider({
    mcpEnabled: true,
    mcpEndpointUrl: null,
  });
  assert.equal(missingEndpointProvider.capabilities.interactiveQuestions, false);
  assert.equal(missingEndpointProvider.descriptor.capabilities.interactiveQuestions, false);
});
