import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { InteractionBridgeHub } from '../server/ai/bridge/interaction-bridge-hub.mjs';
import bridgeRoutes from '../server/ai/bridge/routes.mjs';
import {
  createBridgeMcpServer,
  formatInteractionAnswer,
} from '../server/ai/bridge/mcp-bridge-server.mjs';
import { createClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { AiError, createCanonicalTurn } from '../server/ai/contracts.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { reconcileOrphanedTurns } from '../server/ai/sessions/turns/turn-recovery.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MCP_BRIDGE_SCRIPT = resolve(__dirname, '..', 'server', 'ai', 'bridge', 'mcp-bridge-server.mjs');

test('InteractionBridgeHub: manages active turns and validates handleAsk input', async () => {
  const hub = new InteractionBridgeHub();

  // 1. Unregistered turn throws 404
  await assert.rejects(
    () => hub.handleAsk({ turnId: 'nonexistent-turn', question: 'Hello?' }),
    (err) => {
      assert.equal(err.code, 'AI_INTERACTION_NOT_FOUND');
      assert.equal(err.status, 404);
      return true;
    },
  );

  // 2. Register active turn
  let requestedNeutral = null;
  let requestedPolicy = null;
  hub.registerActiveTurn('turn-1', {
    provider: 'claude',
    providerSessionId: 'sess-1',
    requestInteraction: (neutral, options) => {
      requestedNeutral = neutral;
      requestedPolicy = options?.resumePolicy;
      return Promise.resolve({ ...neutral, id: 'int-100' });
    },
  });

  assert.equal(hub.getActiveTurn({ turnId: 'turn-1' })?.turnId, 'turn-1');
  assert.equal(hub.getActiveTurn({ provider: 'claude', providerSessionId: 'sess-1' })?.turnId, 'turn-1');

  // 3. Empty question throws 400
  await assert.rejects(
    () => hub.handleAsk({ turnId: 'turn-1', question: '   ' }),
    (err) => {
      assert.equal(err.code, 'AI_VALIDATION_ERROR');
      assert.equal(err.status, 400);
      return true;
    },
  );

  // 4. Valid question invokes requestInteraction with resumePolicy live-operation
  const askPromise = hub.handleAsk({
    turnId: 'turn-1',
    question: 'Select database engine',
    header: 'Database Choice',
    options: ['PostgreSQL', 'SQLite', { label: 'MySQL', description: 'MySQL 8' }],
    multiSelect: false,
  });

  await new Promise((r) => setImmediate(r));

  assert.equal(requestedNeutral.kind, 'question');
  assert.equal(requestedNeutral.questions[0].question, 'Select database engine');
  assert.equal(requestedNeutral.questions[0].header, 'Database Choice');
  assert.equal(requestedNeutral.questions[0].options.length, 3);
  assert.equal(requestedNeutral.questions[0].options[0].label, 'PostgreSQL');
  assert.equal(requestedNeutral.questions[0].options[2].description, 'MySQL 8');
  assert.equal(requestedPolicy, 'live-operation');
  assert.ok(hub.hasPending('int-100'));

  // 5. Resolving response resolves handleAsk promise
  hub.resolveResponse('int-100', { answers: [{ questionId: 'q1', value: 'PostgreSQL' }] });
  const result = await askPromise;
  assert.deepEqual(result, { answers: [{ questionId: 'q1', value: 'PostgreSQL' }] });
  assert.equal(hub.hasPending('int-100'), false);

  // 6. Unregister active turn
  hub.unregisterActiveTurn('turn-1');
  assert.equal(hub.getActiveTurn({ turnId: 'turn-1' }), null);
});

test('InteractionBridgeHub: cancellation rejects waiting bridge promise', async () => {
  const hub = new InteractionBridgeHub();

  hub.registerActiveTurn('turn-cancel', {
    provider: 'claude',
    providerSessionId: 'sess-cancel',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-cancel' }),
  });

  const askPromise = hub.handleAsk({
    turnId: 'turn-cancel',
    question: 'Please confirm',
  });

  await new Promise((r) => setImmediate(r));
  assert.ok(hub.hasPending('int-cancel'));

  const rejection = assert.rejects(askPromise, (err) => {
    assert.equal(err.code, 'AI_TURN_CANCELLED');
    return true;
  });

  hub.cancelTurn('turn-cancel');
  await rejection;
  assert.equal(hub.hasPending('int-cancel'), false);
});

test('Fastify bridgeRoutes: POST /api/ai/bridge/ask handles requests over loopback', async () => {
  const hub = new InteractionBridgeHub();
  const fastify = Fastify({ logger: false });
  await fastify.register(bridgeRoutes, { interactionHub: hub });

  hub.registerActiveTurn('turn-http', {
    provider: 'claude',
    providerSessionId: 'sess-http',
    bridgeToken: 'token-http-xyz',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-http' }),
  });

  // Start ask request in background
  const responsePromise = fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
    headers: {
      'x-bridge-token': 'token-http-xyz',
    },
    payload: {
      provider: 'claude',
      providerSessionId: 'sess-http',
      turnId: 'turn-http',
      question: 'Which test framework?',
      options: ['node:test', 'vitest'],
    },
  });

  // Await registration
  while (!hub.hasPending('int-http')) {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Resolve pending interaction
  hub.resolveResponse('int-http', {
    answers: [{ questionId: 'q1', value: 'node:test' }],
  });

  const reply = await responsePromise;
  assert.equal(reply.statusCode, 200);
  const data = JSON.parse(reply.body);
  assert.deepEqual(data, { answers: [{ questionId: 'q1', value: 'node:test' }] });
  await fastify.close();
});

test('mcp-bridge-server: stdio JSON-RPC tool discovery and execution', async () => {
  // 1. Start a mock dashboard HTTP server on dynamic port
  let lastRequestBody = null;
  const mockDashboard = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/ai/bridge/ask') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        lastRequestBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answers: [{ questionId: 'q1', value: 'Option Alpha' }] }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((r) => mockDashboard.listen(0, '127.0.0.1', r));
  const port = mockDashboard.address().port;

  // 2. Spawn mcp-bridge-server child process
  const child = spawn(
    process.execPath,
    [
      MCP_BRIDGE_SCRIPT,
      '--port',
      String(port),
      '--provider',
      'claude',
      '--session',
      'sess-mcp-proc',
      '--turn',
      'turn-mcp-proc',
      '--token',
      'tok-test-123',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let buffer = '';
  const messages = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        try {
          messages.push(JSON.parse(line));
        } catch {}
      }
    }
  });

  function waitForMessage(predicate, timeoutMs = 2000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for message'));
        setTimeout(check, 10);
      };
      check();
    });
  }

  // 3. Send initialize
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {},
      },
    }) + '\n',
  );
  const initRes = await waitForMessage((m) => m.id === 1);
  assert.equal(initRes.result.serverInfo.name, 'nevo-interaction-bridge');

  // Send notifications/initialized per MCP spec
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  // 4. Send tools/list
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const toolsRes = await waitForMessage((m) => m.id === 2);
  assert.ok(toolsRes.result.tools.some((t) => t.name === 'ask_user'));

  // 5. Send tools/call for ask_user
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'ask_user',
        arguments: {
          question: 'Pick option',
          options: ['Option Alpha', 'Option Beta'],
        },
      },
    }) + '\n',
  );

  const callRes = await waitForMessage((m) => m.id === 3);
  assert.equal(callRes.result.content[0].type, 'text');
  assert.ok(callRes.result.content[0].text.includes('Option Alpha'));
  assert.equal(lastRequestBody.provider, 'claude');
  assert.equal(lastRequestBody.providerSessionId, 'sess-mcp-proc');
  assert.equal(lastRequestBody.turnId, 'turn-mcp-proc');
  assert.equal(lastRequestBody.bridgeToken, 'tok-test-123');
  assert.equal(lastRequestBody.question, 'Pick option');

  child.kill();
  mockDashboard.close();
});

test('Official MCP SDK: Client connect, tool listing, callTool round-trip, and error handling', async () => {
  let interactionCalledWith = null;
  const mockRequestInteraction = async (config, args) => {
    interactionCalledWith = { config, args };
    if (args.question === 'Fail me') {
      throw new Error('User refused action');
    }
    return { answers: [{ questionId: 'q1', value: 'User approved' }] };
  };

  const server = createBridgeMcpServer(
    { provider: 'claude', sessionId: 'sess-sdk', turnId: 'turn-sdk', token: 'tok-sdk' },
    { requestInteraction: mockRequestInteraction },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'nevo-test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  // 1. Tool listing
  const toolList = await client.listTools();
  assert.ok(toolList.tools.some((t) => t.name === 'ask_user'));
  const askUserTool = toolList.tools.find((t) => t.name === 'ask_user');
  assert.ok(askUserTool.description.includes('Ask the human user'));
  assert.ok(askUserTool.inputSchema.properties.question);

  // 2. Successful callTool
  const result = await client.callTool({
    name: 'ask_user',
    arguments: {
      question: 'Should we proceed?',
      options: ['Yes', 'No'],
      header: 'Approval',
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');
  assert.ok(result.content[0].text.includes('User approved'));
  assert.equal(interactionCalledWith.args.question, 'Should we proceed?');
  assert.equal(interactionCalledWith.config.token, 'tok-sdk');

  // 3. Tool failure returns isError: true with error details
  const failResult = await client.callTool({
    name: 'ask_user',
    arguments: {
      question: 'Fail me',
    },
  });
  assert.equal(failResult.isError, true);
  assert.ok(failResult.content[0].text.includes('Interaction failed or was cancelled: User refused action'));

  await client.close();
  await server.close();
});

test('Bridge security: bridgeToken correlation prevents cross-session hijacking', async () => {
  const hub = new InteractionBridgeHub();
  const fastify = Fastify({ logger: false });
  await fastify.register(bridgeRoutes, { interactionHub: hub });

  hub.registerActiveTurn('turn-sec-1', {
    provider: 'claude',
    providerSessionId: 'sess-sec-1',
    bridgeToken: 'correct-token-42',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-sec-1' }),
  });

  // 1. Missing token is rejected with 403
  const noTokenRes = await fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
    payload: {
      provider: 'claude',
      providerSessionId: 'sess-sec-1',
      turnId: 'turn-sec-1',
      question: 'Attempt without token',
    },
  });
  assert.equal(noTokenRes.statusCode, 403);
  assert.equal(JSON.parse(noTokenRes.body).code, 'AI_FORBIDDEN');

  // 2. Wrong token is rejected with 403
  const wrongTokenRes = await fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
    headers: { 'x-bridge-token': 'wrong-token' },
    payload: {
      provider: 'claude',
      providerSessionId: 'sess-sec-1',
      turnId: 'turn-sec-1',
      question: 'Attempt with wrong token',
    },
  });
  assert.equal(wrongTokenRes.statusCode, 403);
  assert.equal(JSON.parse(wrongTokenRes.body).code, 'AI_FORBIDDEN');

  // 3. Guessed turn ID on unregistered turn returns 404
  const wrongTurnRes = await fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
    headers: { 'x-bridge-token': 'correct-token-42' },
    payload: {
      provider: 'claude',
      providerSessionId: 'sess-sec-1',
      turnId: 'unregistered-turn-id',
      question: 'Attempt on wrong turn',
    },
  });
  assert.equal(wrongTurnRes.statusCode, 404);

  // 4. Correct token succeeds
  const askPromise = fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
    headers: { 'x-bridge-token': 'correct-token-42' },
    payload: {
      provider: 'claude',
      providerSessionId: 'sess-sec-1',
      turnId: 'turn-sec-1',
      question: 'Valid question',
    },
  });

  while (!hub.hasPending('int-sec-1')) {
    await new Promise((r) => setTimeout(r, 10));
  }

  hub.resolveResponse('int-sec-1', { answers: [{ questionId: 'q1', value: 'Answered' }] });
  const validRes = await askPromise;
  assert.equal(validRes.statusCode, 200);

  await fastify.close();
});

test('Bridge race conditions: authoritative terminal outcome for concurrent answer and cancel', async () => {
  const hub = new InteractionBridgeHub();

  // Scenario A: cancel before answer
  hub.registerActiveTurn('turn-race-a', {
    provider: 'claude',
    providerSessionId: 'sess-race-a',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-race-a' }),
  });

  const askPromiseA = hub.handleAsk({
    turnId: 'turn-race-a',
    question: 'Confirm step A?',
  });
  await new Promise((r) => setImmediate(r));

  // User cancels first
  const cancelledCount = hub.cancelTurn('turn-race-a');
  assert.equal(cancelledCount, 1);

  // Subsequent answer cannot resolve
  const answeredLate = hub.resolveResponse('int-race-a', { answer: 'Too late' });
  assert.equal(answeredLate, false, 'Resolving cancelled interaction must return false');

  await assert.rejects(askPromiseA, (err) => {
    assert.equal(err.code, 'AI_TURN_CANCELLED');
    return true;
  });

  // Repeated cancel is a no-op
  const repeatedCancel = hub.cancelTurn('turn-race-a');
  assert.equal(repeatedCancel, 0, 'Repeated cancel must be idempotent');

  // Scenario B: answer before cancel
  hub.registerActiveTurn('turn-race-b', {
    provider: 'claude',
    providerSessionId: 'sess-race-b',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-race-b' }),
  });

  const askPromiseB = hub.handleAsk({
    turnId: 'turn-race-b',
    question: 'Confirm step B?',
  });
  await new Promise((r) => setImmediate(r));

  // User answers first
  const answeredFirst = hub.resolveResponse('int-race-b', { answer: 'Just in time' });
  assert.equal(answeredFirst, true);

  const resultB = await askPromiseB;
  assert.deepEqual(resultB, { answer: 'Just in time' });

  // Subsequent cancel finds no pending interaction
  const cancelAfterAnswer = hub.cancelTurn('turn-race-b');
  assert.equal(cancelAfterAnswer, 0);

  // Repeated answer is a no-op
  const repeatedAnswer = hub.resolveResponse('int-race-b', { answer: 'Duplicate' });
  assert.equal(repeatedAnswer, false);
});

test('Server shutdown: cleanly terminates and rejects pending bridge requests with 503', async () => {
  const hub = new InteractionBridgeHub();

  hub.registerActiveTurn('turn-shutdown', {
    provider: 'claude',
    providerSessionId: 'sess-shutdown',
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-shutdown' }),
  });

  const askPromise = hub.handleAsk({
    turnId: 'turn-shutdown',
    question: 'Pending question before server restarts',
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(hub.hasPending('int-shutdown'));

  // Server triggers shutdown
  hub.shutdown(new AiError('AI_SERVER_SHUTDOWN', 'Server is shutting down.', { status: 503 }));

  await assert.rejects(askPromise, (err) => {
    assert.equal(err.code, 'AI_SERVER_SHUTDOWN');
    assert.equal(err.status, 503);
    return true;
  });

  assert.equal(hub.hasPending('int-shutdown'), false);
  assert.equal(hub.getActiveTurn({ turnId: 'turn-shutdown' }), null);
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

test('Claude provider: dynamic capability truthfulness reflects bridge configuration and script availability', () => {
  // 1. Normal configuration with bridge enabled and existing script
  const enabledProvider = createClaudeAgentProvider({
    mcpBridgeEnabled: true,
    mcpBridgeScriptPath: MCP_BRIDGE_SCRIPT,
  });
  assert.equal(enabledProvider.capabilities.interactiveQuestions, true);
  assert.equal(enabledProvider.capabilities.interactiveConfirmations, false);
  assert.equal(enabledProvider.descriptor.capabilities.interactiveQuestions, true);

  // 2. Disabled bridge
  const disabledProvider = createClaudeAgentProvider({
    mcpBridgeEnabled: false,
    mcpBridgeScriptPath: MCP_BRIDGE_SCRIPT,
  });
  assert.equal(disabledProvider.capabilities.interactiveQuestions, false);
  assert.equal(disabledProvider.descriptor.capabilities.interactiveQuestions, false);

  // 3. Non-existent bridge script
  const missingScriptProvider = createClaudeAgentProvider({
    mcpBridgeEnabled: true,
    mcpBridgeScriptPath: join(__dirname, 'non-existent-script.mjs'),
  });
  assert.equal(missingScriptProvider.capabilities.interactiveQuestions, false);
  assert.equal(missingScriptProvider.descriptor.capabilities.interactiveQuestions, false);
});
