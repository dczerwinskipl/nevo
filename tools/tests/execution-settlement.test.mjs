// Tests for execution-settlement module (D59, D60).
// Run: node --test tools/tests/execution-settlement.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { assessExecutionSettlement } from '../specs/workflow/execution-settlement.mjs';
import { planStart } from '../specs/workflow/start-operation.mjs';
import { saveOperationRecord, loadOperationRecord, isFinishOperationReplayable } from '../specs/workflow/operation-record.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

describe('execution-settlement (D59, D60)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-settlement-test-'));

    // Initialize git repository
    git(tempRepoRoot, ['init', '-b', 'main']);
    git(tempRepoRoot, ['config', 'user.name', 'Test User']);
    git(tempRepoRoot, ['config', 'user.email', 'test@example.com']);

    // Create minimal change structure
    const specsActive = path.join(tempRepoRoot, 'specs', 'active', 'demo-change');
    fs.mkdirSync(path.join(specsActive, 'tasks'), { recursive: true });

    fs.writeFileSync(path.join(specsActive, 'change.yaml'), `
schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
`, 'utf8');

    fs.writeFileSync(path.join(specsActive, 'tasks', '01-demo-task.md'), `---
id: demo-task
status: in-progress
allowed_paths:
  - src/feature/**
---
# Demo Task
`, 'utf8');

    // Commit baseline so worktree is clean
    git(tempRepoRoot, ['add', '.']);
    git(tempRepoRoot, ['commit', '-m', 'Initial setup']);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('Condition 1: In-flight start-operation record blocks settlement', async () => {
    // Create an in-flight start operation
    planStart({
      repoRoot: tempRepoRoot,
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      dependencySnapshot: [],
    });


    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.settled, false);
    assert.equal(result.reason, 'in-flight-start-operation');
    assert.equal(result.outcome, 'recovery-required');
  });

  test('Condition 2: In-flight finish-operation record blocks settlement', async () => {
    // Record in-flight finish operation
    saveOperationRecord(tempRepoRoot, {
      operationId: 'op-finish-1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      status: 'running',
      resolvedInputs: {},
      operations: [],
    });

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.settled, false);
    assert.equal(result.reason, 'in-flight-finish-operation');
    assert.equal(result.outcome, 'resumable');
  });


  test('Condition 3: Task workflow_progress state: active blocks settlement', async () => {
    // Write change.yaml with task workflow_progress.state = 'active'
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml'), `
schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: active
      history: []
`, 'utf8');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.settled, false);
    assert.equal(result.reason, 'task-active');
  });

  test('Condition 4: Dirty tracked change within execution owned scope blocks settlement', async () => {
    // Task in completed state
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'tasks', '01-demo-task.md'), `---
id: demo-task
status: completed
allowed_paths:
  - src/feature/**
workflow_progress:
  current_step: implement
  current_attempt: 1
  state: completed
  history: []
---
# Demo Task
`, 'utf8');

    // Create a tracked dirty file in src/feature/
    const featDir = path.join(tempRepoRoot, 'src', 'feature');
    fs.mkdirSync(featDir, { recursive: true });
    const featFile = path.join(featDir, 'code.js');
    fs.writeFileSync(featFile, '// initial', 'utf8');
    git(tempRepoRoot, ['add', 'src/feature/code.js']);
    git(tempRepoRoot, ['commit', '-m', 'Add feature file']);

    // Make it dirty
    fs.writeFileSync(featFile, '// modified dirty', 'utf8');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.settled, false);
    assert.equal(result.reason, 'dirty-in-scope-files');
    assert.ok(result.dirtyPaths.some(p => p.includes('code.js')));
  });

  test('Dirty file entirely outside execution owned scope does NOT block settlement', async () => {
    // Task in completed state
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'tasks', '01-demo-task.md'), `---
id: demo-task
status: completed
allowed_paths:
  - src/feature/**
workflow_progress:
  current_step: implement
  current_attempt: 1
  state: completed
  history: []
---
# Demo Task
`, 'utf8');

    // Create a tracked dirty file in unrelated/outside scope
    const unrelatedDir = path.join(tempRepoRoot, 'docs', 'unrelated');
    fs.mkdirSync(unrelatedDir, { recursive: true });
    const unrelatedFile = path.join(unrelatedDir, 'notes.md');
    fs.writeFileSync(unrelatedFile, '# Initial notes', 'utf8');
    git(tempRepoRoot, ['add', 'docs/unrelated/notes.md']);
    git(tempRepoRoot, ['commit', '-m', 'Add notes']);

    // Modify outside-scope file
    fs.writeFileSync(unrelatedFile, '# Modified notes', 'utf8');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.settled, true);
    assert.equal(result.outcome, 'completed');
    assert.ok(Array.isArray(result.outOfScopeDirty));
    assert.ok(result.outOfScopeDirty.includes('docs/unrelated/notes.md'));
  });
});

describe('Three-outcome terminal classification (Task 05, D1, D2, D3)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-three-outcome-test-'));

    git(tempRepoRoot, ['init', '-b', 'main']);
    git(tempRepoRoot, ['config', 'user.name', 'Test User']);
    git(tempRepoRoot, ['config', 'user.email', 'test@example.com']);

    const specsActive = path.join(tempRepoRoot, 'specs', 'active', 'demo-change');
    fs.mkdirSync(path.join(specsActive, 'tasks'), { recursive: true });

    fs.writeFileSync(path.join(specsActive, 'change.yaml'), `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
`, 'utf8');

    fs.writeFileSync(path.join(specsActive, 'tasks', '01-demo-task.md'), `---
id: demo-task
status: in-progress
allowed_paths:
  - src/feature/**
forbidden_paths:
  - src/forbidden/**
---
# Demo Task
`, 'utf8');

    git(tempRepoRoot, ['add', '.']);
    git(tempRepoRoot, ['commit', '-m', 'Initial setup']);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('In-flight start-operation record produces outcome: recovery-required (AC1)', async () => {
    planStart({
      repoRoot: tempRepoRoot,
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      dependencySnapshot: [],
    });

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.outcome, 'recovery-required');
    assert.equal(result.settled, false);
    assert.equal(result.reason, 'in-flight-start-operation');
  });

  test('In-flight replayable finish-operation record produces outcome: resumable with intact durable record (AC2)', async () => {
    const originalRecord = {
      operationId: 'op-finish-replayable',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      status: 'running',
      resolvedInputs: { key: 'val' },
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running' },
      ],
    };
    saveOperationRecord(tempRepoRoot, originalRecord);

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.outcome, 'resumable');
    assert.equal(result.settled, false);
    assert.equal(result.reason, 'in-flight-finish-operation');

    // Durable record left completely intact
    const loaded = loadOperationRecord(tempRepoRoot, 'demo-change', 'demo-task', 'implement', 1);
    assert.deepEqual(loaded, originalRecord);
  });

  test('In-flight non-replayable finish-operation record produces outcome: recovery-required (AC3)', async () => {
    // Record with status: 'blocked' (e.g. stage failed/reconciliation required)
    saveOperationRecord(tempRepoRoot, {
      operationId: 'op-finish-blocked',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      status: 'blocked',
      resolvedInputs: {},
      operations: [
        { id: 'update-task', status: 'unknown' },
      ],
    });

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.outcome, 'recovery-required');
    assert.equal(result.settled, false);
    assert.equal(result.reason, 'in-flight-finish-operation');
  });

  test('Active attempt left unfinished produces outcome: resumable regardless of in-scope dirty files (AC4)', async () => {
    // Set workflow_progress.state = 'active'
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml'), `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: active
      history: []
`, 'utf8');

    // Create in-scope dirty file
    const featDir = path.join(tempRepoRoot, 'src', 'feature');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, 'code.js'), '// dirty WIP');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    assert.equal(result.outcome, 'resumable');
    assert.equal(result.settled, false);
    assert.equal(result.reason, 'task-active');
    assert.ok(result.dirtyPaths.some(p => p.includes('code.js')));
  });

  test('Pre-activation remediation turn ending without activating produces outcome: resumable (AC5)', async () => {
    // Task waiting-for-step-start or ready (never activated)
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml'), `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: waiting-for-step-start
      history: []
`, 'utf8');

    // Create in-scope dirty file (the pre-existing activation blocker)
    const featDir = path.join(tempRepoRoot, 'src', 'feature');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, 'code.js'), '// dirty blocker');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
      preActivationBlocker: true,
    });

    assert.equal(result.outcome, 'resumable');
    assert.equal(result.settled, false);
    assert.ok(result.dirtyPaths.some(p => p.includes('code.js')));
  });

  test('Genuinely advanced attempt produces outcome: completed (AC6)', async () => {
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml'), `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: completed
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: completed
      history:
        - step: implement
          attempt: 1
          transitioned_to: verified
`, 'utf8');
    git(tempRepoRoot, ['commit', '-am', 'Task completed']);

    // 1. Clean worktree -> settled: true, outcome: 'completed'

    const cleanResult = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });
    assert.equal(cleanResult.outcome, 'completed');
    assert.equal(cleanResult.settled, true);

    // 2. In-scope dirty files -> settled: false, reason: 'dirty-in-scope-files', outcome: 'completed'
    const featDir = path.join(tempRepoRoot, 'src', 'feature');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, 'code.js'), '// dirty uncommitted after finish');

    const dirtyResult = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });
    assert.equal(dirtyResult.outcome, 'completed');
    assert.equal(dirtyResult.settled, false);
    assert.equal(dirtyResult.reason, 'dirty-in-scope-files');
    assert.ok(dirtyResult.dirtyPaths.some(p => p.includes('code.js')));
  });

  test('Byte-for-byte non-mutation across all three resumable sub-cases (AC7)', async () => {
    const changeYamlPath = path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml');

    // Sub-case 1: Active mid-flight
    fs.writeFileSync(changeYamlPath, `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: active
      history: []
`, 'utf8');
    const beforeYamlSub1 = fs.readFileSync(changeYamlPath, 'utf8');
    const resSub1 = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });
    assert.equal(resSub1.outcome, 'resumable');
    const afterYamlSub1 = fs.readFileSync(changeYamlPath, 'utf8');
    assert.equal(afterYamlSub1, beforeYamlSub1, 'workflow_progress must be byte-for-byte identical after classification');

    // Sub-case 2: Pre-activation remediation never activated
    fs.writeFileSync(changeYamlPath, `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-progress
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: waiting-for-step-start
      history: []
`, 'utf8');
    const beforeYamlSub2 = fs.readFileSync(changeYamlPath, 'utf8');
    const resSub2 = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
      neverActivated: true,
    });
    assert.equal(resSub2.outcome, 'resumable');
    const afterYamlSub2 = fs.readFileSync(changeYamlPath, 'utf8');
    assert.equal(afterYamlSub2, beforeYamlSub2, 'workflow_progress must be byte-for-byte identical for never-activated');

    // Sub-case 3: Replayable finish-operation left behind
    const replayRecord = {
      operationId: 'op-subcase-3',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implement',
      attempt: 1,
      status: 'running',
      resolvedInputs: { key: 'val3' },
      operations: [
        { id: 'verify-gates', status: 'completed' },
      ],
    };
    saveOperationRecord(tempRepoRoot, replayRecord);
    const beforeYamlSub3 = fs.readFileSync(changeYamlPath, 'utf8');
    const resSub3 = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });
    assert.equal(resSub3.outcome, 'resumable');
    const afterYamlSub3 = fs.readFileSync(changeYamlPath, 'utf8');
    assert.equal(afterYamlSub3, beforeYamlSub3);
    const loadedRecord = loadOperationRecord(tempRepoRoot, 'demo-change', 'demo-task', 'implement', 1);
    assert.deepEqual(loadedRecord, replayRecord, 'durable operation record must be unchanged');
  });

  test('Out-of-scope and forbidden_paths dirty files are reported as non-blocking diagnostics (AC8)', async () => {
    // Modify task in completed state
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'change.yaml'), `schema_version: '1.0'
id: demo-change
title: Demo Change
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: completed
    workflow_progress:
      current_step: implement
      current_attempt: 1
      state: completed
      history: []
`, 'utf8');
    fs.writeFileSync(path.join(tempRepoRoot, 'specs', 'active', 'demo-change', 'tasks', '01-demo-task.md'), `---
id: demo-task
status: completed
allowed_paths:
  - src/feature/**
forbidden_paths:
  - src/forbidden/**
---
# Demo Task
`, 'utf8');
    git(tempRepoRoot, ['commit', '-am', 'Update change.yaml and task to completed with forbidden_paths']);

    // Create tracked dirty file outside scope in docs/
    const docsDir = path.join(tempRepoRoot, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const docsFile = path.join(docsDir, 'guide.md');
    fs.writeFileSync(docsFile, '# Guide', 'utf8');
    git(tempRepoRoot, ['add', 'docs/guide.md']);
    git(tempRepoRoot, ['commit', '-m', 'Add guide']);
    fs.writeFileSync(docsFile, '# Guide modified', 'utf8');

    // Create untracked/dirty file matching forbidden_paths (src/forbidden/**)
    const forbiddenDir = path.join(tempRepoRoot, 'src', 'forbidden');
    fs.mkdirSync(forbiddenDir, { recursive: true });
    const forbiddenFile = path.join(forbiddenDir, 'secret.js');
    fs.writeFileSync(forbiddenFile, '// secret code', 'utf8');
    git(tempRepoRoot, ['add', 'src/forbidden/secret.js']);
    git(tempRepoRoot, ['commit', '-m', 'Add forbidden file']);
    fs.writeFileSync(forbiddenFile, '// forbidden edit', 'utf8');

    const result = await assessExecutionSettlement({
      repoRoot: tempRepoRoot,
      changeSlug: 'demo-change',
      taskId: 'demo-task',
    });

    // In-scope is clean, so outcome is completed and settled is true
    assert.equal(result.outcome, 'completed');
    assert.equal(result.settled, true);

    // Diagnostics attached
    assert.ok(Array.isArray(result.outOfScopeDirtyPaths));
    assert.ok(result.outOfScopeDirtyPaths.some(p => p.includes('docs/guide.md')));
    assert.ok(result.outOfScopeDirtyPaths.some(p => p.includes('src/forbidden/secret.js')));
    assert.ok(Array.isArray(result.forbiddenDirtyPaths));
    assert.ok(result.forbiddenDirtyPaths.some(p => p.includes('src/forbidden/secret.js')));
  });
});

