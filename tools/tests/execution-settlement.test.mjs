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
import { saveOperationRecord } from '../specs/workflow/operation-record.mjs';

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
  });
});
