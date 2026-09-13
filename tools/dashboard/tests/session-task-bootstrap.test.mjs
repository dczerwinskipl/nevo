import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { AgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { ClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { AntigravityAgentProvider } from '../server/ai/providers/antigravity/provider.mjs';
import { CodexAgentProvider } from '../server/ai/providers/codex/provider.mjs';
import { CodexAppServerClient } from '../server/ai/providers/codex/app-server-client.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('AC 1: Synchronous canonical sessionId UUID generated at session creation time and bound with established: false before spawn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-bootstrap-test-ac1-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const registry = createAgentProviderRegistry();

    let spawnAttempted = false;
    registry.register({
      descriptor: { id: 'mock', label: 'Mock Provider', defaultMode: 'edit', capabilities: {} },
      createSession: async ({ sessionId }) => {
        // Provider session creation receives the canonical sessionId
        assert.ok(sessionId, 'Provider should receive canonical sessionId');
        assert.match(sessionId, UUID_RE);
        return { providerSessionId: sessionId };
      },
      startTurn: async () => {
        spawnAttempted = true;
        return { message: 'hello' };
      },
      cancelTurn: async () => ({}),
    });

    const sessionService = new AgentSessionService({
      registry,
      bindingService,
    });

    const specId = '11111111-2222-4333-8444-555555555555';
    const session = await sessionService.createSession({
      provider: 'mock',
      specId,
      taskId: '01-task',
      mode: 'edit',
    });

    // Before any turn or provider process spawn:
    assert.equal(spawnAttempted, false, 'No provider process should be spawned during createSession');
    assert.ok(session.sessionId, 'Session DTO must contain canonical sessionId');
    assert.match(session.sessionId, UUID_RE, 'Canonical sessionId must be a valid UUID');

    // Binding must be persisted to disk under specId with established: false
    const bindings = await bindingService.listBindings({ specId });
    assert.equal(bindings.length, 1);
    const b = bindings[0];
    assert.equal(b.sessionId, session.sessionId);
    assert.equal(b.specId, specId);
    assert.equal(b.taskId, '01-task');
    assert.equal(b.activeTaskId, '01-task');
    assert.equal(b.established, false, 'Initial binding before native confirmation must have established: false');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('AC 2: Provider process spawn configurations across Claude, Antigravity, and Codex receive NEVO_SESSION_ID and NEVO_AGENT_PROVIDER', async () => {
  const canonicalSessionId = '22222222-3333-4444-8555-666666666666';
  const specId = '33333333-4444-4555-8666-777777777777';
  const taskId = '02-task';

  const createMockProcess = (onSpawn) => (exe, args, opts) => {
    onSpawn(opts);
    const child = {
      exitCode: 0,
      signalCode: null,
      killed: true,
      stdout: {
        on: (event, cb) => {
          if (event === 'data') {
            queueMicrotask(() => {
              cb(Buffer.from(JSON.stringify({ type: 'result', status: 'completed' }) + '\n'));
            });
          }
        },
      },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'close') {
          queueMicrotask(() => cb(0));
        }
      },
      kill: () => {},
    };
    return child;
  };

  // 1. Claude provider
  {
    let capturedSpawnEnv = null;
    const claude = new ClaudeAgentProvider({
      executable: 'claude',
      cwd: process.cwd(),
      cancelGraceMs: 50,
      forceGraceMs: 50,
      probeExecutable: () => ({ ok: true }),
      spawnProcess: createMockProcess((opts) => {
        capturedSpawnEnv = opts.env;
      }),
    });

    claude.setAmbientSessionContext({
      sessionId: canonicalSessionId,
      specId,
      taskId,
      activeTaskId: taskId,
    });

    try {
      await claude.startTurn({
        turnId: 'turn-c1',
        providerSessionId: 'sess-c1',
        message: 'test prompt',
      });
    } catch {}

    assert.ok(capturedSpawnEnv, 'Claude should have spawned child process');
    assert.equal(capturedSpawnEnv.NEVO_SESSION_ID, canonicalSessionId);
    assert.equal(capturedSpawnEnv.NEVO_AGENT_PROVIDER, 'claude');
    assert.equal(capturedSpawnEnv.NEVO_SPEC_ID, specId);
    assert.equal(capturedSpawnEnv.NEVO_TASK_ID, taskId);
  }

  // 2. Antigravity provider
  {
    let capturedSpawnEnv = null;
    const agy = new AntigravityAgentProvider({
      executable: 'agy',
      cwd: process.cwd(),
      cancelGraceMs: 50,
      forceGraceMs: 50,
      rawFlushTimeoutMs: 50,
      probeExecutable: () => ({ ok: true }),
      ensureMcpRegistered: false,
      spawnProcess: createMockProcess((opts) => {
        capturedSpawnEnv = opts.env;
      }),
    });

    agy.setAmbientSessionContext({
      sessionId: canonicalSessionId,
      specId,
      taskId,
      activeTaskId: taskId,
    });

    try {
      await agy.startTurn({
        turnId: 'turn-a1',
        providerSessionId: 'sess-a1',
        message: 'test prompt',
      });
    } catch {}

    assert.ok(capturedSpawnEnv, 'Antigravity should have spawned child process');
    assert.equal(capturedSpawnEnv.NEVO_SESSION_ID, canonicalSessionId);
    assert.equal(capturedSpawnEnv.NEVO_AGENT_PROVIDER, 'antigravity');
    assert.equal(capturedSpawnEnv.NEVO_SPEC_ID, specId);
    assert.equal(capturedSpawnEnv.NEVO_TASK_ID, taskId);
  }

  // 3. Codex provider & client
  {
    const mockClient = {
      onNotification: () => () => {},
      onServerRequest: () => () => {},
      request: async () => ({ thread: { id: 'thread-codex-1' }, turn: { id: 'turn-1', status: 'inProgress' } }),
      waitForNotification: () => new Promise(() => {}),
      dispose: () => {},
    };
    const client = new CodexAppServerClient({
      executable: 'codex',
      cwd: process.cwd(),
      clientFactory: () => mockClient,
    });

    client.setAmbientSessionContext({
      sessionId: canonicalSessionId,
      specId,
      taskId,
      activeTaskId: taskId,
    });

    assert.equal(client.env.NEVO_SESSION_ID, canonicalSessionId);
    assert.equal(client.env.NEVO_AGENT_PROVIDER, 'codex');
    assert.equal(client.env.NEVO_SPEC_ID, specId);
    assert.equal(client.env.NEVO_TASK_ID, taskId);

    const codex = new CodexAgentProvider({
      executable: 'codex',
      cwd: process.cwd(),
      client,
    });

    codex.setAmbientSessionContext({
      sessionId: canonicalSessionId,
      specId,
      taskId,
      activeTaskId: taskId,
    });

    assert.equal(codex.client.env.NEVO_SESSION_ID, canonicalSessionId);
    assert.equal(codex.client.env.NEVO_AGENT_PROVIDER, 'codex');
  }
});

test('AC 4: Calling markSessionEstablished when provider native session ID arrives updates providerSessionId and clears established: false', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-bootstrap-test-ac4-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const specId = '44444444-5555-4666-8777-888888888888';
    const canonicalSessionId = '55555555-6666-4777-8888-999999999999';

    // Initial binding with established: false
    const initial = await bindingService.bindSession({
      provider: 'claude',
      providerSessionId: canonicalSessionId,
      sessionId: canonicalSessionId,
      specId,
      taskId: '01-first-task',
      step: 'implementation',
      attempt: 1,
      established: false,
    });

    assert.equal(initial.sessionId, canonicalSessionId);
    assert.equal(initial.providerSessionId, canonicalSessionId);
    assert.equal(initial.established, false);

    // Native provider ID arrives (e.g. Claude native conversation ID)
    const nativeProviderSessionId = 'claude-conversation-native-uuid-999';
    await bindingService.markSessionEstablished('claude', canonicalSessionId, nativeProviderSessionId);

    // After establishment:
    // 1. Canonical sessionId must remain invariant
    const resolvedByNative = await bindingService.resolveCurrentBinding('claude', nativeProviderSessionId);
    assert.ok(resolvedByNative);
    assert.equal(resolvedByNative.sessionId, canonicalSessionId, 'Canonical sessionId must be preserved');
    assert.equal(resolvedByNative.providerSessionId, nativeProviderSessionId, 'providerSessionId must be updated to native ID');
    assert.equal(resolvedByNative.established, undefined, 'established: false flag must be cleared');
    assert.equal(resolvedByNative.taskId, '01-first-task', 'Earlier task binding must remain intact');
    assert.equal(resolvedByNative.step, 'implementation', 'Step must remain intact');
    assert.equal(resolvedByNative.attempt, 1, 'Attempt must remain intact');

    // 2. Lookup by canonical sessionId still resolves correctly
    const resolvedByCanonical = await bindingService.getBinding('claude', canonicalSessionId);
    assert.ok(resolvedByCanonical);
    assert.equal(resolvedByCanonical.providerSessionId, nativeProviderSessionId);
    assert.equal(resolvedByCanonical.sessionId, canonicalSessionId);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
