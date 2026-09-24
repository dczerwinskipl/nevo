import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  publishTask,
  validateTaskDefinitionForPublish,
  PUBLISH_STAGE_IDS,
} from '../specs/workflow/publish/operation.mjs';
import { handleWorkflowTaskPublish } from '../specs/workflow/cli.mjs';
import { loadChange, setTaskStatus } from '../specs/store.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import * as git from '../lib/git.mjs';
import {
  operationFilePath,
  saveOperationRecord,
  loadOperationRecord,
  findInFlightOperationRecord,
} from '../specs/workflow/operation-record.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
} from '../specs/workflow/workspace-request.mjs';
import {
  reconcileRequestBackedWorkspaceClaim,
  registerRequestKindReconciler,
} from '../specs/workflow/workspace-claim-reconciliation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = resolve(__dirname, '..');

function setupTempGitRepo() {
  const baseDir = join(tmpdir(), `nevo-publish-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(baseDir, { recursive: true });

  execFileSync('git', ['init'], { cwd: baseDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: baseDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: baseDir });

  writeFileSync(join(baseDir, 'README.md'), '# Test repo\n');
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: baseDir });
  execFileSync('git', ['add', '.'], { cwd: baseDir });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: baseDir });

  const activeDir = join(baseDir, 'specs', 'active');
  const archiveDir = join(baseDir, 'specs', 'archive');
  const workflowsDir = join(baseDir, '.nevo-ai', 'workflows');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  const testWorkflow = [
    'id: standard',
    'title: "Standard Workflow"',
    'type: standard',
    'version: 1',
    'sourceControl:',
    '  enabled: true',
    '  push: false',
    'steps:',
    '  implementation:',
    '    status:',
    '      active: implementing',
    '      completed: implemented',
    '    entryGates: []',
    '    exitGates: []',
    '    finalize: []',
    '    transitions:',
    '      - to: verified',
    '        outcome: success',
    '',
  ].join('\n');
  writeFileSync(join(workflowsDir, 'standard.yaml'), testWorkflow, 'utf8');

  writeFileSync(join(baseDir, 'specs', 'active.generated.md'), '# Active Specs\n');
  writeFileSync(join(baseDir, 'specs', 'archive.generated.md'), '# Archive Specs\n');
  writeFileSync(join(baseDir, 'specs', 'index.generated.json'), JSON.stringify({ generated: new Date().toISOString(), changes: [] }, null, 2));

  execFileSync('git', ['add', '.'], { cwd: baseDir });
  execFileSync('git', ['commit', '-m', 'chore: setup specs infrastructure'], { cwd: baseDir });

  return { baseDir, activeDir, archiveDir, workflowsDir };
}

function createDeterministicSpec(activeDir, slug) {
  const changeDir = join(activeDir, slug);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const changeYaml = [
    `id: ${slug}`,
    `title: Deterministic Spec`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  version: 1`,
    `  definition: standard`,
    `tasks:`,
    `  - id: t1`,
    `    status: draft`,
    `    file: tasks/01-t1.md`,
    `  - id: t2`,
    `    status: draft`,
    `    file: tasks/02-t2.md`,
    `    depends_on: [ t1 ]`,
    `  - id: t3`,
    `    status: draft`,
    `    file: tasks/03-t3.md`,
    '',
  ].join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
  writeFileSync(join(tasksDir, '02-t2.md'), '---\nid: t2\n---\n# T2\n', 'utf8');
  writeFileSync(join(tasksDir, '03-t3.md'), '---\nid: t3\n---\n# T3\n', 'utf8');

  return { changeDir, changeYamlPath: join(changeDir, 'change.yaml'), changeYaml };
}

describe('workflow task publish — static check', () => {
  test('publish operation does not import approveTask or approve operation', () => {
    const operationFile = join(toolsDir, 'specs', 'workflow', 'publish', 'operation.mjs');
    const source = readFileSync(operationFile, 'utf8');

    assert.equal(
      source.includes('approve/operation'),
      false,
      'publish operation must not import from approve/operation.mjs'
    );
    assert.equal(
      source.includes('approveTask'),
      false,
      'publish operation must not call or reference approveTask'
    );
    assert.equal(
      source.includes('lifecycle-primitives'),
      false,
      'publish operation must not import lifecycle-primitives.mjs'
    );
  });
});

describe('workflow task publish — functional tests', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  test('AC 186 & 190: Successful single-task publish with sourceControl commits exactly chore(workflow): publish <task-id> and leaves git clean', async () => {
    const slug = 'pub-valid';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const headBefore = git.getCurrentRevision(env.baseDir);

    const result = await publishTask(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.taskId, 't1');
    assert.equal(result.status, 'approved');

    // Verify change.yaml was updated to approved
    const change = loadChange(slug, env.activeDir);
    const task = change.tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'approved');

    // AC 186: git status shows no uncommitted change to change.yaml for this change
    const dirty = git.getDirtyPaths(env.baseDir);
    const slugDirty = dirty.filter(p => p.replace(/\\/g, '/').includes(`specs/active/${slug}/`));
    assert.equal(slugDirty.some(p => p.includes('change.yaml')), false, 'change.yaml must be cleanly committed');

    // AC 190: commit message is chore(workflow): publish <task-id>
    const headAfter = git.getCurrentRevision(env.baseDir);
    assert.notEqual(headAfter, headBefore);
    const commitInfo = git.getCommitInfo(env.baseDir, 'HEAD');
    assert.equal(commitInfo.subject, 'chore(workflow): publish t1');
  });

  test('Publishing a task with depends_on that resolve in the same change succeeds', async () => {
    const slug = 'pub-deps';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const result = await publishTask(slug, 't2', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'approved');
    const change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 't2').status, 'approved');
  });

  test('Publishing with sourceControl disabled updates change.yaml without committing', async () => {
    const slug = 'pub-no-sc';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const headBefore = git.getCurrentRevision(env.baseDir);

    const result = await publishTask(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
      sourceControl: { enabled: false, push: false },
    });

    assert.equal(result.ok, true);
    const headAfter = git.getCurrentRevision(env.baseDir);
    assert.equal(headAfter, headBefore, 'Head should not change when sourceControl is disabled');

    const dirty = git.getDirtyPaths(env.baseDir);
    assert.ok(dirty.some(p => p.includes('change.yaml')));
  });

  test('Publishing against legacy spec fails via deterministic guard before mutation', () => {
    const slug = 'pub-legacy';
    const changeDir = join(env.activeDir, slug);
    mkdirSync(join(changeDir, 'tasks'), { recursive: true });
    const changeYaml = `id: ${slug}\ntitle: Legacy\nstatus: draft\ntasks:\n  - id: t1\n    status: draft\n    file: tasks/01-t1.md\n`;
    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        return true;
      }
    );
  });

  test('Validation guards: non-draft, missing file, mismatched id, unknown dep, self dep, already started fail cleanly', () => {
    const slug = 'pub-guards';
    const { changeDir, changeYaml } = createDeterministicSpec(env.activeDir, slug);

    // Mismatched ID
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: wrong-id\n---\n# T1\n', 'utf8');
    assert.throws(() => {
      publishTask(slug, 't1', { activeDir: env.activeDir, repoRoot: env.baseDir });
    }, /does not match/);

    // Missing file
    rmSync(join(changeDir, 'tasks', '01-t1.md'));
    assert.throws(() => {
      publishTask(slug, 't1', { activeDir: env.activeDir, repoRoot: env.baseDir });
    }, /file not found/);
  });
});

describe('Task 31: Advanced arbitration, durability, CAS, and reconciliation', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  test('AC 242 & 270: Durable workspace-request created with status: queued before acquireWorkspaceWriter, and operation record precedes request (D72, D91)', async () => {
    const slug = 'pub-order';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const result = await publishTask(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
    });

    assert.ok(result.requestId);
    const req = loadWorkspaceRequest(env.baseDir, result.requestId);
    assert.ok(req);
    assert.equal(req.kind, 'publish');
    assert.equal(req.status, 'completed');
    assert.ok(req.operationRef);
    assert.ok(existsSync(req.operationRef));
  });

  test('AC 210, 219, 223: Publish waits when workspace-writer slot is held by an active agent (for same or different spec) (D55, D64, D65)', async () => {
    const slugA = 'pub-spec-a';
    const slugB = 'pub-spec-b';
    createDeterministicSpec(env.activeDir, slugA);
    createDeterministicSpec(env.activeDir, slugB);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add specs`], { cwd: env.baseDir });

    // Agent acquires workspace-writer for spec A
    const agentClaim = await acquireWorkspaceWriter({
      repoRoot: env.baseDir,
      kind: 'agent',
      specId: slugA,
      taskId: 't1',
    });
    assert.equal(agentClaim.acquired, true);

    // Spec B attempts publish with timeoutMs: 100ms and retry: false -> must be contended
    await assert.rejects(
      async () => {
        await publishTask(slugB, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
          timeoutMs: 100,
          retry: false,
        });
      },
      /Failed to acquire workspace-writer slot/
    );

    // Release agent claim
    await releaseWorkspaceWriterIfOwned({
      repoRoot: env.baseDir,
      expectedOwnerId: agentClaim.ownerId,
      expectedKind: 'agent',
    });

    // Now Spec B can publish successfully (AC 216)
    const pubB = await publishTask(slugB, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
    });
    assert.equal(pubB.ok, true);
  });

  test('AC 227: Publish waiting on agent claim marked recovery-required reports blocked-by-recovery (D67)', async () => {
    const slug = 'pub-blocked-rec';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    // Acquire and mark recovery-required
    const agentClaim = await acquireWorkspaceWriter({
      repoRoot: env.baseDir,
      kind: 'agent',
      specId: slug,
      taskId: 't1',
    });
    await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: env.baseDir,
      expectedOwnerId: agentClaim.ownerId,
    });

    const result = await publishTask(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
      timeoutMs: 100,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blockedByRecovery, true);
    assert.equal(result.reason, 'recovery-required');

    // Clean up recovery claim
    const lockFile = join(env.baseDir, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    try { unlinkSync(lockFile); } catch {}
  });

  test('AC 237: Ownership-conditional release rejects delayed release with old ownerId (D70)', async () => {
    const claim1 = await acquireWorkspaceWriter({
      repoRoot: env.baseDir,
      kind: 'publish',
      specId: 'spec-x',
    });
    assert.equal(claim1.acquired, true);
    await releaseWorkspaceWriterIfOwned({
      repoRoot: env.baseDir,
      expectedOwnerId: claim1.ownerId,
      expectedKind: 'publish',
    });

    // Acquire new claim
    const claim2 = await acquireWorkspaceWriter({
      repoRoot: env.baseDir,
      kind: 'publish',
      specId: 'spec-y',
    });
    assert.equal(claim2.acquired, true);

    // Delayed release with claim1's ownerId
    const delayedRel = await releaseWorkspaceWriterIfOwned({
      repoRoot: env.baseDir,
      expectedOwnerId: claim1.ownerId,
      expectedKind: 'publish',
    });

    assert.equal(delayedRel.released, false);
    assert.equal(delayedRel.reason, 'not-current-owner');

    await releaseWorkspaceWriterIfOwned({
      repoRoot: env.baseDir,
      expectedOwnerId: claim2.ownerId,
      expectedKind: 'publish',
    });
  });

  test('AC 287: Registration for publish and batch-publish checkers is available upon importing publish/operation.mjs (D96)', async () => {
    // Check that publish and batch-publish checkers resolve via reconcileRequestBackedWorkspaceClaim
    const dummyReq = await createWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: 'req-check-reg',
      kind: 'publish',
      specId: 'spec-test',
    });

    // Reconciling a dead claim whose operation record is missing fails closed with reconciliation-required
    const checkRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: env.baseDir,
      claimSnapshot: {
        ownerId: 'owner-dummy',
        requestId: dummyReq.requestId,
        kind: 'publish',
      },
    });

    assert.equal(checkRes.reconciled, false);
    assert.equal(checkRes.outcome, 'reconciliation-required');
  });

  test('AC 260: Dead pid on Publish claim with completed operation record is released and marked completed (D79, D88)', async () => {
    const slug = 'pub-dead-pid';
    createDeterministicSpec(env.activeDir, slug);

    // Create completed operation record
    const recordPath = operationFilePath(env.baseDir, slug, 't1', 'publish', 1);
    const record = {
      operationId: 'op-completed',
      change: slug,
      task: 't1',
      step: 'publish',
      attempt: 1,
      status: 'completed',
      operations: PUBLISH_STAGE_IDS.map(id => ({ id, status: 'completed' })),
    };
    saveOperationRecord(env.baseDir, record);

    const req = await createWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: 'req-dead-pid',
      kind: 'publish',
      specId: slug,
      taskId: 't1',
      operationRef: recordPath,
    });

    const reconcileRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: env.baseDir,
      claimSnapshot: {
        ownerId: 'dead-owner-123',
        requestId: req.requestId,
        kind: 'publish',
        operationRef: recordPath,
      },
    });

    assert.equal(reconcileRes.reconciled, true);
    assert.equal(reconcileRes.outcome, 'completed');
  });

  test('AC 274: Settled failed Publish becomes failed workspace-request, never completed (D95)', async () => {
    const slug = 'pub-failed-stage';
    const recordPath = operationFilePath(env.baseDir, slug, 't1', 'publish', 1);
    const record = {
      operationId: 'op-failed',
      change: slug,
      task: 't1',
      step: 'publish',
      attempt: 1,
      status: 'failed',
      operations: [
        { id: 'validate', status: 'completed' },
        { id: 'update-task', status: 'failed' },
      ],
    };
    saveOperationRecord(env.baseDir, record);

    const req = await createWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: 'req-failed-op',
      kind: 'publish',
      specId: slug,
      taskId: 't1',
      operationRef: recordPath,
    });

    const reconcileRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: env.baseDir,
      claimSnapshot: {
        ownerId: 'failed-owner-123',
        requestId: req.requestId,
        kind: 'publish',
        operationRef: recordPath,
      },
    });

    assert.equal(reconcileRes.reconciled, true);
    assert.equal(reconcileRes.outcome, 'failed');

    const updatedReq = loadWorkspaceRequest(env.baseDir, req.requestId);
    assert.equal(updatedReq.status, 'failed');
  });

  test('AC 291: Atomic requestSequence under concurrent creation (D81)', async () => {
    const [req1, req2] = await Promise.all([
      createWorkspaceRequest({ repoRoot: env.baseDir, requestId: 'seq-1', kind: 'publish', specId: 's1' }),
      createWorkspaceRequest({ repoRoot: env.baseDir, requestId: 'seq-2', kind: 'publish', specId: 's1' }),
    ]);

    assert.notEqual(req1.requestSequence, req2.requestSequence);
    assert.equal(Math.abs(req1.requestSequence - req2.requestSequence), 1);
  });

  test('AC 295: CAS prevents double-publish (D83)', async () => {
    const req = await createWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: 'cas-test',
      kind: 'publish',
      specId: 's1',
    });

    // Processor 1 transitions queued -> running
    const cas1 = await transitionWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: req.requestId,
      expectedStatus: ['queued', 'waiting-for-workspace'],
      to: 'running',
    });
    assert.equal(cas1.transitioned, true);

    // Processor 2 attempts same transition from queued -> rejected
    const cas2 = await transitionWorkspaceRequest({
      repoRoot: env.baseDir,
      requestId: req.requestId,
      expectedStatus: ['queued', 'waiting-for-workspace'],
      to: 'running',
    });
    assert.equal(cas2.transitioned, false);
    assert.equal(cas2.reason, 'state-conflict');
    assert.equal(cas2.currentStatus, 'running');
  });
});
