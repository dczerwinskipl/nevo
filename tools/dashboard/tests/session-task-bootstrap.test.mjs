import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createAgentSessionBindingService,
  readAgentExecutionContext,
} from '../server/ai/sessions/binding-service.mjs';
import { AgentSessionService, resolveDeterministicWorkflowInfo } from '../server/ai/sessions/service.mjs';
import { writeLegacySpecFixtureSync } from './helpers/spec-fixtures.mjs';
import { cp } from 'node:fs/promises';
import { AgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { ClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { AntigravityAgentProvider } from '../server/ai/providers/antigravity/provider.mjs';
import { CodexAgentProvider } from '../server/ai/providers/codex/provider.mjs';
import { CodexAppServerClient } from '../server/ai/providers/codex/app-server-client.mjs';
import { autoBindAgentSession } from '../../specs.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createMockProcess = (onSpawn) => (exe, args, opts) => {
  onSpawn(opts);
  const child = {
    exitCode: 0,
    signalCode: null,
    killed: true,
    stdin: {
      write: () => true,
      end: () => {},
      on: () => {},
    },
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

class FakeCodexClient {
  constructor(handler) {
    this.handler = handler;
    this.notifications = new Set();
    this.serverRequests = new Set();
    this.waiters = new Set();
    this.env = { NEVO_AGENT_PROVIDER: 'codex' };
  }
  onNotification(handler) {
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }
  onServerRequest(handler) {
    this.serverRequests.add(handler);
    return () => this.serverRequests.delete(handler);
  }
  request(method, params) {
    return this.handler(method, params, this);
  }
  waitForNotification(predicate, { signal } = {}) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      this.waiters.add(waiter);
      if (signal) {
        const abort = () => {
          this.waiters.delete(waiter);
          reject(Object.assign(new Error('cancelled'), { code: 'AI_TURN_CANCELLED' }));
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
    });
  }
  async emitNotification(method, params = {}) {
    const notification = { method, params };
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(notification)) {
        this.waiters.delete(waiter);
        waiter.resolve(notification);
      }
    }
    for (const handler of this.notifications) await handler(notification);
  }
  dispose() {}
}

test('1. Real atomic first turn on startTurn() without providerSessionId creates canonical session and persists binding BEFORE provider execution starts', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-bootstrap-test-1-'));
  let sessionService = null;
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const registry = createAgentProviderRegistry();
    const specId = '11111111-2222-4333-8444-555555555555';
    const taskId = '01-task';
    // AgentSessionService's fail-closed contract (Task 02) rejects an explicit specId
    // that resolves to no real spec under its repoRoot — specId here is purely an inert
    // label, so it needs a genuine (legacy) spec on disk.
    writeLegacySpecFixtureSync(tmpDir, specId, { taskIds: [taskId] });

    let providerTurnStarted = false;
    let bindingAtTurnStart = null;
    let providerTurnContext = null;

    registry.register({
      descriptor: { id: 'mock', label: 'Mock Provider', defaultMode: 'edit', capabilities: {} },
      startTurn: (context) => {
        providerTurnStarted = true;
        providerTurnContext = context;
        // Check disk binding at the exact moment provider turn starts
        const bindings = bindingService.listBindingsSync({ specId });
        bindingAtTurnStart = bindings[0] || null;

        return (async function* () {
          yield { type: 'commentary.delta', text: 'working...' };
          yield { type: 'final_answer.delta', text: 'done' };
        })();
      },
      cancelTurn: async () => ({}),
    });

    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({
      registry,
      turnRuntime,
      bindingService,
      repoRoot: tmpDir,
    });

    // Call startTurn directly with providerSessionId === undefined (real POST /api/agent-sessions/turns path)
    const turnResult = await sessionService.startTurn('mock', undefined, {
      specId,
      taskId,
      message: 'Hello from first turn',
    });

    assert.ok(turnResult.turnId, 'Turn should be created');
    assert.equal(providerTurnStarted, true, 'Provider startTurn should have run');

    // Verification 1: Binding was already persisted before provider execution finished
    assert.ok(bindingAtTurnStart, 'SessionTaskBinding MUST exist on disk when provider startTurn begins');
    assert.ok(bindingAtTurnStart.sessionId, 'Binding must have canonical sessionId UUID');
    assert.match(bindingAtTurnStart.sessionId, UUID_RE);
    assert.equal(bindingAtTurnStart.specId, specId);
    assert.equal(bindingAtTurnStart.taskId, taskId);

    // Verification 2: Provider turn context received the canonical sessionId
    assert.equal(providerTurnContext.sessionId, bindingAtTurnStart.sessionId);
    assert.equal(providerTurnContext.specId, specId);
    assert.equal(providerTurnContext.taskId, taskId);

    for (let i = 0; i < 50; i++) {
      const snap = sessionService.getTurn(turnResult.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('2. Claude provider: turn-scoped childEnv injection of NEVO_SESSION_ID and isolation between concurrent turns', async () => {
  let spawnCalls = [];
  const claude = new ClaudeAgentProvider({
    executable: 'claude',
    cwd: process.cwd(),
    cancelGraceMs: 50,
    forceGraceMs: 50,
    probeExecutable: () => ({ ok: true }),
    spawnProcess: (exe, args, opts) => {
      spawnCalls.push({ ...opts, env: { ...opts.env } });
      const child = {
        exitCode: 0,
        signalCode: null,
        killed: true,
        stdin: {
          write: () => true,
          end: () => {},
          on: () => {},
        },
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
    },
  });

  // Zero ambient mutable state
  assert.equal(claude.setAmbientSessionContext, undefined, 'Claude must not have setAmbientSessionContext');

  const session1 = {
    canonicalSessionId: '11111111-1111-4111-8111-111111111111',
    specId: 'spec-aaa-111',
    taskId: '01',
  };
  const session2 = {
    canonicalSessionId: '22222222-2222-4222-8222-222222222222',
    specId: 'spec-bbb-222',
    taskId: '02',
  };

  // Launch two turns concurrently
  await Promise.all([
    claude.startTurn({
      turnId: 'turn-claude-1',
      sessionId: session1.canonicalSessionId,
      specId: session1.specId,
      taskId: session1.taskId,
      message: 'turn 1',
    }),
    claude.startTurn({
      turnId: 'turn-claude-2',
      sessionId: session2.canonicalSessionId,
      specId: session2.specId,
      taskId: session2.taskId,
      message: 'turn 2',
    }),
  ]);

  assert.equal(spawnCalls.length, 2);
  const spawn1 = spawnCalls.find((s) => s.env.NEVO_SESSION_ID === session1.canonicalSessionId);
  const spawn2 = spawnCalls.find((s) => s.env.NEVO_SESSION_ID === session2.canonicalSessionId);

  assert.ok(spawn1, 'Spawn 1 must have session 1 env');
  assert.equal(spawn1.env.NEVO_AGENT_PROVIDER, 'claude');
  assert.equal(spawn1.env.NEVO_SPEC_ID, session1.specId);
  assert.equal(spawn1.env.NEVO_TASK_ID, session1.taskId);

  assert.ok(spawn2, 'Spawn 2 must have session 2 env');
  assert.equal(spawn2.env.NEVO_AGENT_PROVIDER, 'claude');
  assert.equal(spawn2.env.NEVO_SPEC_ID, session2.specId);
  assert.equal(spawn2.env.NEVO_TASK_ID, session2.taskId);
});

test('3. Antigravity provider: turn-scoped spawn env injection and isolation between concurrent turns', async () => {
  let spawnCalls = [];
  const agy = new AntigravityAgentProvider({
    executable: 'agy',
    cwd: process.cwd(),
    cancelGraceMs: 50,
    forceGraceMs: 50,
    rawFlushTimeoutMs: 50,
    probeExecutable: () => ({ ok: true }),
    ensureMcpRegistered: false,
    spawnProcess: (exe, args, opts) => {
      spawnCalls.push({ ...opts, env: { ...opts.env } });
      const child = {
        exitCode: 0,
        signalCode: null,
        killed: true,
        stdin: {
          write: () => true,
          end: () => {},
          on: () => {},
        },
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
    },
  });

  assert.equal(agy.setAmbientSessionContext, undefined, 'Antigravity must not have setAmbientSessionContext');

  const session1 = {
    canonicalSessionId: '33333333-3333-4333-8333-333333333333',
    specId: 'spec-333',
    taskId: '03',
  };
  const session2 = {
    canonicalSessionId: '44444444-4444-4444-8444-444444444444',
    specId: 'spec-444',
    taskId: '04',
  };

  await Promise.all([
    agy.startTurn({
      turnId: 'turn-agy-1',
      sessionId: session1.canonicalSessionId,
      specId: session1.specId,
      taskId: session1.taskId,
      message: 'agy turn 1',
    }),
    agy.startTurn({
      turnId: 'turn-agy-2',
      sessionId: session2.canonicalSessionId,
      specId: session2.specId,
      taskId: session2.taskId,
      message: 'agy turn 2',
    }),
  ]);

  assert.equal(spawnCalls.length, 2);
  const spawn1 = spawnCalls.find((s) => s.env.NEVO_SESSION_ID === session1.canonicalSessionId);
  const spawn2 = spawnCalls.find((s) => s.env.NEVO_SESSION_ID === session2.canonicalSessionId);

  assert.ok(spawn1, 'Spawn 1 must have session 1 env');
  assert.equal(spawn1.env.NEVO_AGENT_PROVIDER, 'antigravity');
  assert.equal(spawn1.env.NEVO_SPEC_ID, session1.specId);
  assert.equal(spawn1.env.NEVO_TASK_ID, session1.taskId);

  assert.ok(spawn2, 'Spawn 2 must have session 2 env');
  assert.equal(spawn2.env.NEVO_AGENT_PROVIDER, 'antigravity');
  assert.equal(spawn2.env.NEVO_SPEC_ID, session2.specId);
  assert.equal(spawn2.env.NEVO_TASK_ID, session2.taskId);
});

test('4. Codex provider: turn-scoped bridge file written during turn and cleaned up in finally; readAgentExecutionContext discovers bridge', async () => {
  const tmpRepo = await mkdtemp(join(tmpdir(), 'nevo-codex-test-'));
  try {
    let bridgeDiscoveredDuringTurn = null;
    let threadTurnStarted = false;

    const mockClient = new FakeCodexClient(async (method, params, client) => {
      if (method === 'thread/start') {
        return { thread: { id: 'th-123' } };
      }
      if (method === 'turn/start') {
        threadTurnStarted = true;
        // Check bridge while turn is in progress
        bridgeDiscoveredDuringTurn = readAgentExecutionContext(
          { NEVO_AGENT_PROVIDER: 'codex' },
          { repoRoot: tmpRepo, specId: 'spec-codex-1', taskId: '05' },
        );
        setTimeout(async () => {
          await client.emitNotification('turn/completed', {
            threadId: 'th-123',
            turn: { id: 'turn-cx-1', status: 'completed' },
          });
        }, 10);
        return { turn: { id: 'turn-cx-1', status: 'inProgress', items: [] } };
      }
      return {};
    });

    const codex = new CodexAgentProvider({
      executable: 'codex',
      cwd: tmpRepo,
      client: mockClient,
    });

    assert.equal(codex.setAmbientSessionContext, undefined, 'Codex provider must not have setAmbientSessionContext');

    const canonicalSessionId = '55555555-5555-4555-8555-555555555555';
    await codex.startTurn({
      turnId: 'turn-codex-turn-1',
      sessionId: canonicalSessionId,
      specId: 'spec-codex-1',
      taskId: '05',
      cwd: tmpRepo,
      message: 'codex prompt',
    });

    assert.equal(threadTurnStarted, true);
    assert.ok(bridgeDiscoveredDuringTurn, 'readAgentExecutionContext must discover active turn context');
    assert.equal(bridgeDiscoveredDuringTurn.sessionId, canonicalSessionId);
    assert.equal(bridgeDiscoveredDuringTurn.provider, 'codex');

    // Verification: after turn completes, bridge file is cleaned up
    const remainingBridge = readAgentExecutionContext(
      { NEVO_AGENT_PROVIDER: 'codex' },
      { repoRoot: tmpRepo, specId: 'spec-codex-1', taskId: '05' },
    );
    assert.equal(remainingBridge, null, 'Bridge file must be cleaned up in finally');
  } finally {
    await rm(tmpRepo, { recursive: true, force: true });
  }
});

test('5. Automatic deterministic workflow header: injected on first turn, suppressed on repeat turns, re-injected on step/task change, clean userMessage', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-hdr-test-'));
  let sessionService = null;
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const registry = createAgentProviderRegistry();

    let capturedPrompts = [];

    registry.register({
      descriptor: { id: 'mock', label: 'Mock Provider', defaultMode: 'edit', capabilities: {} },
      startTurn: (context) => {
        capturedPrompts.push(context.prompt);
        return (async function* () {
          yield { type: 'final_answer.delta', text: 'response' };
        })();
      },
      cancelTurn: async () => ({}),
    });

    const turnRuntime = new AgentTurnRuntime({ registry });

    const specId = '66666666-6666-4666-8666-666666666666';
    // AgentSessionService's fail-closed contract (Task 02) rejects an explicit specId
    // that resolves to no real spec under its repoRoot — specId here is purely an inert
    // label (this test exercises the explicit workflowContext override, not automatic
    // deterministic resolution), so it needs a genuine (legacy) spec on disk.
    writeLegacySpecFixtureSync(tmpDir, specId, { taskIds: ['01'] });
    sessionService = new AgentSessionService({
      registry,
      turnRuntime,
      bindingService,
      repoRoot: tmpDir,
    });

    // Turn 1: Explicit workflow context or first turn on task '01'
    const turn1 = await sessionService.startTurn('mock', undefined, {
      specId,
      taskId: '01',
      workflowContext: {
        changeSlug: 'my-feature',
        taskId: '01',
        step: 'implementation',
        attempt: 1,
      },
      message: 'Please implement feature X',
    });

    assert.equal(capturedPrompts.length, 1);
    assert.match(capturedPrompts[0], /\[Nevo Workflow Context\]/);
    assert.match(capturedPrompts[0], /Please implement feature X/);

    const canonical1 = sessionService.getCanonicalTurn(turn1.turnId);
    assert.equal(canonical1.userMessage?.text, 'Please implement feature X', 'userMessage must be clean');

    const sessionBinding = await bindingService.getBinding('mock', canonical1.sessionId || turn1.sessionId);
    assert.equal(sessionBinding.lastBootstrapTaskId, '01');
    assert.equal(sessionBinding.lastBootstrapStep, 'implementation');
    assert.equal(sessionBinding.lastBootstrapAttempt, 1);

    for (let i = 0; i < 50; i++) {
      const snap = sessionService.getTurn(turn1.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }

    // Turn 2: Second turn on same session, same task, same step -> should be SUPPRESSED
    const turn2 = await sessionService.startTurn('mock', turn1.sessionId, {
      specId,
      taskId: '01',
      message: 'Next question without new step',
    });

    assert.equal(capturedPrompts.length, 2);
    assert.doesNotMatch(capturedPrompts[1], /\[Nevo Workflow Context\]/, 'Repeat turn on same step must not repeat header');
    assert.equal(capturedPrompts[1], 'Next question without new step');

    for (let i = 0; i < 50; i++) {
      const snap = sessionService.getTurn(turn2.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }

    // Turn 3: Step progresses to 'verification' -> should RE-INJECT
    const turn3 = await sessionService.startTurn('mock', turn1.sessionId, {
      specId,
      taskId: '01',
      workflowContext: {
        changeSlug: 'my-feature',
        taskId: '01',
        step: 'verification',
        attempt: 1,
      },
      message: 'Write code',
      userMessage: 'Write code',
    });

    for (let i = 0; i < 50; i++) {
      const snap = sessionService.getTurn(turn3.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }

    assert.equal(capturedPrompts.length, 3);
    assert.match(capturedPrompts[2], /\[Nevo Workflow Context\]/);
    assert.match(capturedPrompts[2], /Step: verification \(attempt 1\)/);
    assert.match(capturedPrompts[2], /Write code/);
    const canonical3 = sessionService.getCanonicalTurn(turn3.turnId);
    assert.equal(canonical3.userMessage?.text, 'Write code', 'userMessage must be clean on reinjected step turn');
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Section 9: resolveDeterministicWorkflowInfo must fail closed ───────────────────────
// Never guess step: 'implementation', attempt: 1 when the true workflow position can't be
// resolved — a wrong instruction injected into the agent's context is worse than none.

const REAL_REPO_ROOT = join(new URL('../../..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));

async function writeDeterministicChangeFixture(tmpDir, { specId, taskId, workflowProgress, definition = 'standard-v1' }) {
  const activeDir = join(tmpDir, 'specs', 'active');
  const changeDir = join(activeDir, 'fixture-change');
  await mkdir(changeDir, { recursive: true });
  const wp = workflowProgress
    ? `
    workflow_progress:
      current_step: ${workflowProgress.current_step}
      current_attempt: ${workflowProgress.current_attempt}
      state: ${workflowProgress.state}`
    : '';
  const yaml = `spec_id: ${specId}
workflow:
  mode: deterministic
  definition: ${definition}
tasks:
  - id: "${taskId}"${wp}
`;
  await writeFile(join(changeDir, 'change.yaml'), yaml, 'utf-8');
  // resolveDeterministicWorkflowInfo takes the authoritative repoRoot directly (never a
  // pre-resolved specs/active dir it would have to reverse-derive the root from).
  return tmpDir;
}

test('9a. resolveDeterministicWorkflowInfo: valid deterministic resolution returns { mode: "deterministic" } with the real step/attempt from workflow_progress', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-fail-closed-valid-'));
  try {
    await mkdir(join(tmpDir, '.nevo-ai', 'workflows'), { recursive: true });
    await cp(
      join(REAL_REPO_ROOT, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
      join(tmpDir, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
    );

    const specId = '99999999-9999-4999-8999-999999999991';
    const repoRoot = await writeDeterministicChangeFixture(tmpDir, {
      specId,
      taskId: '01',
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active' },
    });

    const result = resolveDeterministicWorkflowInfo(specId, '01', repoRoot);
    assert.equal(result.mode, 'deterministic', 'a genuinely resolvable deterministic position must not fail closed');
    assert.equal(result.workflowInfo.step, 'implementation');
    assert.equal(result.workflowInfo.attempt, 1);
    assert.equal(result.workflowInfo.taskId, '01');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9b. resolveDeterministicWorkflowInfo: a broken/missing workflow definition throws AiDeterministicWorkflowUnavailableError instead of guessing implementation/attempt 1', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-fail-closed-broken-'));
  try {
    // Deliberately no .nevo-ai/workflows/standard-v1.yaml exists under this repoRoot.
    const specId = '99999999-9999-4999-8999-999999999992';
    const repoRoot = await writeDeterministicChangeFixture(tmpDir, {
      specId,
      taskId: '01',
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active' },
    });

    assert.throws(
      () => resolveDeterministicWorkflowInfo(specId, '01', repoRoot),
      (err) => {
        assert.equal(err.constructor.name, 'AiDeterministicWorkflowUnavailableError');
        assert.equal(err.code, 'AI_DETERMINISTIC_WORKFLOW_UNAVAILABLE');
        return true;
      },
      'a missing workflow definition must reject with a typed error, never a guessed implementation/attempt 1',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9c. resolveDeterministicWorkflowInfo: human-verification state is reported with its real attempt, never silently presented as attempt 1', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-fail-closed-humanverif-'));
  try {
    await mkdir(join(tmpDir, '.nevo-ai', 'workflows'), { recursive: true });
    await cp(
      join(REAL_REPO_ROOT, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
      join(tmpDir, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
    );

    const specId = '99999999-9999-4999-8999-999999999993';
    const repoRoot = await writeDeterministicChangeFixture(tmpDir, {
      specId,
      taskId: '01',
      // A task genuinely sitting at human-verification, attempt 3 (e.g. after two prior
      // review cycles) — must never be reported as attempt 1.
      workflowProgress: { current_step: 'human-verification', current_attempt: 3, state: 'active' },
    });

    const result = resolveDeterministicWorkflowInfo(specId, '01', repoRoot);
    assert.equal(result.mode, 'deterministic');
    assert.equal(result.workflowInfo.step, 'human-verification');
    assert.equal(result.workflowInfo.attempt, 3);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Section 9 (integration): AgentSessionService.startTurn's three mandatory outcomes ──
// legacy -> normal turn, no automatic header; deterministic+resolved -> authoritative
// header injected; deterministic+broken -> the turn itself is rejected, never silently
// run without the deterministic protocol.

function buildEchoProviderService({ bindingService, repoRoot }) {
  const registry = createAgentProviderRegistry();
  const capturedPrompts = [];
  registry.register({
    descriptor: { id: 'mock', label: 'Mock Provider', defaultMode: 'edit', capabilities: {} },
    startTurn: (context) => {
      capturedPrompts.push(context.prompt);
      return (async function* () {
        yield { type: 'final_answer.delta', text: 'response' };
      })();
    },
    cancelTurn: async () => ({}),
  });
  const turnRuntime = new AgentTurnRuntime({ registry });
  const service = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot });
  return { service, capturedPrompts };
}

test('9d. startTurn: a legacy (non-deterministic) spec proceeds normally with no automatic workflow header', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-legacy-turn-'));
  try {
    const specId = '99999999-9999-4999-8999-999999999994';
    // No `workflow:` key at all — legacy is the global default.
    const changeDir = join(tmpDir, 'specs', 'active', 'fixture-change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, 'change.yaml'), `spec_id: ${specId}\ntasks:\n  - id: "01"\n`, 'utf-8');

    const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: tmpDir });

    const turn = await service.startTurn('mock', undefined, {
      specId,
      taskId: '01',
      message: 'Do the thing',
    });
    for (let i = 0; i < 50; i++) {
      const snap = service.getTurn(turn.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(service.getTurn(turn.turnId)?.status, 'completed');
    assert.equal(capturedPrompts.length, 1);
    assert.equal(capturedPrompts[0], 'Do the thing', 'no automatic [Nevo Workflow Context] header for a legacy spec');
    assert.doesNotMatch(capturedPrompts[0], /\[Nevo Workflow Context\]/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9e. startTurn: a valid deterministic spec automatically injects the authoritative workflow header', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-deterministic-turn-'));
  try {
    await mkdir(join(tmpDir, '.nevo-ai', 'workflows'), { recursive: true });
    await cp(
      join(REAL_REPO_ROOT, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
      join(tmpDir, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
    );
    const specId = '99999999-9999-4999-8999-999999999995';
    await writeDeterministicChangeFixture(tmpDir, {
      specId,
      taskId: '01',
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active' },
    });

    const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: tmpDir });

    const turn = await service.startTurn('mock', undefined, {
      specId,
      taskId: '01',
      message: 'Do the thing',
    });
    for (let i = 0; i < 50; i++) {
      const snap = service.getTurn(turn.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(service.getTurn(turn.turnId)?.status, 'completed');
    assert.equal(capturedPrompts.length, 1);
    assert.match(capturedPrompts[0], /\[Nevo Workflow Context\]/);
    assert.match(capturedPrompts[0], /Step: implementation \(attempt 1\)/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9f. startTurn: a deterministic spec with a broken/unresolvable workflow position rejects the turn instead of silently continuing without context', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-deterministic-broken-turn-'));
  try {
    // Deliberately no .nevo-ai/workflows/standard-v1.yaml — resolution must fail.
    const specId = '99999999-9999-4999-8999-999999999996';
    await writeDeterministicChangeFixture(tmpDir, {
      specId,
      taskId: '01',
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active' },
    });

    const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: tmpDir });

    await assert.rejects(
      () =>
        service.startTurn('mock', undefined, {
          specId,
          taskId: '01',
          message: 'Do the thing',
        }),
      (err) => {
        assert.equal(err.constructor.name, 'AiDeterministicWorkflowUnavailableError');
        assert.equal(err.code, 'AI_DETERMINISTIC_WORKFLOW_UNAVAILABLE');
        return true;
      },
    );
    // The provider must never have been reached — the turn is rejected before dispatch,
    // never silently run without the deterministic protocol.
    assert.equal(capturedPrompts.length, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Section 1 (final Task 02 corrective pass): an explicit specId that cannot be
// resolved must fail the turn, never fall back to legacy ─────────────────────────────

test('9g. startTurn: no specId at all proceeds normally as legacy, with no automatic workflow header', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-no-specid-'));
  try {
    const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: tmpDir });

    const turn = await service.startTurn('mock', undefined, {
      message: 'Do the thing with no spec at all',
    });
    for (let i = 0; i < 50; i++) {
      const snap = service.getTurn(turn.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(service.getTurn(turn.turnId)?.status, 'completed');
    assert.equal(capturedPrompts.length, 1);
    assert.equal(capturedPrompts[0], 'Do the thing with no spec at all');
    assert.doesNotMatch(capturedPrompts[0], /\[Nevo Workflow Context\]/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9h. resolveDeterministicWorkflowInfo: an explicit specId with no matching spec under repoRoot throws AiSpecContextUnavailableError, never { mode: "legacy" }', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-missing-spec-unit-'));
  try {
    const specId = '99999999-9999-4999-8999-999999999997';
    // Deliberately no specs/active/ directory at all under this repoRoot.
    assert.throws(
      () => resolveDeterministicWorkflowInfo(specId, '01', tmpDir),
      (err) => {
        assert.equal(err.constructor.name, 'AiSpecContextUnavailableError');
        assert.equal(err.code, 'AI_SPEC_CONTEXT_UNAVAILABLE');
        assert.equal(err.details?.specId, specId);
        assert.equal(err.details?.repoRoot, tmpDir);
        return true;
      },
      'an explicit, unresolvable specId must fail closed, never silently degrade to legacy',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9i. startTurn: an explicit unknown/nonexistent specId rejects the turn with AiSpecContextUnavailableError, never silently behaves as legacy', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-workflow-missing-spec-turn-'));
  try {
    const specId = '99999999-9999-4999-8999-999999999998';
    // Deliberately no fixture spec written for this specId under tmpDir.
    const bindingService = createAgentSessionBindingService({ storageDir: join(tmpDir, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: tmpDir });

    await assert.rejects(
      () =>
        service.startTurn('mock', undefined, {
          specId,
          taskId: '01',
          message: 'Do the thing',
        }),
      (err) => {
        assert.equal(err.constructor.name, 'AiSpecContextUnavailableError');
        assert.equal(err.code, 'AI_SPEC_CONTEXT_UNAVAILABLE');
        return true;
      },
    );
    // The provider must never have been reached — an unresolvable explicit specId is
    // rejected before dispatch, never silently treated as a legacy/spec-less turn.
    assert.equal(capturedPrompts.length, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('9j. startTurn: a spec that exists under a DIFFERENT repoRoot than the one the service was constructed with fails, proving the repoRoot boundary is enforced rather than silently masked', async () => {
  const repoRootA = await mkdtemp(join(tmpdir(), 'nevo-workflow-repo-a-'));
  const repoRootB = await mkdtemp(join(tmpdir(), 'nevo-workflow-repo-b-'));
  try {
    const specId = '99999999-9999-4999-8999-999999999999';
    // The spec genuinely exists — but only under repoRootA.
    const changeDir = join(repoRootA, 'specs', 'active', 'fixture-change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, 'change.yaml'), `spec_id: ${specId}\ntasks:\n  - id: "01"\n`, 'utf-8');

    // The service is constructed against repoRootB, which has no such spec at all.
    const bindingService = createAgentSessionBindingService({ storageDir: join(repoRootB, 'sessions') });
    const { service, capturedPrompts } = buildEchoProviderService({ bindingService, repoRoot: repoRootB });

    await assert.rejects(
      () =>
        service.startTurn('mock', undefined, {
          specId,
          taskId: '01',
          message: 'Do the thing',
        }),
      (err) => {
        assert.equal(err.constructor.name, 'AiSpecContextUnavailableError');
        assert.equal(err.details?.repoRoot, repoRootB, 'the error must name the actual (wrong) repoRoot resolution was attempted under');
        return true;
      },
      'a spec that exists under a different root must never be silently found or silently treated as legacy',
    );
    assert.equal(capturedPrompts.length, 0);
  } finally {
    await rm(repoRootA, { recursive: true, force: true });
    await rm(repoRootB, { recursive: true, force: true });
  }
});

test('6. tools/specs.mjs autoBindAgentSession writes SessionTaskBinding to <repoRoot>/.nevo-ai-local/sessions/ using discovered context', async () => {
  const tmpRepo = await mkdtemp(join(tmpdir(), 'nevo-autobind-test-'));
  const originalEnvSessionId = process.env.NEVO_SESSION_ID;
  const originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;
  try {
    const canonicalSessionId = '77777777-7777-4777-8777-777777777777';
    const specId = '88888888-8888-4888-8888-888888888888';

    process.env.NEVO_SESSION_ID = canonicalSessionId;
    process.env.NEVO_AGENT_PROVIDER = 'claude';

    const mockChange = {
      spec_id: specId,
      _slug: 'test-change',
    };

    autoBindAgentSession(mockChange, '02', 'execution', {
      step: 'implementation',
      attempt: 1,
      repoRoot: tmpRepo,
    });

    const sessionFile = join(tmpRepo, '.nevo-ai-local', 'sessions', `${specId}.json`);
    assert.equal(existsSync(sessionFile), true, 'Session file must exist under <repoRoot>/.nevo-ai-local/sessions');

    const content = JSON.parse(await readFile(sessionFile, 'utf-8'));
    assert.equal(typeof content, 'object');
    const binding = (Array.isArray(content) ? content : content.bindings)[0];
    assert.ok(binding);
    assert.equal(binding.sessionId, canonicalSessionId);
    assert.equal(binding.provider, 'claude');
    assert.equal(binding.specId, specId);
    assert.equal(binding.taskId, '02');
    assert.equal(binding.step, 'implementation');
    assert.equal(binding.attempt, 1);
  } finally {
    if (originalEnvSessionId !== undefined) process.env.NEVO_SESSION_ID = originalEnvSessionId;
    else delete process.env.NEVO_SESSION_ID;
    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;
    await rm(tmpRepo, { recursive: true, force: true });
  }
});

test('7. setProviderSessionId strictly correlates to canonical sessionId without mutating unrelated sessions', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-correlate-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const specId = '99999999-9999-4999-8999-999999999999';

    const session1Id = 'aaaa1111-1111-4111-8111-111111111111';
    const session2Id = 'bbbb2222-2222-4222-8222-222222222222';

    // Two sessions both unestablished
    await bindingService.bindSession({
      provider: 'mock',
      sessionId: session1Id,
      specId,
      taskId: '01',
    });

    await bindingService.bindSession({
      provider: 'mock',
      sessionId: session2Id,
      specId,
      taskId: '02',
    });

    // Establish session 1 only
    await bindingService.markSessionEstablished('mock', session1Id, 'mock-native-1');

    const s1 = await bindingService.getBinding('mock', session1Id);
    assert.equal(s1.providerSessionId, 'mock-native-1');

    const session2Obj = await bindingService.getSession(session2Id);
    assert.equal(session2Obj.providerSessionId, undefined, 'Unrelated session must NOT have providerSessionId set');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('8. Regression: first turn on a provider without createSession() must not throw "Cannot re-bind" when the provider later allocates a native session ID that differs from the canonical placeholder', async () => {
  // Reproduces the real Claude dashboard failure: AgentSessionService.createSession()
  // falls back to using the canonical Nevo sessionId as a placeholder providerSessionId
  // (established: false) when the provider has no native createSession(). That
  // placeholder used to be baked into TurnLifecycleCoordinator as an already-bound
  // providerSessionId, so the provider's later genuinely-allocated native session ID
  // collided with it in bindTurnProviderSessionId() ("Cannot re-bind turn ...").
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-rebind-regression-'));
  let sessionService = null;
  try {
    const storageDir = join(tmpDir, 'sessions');
    const bindingService = createAgentSessionBindingService({ storageDir });
    const registry = createAgentProviderRegistry();
    const specId = '33333333-4444-4555-8666-777777777777';
    const taskId = '02-task';
    const nativeSessionId = 'native-aaaa-bbbb-cccc-dddddddddddd';
    // AgentSessionService's fail-closed contract (Task 02) rejects an explicit specId
    // that resolves to no real spec under its repoRoot — specId here is purely an inert
    // label, so it needs a genuine (legacy) spec on disk.
    writeLegacySpecFixtureSync(tmpDir, specId, { taskIds: [taskId] });

    // No createSession() on this provider — mirrors ClaudeAgentProvider, which has
    // no native session pre-allocation and only learns its real session ID once the
    // CLI process actually starts (see claude/provider.mjs effectiveSessionId).
    registry.register({
      descriptor: { id: 'mock-claude-like', label: 'Mock Claude-like Provider', defaultMode: 'edit', capabilities: {} },
      startTurn: (context) => {
        return (async function* () {
          // Provider allocates and confirms its OWN native session ID, distinct
          // from the canonical Nevo sessionId placeholder used before establishment.
          await context.onProviderSessionIdAvailable(nativeSessionId);
          yield { type: 'final_answer.delta', text: 'done' };
        })();
      },
      cancelTurn: async () => ({}),
    });

    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({
      registry,
      turnRuntime,
      bindingService,
      repoRoot: tmpDir,
    });

    const turnResult = await sessionService.startTurn('mock-claude-like', undefined, {
      specId,
      taskId,
      message: 'Implement Task 02',
    });

    assert.ok(turnResult.turnId, 'Turn should be created');

    let finalSnap;
    for (let i = 0; i < 50; i++) {
      const snap = sessionService.getTurn(turnResult.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') {
        assert.equal(snap.status, 'completed', `Turn must complete, not fail: ${JSON.stringify(snap)}`);
        finalSnap = snap;
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    assert.equal(
      finalSnap?.providerSessionId,
      nativeSessionId,
      'Established providerSessionId must be the native ID the provider allocated, not the canonical placeholder',
    );

    const binding = await bindingService.getBinding('mock-claude-like', nativeSessionId);
    assert.ok(binding, 'Binding must be resolvable by the confirmed native providerSessionId');
    assert.equal(binding.established, undefined, 'Confirmed binding must no longer carry established: false');
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
});
