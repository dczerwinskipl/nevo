// Corrective tests (batch-execution-generalization, task 09) proving executeBatchFinish
// uses real gate infrastructure and respects finishStep's own outcome, instead of the
// pre-correction behavior: finishStep called with no gateRegistry (silently falling
// back to the verification-store-less default, so a real command-type exit gate could
// never pass) and every member unconditionally recorded as completed regardless of
// finishStep's own returned status.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/operation.mjs';
import { loadBatchFinishRecord } from '../specs/workflow/batch-finish/record.mjs';
import { loadDependencyConsumption } from '../specs/workflow/dependency-consumption.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Structurally identical to the real .nevo-ai/workflows/standard.yaml, except the
// implementation step's exit gate uses a literal `command:` (a controllable script)
// instead of `action: test` — this still exercises the real CommandGate/
// buildWorkflowGateRegistry infrastructure end to end; only the concrete command is
// test-appropriate (deterministic, fast, flag-file-controlled) rather than `npm test`.
const GATE_CONTROLLED_WORKFLOW_YAML = `id: standard-v1
title: "Standard-shaped workflow (real gate infrastructure test)"
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
    consumesDependencies: true
    purpose: "Perform the approved implementation work for the task within declared scope."
    expectedWork:
      summary: "Modify code within allowed_paths."
    entryGates: []
    exitGates:
      - type: command
        command: "node check-gate.js"
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
        continuation: auto
        releasesDependencies: true
        execution:
          session: fresh
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Independent quality review."
    expectedWork:
      summary: "Audit implementation."
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
        continuation: auto
        invalidatesDependencyRelease: true
        execution:
          session: fresh
          role: refiner
`;

// Real standard.yaml shape: exitGates uses the real logical alias 'test', resolved
// through the real defaultCommandCatalog to the literal 'npm test' — proving the fix
// against the exact production mapping, not only a custom literal command.
const REAL_SHAPED_WORKFLOW_YAML = `id: standard-v1
title: "Standard-shaped workflow (real action:test mapping)"
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
    consumesDependencies: true
    purpose: "Perform the approved implementation work for the task within declared scope."
    expectedWork:
      summary: "Modify code within allowed_paths."
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
        continuation: auto
        releasesDependencies: true
        execution:
          session: fresh
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Independent quality review."
    expectedWork:
      summary: "Audit implementation."
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
`;

function setupTestRepo(slug, workflowYaml) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-gate-correctness-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'standard.yaml'), workflowYaml, 'utf8');

  return { tmpRoot, activeDir, changeDir, taskDir };
}

function writeChangeYaml(changeDir, slug, specId, taskYaml) {
  fs.writeFileSync(
    path.join(changeDir, 'change.yaml'),
    `id: ${slug}
spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
${taskYaml}
`,
    'utf8',
  );
}

function writeCheckGateScript(tmpRoot) {
  // Exit 0 ("gate passes") iff gate-flag.txt exists in tmpRoot; exit 1 otherwise.
  fs.writeFileSync(
    path.join(tmpRoot, 'check-gate.js'),
    "const fs = require('fs'); process.exit(fs.existsSync('gate-flag.txt') ? 0 : 1);\n",
    'utf8',
  );
}

function commitAll(tmpRoot, message) {
  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', message], { cwd: tmpRoot });
}

function writeSessionFile(tmpRoot, specId, session) {
  const sessionFile = path.join(tmpRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ sessions: [session], bindings: [] }, null, 2), 'utf8');
}

async function startBatch({ tmpRoot, activeDir, slug, specId, taskIds, batchExecutionId, sessionId }) {
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model', mode: 'agent' },
  });
  writeSessionFile(tmpRoot, specId, {
    sessionId,
    batchExecutionId,
    executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
  });
  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    sessionId,
    turnId: 'turn-1',
    scope: { kind: 'task-batch', taskIds },
    batchExecutionId,
  });
  await executeBatchStart({ repoRoot: tmpRoot, activeDir, changeSlug: slug, batchExecutionId, sessionId });
}

test('A real command exit gate that fails blocks the member: not recorded as completed, no shared commit, no dependency-consumption materialized', async () => {
  const slug = 'gate-blocks';
  const specId = 'ffffffff-0001-4000-f000-000000000001';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug, GATE_CONTROLLED_WORKFLOW_YAML);
  try {
    writeChangeYaml(
      changeDir,
      slug,
      specId,
      `  - id: t1
    order: 1
    title: Task 1
    status: approved
    allowed_paths:
      - src/t1.js
  - id: t2
    order: 2
    title: Task 2
    status: approved
    allowed_paths:
      - src/t2.js
    depends_on: [t1]
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
    writeCheckGateScript(tmpRoot);
    commitAll(tmpRoot, 'Initial commit');

    const taskIds = ['t1', 't2'];
    const batchExecutionId = 'batch-gate-blocks-1';
    const sessionId = 'session-gate-blocks-1';
    await startBatch({ tmpRoot, activeDir, slug, specId, taskIds, batchExecutionId, sessionId });

    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 'wip';\n", 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't2.js'), "export const t2 = 'wip';\n", 'utf8');

    const localCommitCountBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();

    // gate-flag.txt does not exist — check-gate.js exits 1 — the real exit gate fails.
    await assert.rejects(
      () => executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: { tasks: {}, 'commit.title': 'feat: implement t1, t2' },
      }),
      (err) => {
        assert.equal(err.code, 'BATCH_MEMBER_FINISH_INCOMPLETE');
        assert.equal(err.details?.taskId ?? err.taskId, 't1');
        return true;
      },
    );

    // Not recorded as completed.
    const record = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.notEqual(record?.stages?.memberFinishes?.t1?.status, 'completed');
    assert.notEqual(record?.status, 'completed');

    // No real transition happened for t1.
    const change = requireChange(slug, activeDir);
    const t1 = requireTask(change, 't1');
    assert.equal(t1.workflow_progress.state, 'active');
    assert.deepEqual(t1.workflow_progress.history, []);

    // No dependency-consumption materialized for t2 (it depends on t1, which never
    // actually released its epoch).
    assert.equal(loadDependencyConsumption(tmpRoot, slug, 't2', 'implementation', 1), null);

    // No shared commit landed.
    const localCommitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.equal(localCommitCountAfter, localCommitCountBefore);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('After remediation (the real command now passes), re-invoking executeBatchFinish completes correctly', async () => {
  const slug = 'gate-remediated';
  const specId = 'ffffffff-0002-4000-f000-000000000001';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug, GATE_CONTROLLED_WORKFLOW_YAML);
  try {
    writeChangeYaml(
      changeDir,
      slug,
      specId,
      `  - id: t1
    order: 1
    title: Task 1
    status: approved
    allowed_paths:
      - src/t1.js
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    writeCheckGateScript(tmpRoot);
    commitAll(tmpRoot, 'Initial commit');

    // Single member is enough here, but executeBatchFinish requires a reservation of
    // 2+ taskIds — add a second, independent member with the identical shape.
    // (See writeChangeYaml below — redefine with t2.)
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: ${slug}
spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: approved
    allowed_paths:
      - src/t1.js
  - id: t2
    order: 2
    title: Task 2
    status: approved
    allowed_paths:
      - src/t2.js
`,
      'utf8',
    );
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 'wip';\n", 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't2.js'), "export const t2 = 'wip';\n", 'utf8');
    commitAll(tmpRoot, 'Add t2 and wip source');

    const taskIds = ['t1', 't2'];
    const batchExecutionId = 'batch-gate-remediated-1';
    const sessionId = 'session-gate-remediated-1';
    await startBatch({ tmpRoot, activeDir, slug, specId, taskIds, batchExecutionId, sessionId });

    const finishInputs = { tasks: {}, 'commit.title': 'feat: implement t1, t2' };

    // First attempt: gate still fails.
    await assert.rejects(
      () => executeBatchFinish({ repoRoot: tmpRoot, activeDir, changeSlug: slug, batchExecutionId, sessionId, inputs: finishInputs }),
      { code: 'BATCH_MEMBER_FINISH_INCOMPLETE' },
    );

    // Remediate: the real command now passes.
    fs.writeFileSync(path.join(tmpRoot, 'gate-flag.txt'), 'ok\n', 'utf8');

    const localCommitCountBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();

    const finishRes = await executeBatchFinish({ repoRoot: tmpRoot, activeDir, changeSlug: slug, batchExecutionId, sessionId, inputs: finishInputs });

    assert.equal(finishRes.status, 'completed');
    assert.equal(finishRes.record.stages.sharedCommit.status, 'completed');

    const localCommitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.equal(Number(localCommitCountAfter), Number(localCommitCountBefore) + 1, 'Exactly one shared commit must land');

    const change = requireChange(slug, activeDir);
    for (const taskId of taskIds) {
      const task = requireTask(change, taskId);
      assert.equal(task.workflow_progress.state, 'completed');
      const lastEntry = task.workflow_progress.history[task.workflow_progress.history.length - 1];
      assert.equal(lastEntry.transitioned_to, 'review');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('A real standard.yaml-shaped workflow (action: test, mapped through the real default command catalog) with a genuinely passing command finishes end to end with exactly one shared commit', async () => {
  const slug = 'real-action-test-mapping';
  const specId = 'ffffffff-0003-4000-f000-000000000001';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug, REAL_SHAPED_WORKFLOW_YAML);
  try {
    writeChangeYaml(
      changeDir,
      slug,
      specId,
      `  - id: t1
    order: 1
    title: Task 1
    status: approved
    allowed_paths:
      - src/t1.js
  - id: t2
    order: 2
    title: Task 2
    status: approved
    allowed_paths:
      - src/t2.js
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
    // The literal 'npm test' resolution of the logical 'test' alias needs a real
    // package.json in this fixture repo, exactly like any real project would have.
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'gate-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
      'utf8',
    );
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 'implemented';\n", 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't2.js'), "export const t2 = 'implemented';\n", 'utf8');
    commitAll(tmpRoot, 'Initial commit');

    const taskIds = ['t1', 't2'];
    const batchExecutionId = 'batch-real-mapping-1';
    const sessionId = 'session-real-mapping-1';
    await startBatch({ tmpRoot, activeDir, slug, specId, taskIds, batchExecutionId, sessionId });

    const localCommitCountBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();

    const finishRes = await executeBatchFinish({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
      sessionId,
      inputs: { tasks: {}, 'commit.title': 'feat: implement t1, t2' },
    });

    assert.equal(finishRes.status, 'completed');

    const localCommitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.equal(Number(localCommitCountAfter), Number(localCommitCountBefore) + 1, 'Exactly one shared commit must land');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
