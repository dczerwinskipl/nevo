import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';

// Reproduces the production regression: a dashboard restart creates an empty Claude
// session shell (POST /api/agent-sessions with no providerSessionId) before any message
// is sent. Since ClaudeAgentProvider has no createSession(), AgentSessionService fabricates
// a local placeholder UUID that Claude has never seen. The first turn on that session must
// not be resumed with --resume — Claude has no conversation under that ID yet.

function createMockClaudeProcess(stdoutLines, { exitCode = 0, sessionId } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = () => true;

  setImmediate(async () => {
    for (const rawLine of stdoutLines) {
      let line = rawLine;
      if (sessionId) {
        try {
          const parsed = JSON.parse(rawLine);
          if (!parsed.session_id) {
            parsed.session_id = sessionId;
            line = JSON.stringify(parsed);
          }
        } catch {
          // not JSON, stream as-is
        }
      }
      child.stdout.push(`${line}\n`);
    }
    child.stdout.push(null);
    child.exitCode = exitCode;
    child.emit('exit', exitCode, null);
    child.emit('close', exitCode);
  });

  return child;
}

function extractFlag(args) {
  const sIdx = args.indexOf('--session-id');
  const rIdx = args.indexOf('--resume');
  if (sIdx !== -1) return { flag: '--session-id', value: args[sIdx + 1] };
  if (rIdx !== -1) return { flag: '--resume', value: args[rIdx + 1] };
  return { flag: null, value: null };
}

function makeStreamLines(text) {
  return [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];
}

async function waitForTurnTerminal(service, turnId) {
  for (let i = 0; i < 200; i++) {
    const snap = service.getTurn(turnId);
    if (snap?.status === 'completed' || snap?.status === 'failed') return snap;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Turn ${turnId} did not reach a terminal state in time`);
}

test('Claude fresh-session identity: createSession -> first turn avoids --resume -> binding confirmed -> second turn resumes', async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-claude-identity-'));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const capturedCalls = [];
  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push(args);
      const { value } = extractFlag(args);
      return createMockClaudeProcess(makeStreamLines(`turn ${capturedCalls.length}`), { sessionId: value });
    },
  });

  const registry = createAgentProviderRegistry([provider]);
  const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry });
  const service = createAgentSessionService({ registry, turnRuntime, bindingService });

  const specId = randomUUID();

  // Session shell created the way the dashboard does before any message is sent.
  const session = await service.createSession('claude', { specId, taskId: 'task-1' });
  const placeholderId = session.providerSessionId;
  assert.ok(placeholderId);

  const bindingBeforeFirstTurn = await bindingService.getBinding('claude', placeholderId);
  assert.equal(bindingBeforeFirstTurn.established, false, 'a fabricated placeholder must be recorded as unestablished');

  // A. First turn on a not-yet-established session must not resume a conversation
  // Claude has never created.
  const turn1 = await service.startTurn('claude', placeholderId, { message: 'First message in new chat' });
  await waitForTurnTerminal(service, turn1.turnId);

  assert.equal(capturedCalls.length, 1);
  const firstCallFlag = extractFlag(capturedCalls[0]);
  assert.equal(firstCallFlag.flag, '--session-id', 'first turn on an unconfirmed session must not pass --resume');
  assert.equal(
    firstCallFlag.value,
    placeholderId,
    'Claude must create the session under the exact ID the Nevo session already carries',
  );
  assert.equal(turn1.providerSessionId, placeholderId, 'the Nevo-visible session id must not change identity');

  // B. Once Claude actually confirms the session, the binding is durably updated.
  const bindingAfterFirstTurn = await bindingService.getBinding('claude', placeholderId);
  assert.notEqual(
    bindingAfterFirstTurn.established,
    false,
    'confirmed provider session must be persisted as established',
  );

  // C. Second turn on the now-confirmed session resumes using the bound ID.
  const turn2 = await service.startTurn('claude', placeholderId, { message: 'Follow-up message' });
  await waitForTurnTerminal(service, turn2.turnId);

  assert.equal(capturedCalls.length, 2);
  const secondCallFlag = extractFlag(capturedCalls[1]);
  assert.equal(secondCallFlag.flag, '--resume', 'second turn on a confirmed session must resume');
  assert.equal(secondCallFlag.value, placeholderId);
});

test('Claude fresh-session identity: the Nevo-fabricated session id is never used as an implicit resumable providerSessionId, even after a server restart', async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-claude-identity-restart-'));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const specId = randomUUID();
  const bindingStorageDir = join(tmpDir, 'sessions');

  // Provider instance/process #1: dashboard creates an empty session shell, never sends a message.
  const registry1 = createAgentProviderRegistry([
    createClaudeAgentProvider({
      spawnProcess: () => {
        throw new Error('must not spawn before any message is sent');
      },
    }),
  ]);
  const bindingService1 = createAgentSessionBindingService({ storageDir: bindingStorageDir });
  const service1 = createAgentSessionService({ registry: registry1, bindingService: bindingService1 });
  const session = await service1.createSession('claude', { specId, taskId: 'task-1' });
  const placeholderId = session.providerSessionId;

  // Simulate a full dashboard restart: brand new provider/runtime/service instances, so no
  // in-memory materialization state survives. Only the persisted binding does.
  const capturedCalls = [];
  const provider2 = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push(args);
      const { value } = extractFlag(args);
      return createMockClaudeProcess(makeStreamLines('after restart'), { sessionId: value });
    },
  });
  const registry2 = createAgentProviderRegistry([provider2]);
  const bindingService2 = createAgentSessionBindingService({ storageDir: bindingStorageDir });
  const turnRuntime2 = createAgentTurnRuntime({ registry: registry2 });
  const service2 = createAgentSessionService({
    registry: registry2,
    turnRuntime: turnRuntime2,
    bindingService: bindingService2,
  });

  // D. The first message sent from this session must never implicitly resume a conversation
  // Claude has never actually created, even though the caller supplies a providerSessionId
  // (the Nevo-fabricated placeholder allocated before the restart).
  const turn = await service2.startTurn('claude', placeholderId, { message: 'First real message' });
  await waitForTurnTerminal(service2, turn.turnId);

  assert.equal(capturedCalls.length, 1);
  const flag = extractFlag(capturedCalls[0]);
  assert.equal(
    flag.flag,
    '--session-id',
    'the Nevo session id must never be used as an implicit providerSessionId for --resume',
  );
  assert.equal(flag.value, placeholderId);
});
