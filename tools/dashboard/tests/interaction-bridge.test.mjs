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
  assert.ok(noTokenResult.content[0].text.includes('Forbidden: missing x-nevo-interaction-token header'));

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

test('Fastify mcpRoutes: loopback enforcement, canonical /mcp route, and full MCP lifecycle', async () => {
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
        'x-nevo-interaction-token': token,
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

    // Step 2d: Tools call on canonical /mcp endpoint with x-nevo-interaction-token in header
    const callPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': mcpSessionId,
        'x-nevo-interaction-token': token,
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

    // Step 2e: Verify deprecated /api/ai/mcp endpoint is removed (returns 404)
    const deprecatedRes = await fetch(`http://127.0.0.1:${port}/api/ai/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
    });
    assert.equal(deprecatedRes.status, 404, 'Deprecated /api/ai/mcp route must return 404');
  } finally {
    await fastify.close();
  }
});

test('Token correlation security: missing, invalid, stale, wrong turn, and query-param rejection', async () => {
  const registry = new McpInteractionRegistry();
  const tokenValid = 'tok-valid-sec';
  const tokenOther = 'tok-other-turn';

  registry.registerActiveTurn('turn-sec', {
    token: tokenValid,
    provider: 'claude',
    providerSessionId: 'sess-sec',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-sec-1' }),
  });

  registry.registerActiveTurn('turn-other', {
    token: tokenOther,
    provider: 'claude',
    providerSessionId: 'sess-other',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-other-1' }),
  });

  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRoutes, { registry });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = fastify.server.address().port;

  try {
    // 1. Missing token header during initialization is rejected with 403
    const noTokenInitRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } },
      }),
    });
    assert.equal(noTokenInitRes.status, 403);
    const noTokenInitBody = await noTokenInitRes.json();
    assert.ok(noTokenInitBody.error.message.includes('missing x-nevo-interaction-token header'));

    // 2. Token in query param during initialization is rejected (must be in header)
    const queryParamInitRes = await fetch(`http://127.0.0.1:${port}/mcp?token=${tokenValid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } },
      }),
    });
    assert.equal(queryParamInitRes.status, 403);
    const queryParamInitBody = await queryParamInitRes.json();
    assert.ok(queryParamInitBody.error.message.includes('missing x-nevo-interaction-token header'));

    // 3. Invalid / unknown token during initialization is rejected with 403
    const wrongTokenInitRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': 'wrong-token-xyz',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } },
      }),
    });
    assert.equal(wrongTokenInitRes.status, 403);
    const wrongTokenInitBody = await wrongTokenInitRes.json();
    assert.ok(wrongTokenInitBody.error.message.includes('invalid, stale, or expired'));

    // 4. Initialize session sid successfully with tokenValid
    const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': tokenValid,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      }),
    });
    assert.equal(initRes.status, 200);
    const sid = initRes.headers.get('mcp-session-id');
    assert.ok(sid, 'Initialization returns mcp-session-id');

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    // 5. Presenting tokenOther on session sid (bound to turn-sec) is REJECTED and does NOT route to turn-other
    const wrongTurnRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-nevo-interaction-token': tokenOther,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Attempt cross-turn routing' } },
      }),
    });
    assert.equal(wrongTurnRes.status, 403, 'Submitting token of another turn on session sid must be rejected with 403');
    const wrongTurnBody = await wrongTurnRes.json();
    assert.ok(
      wrongTurnBody.error.message.includes('Forbidden: interaction token does not match the bound session turn'),
      'Error message must indicate token mismatch with bound session',
    );
    assert.equal(registry.hasPending('int-other-1'), false, 'Must NOT create interaction on other turn');

    // 6. Presenting matching tokenValid on session sid succeeds
    const callValidPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-nevo-interaction-token': tokenValid,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question on turn-sec' } },
      }),
    });

    while (!registry.hasPending('int-sec-1')) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(registry.getPending('int-sec-1')?.turnId, 'turn-sec');
    registry.resolveResponse('int-sec-1', { answer: 'Turn sec answered' });

    const validRes = await callValidPromise;
    assert.equal(validRes.status, 200);
    const validBody = await validRes.json();
    assert.equal(validBody.result.isError, undefined);
    assert.ok(validBody.result.content[0].text.includes('Turn sec answered'));

    // 7. Duplicate/replayed initialize on already initialized session sid is rejected
    const replayInitRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-nevo-interaction-token': tokenValid,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } },
      }),
    });
    assert.equal(replayInitRes.status, 400);
    const replayInitBody = await replayInitRes.json();
    assert.ok(replayInitBody.error.message.includes('already initialized'));

    // 8. Stale/non-existent MCP session id returns 404
    const staleSessionRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'non-existent-sid',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} }),
    });
    assert.equal(staleSessionRes.status, 404);

    // 9. Stale turn: unregister active turn, later ask_user on session sid fails closed
    registry.unregisterActiveTurn('turn-sec');
    const staleTurnRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'x-nevo-interaction-token': tokenValid,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Call after turn terminated' } },
      }),
    });
    const staleTurnBody = await staleTurnRes.json();
    assert.equal(staleTurnBody.result.isError, true);
    assert.ok(staleTurnBody.result.content[0].text.includes('invalid, stale, or expired'));
    assert.equal(registry.hasPending('int-sec-1'), false);
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

test('Multi-client MCP concurrency: independent sessions, isolated calls, distinct resolution, and cancellation isolation (A-F)', async () => {
  const registry = new McpInteractionRegistry();
  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRoutes, { registry });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = fastify.server.address().port;

  try {
    // Register two concurrent turns
    const token1 = 'tok-turn-1';
    const token2 = 'tok-turn-2';

    registry.registerActiveTurn('turn-conc-1', {
      token: token1,
      provider: 'claude',
      providerSessionId: 'sess-conc-1',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-conc-1' }),
    });

    registry.registerActiveTurn('turn-conc-2', {
      token: token2,
      provider: 'claude',
      providerSessionId: 'sess-conc-2',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-conc-2' }),
    });

    // Client 1 initializes with token1
    const initRes1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': token1,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'client-1', version: '1.0' } },
      }),
    });
    const sid1 = initRes1.headers.get('mcp-session-id');
    assert.ok(sid1, 'Client 1 receives session id');

    // Client 2 initializes with token2
    const initRes2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': token2,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'client-2', version: '1.0' } },
      }),
    });
    const sid2 = initRes2.headers.get('mcp-session-id');
    assert.ok(sid2, 'Client 2 receives distinct session id');
    assert.notEqual(sid1, sid2, 'A: Sessions must have independent session IDs');

    // Both send initialized notifications
    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1 },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2 },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    // B: Independent calls - call ask_user on both sessions concurrently
    const call1Promise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid1,
        'x-nevo-interaction-token': token1,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question for Turn 1' } },
      }),
    });

    const call2Promise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid2,
        'x-nevo-interaction-token': token2,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question for Turn 2' } },
      }),
    });

    while (!registry.hasPending('int-conc-1') || !registry.hasPending('int-conc-2')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // C: Distinct resolution - resolve each turn with different answers
    registry.resolveResponse('int-conc-1', { answer: 'Answer for Turn 1' });
    registry.resolveResponse('int-conc-2', { answer: 'Answer for Turn 2' });

    const [res1, res2] = await Promise.all([call1Promise, call2Promise]);
    const body1 = await res1.json();
    const body2 = await res2.json();

    assert.ok(body1.result.content[0].text.includes('Answer for Turn 1'));
    assert.ok(!body1.result.content[0].text.includes('Answer for Turn 2'));
    assert.ok(body2.result.content[0].text.includes('Answer for Turn 2'));
    assert.ok(!body2.result.content[0].text.includes('Answer for Turn 1'));

    // D: Cancellation isolation: Turn 1 is cancelled, while Turn 2 remains active
    const call1CancelPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid1,
        'x-nevo-interaction-token': token1,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question 1B to be cancelled' } },
      }),
    });

    const call2ActivePromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid2,
        'x-nevo-interaction-token': token2,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question 2B to succeed' } },
      }),
    });

    while (!registry.hasPending('int-conc-1') || !registry.hasPending('int-conc-2')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Cancel Turn 1 only
    registry.cancelTurn('turn-conc-1');

    const res1Cancelled = await call1CancelPromise;
    const body1Cancelled = await res1Cancelled.json();
    assert.ok(body1Cancelled.result.isError, 'Cancelled turn call must return isError');
    assert.ok(body1Cancelled.result.content[0].text.includes('cancelled'));

    // Turn 2 is still pending!
    assert.equal(registry.hasPending('int-conc-2'), true, 'Turn 2 must remain pending after Turn 1 cancellation');

    // Resolve Turn 2
    registry.resolveResponse('int-conc-2', { answer: 'Turn 2 survived' });
    const res2Active = await call2ActivePromise;
    const body2Active = await res2Active.json();
    assert.ok(body2Active.result.content[0].text.includes('Turn 2 survived'));

    // E: Session closing: DELETE /mcp for Session 1 does not affect Session 2
    const delRes1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sid1 },
    });
    assert.equal(delRes1.status, 200, 'DELETE session 1 succeeds');

    // Session 1 is gone (returns 404)
    const deadSessionRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1 },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
    });
    assert.equal(deadSessionRes.status, 404, 'Closed session returns 404');

    // Session 2 is still alive and working!
    const liveSessionRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2 },
      body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'tools/list', params: {} }),
    });
    assert.equal(liveSessionRes.status, 200, 'Session 2 remains alive');
    const liveBody = await liveSessionRes.json();
    assert.equal(liveBody.result.tools[0].name, 'ask_user');
  } finally {
    // F: Cleanup on server close
    await fastify.close();
  }
});

test('MCP session-to-Turn binding and lifecycle isolation (requirements 1-10)', async () => {
  const registry = new McpInteractionRegistry();
  const tokenA = 'tok-turn-A';
  const tokenB = 'tok-turn-B';

  let interactionA = null;
  let interactionB = null;

  registry.registerActiveTurn('turn-A', {
    token: tokenA,
    provider: 'claude',
    providerSessionId: 'sess-A',
    requestInteraction: (neutral) => {
      interactionA = { ...neutral, id: 'int-A-1' };
      return Promise.resolve(interactionA);
    },
  });

  registry.registerActiveTurn('turn-B', {
    token: tokenB,
    provider: 'claude',
    providerSessionId: 'sess-B',
    requestInteraction: (neutral) => {
      interactionB = { ...neutral, id: 'int-B-1' };
      return Promise.resolve(interactionB);
    },
  });

  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRoutes, { registry });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const port = fastify.server.address().port;

  try {
    // 1. initialize with valid token A -> MCP session S1 bound to Turn A
    const initRes1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': tokenA,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'client-A', version: '1.0' } },
      }),
    });
    assert.equal(initRes1.status, 200);
    const sid1 = initRes1.headers.get('mcp-session-id');
    assert.ok(sid1, 'Session S1 created');

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1 },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    // 2. S1 ask_user -> creates Interaction on Turn A
    const callA1Promise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid1,
        'x-nevo-interaction-token': tokenA,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question on Turn A' } },
      }),
    });

    while (!registry.hasPending('int-A-1')) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(registry.getPending('int-A-1')?.turnId, 'turn-A');
    registry.resolveResponse('int-A-1', { answer: 'Answer for Turn A' });
    const callA1Res = await callA1Promise;
    const callA1Body = await callA1Res.json();
    assert.ok(callA1Body.result.content[0].text.includes('Answer for Turn A'));

    // 3. S1 + token B belonging to another active Turn -> rejected -> MUST NOT create Interaction on Turn B
    const callAWithBRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid1,
        'x-nevo-interaction-token': tokenB,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Cross-turn call' } },
      }),
    });
    assert.equal(callAWithBRes.status, 403);
    const callAWithBBody = await callAWithBRes.json();
    assert.ok(callAWithBBody.error.message.includes('Forbidden: interaction token does not match the bound session turn'));
    assert.equal(registry.hasPending('int-B-1'), false, 'MUST NOT create interaction on Turn B');

    // 4. independent MCP session S2 initialized with token B -> can create Interaction on Turn B normally
    const initRes2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-nevo-interaction-token': tokenB,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'client-B', version: '1.0' } },
      }),
    });
    assert.equal(initRes2.status, 200);
    const sid2 = initRes2.headers.get('mcp-session-id');
    assert.ok(sid2, 'Session S2 created');
    assert.notEqual(sid1, sid2, 'S1 and S2 have distinct session IDs');

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2 },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    const callB1Promise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid2,
        'x-nevo-interaction-token': tokenB,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'ask_user', arguments: { question: 'Question on Turn B' } },
      }),
    });

    while (!registry.hasPending('int-B-1')) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(registry.getPending('int-B-1')?.turnId, 'turn-B');
    registry.resolveResponse('int-B-1', { answer: 'Answer for Turn B' });
    const callB1Res = await callB1Promise;
    const callB1Body = await callB1Res.json();
    assert.ok(callB1Body.result.content[0].text.includes('Answer for Turn B'));

    // 5. two concurrent sessions: S1 -> Turn A, S2 -> Turn B remain isolated
    registry.getActiveTurn({ turnId: 'turn-A' }).requestInteraction = (neutral) => {
      return Promise.resolve({ ...neutral, id: 'int-A-2' });
    };
    registry.getActiveTurn({ turnId: 'turn-B' }).requestInteraction = (neutral) => {
      return Promise.resolve({ ...neutral, id: 'int-B-2' });
    };

    const concA = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1, 'x-nevo-interaction-token': tokenA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'Concurrent A' } } }),
    });
    const concB = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2, 'x-nevo-interaction-token': tokenB },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'Concurrent B' } } }),
    });

    while (!registry.hasPending('int-A-2') || !registry.hasPending('int-B-2')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    registry.resolveResponse('int-A-2', { answer: 'Resolved A2' });
    registry.resolveResponse('int-B-2', { answer: 'Resolved B2' });
    const [resConcA, resConcB] = await Promise.all([concA, concB]);
    const bodyConcA = await resConcA.json();
    const bodyConcB = await resConcB.json();
    assert.ok(bodyConcA.result.content[0].text.includes('Resolved A2'));
    assert.ok(!bodyConcA.result.content[0].text.includes('Resolved B2'));
    assert.ok(bodyConcB.result.content[0].text.includes('Resolved B2'));
    assert.ok(!bodyConcB.result.content[0].text.includes('Resolved A2'));

    // 7. cancellation of Turn A: pending ask_user on S1 terminates -> S2 / Turn B unaffected
    registry.getActiveTurn({ turnId: 'turn-A' }).requestInteraction = (neutral) => {
      return Promise.resolve({ ...neutral, id: 'int-A-3' });
    };
    registry.getActiveTurn({ turnId: 'turn-B' }).requestInteraction = (neutral) => {
      return Promise.resolve({ ...neutral, id: 'int-B-3' });
    };

    const callA3CancelPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1, 'x-nevo-interaction-token': tokenA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'A3 cancel test' } } }),
    });
    const callB3ActivePromise = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2, 'x-nevo-interaction-token': tokenB },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'B3 active test' } } }),
    });

    while (!registry.hasPending('int-A-3') || !registry.hasPending('int-B-3')) {
      await new Promise((r) => setTimeout(r, 10));
    }

    registry.cancelTurn('turn-A');
    const resA3 = await callA3CancelPromise;
    const bodyA3 = await resA3.json();
    assert.equal(bodyA3.result.isError, true);
    assert.ok(bodyA3.result.content[0].text.includes('cancelled'));

    assert.equal(registry.hasPending('int-B-3'), true, 'Turn B waiter must remain active');
    registry.resolveResponse('int-B-3', { answer: 'B3 survived' });
    const resB3 = await callB3ActivePromise;
    const bodyB3 = await resB3.json();
    assert.ok(bodyB3.result.content[0].text.includes('B3 survived'));

    // 6. token A becomes stale because Turn A terminates -> later ask_user on S1 rejected -> no Interaction created
    registry.unregisterActiveTurn('turn-A');
    const callAStaleRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid1, 'x-nevo-interaction-token': tokenA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'After turn terminated' } } }),
    });
    const bodyAStale = await callAStaleRes.json();
    assert.equal(bodyAStale.result.isError, true);
    assert.ok(bodyAStale.result.content[0].text.includes('invalid, stale, or expired'));

    // 8. closing S1: does not mutate Turn B / S2
    const delS1Res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sid1 },
    });
    assert.equal(delS1Res.status, 200);

    const toolsS2Res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2 },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }),
    });
    assert.equal(toolsS2Res.status, 200);
    const toolsS2Body = await toolsS2Res.json();
    assert.equal(toolsS2Body.result.tools[0].name, 'ask_user');

    // 9. duplicate/replayed initialize or stale MCP session id: deterministic failure, no ownership reassignment
    const replayInitRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2, 'x-nevo-interaction-token': tokenB },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'replayer', version: '1.0' } } }),
    });
    assert.equal(replayInitRes.status, 400);
    const replayBody = await replayInitRes.json();
    assert.ok(replayBody.error.message.includes('already initialized'));

    const staleSidRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': 'stale-sid-999' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/list', params: {} }),
    });
    assert.equal(staleSidRes.status, 404);

    // 10. MCP session ownership cannot be changed after initialization
    const hijackRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid2, 'x-nevo-interaction-token': 'rogue-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'ask_user', arguments: { question: 'Hijack attempt' } } }),
    });
    assert.equal(hijackRes.status, 403);
    const hijackBody = await hijackRes.json();
    assert.ok(hijackBody.error.message.includes('Forbidden: interaction token does not match the bound session turn'));
  } finally {
    await fastify.close();
  }
});

test('Terminal cause propagation: MCP waiter receives authoritative error code and message', async () => {
  // 1. Cancellation -> AI_TURN_CANCELLED
  {
    const registry = new McpInteractionRegistry();
    registry.registerActiveTurn('turn-prop-cancel', {
      token: 'tok-prop-cancel',
      provider: 'claude',
      providerSessionId: 'sess-prop-cancel',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-prop-cancel' }),
    });
    registry.registerPending('int-prop-cancel', {
      turnId: 'turn-prop-cancel',
      provider: 'claude',
      providerSessionId: 'sess-prop-cancel',
    });
    const waiter = registry.waitForResponse('int-prop-cancel');
    const cancelErr = new AiError('AI_TURN_CANCELLED', 'User explicitly cancelled the turn.', { status: 409 });
    registry.cancelTurn('turn-prop-cancel', cancelErr);

    await assert.rejects(waiter, (err) => {
      assert.equal(err.code, 'AI_TURN_CANCELLED');
      assert.equal(err.message, 'User explicitly cancelled the turn.');
      assert.equal(err.status, 409);
      return true;
    });
  }

  // 2. Provider error / exit -> AI_PROVIDER_EXIT_ERROR
  {
    const registry = new McpInteractionRegistry();
    registry.registerActiveTurn('turn-prop-exit', {
      token: 'tok-prop-exit',
      provider: 'claude',
      providerSessionId: 'sess-prop-exit',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-prop-exit' }),
    });
    registry.registerPending('int-prop-exit', {
      turnId: 'turn-prop-exit',
      provider: 'claude',
      providerSessionId: 'sess-prop-exit',
    });
    const waiter = registry.waitForResponse('int-prop-exit');
    const exitErr = new AiError('AI_PROVIDER_EXIT_ERROR', 'Claude CLI process crashed with exit code 137 (SIGKILL)');
    registry.unregisterActiveTurn('turn-prop-exit', exitErr);

    await assert.rejects(waiter, (err) => {
      assert.equal(err.code, 'AI_PROVIDER_EXIT_ERROR');
      assert.ok(err.message.includes('SIGKILL'));
      return true;
    });
  }

  // 3. Timeout -> AI_TURN_TIMEOUT
  {
    const registry = new McpInteractionRegistry();
    registry.registerActiveTurn('turn-prop-timeout', {
      token: 'tok-prop-timeout',
      provider: 'claude',
      providerSessionId: 'sess-prop-timeout',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-prop-timeout' }),
    });
    registry.registerPending('int-prop-timeout', {
      turnId: 'turn-prop-timeout',
      provider: 'claude',
      providerSessionId: 'sess-prop-timeout',
    });
    const waiter = registry.waitForResponse('int-prop-timeout');
    const timeoutErr = new AiError('AI_TURN_TIMEOUT', 'The turn was cancelled because it stopped responding.', { status: 504 });
    registry.cancelTurn('turn-prop-timeout', timeoutErr);

    await assert.rejects(waiter, (err) => {
      assert.equal(err.code, 'AI_TURN_TIMEOUT');
      assert.equal(err.status, 504);
      return true;
    });
  }

  // 4. Server shutdown -> AI_SERVER_SHUTDOWN
  {
    const registry = new McpInteractionRegistry();
    registry.registerActiveTurn('turn-prop-shutdown', {
      token: 'tok-prop-shutdown',
      provider: 'claude',
      providerSessionId: 'sess-prop-shutdown',
      requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-prop-shutdown' }),
    });
    registry.registerPending('int-prop-shutdown', {
      turnId: 'turn-prop-shutdown',
      provider: 'claude',
      providerSessionId: 'sess-prop-shutdown',
    });
    const waiter = registry.waitForResponse('int-prop-shutdown');
    const shutdownErr = new AiError('AI_SERVER_SHUTDOWN', 'Server is shutting down.', { status: 503 });
    registry.shutdown(shutdownErr);

    await assert.rejects(waiter, (err) => {
      assert.equal(err.code, 'AI_SERVER_SHUTDOWN');
      assert.equal(err.status, 503);
      return true;
    });
  }
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
