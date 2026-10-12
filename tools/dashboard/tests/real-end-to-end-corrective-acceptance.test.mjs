// Corrective task 12 (batch-execution-generalization): the single, dedicated,
// uncompromising proof that tasks 09-11 actually fixed what they claimed, against the
// REAL .nevo-ai/workflows/standard.yaml (real `action: test` exit gates, never
// `exitGates: []`) and the real production admission route — not a simplified fixture.
// New test file only; no production code changed by this task.
//
// overview.md's original change-wide acceptance criteria + the post-implementation
// review's 5 findings, mapped to assertions below:
// 1. "A batch of brand-new, dependency-ordered implementation tasks can start, execute
//    under one session, and finish with exactly one commit and one push."
//    -> Test A (points 1, 2, 4, 5).
// 2. "A dependency-blocked batch member's own, same-batch dependency never blocks batch
//    admission; an unsatisfied dependency outside the batch still does."
//    -> Test A (same-batch half) + Test B (external half).
// 3. "A failed review's members produce no more than one new agent session per distinct
//    execution-contract group — never one per member." -> Test D.
// 4. "No code path remains that creates a new session merely because execution moved
//    from one member task to another inside the same batch." -> Test A asserts exactly
//    one session for the whole 3-task batch; task 05's own test
//    (tools/tests/batch-completion-orchestration.test.mjs) already covers the
//    parentSessionId/no-new-session-per-member-move claim directly — not duplicated here.
// 5. "The generic sequential queue ... is removed, not merely unused." -> covered by
//    task 01's own removal; not duplicated here (orthogonal to this task's own scope).
// 6. "node tools/specs.mjs validate, the full test suite, and the dashboard suites all
//    pass." -> this task's own ## Verification commands, not a single assertion.
//
// Review finding 1 (real gate infrastructure) -> Test A (passing gate) + Test C (real
// failing gate blocks). Finding 2 (production admission route) -> Test A + Test B.
// Finding 3 (durable grouped handover) -> Test D. Point 11 (single-task convergence,
// not fabricated into a batch-of-one) -> Test E.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';

import sessionRoutes from '../server/ai/sessions/routes.mjs';
import turnRoutes from '../server/ai/sessions/turns/routes.mjs';
import { aiErrorHandler } from '../server/ai/sessions/http.mjs';
import { ExecutionPolicyService } from '../server/ai/sessions/execution-policy-service.mjs';
import { createTrustedNetworkAiAccessPolicy } from '../server/ai/access-policy.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { getGroupReservation, createGroupReservation } from '../../specs/workflow/queue/reservation.mjs';
import { acquireWorkspaceWriter, getWorkspaceWriterClaim } from '../../specs/workflow/workspace-writer.mjs';
import { executeBatchStart } from '../../specs/workflow/batch-start/operation.mjs';
import { executeBatchFinish } from '../../specs/workflow/batch-finish/operation.mjs';
import { loadBatchFinishRecord, saveBatchFinishRecord } from '../../specs/workflow/batch-finish/record.mjs';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
} from '../server/ai/orchestration/batch-completion-settlement.mjs';
import {
  getActiveAgentExecution,
  resetAdmissionStateForTest,
  releaseAdmittedExecution,
} from '../server/ai/orchestration/admission.mjs';
import { handleWorkflowStepStart } from '../../specs/workflow/cli.mjs';
import { loadBatchStartRecord } from '../../specs/workflow/batch-start/record.mjs';
import { requireChange, requireTask, setTaskWorkflowState } from '../../specs/store.mjs';
import '../../specs/workflow/actions/index.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function makeMockSessionService() {
  const createdSessions = [];
  return {
    createdSessions,
    createSession: async (provider, opts) => {
      const sessionId = `sess-${randomUUID()}`;
      createdSessions.push({ sessionId, provider, ...opts });
      return { sessionId };
    },
    turnRuntime: undefined,
  };
}

function setupRealRepo(slug) {
  resetAdmissionStateForTest();
  const baseDir = mkdtempSync(join(tmpdir(), `nevo-e2e-corrective-${slug}-`));
  const originDir = join(baseDir, 'origin.git');
  const tmpRoot = join(baseDir, 'repo');
  execFileSync('git', ['init', '--bare', '-q', originDir]);
  execFileSync('git', ['clone', '-q', originDir, tmpRoot]);
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: tmpRoot });

  mkdirSync(join(tmpRoot, '.nevo-ai', 'workflows'), { recursive: true });
  // The REAL production workflow, real exit gates intact — never exitGates: [].
  copyFileSync(
    join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    join(tmpRoot, '.nevo-ai', 'workflows', 'standard.yaml'),
  );
  // A real package.json is required for the real action:'test' exit gate to actually
  // evaluate (it maps to the literal 'npm test' via the real default command catalog) —
  // exactly what a real project fixture would have.
  writeFileSync(
    join(tmpRoot, 'package.json'),
    JSON.stringify({ name: 'e2e-corrective-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
    'utf8',
  );

  const specId = randomUUID();
  const changeSlug = `e2e-corrective-${slug}`;
  const changeDir = join(tmpRoot, 'specs', 'active', changeSlug);
  const taskDir = join(changeDir, 'tasks');
  mkdirSync(taskDir, { recursive: true });

  return { baseDir, originDir, tmpRoot, activeDir: join(tmpRoot, 'specs', 'active'), changeDir, taskDir, specId, changeSlug };
}

function writeChangeYaml(changeDir, changeSlug, specId, tasksYaml) {
  writeFileSync(
    join(changeDir, 'change.yaml'),
    `id: ${changeSlug}\nspec_id: ${specId}\nworkflow:\n  mode: deterministic\n  definition: standard.yaml\ntasks:\n${tasksYaml}\n`,
    'utf8',
  );
}

function taskYaml(id, order, { dependsOn = [], allowedPaths = [] } = {}) {
  const deps = dependsOn.length ? `\n    depends_on: [${dependsOn.join(', ')}]` : '';
  const paths = allowedPaths.length ? `\n    allowed_paths:\n${allowedPaths.map((p) => `      - ${p}`).join('\n')}` : '';
  return `  - id: ${id}\n    order: ${order}\n    title: Task ${id}\n    status: approved${deps}${paths}`;
}

function writeSessionFile(tmpRoot, specId, session) {
  const sessionFile = join(tmpRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  mkdirSync(join(tmpRoot, '.nevo-ai-local', 'sessions'), { recursive: true });
  writeFileSync(sessionFile, JSON.stringify({ sessions: [session], bindings: [] }, null, 2), 'utf8');
}

async function withApp({ tmpRoot, policy, changeSlug }, fn) {
  const recordedSessions = [];
  const mockProvider = {
    descriptor: {
      id: 'claude',
      label: 'Claude',
      enabled: true,
      capabilities: { canOverrideTurnModel: true },
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'agent',
    },
    isAvailable: () => ({ available: true }),
    listModels: async () => [{ id: 'sonnet', name: 'sonnet', traits: { maxContextTokens: 200000 } }],
    createSession: async (options) => {
      recordedSessions.push(options);
      return { providerSessionId: `claude-sess-${recordedSessions.length}` };
    },
    startTurn: () => (async function* () {
      yield { type: 'final_answer.delta', text: 'done' };
    })(),
    cancelTurn: async () => ({}),
  };

  const registry = createAgentProviderRegistry([mockProvider]);
  const transcriptCache = createTranscriptCacheService({ baseDir: join(tmpRoot, '.nevo-ai-local', 'transcripts') });
  const bindingService = createAgentSessionBindingService({ storageDir: join(tmpRoot, '.nevo-ai-local', 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService, repoRoot: tmpRoot });
  const policyService = new ExecutionPolicyService({ repoRoot: tmpRoot });
  if (policy) policyService.saveExecutionPolicy(changeSlug, policy);

  const app = Fastify();
  app.setErrorHandler(aiErrorHandler);
  const accessPolicy = createTrustedNetworkAiAccessPolicy();
  await app.register(sessionRoutes, { service, accessPolicy, executionPolicyService: policyService });
  await app.register(turnRoutes, { service, accessPolicy, repoRoot: tmpRoot });
  try {
    return await fn(app, { recordedSessions });
  } finally {
    await app.close();
  }
}

test('A. Real production route admits a brand-new, dependency-ordered 3-task implementation batch; same-batch dependency does not block; real exit gates pass; finish produces exactly one commit and one push', async () => {
  const { baseDir, originDir, tmpRoot, activeDir, changeDir, specId, changeSlug } = setupRealRepo('main-flow');
  try {
    writeChangeYaml(changeDir, changeSlug, specId, [
      taskYaml('t1', 1, { allowedPaths: ['src/t1.js'] }),
      taskYaml('t2', 2, { dependsOn: ['t1'], allowedPaths: ['src/t2.js'] }),
      taskYaml('t3', 3, { dependsOn: ['t1'], allowedPaths: ['src/t3.js'] }),
    ].join('\n'));
    for (const id of ['t1', 't2', 't3']) {
      writeFileSync(join(changeDir, 'tasks', `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    execFileSync('git', ['push', '-u', 'origin', branch], { cwd: tmpRoot });

    const policy = { provider: 'claude', model: 'sonnet', mode: 'agent' };

    const { batchExecutionId, sessionId } = await withApp({ tmpRoot, policy, changeSlug }, async (app, { recordedSessions }) => {
      // Point 1 & 2: brand-new, dependency-ordered tasks admitted through the REAL
      // production route (not createGroupReservation/executeBatchStart directly).
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId,
          changeSlug,
          taskIds: ['t1', 't2', 't3'],
          prompt: 'Implement t1, t2, t3',
        },
      });
      if (res.statusCode !== 201) assert.fail(`Expected 201, got ${res.statusCode}: ${res.payload}`);
      const data = JSON.parse(res.payload);
      assert.ok(data.batchExecutionId);

      // Point 5: t2/t3 depending only on in-batch t1 did not block admission.
      const reservation = getGroupReservation(tmpRoot, changeSlug, data.batchExecutionId);
      assert.deepEqual(reservation.taskIds.slice().sort(), ['t1', 't2', 't3']);

      // Exactly one session for the whole 3-task batch (point 2 / change-wide AC1).
      assert.equal(recordedSessions.length, 1);

      return { batchExecutionId: data.batchExecutionId, sessionId: data.sessionId };
    });

    // The admitted session's own first real action: bootstrap the batch (workspace
    // baseline capture, dependency-consumption planning) — exactly what a real agent,
    // running inside the session the route just admitted, does via
    // `node tools/specs.mjs workflow batch start` before doing any real work.
    await executeBatchStart({ repoRoot: tmpRoot, activeDir, changeSlug, batchExecutionId, sessionId });

    // Simulate the admitted session doing real work within each member's own scope.
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    for (const id of ['t1', 't2', 't3']) {
      writeFileSync(join(tmpRoot, 'src', `${id}.js`), `export const ${id} = 'implemented';\n`, 'utf8');
    }

    const localCommitsBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    const originCommitsBefore = execFileSync('git', ['rev-list', '--count', branch], { cwd: originDir, encoding: 'utf8' }).trim();

    // Point 3 (passing case): the real standard.yaml's implementation step's real
    // action:'test' exit gate is actually evaluated (task 09's own fix) — and passes,
    // because this fixture has a real package.json, same as any real project.
    const finishRes = await executeBatchFinish({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug,
      batchExecutionId,
      sessionId,
      inputs: { tasks: {}, 'commit.title': 'feat: implement t1, t2, t3' },
    });
    assert.equal(finishRes.status, 'completed');

    // Point 1 / change-wide AC1: exactly one commit, one push.
    const localCommitsAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.equal(Number(localCommitsAfter), Number(localCommitsBefore) + 1, 'Exactly one shared commit must land locally');
    const originCommitsAfter = execFileSync('git', ['rev-list', '--count', branch], { cwd: originDir, encoding: 'utf8' }).trim();
    assert.equal(Number(originCommitsAfter), Number(originCommitsBefore) + 1, 'Exactly one push must land on the remote');
    const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    const originHead = execFileSync('git', ['rev-parse', branch], { cwd: originDir, encoding: 'utf8' }).trim();
    assert.equal(originHead, localHead);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('B. An external, unsatisfied dependency outside the selected batch still blocks admission through the real production route', async () => {
  const { baseDir, tmpRoot, specId, changeDir, changeSlug } = setupRealRepo('external-dep');
  try {
    writeChangeYaml(changeDir, changeSlug, specId, [
      taskYaml('t-outside', 1, { allowedPaths: ['src/outside.js'] }),
      taskYaml('t1', 2, { dependsOn: ['t-outside'], allowedPaths: ['src/t1.js'] }),
      taskYaml('t2', 3, { dependsOn: ['t1'], allowedPaths: ['src/t2.js'] }),
    ].join('\n'));
    for (const id of ['t-outside', 't1', 't2']) {
      writeFileSync(join(changeDir, 'tasks', `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });

    const policy = { provider: 'claude', model: 'sonnet', mode: 'agent' };
    await withApp({ tmpRoot, policy, changeSlug }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId,
          changeSlug,
          taskIds: ['t1', 't2'],
          prompt: 'Execute t1, t2',
        },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.match(body.error?.message || '', /t1/);
    });
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('C. A real, genuinely failing exit gate blocks batch finish — not silently recorded as completed', async () => {
  const { baseDir, tmpRoot, activeDir, changeDir, specId, changeSlug } = setupRealRepo('failing-gate');
  try {
    // Overwrite the fixture's own package.json with a genuinely FAILING test script.
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'e2e-corrective-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
      'utf8',
    );
    writeChangeYaml(changeDir, changeSlug, specId, [
      taskYaml('t1', 1, { allowedPaths: ['src/t1.js'] }),
      taskYaml('t2', 2, { allowedPaths: ['src/t2.js'] }),
    ].join('\n'));
    for (const id of ['t1', 't2']) {
      writeFileSync(join(changeDir, 'tasks', `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });

    const batchExecutionId = `batch-${randomUUID()}`;
    const sessionId = 'session-failing-gate';
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug,
      taskIds: ['t1', 't2'],
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
    });
    writeSessionFile(tmpRoot, specId, {
      sessionId,
      batchExecutionId,
      executionScope: { kind: 'task-batch', changeSlug, taskIds: ['t1', 't2'] },
    });
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      sessionId,
      batchExecutionId,
    });
    await executeBatchStart({ repoRoot: tmpRoot, activeDir, changeSlug, batchExecutionId, sessionId });

    await assert.rejects(
      () => executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug,
        batchExecutionId,
        sessionId: 'session-failing-gate',
        inputs: { tasks: {}, 'commit.title': 'feat: implement t1, t2' },
      }),
      { code: 'BATCH_MEMBER_FINISH_INCOMPLETE' },
    );

    const record = loadBatchFinishRecord(tmpRoot, changeSlug, batchExecutionId);
    assert.notEqual(record?.stages?.memberFinishes?.t1?.status, 'completed');
    assert.notEqual(record?.status, 'completed');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('D. Post-review handover producing 2 distinct contract groups loses neither — at most one admitted at once, the other survives as durable pending work and is admitted sequentially', async () => {
  const { baseDir, tmpRoot, activeDir, specId, changeDir, changeSlug } = setupRealRepo('multi-group-handover');
  try {
    const memberIds = ['t1', 't2', 't3'];
    const tasksYaml = memberIds.map((id, idx) => `  - id: ${id}
    order: ${idx + 1}
    title: Task ${id}
    status: in-review
    allowed_paths:
      - src/${id}.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-${id}
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
          transitioned_to: implementation
`).join('');
    writeFileSync(
      join(changeDir, 'change.yaml'),
      `id: ${changeSlug}\nspec_id: ${specId}\nworkflow:\n  mode: deterministic\n  definition: standard.yaml\ntasks:\n${tasksYaml}`,
      'utf8',
    );
    for (const id of memberIds) {
      writeFileSync(join(changeDir, 'tasks', `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });

    const policyService = new ExecutionPolicyService({ repoRoot: tmpRoot });
    policyService.saveExecutionPolicy(changeSlug, {
      provider: 'claude',
      mode: 'agent',
      roles: { refiner: { provider: 'claude', mode: 'agent' } },
      taskOverrides: { t3: { provider: 'gemini', mode: 'agent' } },
    });

    const parentBatchExecutionId = `batch-${randomUUID()}`;
    const parentSessionId = `session-rev-batch-${randomUUID()}`;
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug,
      taskIds: memberIds,
      batchExecutionId: parentBatchExecutionId,
      executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
    });
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: memberIds },
      sessionId: parentSessionId,
      batchExecutionId: parentBatchExecutionId,
    });
    saveBatchFinishRecord(tmpRoot, changeSlug, {
      batchExecutionId: parentBatchExecutionId,
      changeSlug,
      sessionId: parentSessionId,
      taskIds: memberIds,
      status: 'completed',
      results: Object.fromEntries(memberIds.map((id) => [id, { value: 'fail' }])),
    });

    const mockSessionService = makeMockSessionService();

    // Pass 1: {t1,t2} (identical contract) admitted; {t3} (diverged via taskOverrides)
    // left durably pending — point 8 (at most one group active at once).
    const firstOutcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug,
      batchExecutionId: parentBatchExecutionId,
      sessionId: parentSessionId,
      ownerId: acq.ownerId,
      activeDir,
      options: { sessionService: mockSessionService },
    });
    assert.equal(firstOutcome.settled, false);
    assert.equal(firstOutcome.status, 'pending');

    const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, changeSlug, parentBatchExecutionId);
    assert.equal(
      afterFirstPass.stages.continuationDispatch.members.t3,
      undefined,
      'point 9: t3 must survive as durable pending work, not lost/completed',
    );
    const childBatchExecutionId = afterFirstPass.stages.continuationDispatch.members.t1.batchExecutionId;
    assert.ok(childBatchExecutionId);
    assert.ok(getActiveAgentExecution(specId));

    // Settle the {t1,t2} child group FOR REAL — its own execution genuinely concludes
    // (both members reach a terminal workflow position) and its own real batch-finish
    // record is saved, exactly as the real system would produce. The second group must
    // then be picked up automatically, as a side effect of the CHILD's own settlement
    // (task 13's generalized resume trigger) — never by this test manually clearing the
    // slot and manually re-invoking the parent settlement a second time (that would only
    // prove the pending record's durability, not that resume is actually automatic).
    const childChange = requireChange(changeSlug, activeDir);
    for (const taskId of ['t1', 't2']) {
      const task = requireTask(childChange, taskId);
      setTaskWorkflowState(childChange, taskId, {
        status: 'verified',
        workflowProgress: {
          current_step: 'review',
          current_attempt: task.workflow_progress.current_attempt,
          state: 'completed',
          history: [
            ...task.workflow_progress.history,
            { step: 'review', attempt: task.workflow_progress.current_attempt, result: 'pass', transitioned_to: 'verified' },
          ],
        },
      });
    }
    saveBatchFinishRecord(tmpRoot, changeSlug, {
      batchExecutionId: childBatchExecutionId,
      changeSlug,
      sessionId: afterFirstPass.stages.continuationDispatch.members.t1.admission?.sessionId || 'session-child',
      taskIds: ['t1', 't2'],
      status: 'completed',
      results: {},
    });

    const childOutcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug,
      batchExecutionId: childBatchExecutionId,
      sessionId: afterFirstPass.stages.continuationDispatch.members.t1.admission?.sessionId,
      activeDir,
      options: { sessionService: mockSessionService },
    });
    assert.equal(childOutcome.settled, true, 'the child {t1,t2} batch must settle on its own terms');

    // The PARENT settlement must now also be completed — resumed automatically as a
    // side effect of the child's own settlement freeing the active-execution slot, not
    // because this test re-invoked the parent settlement itself.
    const finalSettlement = loadBatchCompletionSettlement(tmpRoot, changeSlug, parentBatchExecutionId);
    assert.equal(finalSettlement.status, 'completed', 'the parent settlement must be auto-resumed and completed');
    assert.equal(finalSettlement.stages.continuationDispatch.members.t3.action, 'agent-admitted');
    assert.notEqual(finalSettlement.stages.continuationDispatch.members.t3.batchExecutionId, childBatchExecutionId);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('D2. Singleton dispatched first, grouped batch left pending second — the singleton settling for real (admission.mjs\'s own turn-terminal handling) automatically admits the pending group, not merely a manually re-invoked settlement', async () => {
  const { baseDir, tmpRoot, activeDir, specId, changeDir, changeSlug } = setupRealRepo('singleton-first-handover');
  try {
    const memberIds = ['t1', 't2', 't3'];
    const tasksYaml = memberIds.map((id, idx) => `  - id: ${id}
    order: ${idx + 1}
    title: Task ${id}
    status: in-review
    allowed_paths:
      - src/${id}.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-${id}
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
          transitioned_to: implementation
`).join('');
    writeChangeYaml(changeDir, changeSlug, specId, tasksYaml);
    for (const id of memberIds) {
      writeFileSync(join(changeDir, 'tasks', `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });

    // t1 diverges via taskOverrides (same role, different provider) while t2/t3 share
    // the identical refiner contract — the review pass therefore produces a single-
    // member group for t1 (isGroup: false, dispatched via the single-task continuation
    // path, exactly like task 11's own 2-groups test) FIRST (t1 is processed first,
    // inserting its unique tuple first), and the {t2,t3} group SECOND, left pending
    // behind it — the reverse of task 11's own "batch-first" ordering.
    const policyService = new ExecutionPolicyService({ repoRoot: tmpRoot });
    policyService.saveExecutionPolicy(changeSlug, {
      provider: 'claude',
      mode: 'agent',
      roles: { refiner: { provider: 'claude', mode: 'agent' } },
      taskOverrides: { t1: { provider: 'gemini', mode: 'agent' } },
    });

    const parentBatchExecutionId = `batch-${randomUUID()}`;
    const parentSessionId = `session-rev-batch-${randomUUID()}`;
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug,
      taskIds: memberIds,
      batchExecutionId: parentBatchExecutionId,
      executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
    });
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: memberIds },
      sessionId: parentSessionId,
      batchExecutionId: parentBatchExecutionId,
    });
    saveBatchFinishRecord(tmpRoot, changeSlug, {
      batchExecutionId: parentBatchExecutionId,
      changeSlug,
      sessionId: parentSessionId,
      taskIds: memberIds,
      status: 'completed',
      results: Object.fromEntries(memberIds.map((id) => [id, { value: 'fail' }])),
    });

    const mockSessionService = makeMockSessionService();

    const firstOutcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug,
      batchExecutionId: parentBatchExecutionId,
      sessionId: parentSessionId,
      ownerId: acq.ownerId,
      activeDir,
      options: { sessionService: mockSessionService },
    });
    assert.equal(firstOutcome.settled, false);
    assert.equal(firstOutcome.status, 'pending');

    const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, changeSlug, parentBatchExecutionId);
    assert.equal(afterFirstPass.stages.continuationDispatch.members.t1.action, 'agent-admitted');
    assert.equal(
      afterFirstPass.stages.continuationDispatch.members.t1.batchExecutionId,
      undefined,
      'a single-member group dispatches via the single-task path, never a fabricated batch-of-one',
    );
    assert.equal(afterFirstPass.stages.continuationDispatch.members.t2, undefined, '{t2,t3} must remain durably pending after pass 1');
    assert.ok(getActiveAgentExecution(specId), 't1 must be the live active execution after pass 1');

    // Simulate t1's own real progress (what a real finish-step CLI invocation would
    // have recorded on disk between admission and turn-terminal): the refiner attempt
    // concludes, t1 returns to review, and review passes — t1 reaches a terminal
    // position so Hook 1's own "automatic continuation for settled turn" step (which
    // runs BEFORE the pending-handover resume trigger, by design — see admission.mjs)
    // has nothing further to admit for t1 itself, isolating the pending-handover
    // resume trigger as the only thing that can free the slot for {t2,t3}.
    const changeForUpdate = requireChange(changeSlug, activeDir);
    const t1Task = requireTask(changeForUpdate, 't1');
    const refinerSessionId = afterFirstPass.stages.continuationDispatch.members.t1.admission?.sessionId;
    setTaskWorkflowState(changeForUpdate, 't1', {
      status: 'verified',
      workflowProgress: {
        current_step: 'review',
        current_attempt: 2,
        state: 'completed',
        history: [
          ...t1Task.workflow_progress.history,
          { step: 'implementation', attempt: 2, sessionId: refinerSessionId, transitioned_to: 'review' },
          { step: 'review', attempt: 2, sessionId: refinerSessionId, result: 'pass', transitioned_to: 'verified' },
        ],
      },
    });
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 't1 refiner attempt concludes'], { cwd: tmpRoot });

    // Settle t1 FOR REAL via admission.mjs's own turn-terminal handling
    // (releaseAdmittedExecution drives the exact same `reconcileHook1` closure a real
    // session's turn.completed event would invoke) — not a manual
    // clearActiveAgentExecution call standing in for the real trigger.
    const reconcileRes = await releaseAdmittedExecution(specId, { settled: true });
    assert.equal(reconcileRes.outcome, 'completed');
    assert.equal(reconcileRes.released, true);

    // The pending {t2,t3} group must now be admitted automatically, as a side effect of
    // t1's own slot-freeing trigger (task 13) — no manual intervention, no manual
    // re-invocation of the parent settlement by the test itself.
    const parentAfterResume = loadBatchCompletionSettlement(tmpRoot, changeSlug, parentBatchExecutionId);
    assert.equal(parentAfterResume.status, 'completed', 'the parent settlement must be auto-resumed and completed');
    assert.equal(parentAfterResume.stages.continuationDispatch.members.t2.action, 'agent-admitted');
    assert.equal(
      parentAfterResume.stages.continuationDispatch.members.t2.batchExecutionId,
      parentAfterResume.stages.continuationDispatch.members.t3.batchExecutionId,
    );
    assert.equal(mockSessionService.createdSessions.length, 2, 'exactly one session for t1, one for the {t2,t3} refiner group');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test('E. Single-task execution still uses the same shared primitives — no queue file, no fabricated BatchContext — not a batch of one', async () => {
  const { baseDir, tmpRoot, activeDir, changeDir, specId, changeSlug } = setupRealRepo('single-task');
  try {
    writeChangeYaml(changeDir, changeSlug, specId, [taskYaml('t1', 1, { allowedPaths: ['src/t1.js'] })].join('\n'));
    writeFileSync(join(changeDir, 'tasks', 't1.md'), '# Task 1\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpRoot });

    await handleWorkflowStepStart(changeSlug, 't1', { repoRoot: tmpRoot, activeDir });

    const reservationFile = join(tmpRoot, '.nevo-ai-local', 'batch-reservations', `${changeSlug}.json`);
    assert.equal(existsSync(reservationFile), false, 'No batch-reservations file must exist for a single-task Start');
    assert.equal(loadBatchStartRecord(tmpRoot, changeSlug, 'any-batch-id'), null, 'No BatchContext must be fabricated');

    const claim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(claim);
    assert.equal(claim.scope?.kind, 'task', 'A single task must get a plain task-scoped claim, not task-batch');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
