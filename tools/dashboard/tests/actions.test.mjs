import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  executeSpecificationAction,
  loadSpecificationActions,
  SpecificationActionError,
} from '../server/actions.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../../specs/fingerprint.mjs';

function fixture() {
  const root = join(tmpdir(), `nevo-dashboard-actions-${process.pid}-${Date.now()}-${Math.random()}`);
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'sample');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: sample',
    'title: Sample',
    'status: draft',
    'tasks:',
    '  - id: design-task',
    '    order: 1',
    '    file: tasks/01-design-task.md',
    '    status: draft',
    '  - id: implemented-task',
    '    order: 2',
    '    file: tasks/02-implemented-task.md',
    '    status: implemented',
    '',
  ].join('\n'));
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  writeFileSync(join(changeDir, 'overview.md'), '# Overview\n\nSample goal');
  writeFileSync(join(changeDir, 'tasks', '01-design-task.md'), '# Design Task\n\nContent');
  writeFileSync(join(changeDir, 'tasks', '02-implemented-task.md'), '# Implemented Task\n\nContent');

  const changeObj = {
    _dir: changeDir,
    tasks: [
      { id: 'design-task', file: 'tasks/01-design-task.md', status: 'draft' },
      { id: 'implemented-task', file: 'tasks/02-implemented-task.md', status: 'implemented' },
    ],
  };
  const fingerprint = computeChangeFingerprint(changeObj);
  const taskFingerprint = computeTaskFingerprint(changeObj, 'design-task');
  mkdirSync(join(changeDir, 'reviews'), { recursive: true });
  writeFileSync(join(changeDir, 'reviews', 'spec.md'), [
    '---',
    'verdict: ready-for-approval',
    `spec_fingerprint: ${fingerprint}`,
    'unresolved_required_fixes: 0',
    'unresolved_owner_decisions: 0',
    'unresolved_needs_clarification: 0',
    'task_fingerprints:',
    `  design-task: ${taskFingerprint}`,
    '---',
    '',
    '# Spec Review',
  ].join('\n'));

  return { root, activeDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('projects contextual task gates, finalize validation, and worktree state for an active specification', async () => {
  const sample = fixture();
  try {
    const payload = await loadSpecificationActions({
      slug: 'sample',
      activeDir: sample.activeDir,
      root: sample.root,
      worktreeLoader: () => ({ clean: false, total: 2, staged: 1, unstaged: 1, untracked: 0, files: [] }),
      branchLoader: () => 'feature/sample',
      trackingLoader: () => ({ hasUpstream: true, ahead: 0, behind: 0 }),
    });

    assert.equal(payload.source, 'active');
    assert.equal(payload.tasks['design-task'].action, 'approve');
    assert.equal(payload.tasks['implemented-task'].action, 'verify');
    assert.equal(payload.tasks['implemented-task'].enabled, true);
    assert.equal(payload.tasks['implemented-task'].reason, null);
    assert.equal(payload.finalize.enabled, false); // tasks are not all verified yet
    assert.deepEqual(payload.worktree, {
      clean: false, total: 2, staged: 1, unstaged: 1, untracked: 0, files: [],
      branch: 'feature/sample', hasUpstream: true, ahead: 0, behind: 0,
    });
  } finally {
    sample.cleanup();
  }
});

test('production-path in-process action execution uses shared application operation, emits progress to OperationRuntime, and completes without spawning CLI', async () => {
  const sample = fixture();
  const recordedEvents = [];
  let runtimeResult = null;

  let resolveDone;
  const donePromise = new Promise(resolve => { resolveDone = resolve; });

  const runtime = {
    createOperation: () => 'op-prod-1',
    recordEvent: (id, event) => { recordedEvents.push(event); },
    completeOperation: (id, result) => {
      runtimeResult = { status: 'completed', result };
      resolveDone();
    },
    failOperation: (id, error) => {
      runtimeResult = { status: 'failed', error };
      resolveDone();
    },
  };

  try {
    const result = executeSpecificationAction({
      slug: 'sample',
      action: 'approve',
      taskId: 'design-task',
      activeDir: sample.activeDir,
      root: sample.root,
      operationRuntime: runtime,
    });

    assert.equal(result.ok, true);
    assert.equal(result.operationId, 'op-prod-1');

    await donePromise;

    assert.equal(runtimeResult?.status, 'completed', JSON.stringify(runtimeResult));
    assert.equal(runtimeResult?.result?.ok, true);
    assert.ok(runtimeResult?.result?.summary, 'result object includes domain summary');
    assert.ok(recordedEvents.length > 0, 'progress events recorded in OperationRuntime');
    assert.ok(recordedEvents.some(e => e.type === 'operation.step.started'));
    assert.ok(recordedEvents.some(e => e.type === 'operation.step.completed'));
    // Ensure operation.completed was not directly forwarded to recordEvent
    assert.equal(recordedEvents.some(e => e.type === 'operation.completed'), false);
    assert.equal(recordedEvents.some(e => e.type === 'operation.failed'), false);
  } finally {
    sample.cleanup();
  }
});

test('in-process action execution records failure in OperationRuntime on error and terminates exactly once', async () => {
  const sample = fixture();
  let terminationCount = 0;
  let runtimeResult = null;
  let onFinishedCallCount = 0;

  const runtime = {
    createOperation: () => 'op-fail-1',
    recordEvent: () => {},
    completeOperation: (id, result) => {
      terminationCount++;
      runtimeResult = { status: 'completed', result };
    },
    failOperation: (id, error) => {
      terminationCount++;
      runtimeResult = { status: 'failed', error };
    },
  };

  try {
    const result = executeSpecificationAction({
      slug: 'sample',
      action: 'verify',
      taskId: 'design-task', // draft task cannot be verified -> throws gate error
      activeDir: sample.activeDir,
      root: sample.root,
      operationRuntime: runtime,
      onFinished: () => {
        onFinishedCallCount++;
      },
    });

    assert.equal(result.ok, true);
    assert.ok(result.completion && typeof result.completion.then === 'function', 'result provides completion Promise');

    await result.completion;

    assert.equal(terminationCount, 1, 'OperationRuntime terminated exactly once on failure');
    assert.equal(onFinishedCallCount, 1, 'onFinished was called exactly once on failure');
    assert.equal(runtimeResult?.status, 'failed');
    assert.ok(runtimeResult?.error, 'OperationRuntime received failure error');
  } finally {
    sample.cleanup();
  }
});

test('revalidates owner actions and requires finalize confirmation', () => {
  const sample = fixture();
  try {
    assert.throws(() => executeSpecificationAction({
      slug: 'sample', action: 'finalize', confirmed: false,
      activeDir: sample.activeDir, root: sample.root,
    }), error => error instanceof SpecificationActionError && error.status === 400);
  } finally {
    sample.cleanup();
  }
});

test('dashboard server code does not import tools/specs.mjs and has no obsolete CLI subprocess spawner', () => {
  const actionsSrc = readFileSync(new URL('../server/actions.mjs', import.meta.url), 'utf8');
  assert.equal(actionsSrc.includes("from '../../specs.mjs'"), false);
  assert.equal(actionsSrc.includes('from "../../specs.mjs"'), false);
  assert.equal(actionsSrc.includes("from '../specs.mjs'"), false);
  assert.equal(actionsSrc.includes('from "../specs.mjs"'), false);
  assert.equal(actionsSrc.includes('defaultSpecsSpawner'), false);
  assert.equal(actionsSrc.includes('spawnSpecs'), false);
});
