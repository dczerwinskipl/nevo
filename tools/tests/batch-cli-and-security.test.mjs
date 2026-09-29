// End-to-end integration test for public CLI workflow batch start / finish,
// fail-closed ambient security, and policy conflict 409 error mapping.
// Covers Items 1, 2, 3, 4, 6, 14, 18-25 from corrective pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGroupReservation } from '../specs/workflow/queue/index.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { getCanonicalBatchReportRelativePath } from '../specs/reviews/batch-report.mjs';
import { loadBatchFinishRecord } from '../specs/workflow/batch-finish/record.mjs';
import { AiPolicyConflictError } from '../dashboard/server/ai/contracts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SPECS_CLI = path.join(REPO_ROOT, 'tools', 'specs.mjs');

function setupTestRepo(slug) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-batch-cli-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');

  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );

  const changeYaml = `id: ${slug}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
  fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

  return { tmpRoot, activeDir, changeDir };
}

test('1. CLI surface: node tools/specs.mjs workflow batch --help shows start and finish subcommands', () => {
  const result = spawnSync('node', [SPECS_CLI, 'workflow', 'batch', '--help'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });

  assert.equal(result.status, 0, `workflow batch --help should exit 0. Stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('start'), 'Help output must include "start" command');
  assert.ok(result.stdout.includes('finish'), 'Help output must include "finish" command');
});

test('2. Security: workflow batch start fails closed when no ambient session identity exists', async () => {
  const slug = 'fail-closed-ambient';
  const { tmpRoot, activeDir } = setupTestRepo(slug);
  try {
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds: ['t1', 't2'],
      batchExecutionId: 'batch-fail-closed-1',
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const env = { ...process.env };
    delete env.NEVO_SESSION_ID;
    delete env.NEVO_AGENT_PROVIDER;
    delete env.NEVO_AGENT_PROVIDER_SESSION_ID;

    const runRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', reservation.batchExecutionId],
      {
        cwd: tmpRoot,
        env,
        encoding: 'utf8',
      }
    );

    assert.notEqual(runRes.status, 0, 'Must exit non-zero when ambient session is missing');
    const combinedOutput = `${runRes.stdout} ${runRes.stderr}`;
    assert.ok(
      combinedOutput.includes('session') || combinedOutput.includes('BATCH_IDENTITY_MISMATCH'),
      `Output must explain missing session or identity mismatch: ${combinedOutput}`
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('3. Full public CLI lifecycle: workflow batch start and finish via ambient session without --session-id', async () => {
  const slug = 'cli-full-lifecycle';
  const { tmpRoot, activeDir, changeDir } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-exec-cli-101';
    const sessionId = 'session-agent-cli-101';
    const taskIds = ['t1', 't2'];

    // 1. Group reservation
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    // 2. Persisted AgentSession with batchExecutionId
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${slug}.json`),
      JSON.stringify({
        sessions: [{
          sessionId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2),
      'utf8'
    );

    // 3. Workspace writer claim
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: slug,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    const env = {
      ...process.env,
      NEVO_SESSION_ID: sessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    // 4. Execute: node tools/specs.mjs workflow batch start <change> --batch <batchExecutionId>
    const startRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      {
        cwd: tmpRoot,
        env,
        encoding: 'utf8',
      }
    );

    assert.equal(startRes.status, 0, `batch start failed with stderr: ${startRes.stderr}\nstdout: ${startRes.stdout}`);
    assert.ok(startRes.stdout.includes(batchExecutionId), 'batch start output must include batchExecutionId');

    // Verify tasks activated in change.yaml
    const postStartChange = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.ok(postStartChange.includes('current_step: review'), 't1 and t2 must be in current_step: review');

    // 5. Reviewer creates canonical report file
    const reportRelativePath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
    const fullReportPath = path.join(tmpRoot, reportRelativePath);
    fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
    fs.writeFileSync(fullReportPath, '# Batch Review Report\n\nAll tasks verified.\n', 'utf8');

    // 6. Execute: node tools/specs.mjs workflow batch finish <change> --batch <batchExecutionId> --input '<json>'
    const finishInput = JSON.stringify({
      tasks: {
        t1: { result: 'pass', feedback: 't1 looks great' },
        t2: { result: 'pass', feedback: 't2 looks great' },
      },
    });

    const finishRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input', finishInput],
      {
        cwd: tmpRoot,
        env,
        encoding: 'utf8',
      }
    );

    assert.equal(finishRes.status, 0, `batch finish failed with stderr: ${finishRes.stderr}\nstdout: ${finishRes.stdout}`);
    const finishJson = JSON.parse(finishRes.stdout);
    assert.equal(finishJson.status, 'completed', 'Must report completed finish');

    // 7. Verify durable batch-finish record
    const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.ok(finishRecord);
    assert.equal(finishRecord.status, 'completed');
    assert.equal(finishRecord.results.t1.result, 'pass');
    assert.equal(finishRecord.results.t2.result, 'pass');

    // 8. Verify report commit landed on git
    const lastCommitLog = execFileSync('git', ['log', '-1', '--oneline'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.ok(lastCommitLog.includes('review-batch') || lastCommitLog.includes('report'), `Report commit log: ${lastCommitLog}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('4. CLI batch finish with --input-file works identically', async () => {
  const slug = 'cli-input-file';
  const { tmpRoot, activeDir, changeDir } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-exec-file-202';
    const sessionId = 'session-agent-file-202';
    const taskIds = ['t1', 't2'];

    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${slug}.json`),
      JSON.stringify({
        sessions: [{
          sessionId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2),
      'utf8'
    );

    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: slug,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    const env = {
      ...process.env,
      NEVO_SESSION_ID: sessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    const reportRelativePath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
    const fullReportPath = path.join(tmpRoot, reportRelativePath);
    fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
    fs.writeFileSync(fullReportPath, '# Batch Review Report\n\nAll tasks verified.\n', 'utf8');

    // Input file must be outside working tree or inside .nevo-ai-local so it doesn't violate git provenance
    const inputFile = path.join(tmpRoot, '.nevo-ai-local', 'results.json');
    fs.writeFileSync(
      inputFile,
      JSON.stringify({
        tasks: {
          t1: { result: 'pass', feedback: 'ok file' },
          t2: { result: 'fail', feedback: 'needs fix' },
        },
      }),
      'utf8'
    );

    const finishRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input-file', inputFile],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    assert.equal(finishRes.status, 0, `batch finish --input-file failed with stderr: ${finishRes.stderr}\nstdout: ${finishRes.stdout}`);
    const finishJson = JSON.parse(finishRes.stdout);
    assert.equal(finishJson.status, 'completed');
    const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.ok(finishRecord);
    assert.equal(finishRecord.results.t1.result, 'pass');
    assert.equal(finishRecord.results.t2.result, 'fail');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('5. Policy conflict throws AiPolicyConflictError with HTTP 409 mapping', () => {
  const err = new AiPolicyConflictError(
    'Selected tasks have conflicting execution policy overrides. An explicit provider and mode must be selected for the batch.'
  );
  assert.equal(err.status, 409, 'AiPolicyConflictError status must be 409');
  assert.equal(err.code, 'AI_POLICY_CONFLICT', 'Error code must be AI_POLICY_CONFLICT');
  assert.equal(err.recoveryHint, 'operator-action', 'Recovery hint must be operator-action');
});
