// End-to-end integration test for public CLI workflow batch start / finish,
// fail-closed ambient security, canonical spec_id enforcement, and prevalidation semantics.
// Covers Items 1, 2, 7, 8, 14, 15 from corrective pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createGroupReservation } from '../specs/workflow/queue/index.mjs';
import { acquireWorkspaceWriter, getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';
import { getCanonicalBatchReportRelativePath } from '../specs/reviews/batch-report.mjs';
import { loadBatchFinishRecord } from '../specs/workflow/batch-finish/record.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/operation.mjs';
import { AiPolicyConflictError } from '../dashboard/server/ai/contracts.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SPECS_CLI = path.join(REPO_ROOT, 'tools', 'specs.mjs');

function setupTestRepo(slug, { omitSpecId = false, specId = randomUUID() } = {}) {
  // A real 'origin' remote is required now that batch-finish's one shared commit
  // stage actually attempts a push when the workflow definition declares
  // sourceControl.push: true (batch-execution-generalization, task 03/04) — matching
  // the same bare-remote-plus-clone pattern other CLI integration tests already use
  // (see approve-git-sync.test.mjs's setupTempGitRepo).
  const baseDir = fs.mkdtempSync(path.join(tmpdir(), `nevo-batch-cli-${slug}-`));
  const originDir = path.join(baseDir, 'origin.git');
  const tmpRoot = path.join(baseDir, 'repo');
  execFileSync('git', ['init', '--bare', '-q', originDir]);
  execFileSync('git', ['clone', '-q', originDir, tmpRoot]);
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

  const specIdField = omitSpecId ? '' : `spec_id: ${specId}\n`;
  const changeYaml = `id: ${slug}
${specIdField}workflow:
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
  const currentBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
  execFileSync('git', ['push', '-u', 'origin', currentBranch], { cwd: tmpRoot });

  return { tmpRoot, baseDir, activeDir, changeDir, specId: omitSpecId ? null : specId };
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
  const { tmpRoot, baseDir } = setupTestRepo(slug);
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
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('3. Full public CLI lifecycle: workflow batch start and finish via ambient session without --session-id', async () => {
  const slug = 'cli-full-lifecycle';
  const { tmpRoot, baseDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-exec-101';
    const sessionId = 'session-agent-101';
    const taskIds = ['t1', 't2'];

    // 1. Group reservation
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    // 2. Persisted AgentSession under canonical specId
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${specId}.json`),
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

    // 3. Workspace writer claim with canonical specId
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
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

    // 4. Execute workflow batch start via CLI
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
    const startJson = JSON.parse(startRes.stdout);
    assert.equal(startJson.batchExecutionId, batchExecutionId);
    assert.ok(startJson.batchContext);
    assert.ok(startJson.workspaceBaseline);

    // 5. Execute workflow batch finish with structured --input
    const resultsPayload = JSON.stringify({
      results: {
        t1: { result: 'pass', feedback: 'All good' },
        t2: { result: 'pass', feedback: 'Verified' },
      },
      crossTaskFindings: [{ summary: 'No collisions', affectedTaskIds: ['t1', 't2'] }],
      'commit.title': 'docs(review): batch review report',
    });

    const finishRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input', resultsPayload],
      {
        cwd: tmpRoot,
        env,
        encoding: 'utf8',
      }
    );

    assert.equal(finishRes.status, 0, `batch finish failed with stderr: ${finishRes.stderr}\nstdout: ${finishRes.stdout}`);
    const finishJson = JSON.parse(finishRes.stdout);
    assert.equal(finishJson.status, 'completed', 'Must report completed finish');

    // 6. Verify durable batch-finish record
    const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.ok(finishRecord);
    assert.equal(finishRecord.status, 'completed');
    assert.equal(finishRecord.results.t1.result, 'pass');
    assert.equal(finishRecord.results.t2.result, 'pass');

    // 7. Verify report commit landed on git
    const lastCommitLog = execFileSync('git', ['log', '-1', '--oneline'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.ok(lastCommitLog.includes('review-batch') || lastCommitLog.includes('report'), `Report commit log: ${lastCommitLog}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('4. CLI batch finish with --input-file works identically', async () => {
  const slug = 'cli-input-file';
  const { tmpRoot, baseDir, specId } = setupTestRepo(slug);
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
      path.join(sessionsDir, `${specId}.json`),
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
      specId,
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

    // Input file must be inside .nevo-ai-local so it doesn't violate git provenance
    const inputFile = path.join(tmpRoot, '.nevo-ai-local', 'results.json');
    fs.writeFileSync(
      inputFile,
      JSON.stringify({
        tasks: {
          t1: { result: 'pass', feedback: 'ok file' },
          t2: { result: 'fail', feedback: 'needs fix' },
        },
        'commit.title': 'docs(review): batch review report',
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
    fs.rmSync(baseDir, { recursive: true, force: true });
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

test('6. Security: deterministic spec without spec_id fails closed on workflow batch start (Item 2)', async () => {
  const slug = 'deterministic-no-spec-id';
  const { tmpRoot, baseDir, activeDir } = setupTestRepo(slug, { omitSpecId: true });
  try {
    const batchExecutionId = 'batch-no-spec-id-1';
    const sessionId = 'session-no-spec-id-1';
    const taskIds = ['t1', 't2'];

    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const env = {
      ...process.env,
      NEVO_SESSION_ID: sessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    const startRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    assert.notEqual(startRes.status, 0, 'Must exit non-zero when spec_id is missing on deterministic spec');
    assert.ok(
      startRes.stderr.includes('has no persisted spec_id') || startRes.stderr.includes('backfill-spec-id'),
      `Error must explain missing spec_id: ${startRes.stderr}`
    );

    // Verify ZERO task activations occurred
    const changeAfter = requireChange(slug, activeDir);
    const t1 = requireTask(changeAfter, 't1');
    const t2 = requireTask(changeAfter, 't2');
    assert.equal(t1.workflow_progress.state, 'completed', 'Task t1 state must remain untouched');
    assert.equal(t2.workflow_progress.state, 'completed', 'Task t2 state must remain untouched');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('7. Identity: canonical spec_id UUID resolution across admission, batch-start, batch-finish (Item 1)', async () => {
  const slug = 'canonical-spec-uuid-flow';
  const canonicalUuid = randomUUID();
  const { tmpRoot, baseDir } = setupTestRepo(slug, { specId: canonicalUuid });
  try {
    const batchExecutionId = 'batch-uuid-test-1';
    const sessionId = 'session-uuid-test-1';
    const taskIds = ['t1', 't2'];

    // 1. Queue reservation
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    // 2. Persisted session under canonical UUID filename
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${canonicalUuid}.json`),
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

    // 3. Workspace writer claim with canonical UUID
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: canonicalUuid,
      changeSlug: slug,
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

    // 4. Workflow batch start resolves canonical spec_id UUID
    const startRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );
    assert.equal(startRes.status, 0, `batch start failed: ${startRes.stderr}`);

    // 5. Workflow batch finish resolves canonical spec_id UUID
    const finishRes = spawnSync(
      'node',
      [
        SPECS_CLI,
        'workflow',
        'batch',
        'finish',
        slug,
        '--batch',
        batchExecutionId,
        '--input',
        JSON.stringify({ results: { t1: { result: 'pass' }, t2: { result: 'pass' } }, 'commit.title': 'docs(review): batch review report' }),
      ],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );
    assert.equal(finishRes.status, 0, `batch finish failed: ${finishRes.stderr}`);

    const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.ok(finishRecord);
    assert.equal(finishRecord.status, 'completed');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('8. Prevalidation: failed provenance check leaves no report file, no batch-finish record, and no task mutations (Item 8)', async () => {
  const slug = 'provenance-zero-write';
  const { tmpRoot, baseDir, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-prov-fail-1';
    const sessionId = 'session-prov-fail-1';
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
      path.join(sessionsDir, `${specId}.json`),
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
      specId,
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

    // 1. Batch start captures workspace baseline
    spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    // 2. Introduce an illegal modification in workspace (violates provenance)
    fs.writeFileSync(path.join(tmpRoot, 'unauthorized-edit.js'), '// illegal edit\n', 'utf8');

    // 3. Attempt batch finish
    const canonicalReportRelPath = getCanonicalBatchReportRelativePath(slug, batchExecutionId);
    const fullReportPath = path.join(tmpRoot, canonicalReportRelPath);

    let finishErr = null;
    try {
      await executeBatchFinish({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        sessionId,
        inputs: {
          results: { t1: { result: 'pass' }, t2: { result: 'pass' } },
          'commit.title': 'docs(review): batch review report',
        },
      });
    } catch (err) {
      finishErr = err;
    }

    assert.ok(finishErr, 'executeBatchFinish must throw on provenance violation');
    assert.equal(finishErr.code, 'BATCH_PROVENANCE_VIOLATION');

    // 4. Assert zero durable writes occurred:
    // - No report file written
    assert.equal(fs.existsSync(fullReportPath), false, 'Report file must NOT be written when prevalidation fails');

    // - No batch finish record persisted
    const finishRecord = loadBatchFinishRecord(tmpRoot, slug, batchExecutionId);
    assert.equal(finishRecord, null, 'Batch finish record must NOT be created when prevalidation fails');

    // - No task mutations occurred
    const changeAfter = requireChange(slug, activeDir);
    const t1 = requireTask(changeAfter, 't1');
    const t2 = requireTask(changeAfter, 't2');
    assert.equal(t1.workflow_progress.state, 'active', 'Task t1 must remain in active state (not finished)');
    assert.equal(t2.workflow_progress.state, 'active', 'Task t2 must remain in active state (not finished)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
