import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  createAgentSessionBindingService,
} from '../server/ai/sessions/binding-service.mjs';
import { AgentSessionService } from '../server/ai/sessions/service.mjs';
import { AgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { autoBindAgentSession } from '../../specs.mjs';
import { handleWorkflowStepStart } from '../../specs/workflow/cli.mjs';

const REAL_REPO_ROOT = process.cwd();

function createMockRegistry(onStartTurn) {
  const registry = createAgentProviderRegistry();
  registry.register({
    descriptor: { id: 'mock', label: 'Mock Provider', defaultMode: 'edit', capabilities: {} },
    startTurn: (turnOpts) => {
      onStartTurn?.(turnOpts);
      return (async function* () {
        yield { type: 'final_answer.delta', text: 'ok' };
      })();
    },
    cancelTurn: async () => ({}),
  });
  return registry;
}

async function setupDeterministicRepo(tmpDir, specId, taskOverrides = []) {
  const remote = mkdtempSync(join(tmpdir(), 'nevo-lifecycle-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main'], { cwd: remote });

  await mkdir(join(tmpDir, '.nevo-ai', 'workflows'), { recursive: true });
  await cp(
    join(REAL_REPO_ROOT, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
    join(tmpDir, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
  );

  const activeDir = join(tmpDir, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  await mkdir(changeDir, { recursive: true });
  await mkdir(join(changeDir, 'tasks'), { recursive: true });

  const tasksYaml = taskOverrides.map((t) => {
    let lines = `  - id: "${t.id}"\n    status: ${t.status || 'draft'}`;
    if (t.workflow_progress) {
      const step = t.workflow_progress.current_step || t.workflow_progress.step;
      const attempt = t.workflow_progress.current_attempt || t.workflow_progress.attempt || 1;
      lines += `\n    workflow_progress:\n      state: ${t.workflow_progress.state}\n      current_step: ${step}\n      current_attempt: ${attempt}`;
    }
    return lines;
  }).join('\n');

  const yaml = `id: test-change
spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
${tasksYaml || '  - id: "01-task"\n    status: draft'}
`;
  await writeFile(join(changeDir, 'change.yaml'), yaml, 'utf-8');

  for (const t of taskOverrides.length > 0 ? taskOverrides : [{ id: '01-task' }]) {
    await writeFile(join(changeDir, 'tasks', `${t.id}.md`), `# Task ${t.id}\n`, 'utf-8');
  }

  // Initialize git repo and push to bare remote
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Nevo Test'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 'test@nevo.local'], { cwd: tmpDir });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: tmpDir });
  execFileSync('git', ['add', '.'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: tmpDir });

  const storageDir = join(tmpDir, '.nevo-ai-local', 'sessions');
  await mkdir(storageDir, { recursive: true });
  const bindingService = createAgentSessionBindingService({ storageDir });
  return { bindingService, activeDir, changeDir, remote };
}

test('Scenario A: Generic turn admitted for deterministic spec without taskId', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-a-'));
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const { bindingService, remote } = await setupDeterministicRepo(tmpDir, specId, [
      { id: '01-task', status: 'draft' },
    ]);
    remoteDir = remote;

    let capturedTurn = null;
    const registry = createMockRegistry((opts) => { capturedTurn = opts; });
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    // Create generic session (no task specified)
    const session = await sessionService.createSession('mock', { specId });
    assert.equal(session.activeTaskId, undefined);
    assert.deepEqual(session.taskIds, []);

    // Generic user turn
    const turnResult = await sessionService.startTurn('mock', undefined, {
      sessionId: session.sessionId,
      message: 'help me understand the repo',
    });

    assert.ok(turnResult.turnId);
    assert.equal(capturedTurn.message, 'help me understand the repo', 'Clean message without injected header');
    assert.equal(capturedTurn.taskId, undefined, 'No task ID passed to provider');
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario B: Task execution turn evaluated for readiness', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-b-'));
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const { bindingService, remote } = await setupDeterministicRepo(tmpDir, specId, [
      { id: '01-task', status: 'draft' },
      {
        id: '02-task',
        status: 'implementing',
        workflow_progress: { state: 'active', current_step: 'implementation', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    let capturedTurn = null;
    const registry = createMockRegistry((opts) => { capturedTurn = opts; });
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    const session = await sessionService.createSession('mock', { specId });

    // 1. Explicit execution turn for draft task fails readiness check
    await assert.rejects(
      () => sessionService.startTurn('mock', undefined, {
        sessionId: session.sessionId,
        taskId: '01-task',
        message: 'implement 01',
      }),
      (err) => {
        assert.equal(err.name, 'AiDeterministicWorkflowUnavailableError');
        assert.match(err.message, /not ready for execution/);
        return true;
      },
    );

    // 2. Explicit execution turn for ready task passes and injects workflow context
    const turnResult = await sessionService.startTurn('mock', undefined, {
      sessionId: session.sessionId,
      taskId: '02-task',
      message: 'implement 02',
    });

    assert.ok(turnResult.turnId);
    assert.equal(capturedTurn.taskId, '02-task');
    assert.match(capturedTurn.message, /Nevo Workflow Context/);
    assert.match(capturedTurn.message, /Task: 02-task/);
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario C: Generic session touching task via CLI remains generic', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-c-'));
  const originalEnvSession = process.env.NEVO_SESSION_ID;
  const originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
    const { bindingService, changeDir, remote } = await setupDeterministicRepo(tmpDir, specId, [
      {
        id: '01-task',
        status: 'implementing',
        workflow_progress: { state: 'active', current_step: 'implementation', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    const registry = createMockRegistry();
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    // Create generic session
    const session = await sessionService.createSession('mock', { specId });
    assert.equal(session.activeTaskId, undefined);

    // Simulate agent in that session running autoBindAgentSession with task context
    process.env.NEVO_SESSION_ID = session.sessionId;
    process.env.NEVO_AGENT_PROVIDER = 'mock';

    const mockChange = { id: 'test-change', spec_id: specId, _slug: 'test-change' };
    autoBindAgentSession(mockChange, '01-task', 'execution', {
      step: 'implementation',
      attempt: 1,
      repoRoot: tmpDir,
    });

    // Verify session state in storage
    const storedSession = bindingService.getSessionSync(session.sessionId);
    assert.deepEqual(storedSession.taskIds, ['01-task']);
    assert.equal(storedSession.activeTaskId, undefined, 'Generic session must not acquire activeTaskId');
    assert.equal(storedSession.executionScope, undefined, 'Generic session must not acquire executionScope');

    // Update 01-task to human-verification
    const yaml = `id: test-change
spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: "01-task"
    status: awaiting-human-verification
    workflow_progress:
      state: active
      current_step: human-verification
      current_attempt: 1
`;
    await writeFile(join(changeDir, 'change.yaml'), yaml, 'utf-8');

    // Subsequent generic user turn must succeed without getting blocked by human-verification
    const turnResult = await sessionService.startTurn('mock', undefined, {
      sessionId: session.sessionId,
      message: 'fix a repository issue',
    });
    assert.ok(turnResult.turnId);
  } finally {
    if (originalEnvSession !== undefined) process.env.NEVO_SESSION_ID = originalEnvSession;
    else delete process.env.NEVO_SESSION_ID;
    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario D: Workflow finish clears active execution intent', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-d-'));
  const originalEnvSession = process.env.NEVO_SESSION_ID;
  const originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
    const { bindingService, remote } = await setupDeterministicRepo(tmpDir, specId, [
      {
        id: '01-task',
        status: 'implementing',
        workflow_progress: { state: 'active', current_step: 'implementation', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    const registry = createMockRegistry();
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    // Session actively executing task 01-task
    const sessionId = randomUUID();
    await bindingService.bindSession({
      sessionId,
      provider: 'mock',
      providerSessionId: 'prov-sess-1',
      specId,
      taskId: '01-task',
      activeTaskId: '01-task',
    });

    const beforeSession = bindingService.getSessionSync(sessionId);
    assert.equal(beforeSession.activeTaskId, '01-task');

    // Step finish completes
    process.env.NEVO_SESSION_ID = sessionId;
    process.env.NEVO_AGENT_PROVIDER = 'mock';

    const mockChange = { id: 'test-change', spec_id: specId, _slug: 'test-change' };
    autoBindAgentSession(mockChange, '01-task', 'finish', {
      step: 'implementation',
      attempt: 1,
      repoRoot: tmpDir,
      clearActiveTask: true,
    });

    const afterSession = bindingService.getSessionSync(sessionId);
    assert.deepEqual(afterSession.taskIds, ['01-task'], 'Contextual taskIds must remain');
    assert.equal(afterSession.activeTaskId, undefined, 'activeTaskId must be cleared');
    assert.equal(afterSession.executionScope, undefined, 'executionScope must be cleared');

    // Next turn proceeds as generic turn
    const turnResult = await sessionService.startTurn('mock', undefined, {
      sessionId,
      message: 'what should we do next?',
    });
    assert.ok(turnResult.turnId);
  } finally {
    if (originalEnvSession !== undefined) process.env.NEVO_SESSION_ID = originalEnvSession;
    else delete process.env.NEVO_SESSION_ID;
    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario E: Explicit task execution rejected at human step', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-e-'));
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
    const { bindingService, remote } = await setupDeterministicRepo(tmpDir, specId, [
      {
        id: '01-task',
        status: 'awaiting-human-verification',
        workflow_progress: { state: 'active', current_step: 'human-verification', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    const registry = createMockRegistry();
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    const session = await sessionService.createSession('mock', { specId });

    // Explicit execution turn for human step must fail closed
    await assert.rejects(
      () => sessionService.startTurn('mock', undefined, {
        sessionId: session.sessionId,
        taskId: '01-task',
        message: 'execute human step',
      }),
      (err) => {
        assert.equal(err.name, 'AiDeterministicWorkflowUnavailableError');
        assert.match(err.message, /owned by a human and cannot be started by an agent/);
        return true;
      },
    );
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario F: Failed workflow start does not mutate execution intent', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-f-'));
  const originalEnvSession = process.env.NEVO_SESSION_ID;
  const originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
    const { bindingService, activeDir, remote } = await setupDeterministicRepo(tmpDir, specId, [
      {
        id: '01-task',
        status: 'awaiting-human-verification',
        workflow_progress: { state: 'active', current_step: 'human-verification', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    const registry = createMockRegistry();
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    const session = await sessionService.createSession('mock', { specId });

    process.env.NEVO_SESSION_ID = session.sessionId;
    process.env.NEVO_AGENT_PROVIDER = 'mock';

    // Agent attempts to run workflow step start on human-verification task
    await assert.rejects(
      () => handleWorkflowStepStart('test-change', '01-task', {
        activeDir,
        repoRoot: tmpDir,
        silent: true,
      }),
      (err) => {
        assert.match(err.message, /owned by a human/);
        return true;
      },
    );

    // Verify session record was NOT mutated into active task execution
    const storedSession = bindingService.getSessionSync(session.sessionId);
    assert.equal(storedSession.activeTaskId, undefined);
    assert.equal(storedSession.executionScope, undefined);

    // Subsequent generic user turn proceeds normally
    const turnResult = await sessionService.startTurn('mock', undefined, {
      sessionId: session.sessionId,
      message: 'still working on repository debugging',
    });
    assert.ok(turnResult.turnId);
  } finally {
    if (originalEnvSession !== undefined) process.env.NEVO_SESSION_ID = originalEnvSession;
    else delete process.env.NEVO_SESSION_ID;
    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Scenario G: Real reproduction of session 38cc6ce3-8b41-41d5-b2d7-96a301a7a859', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-scenario-g-'));
  let sessionService = null;
  let remoteDir = null;
  try {
    const specId = 'fe63d2b5-a66a-4c88-b3cc-6d38b193b725';
    const sessionId = '38cc6ce3-8b41-41d5-b2d7-96a301a7a859';
    const { bindingService, remote } = await setupDeterministicRepo(tmpDir, specId, [
      {
        id: 'activity-local-store',
        status: 'awaiting-human-verification',
        workflow_progress: { state: 'active', current_step: 'human-verification', current_attempt: 1 },
      },
    ]);
    remoteDir = remote;

    // Reconstruct the exact on-disk state that the buggy session acquired:
    // It had taskIds: ['activity-local-store'], and the buggy code had also written
    // activeTaskId: 'activity-local-store' and executionScope: { kind: 'task', taskId: 'activity-local-store' }.
    const sessionDoc = {
      specId,
      sessions: [
        {
          sessionId,
          provider: 'mock',
          providerSessionId: 'agy-prov-sess-1',
          specId,
          activeTaskId: 'activity-local-store',
          executionScope: { kind: 'task', taskId: 'activity-local-store' },
          taskIds: ['activity-local-store'],
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ],
      bindings: [
        {
          sessionId,
          provider: 'mock',
          specId,
          taskId: 'activity-local-store',
          step: 'implementation',
          attempt: 1,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ],
    };

    const sessionFile = join(tmpDir, '.nevo-ai-local', 'sessions', `${specId}.json`);
    await writeFile(sessionFile, JSON.stringify(sessionDoc, null, 2), 'utf-8');

    // Reload from storage through bindingService / AgentSessionService
    const registry = createMockRegistry();
    const turnRuntime = new AgentTurnRuntime({ registry });
    sessionService = new AgentSessionService({ registry, turnRuntime, bindingService, repoRoot: tmpDir });

    // 1. Generic turn (the real user request) must SUCCEED and NOT be blocked by human-verification
    const genericTurn = await sessionService.startTurn('mock', undefined, {
      sessionId,
      message: 'Jakakolwiek próba odpalenia batch kończy się błędem WORKSPACE_WRITER_BLOCKED_BY_RECOVERY. Poprawisz? Nie mogę pracować nad spec.',
    });
    assert.ok(genericTurn.turnId, 'Generic user turn must be admitted');

    // Verify stale activeTaskId was cleared from storage
    const healedSession = bindingService.getSessionSync(sessionId);
    assert.equal(healedSession.activeTaskId, undefined, 'Stale active task must be cleared');
    assert.deepEqual(healedSession.taskIds, ['activity-local-store'], 'Contextual taskIds must be preserved');

    // 2. Explicit execution turn for activity-local-store must FAIL CLOSED against human-verification
    await assert.rejects(
      () => sessionService.startTurn('mock', undefined, {
        sessionId,
        taskId: 'activity-local-store',
        message: 'execute activity-local-store',
      }),
      (err) => {
        assert.equal(err.name, 'AiDeterministicWorkflowUnavailableError');
        assert.match(err.message, /owned by a human and cannot be started by an agent/);
        return true;
      },
    );
  } finally {
    await sessionService?.shutdown?.().catch(() => {});
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});
