// Comprehensive tests for Batch Finish Operation (Task 04, AC1, AC2, AC3, AC4, AC5, AC6, AC7).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/operation.mjs';
import { loadBatchFinishRecord } from '../specs/workflow/batch-finish/record.mjs';
import { handleWorkflowBatchFinish } from '../specs/workflow/cli.mjs';
import { getCanonicalBatchReportRelativePath } from '../specs/reviews/batch-report.mjs';
import * as git from '../lib/git.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const standardWorkflowYaml = `id: standard-review-v1
title: "Standard Workflow"
type: standard
version: 1
entryStep: implementation
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    purpose: "Implement code"
    expectedWork:
      summary: "Implement"
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: review
        execution:
          session: fresh
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Review code"
    expectedWork:
      summary: "Review"
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
`;

function setupTestRepo(slug = 'batch-finish-spec') {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-finish-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'root commit'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  fs.writeFileSync(path.join(workflowDir, 'standard.yaml'), standardWorkflowYaml, 'utf8');

  return { tmpRoot, activeDir, changeDir, taskDir, workflowDir, sessionsDir };
}

function createTasksAndBootstrap(tmpRoot, slug, taskIds = ['t1', 't2', 't3']) {
  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');

  const tasksYaml = taskIds.map((id, idx) => `  - id: ${id}
    order: ${idx + 1}
    title: Task ${id}
    status: in-implementation
    allowed_paths:
      - src/${id}.js
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`).join('');

  fs.writeFileSync(
    path.join(changeDir, 'change.yaml'),
    `id: ${slug}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
${tasksYaml}
`,
    'utf8'
  );

  fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
  for (const id of taskIds) {
    fs.writeFileSync(path.join(tmpRoot, 'src', `${id}.js`), `export const ${id} = '${id}';\n`, 'utf8');
    fs.writeFileSync(path.join(taskDir, `${id}.md`), `# Task ${id}\n`, 'utf8');
  }

  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', 'Initial setup for batch finish test'], { cwd: tmpRoot });
}

function writeSessionFile(tmpRoot, specId, session) {
  const sessionFile = path.join(tmpRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ sessions: [session], bindings: [] }, null, 2), 'utf8');
}

test('1. AC1: 3 tasks with valid results on post-bootstrap fixture reaches completed, report committed once', async () => {
  const { tmpRoot, activeDir, changeDir } = setupTestRepo('three-tasks-spec');
  const slug = 'three-tasks-spec';
  const taskIds = ['t1', 't2', 't3'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-101';
  const sessionId = 'session-reviewer-101';

  // 1. Create reservation
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  // 2. Persist session
  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  // 3. Acquire workspace writer claim
  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  // 4. Run batch start to bootstrap and capture baseline (dirtier of change.yaml)
  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  // Verify change.yaml is dirty from bootstrap
  const statusAfterStart = git.getWorkingTreeStatus(tmpRoot);
  assert.ok(statusAfterStart.includes('change.yaml'), 'change.yaml must be dirty post-bootstrap');

  // 5. Reviewer writes canonical report file
  const reportPath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# Batch Review Report\n\nAll tasks passed.\n', 'utf8');

  const commitCountBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();

  // 6. Execute batch finish
  const finishRes = await executeBatchFinish({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
    inputs: {
      tasks: {
        t1: { result: 'pass', feedback: 't1 looks great' },
        t2: { result: 'pass', feedback: 't2 verified' },
        t3: { result: 'fail', feedback: 't3 needs minor fix' },
      },
      crossTaskFindings: [{ id: 'CT-1', message: 'No conflicts found', affectedTaskIds: ['t1', 't2'] }],
    },
  });

  assert.equal(finishRes.status, 'completed');
  assert.equal(finishRes.record.status, 'completed');
  assert.equal(finishRes.record.stages.reportCommit.status, 'completed');

  // Check report commit landed with report path only
  const commitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
  assert.equal(Number(commitCountAfter), Number(commitCountBefore) + 1, 'Exactly one report commit must be added');

  // Check commit contents
  const reportCommitSha = finishRes.record.stages.reportCommit.sha;
  const changedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', reportCommitSha], { cwd: tmpRoot, encoding: 'utf8' }).trim();
  assert.equal(changedFiles, reportPath.replace(/\\/g, '/'), 'Report commit must ONLY include report path');

  // Verify task transitions and histories in change.yaml
  const changeYaml = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
  assert.ok(changeYaml.includes('t1 looks great'));
  assert.ok(changeYaml.includes('t2 verified'));
  assert.ok(changeYaml.includes('t3 needs minor fix'));
  assert.ok(changeYaml.includes('transitioned_to: verified'));
  assert.ok(changeYaml.includes('transitioned_to: implementation'));
});

test('2. AC2: 1 invalid result rejects before any durable write, leaves report file untouched', async () => {
  const { tmpRoot, activeDir, changeDir } = setupTestRepo('invalid-result-spec');
  const slug = 'invalid-result-spec';
  const taskIds = ['t1', 't2', 't3'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-102';
  const sessionId = 'session-reviewer-102';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  const changeYamlBefore = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');

  // Reviewer writes report
  const reportPath = `reviews/review-batch-${batchExecutionId}.md`;
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# Report Content\n', 'utf8');

  // Call finish with invalid result for t2 (e.g. 'invalid-verdict' instead of 'pass'/'fail')
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: {
            t1: { result: 'pass' },
            t2: { result: 'invalid-verdict' }, // INVALID!
            t3: { result: 'pass' },
          },
        },
      });
    },
    (err) => {
      assert.equal(err.code, 'BATCH_RESULT_INVALID');
      assert.equal(err.taskId, 't2');
      return true;
    }
  );

  // Verification: ZERO control-plane durable writes of this operation's own
  const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
  assert.equal(finishRecord, null, 'No batch-finish record must be created');

  const changeYamlAfter = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
  assert.equal(changeYamlAfter, changeYamlBefore, 'change.yaml must NOT be modified');

  // Report file written by reviewer must remain untouched
  assert.equal(fs.existsSync(fullReportPath), true, 'Report file must remain present');
  assert.equal(fs.readFileSync(fullReportPath, 'utf8'), '# Report Content\n');
});

test('3. AC3: Prevalidation provenance failure (HEAD divergence, modified doc/source, untracked source) rejects before durable write', async () => {
  const { tmpRoot, activeDir, changeDir } = setupTestRepo('provenance-spec');
  const slug = 'provenance-spec';
  const taskIds = ['t1', 't2'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-103';
  const sessionId = 'session-reviewer-103';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  const reportPath = `reviews/review-batch-${batchExecutionId}.md`;
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# Report Content\n', 'utf8');

  // Case A: Modified tracked source file
  fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), '// reviewer illegal edit\n', 'utf8');
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: { t1: 'pass', t2: 'pass' },
        },
      });
    },
    { code: 'BATCH_PROVENANCE_VIOLATION' }
  );

  // Restore t1.js to valid state
  fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 't1';\n", 'utf8');

  // Case B: Newly created untracked source file
  fs.writeFileSync(path.join(tmpRoot, 'src', 'untracked-reviewer-artifact.js'), '// extra\n', 'utf8');
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: { t1: 'pass', t2: 'pass' },
        },
      });
    },
    { code: 'BATCH_PROVENANCE_VIOLATION' }
  );
  fs.unlinkSync(path.join(tmpRoot, 'src', 'untracked-reviewer-artifact.js'));

  // Case C: Reviewer performed a git commit
  execFileSync('git', ['commit', '--allow-empty', '-m', 'unauthorized reviewer commit'], { cwd: tmpRoot });
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: { t1: 'pass', t2: 'pass' },
        },
      });
    },
    { code: 'BATCH_PROVENANCE_VIOLATION' }
  );
});

test('4. AC4: Crash immediately after report commit lands resumes without re-checking HEAD==baseRevision or re-committing', async () => {
  const { tmpRoot, activeDir } = setupTestRepo('crash-report-spec');
  const slug = 'crash-report-spec';
  const taskIds = ['t1', 't2'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-104';
  const sessionId = 'session-reviewer-104';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  const reportPath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# Report Content\n', 'utf8');

  // Run with simulated crash immediately after report commit
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: { t1: 'pass', t2: 'pass' },
        },
        _crashAfterReportCommit: true,
      });
    },
    /Simulated crash after report commit/
  );

  // Verify report was committed and record saved
  const recordMid = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
  assert.ok(recordMid);
  assert.equal(recordMid.stages.reportCommit.status, 'completed');
  const initialReportCommitSha = recordMid.stages.reportCommit.sha;
  assert.ok(initialReportCommitSha);

  const commitCountMid = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();

  // Resume finish execution
  const resumeRes = await executeBatchFinish({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
    inputs: {
      tasks: { t1: 'pass', t2: 'pass' },
    },
  });

  assert.equal(resumeRes.status, 'completed');
  assert.equal(resumeRes.record.stages.reportCommit.sha, initialReportCommitSha, 'Must reuse recorded commit SHA');

  const commitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
  assert.equal(commitCountAfter, commitCountMid, 'Report must NOT be committed a second time');
});

test('5. AC5: Crash after report commit and task t1 finish resumes and completes t2 and t3 without re-touching t1', async () => {
  const { tmpRoot, activeDir, changeDir } = setupTestRepo('crash-member-spec');
  const slug = 'crash-member-spec';
  const taskIds = ['t1', 't2', 't3'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-105';
  const sessionId = 'session-reviewer-105';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  const reportPath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# Report Content\n', 'utf8');

  // Crash after member task t1
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          tasks: { t1: 'pass', t2: 'pass', t3: 'pass' },
        },
        _crashAfterMemberTaskId: 't1',
      });
    },
    /Simulated crash after member task t1/
  );

  const recordMid = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
  assert.equal(recordMid.stages.memberFinishes.t1.status, 'completed');
  assert.equal(recordMid.stages.memberFinishes.t2, undefined);
  const t1CompletedAt = recordMid.stages.memberFinishes.t1.completedAt;

  // Resume
  const resumeRes = await executeBatchFinish({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
    inputs: {
      tasks: { t1: 'pass', t2: 'pass', t3: 'pass' },
    },
  });

  assert.equal(resumeRes.status, 'completed');
  assert.equal(resumeRes.record.stages.memberFinishes.t1.completedAt, t1CompletedAt, 't1 must not be re-touched');
  assert.equal(resumeRes.record.stages.memberFinishes.t2.status, 'completed');
  assert.equal(resumeRes.record.stages.memberFinishes.t3.status, 'completed');
});

test('6. AC6: Trusted identity mismatch cases rejected (wrong session, scope, batchExecutionId, reservation, claim owner)', async () => {
  const { tmpRoot, activeDir } = setupTestRepo('identity-mismatch-spec');
  const slug = 'identity-mismatch-spec';
  const taskIds = ['t1', 't2'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-exec-106';
  const correctSessionId = 'session-reviewer-106';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId: correctSessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId: correctSessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId: correctSessionId,
  });

  const reportPath = `reviews/review-batch-${batchExecutionId}.md`;
  fs.mkdirSync(path.join(tmpRoot, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, reportPath), '# Report\n', 'utf8');

  const validInputs = { tasks: { t1: 'pass', t2: 'pass' } };

  // Mismatch 1: Wrong session
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId: 'wrong-session-id',
        inputs: validInputs,
      });
    },
    { code: 'BATCH_IDENTITY_MISMATCH' }
  );

  // Mismatch 2: Wrong batchExecutionId
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId: 'wrong-batch-id',
        sessionId: correctSessionId,
        inputs: validInputs,
      });
    },
    { code: 'BATCH_IDENTITY_MISMATCH' }
  );

  // Mismatch 3: Wrong scope in session
  writeSessionFile(tmpRoot, slug, {
    sessionId: 'session-wrong-scope',
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds: ['different-task-1', 'different-task-2'] },
  });
  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId: 'session-wrong-scope',
    turnId: 'turn-2',
    scope: { kind: 'task-batch', taskIds: ['different-task-1', 'different-task-2'] },
    batchExecutionId,
  });
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId: 'session-wrong-scope',
        inputs: validInputs,
      });
    },
    { code: 'BATCH_IDENTITY_MISMATCH' }
  );

  // Mismatch 4: Wrong reservation status (non-reserved)
  const nonReservedBatchId = 'batch-exec-non-reserved';
  const reservationFile = path.join(tmpRoot, '.nevo-ai-local', 'reservations', slug, `${nonReservedBatchId}.json`);
  fs.mkdirSync(path.dirname(reservationFile), { recursive: true });
  fs.writeFileSync(
    reservationFile,
    JSON.stringify({
      batchExecutionId: nonReservedBatchId,
      changeSlug: slug,
      taskIds,
      status: 'released',
    }, null, 2),
    'utf8'
  );
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId: nonReservedBatchId,
        sessionId: correctSessionId,
        inputs: validInputs,
      });
    },
    { code: 'BATCH_IDENTITY_MISMATCH' }
  );

  // Mismatch 5: Wrong claim owner
  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId: 'session-other-owner',
    turnId: 'turn-3',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });
  await assert.rejects(
    async () => {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId: correctSessionId,
        inputs: validInputs,
      });
    },
    { code: 'BATCH_IDENTITY_MISMATCH' }
  );
});

test('7. AC7: Static code check: tools/specs/workflow/batch-finish/** contains ZERO references to tools/dashboard/**', () => {
  const batchFinishDir = path.join(REPO_ROOT, 'tools', 'specs', 'workflow', 'batch-finish');
  const files = fs.readdirSync(batchFinishDir).filter(f => f.endsWith('.mjs') || f.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(batchFinishDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    assert.equal(
      content.includes('tools/dashboard') || content.includes('../../../dashboard') || content.includes('../../dashboard'),
      false,
      `File '${file}' must NOT import or reference tools/dashboard/**`
    );
  }
});

test('8. CLI surface: handleWorkflowBatchFinish runs end-to-end via CLI options', async () => {
  const { tmpRoot, activeDir } = setupTestRepo('cli-batch-finish-spec');
  const slug = 'cli-batch-finish-spec';
  const taskIds = ['t1', 't2'];
  createTasksAndBootstrap(tmpRoot, slug, taskIds);

  const batchExecutionId = 'batch-cli-108';
  const sessionId = 'session-cli-108';

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  writeSessionFile(tmpRoot, slug, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId: slug,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });

  await executeBatchStart({
    repoRoot: tmpRoot,
    activeDir,
    changeSlug: slug,
    batchExecutionId,
    sessionId,
  });

  const reportPath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
  const fullReportPath = path.join(tmpRoot, reportPath);
  fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
  fs.writeFileSync(fullReportPath, '# CLI Report\n', 'utf8');

  const cliResult = await handleWorkflowBatchFinish(slug, {
    batch: batchExecutionId,
    sessionId,
    repoRoot: tmpRoot,
    activeDir,
    silent: true,
    input: JSON.stringify({
      tasks: { t1: 'pass', t2: 'fail' },
    }),
  });

  assert.equal(cliResult.status, 'completed');
  assert.equal(cliResult.batchExecutionId, batchExecutionId);
});
