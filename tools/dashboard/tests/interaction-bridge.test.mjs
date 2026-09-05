import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import Fastify from 'fastify';

import { InteractionBridgeHub } from '../server/ai/bridge/interaction-bridge-hub.mjs';
import bridgeRoutes from '../server/ai/bridge/routes.mjs';

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
    requestInteraction: (neutral) => Promise.resolve({ ...neutral, id: 'int-http' }),
  });

  // Start ask request in background
  const responsePromise = fastify.inject({
    method: 'POST',
    url: '/api/ai/bridge/ask',
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  const initRes = await waitForMessage((m) => m.id === 1);
  assert.equal(initRes.result.serverInfo.name, 'nevo-interaction-bridge');

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
  assert.equal(lastRequestBody.question, 'Pick option');

  child.kill();
  mockDashboard.close();
});
