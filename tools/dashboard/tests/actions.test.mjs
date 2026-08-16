import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  executeSpecificationAction,
  loadSpecificationActions,
  SpecificationActionError,
} from '../server/actions.mjs';
import { buildProgram } from '../../specs.mjs';

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
  return { root, activeDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function successfulRunner(calls) {
  return (_root, args) => {
    calls.push(args);
    if (args.includes('--check') && args[0] === 'finalize') {
      return JSON.stringify({
        facts: {
          branch: { hasUpstream: true, ahead: 0, behind: 0 },
          pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
          verification: [{ name: 'specs validate', passed: true }],
        },
        result: { ok: true, idempotent: false },
      });
    }
    if (args.includes('--check')) {
      return JSON.stringify({ result: { ok: true, idempotent: false } });
    }
    return 'ok';
  };
}

test('projects contextual task gates, finalize validation, and worktree state for an active specification', () => {
  const sample = fixture();
  const calls = [];
  try {
    const payload = loadSpecificationActions({
      slug: 'sample',
      activeDir: sample.activeDir,
      root: sample.root,
      runSpecs: successfulRunner(calls),
      worktreeLoader: () => ({ clean: false, total: 2, staged: 1, unstaged: 1, untracked: 0, files: [] }),
      branchLoader: () => 'feature/sample',
      trackingLoader: () => ({ hasUpstream: true, ahead: 0, behind: 0 }),
    });

    assert.equal(payload.source, 'active');
    assert.deepEqual(payload.tasks['design-task'], { action: 'approve', enabled: true, reason: null });
    assert.deepEqual(payload.tasks['implemented-task'], { action: 'verify', enabled: true, reason: null });
    assert.equal(payload.finalize.enabled, false); // tasks are not all verified yet
    assert.deepEqual(payload.worktree, {
      clean: false, total: 2, staged: 1, unstaged: 1, untracked: 0, files: [],
      branch: 'feature/sample', hasUpstream: true, ahead: 0, behind: 0,
    });
    assert.ok(calls.some(args => args.join(' ') === 'approve sample design-task --check'));
    assert.ok(calls.some(args => args.join(' ') === 'verify sample implemented-task --check'));
    assert.ok(!calls.some(args => args[0] === 'finalize'), 'must not run heavy finalize check during GET /actions');
  } finally {
    sample.cleanup();
  }
});

test('revalidates owner actions, requires finalize confirmation, and invokes the existing CLI flow', () => {
  const sample = fixture();
  const calls = [];
  const runSpecs = successfulRunner(calls);
  try {
    const approved = executeSpecificationAction({
      slug: 'sample', action: 'approve', taskId: 'design-task',
      activeDir: sample.activeDir, root: sample.root, runSpecs,
    });
    assert.equal(approved.ok, true);
    assert.ok(calls.some(args => args.join(' ') === 'approve sample design-task'));

    assert.throws(() => executeSpecificationAction({
      slug: 'sample', action: 'finalize', confirmed: false,
      activeDir: sample.activeDir, root: sample.root, runSpecs,
    }), error => error instanceof SpecificationActionError && error.status === 400);

    const finalized = executeSpecificationAction({
      slug: 'sample', action: 'finalize', confirmed: true,
      activeDir: sample.activeDir, root: sample.root, runSpecs,
    });
    assert.equal(finalized.ok, true);
    assert.ok(calls.some(args => args.join(' ') === 'finalize sample'));
  } finally {
    sample.cleanup();
  }
});

test('approve and verify expose read-only check flags for dashboard preflight', () => {
  const program = buildProgram();
  for (const name of ['approve', 'verify']) {
    const command = program.commands.find(candidate => candidate.name() === name);
    assert.ok(command);
    assert.match(command.helpInformation(), /--check/);
  }
});
