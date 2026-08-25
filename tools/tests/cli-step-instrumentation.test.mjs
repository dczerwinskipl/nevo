import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseProgressLine } from '../lib/operation-progress.mjs';
import { handleVerify, handleApprove, handleSelfCheck } from '../specs.mjs';
import { loadSpecificationActions } from '../dashboard/server/actions.mjs';
import { computeChangeFingerprint, computeTaskFingerprint, loadChange } from '../specs/service.mjs';

function fixture() {
  const root = join(tmpdir(), `nevo-cli-instrumentation-${process.pid}-${Date.now()}-${Math.random()}`);
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: test-change',
    'title: Test Change',
    'status: draft',
    'tasks:',
    '  - id: task-draft',
    '    order: 1',
    '    file: tasks/01-task-draft.md',
    '    status: draft',
    '  - id: task-impl',
    '    order: 2',
    '    file: tasks/02-task-impl.md',
    '    status: implemented',
    '',
  ].join('\n'));

  writeFileSync(join(tasksDir, '01-task-draft.md'), [
    '---',
    'id: test-change.task-draft',
    'status: draft',
    'change: test-change',
    '---',
    '# Task 1',
    '## Verification',
    '```text',
    'node -e "process.exit(0)"',
    'node -e "process.exit(1)"',
    '```',
  ].join('\n'));

  const change = loadChange('test-change', activeDir);
  const specFingerprint = computeChangeFingerprint(change);
  const taskFingerprint = computeTaskFingerprint(change, 'task-draft');

  mkdirSync(join(changeDir, 'reviews'), { recursive: true });
  writeFileSync(join(changeDir, 'reviews', 'spec.md'), [
    '---',
    'review-of: spec',
    'change: test-change',
    'verdict: ready-for-approval',
    'ready_for_approval: true',
    'implementation_allowed: false',
    'unresolved_required_fixes: 0',
    'unresolved_owner_decisions: 0',
    'unresolved_needs_clarification: 0',
    `spec_fingerprint: ${specFingerprint}`,
    'task_fingerprints:',
    `  task-draft: ${taskFingerprint}`,
    '---',
  ].join('\n'));

  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root });

  return { root, activeDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const lines = [];
  process.stdout.write = chunk => {
    lines.push(String(chunk));
    return true;
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        process.stdout.write = originalWrite;
      }).then(() => lines.flatMap(l => l.split('\n')).filter(Boolean));
    }
  } finally {
    process.stdout.write = originalWrite;
  }
  return lines.flatMap(l => l.split('\n')).filter(Boolean);
}

test('CLI step instrumentation — verify, approve, self-check', async (t) => {
  await t.test('AC3: handleVerify emits progress events and completes on valid transition', async () => {
    const sample = fixture();
    try {
      const output = await captureStdout(async () => {
        await handleVerify('test-change', 'task-impl', { activeDir: sample.activeDir, gitRoot: sample.root, git: false });
      });

      const events = output.map(parseProgressLine).filter(Boolean);
      assert.equal(events.length >= 4, true);

      assert.equal(events[0].type, 'operation.started');
      assert.equal(events[0].operationType, 'verify');

      assert.equal(events[1].type, 'operation.step.started');
      assert.equal(events[1].id, 'validate-transition');

      assert.equal(events[2].type, 'operation.step.completed');
      assert.equal(events[2].id, 'validate-transition');

      const completed = events.find(e => e.type === 'operation.completed');
      assert.ok(completed);
    } finally {
      sample.cleanup();
    }
  });

  await t.test('AC1 & AC2: handleSelfCheck emits step events per verification command and captures pass/fail outcomes', () => {
    const sample = fixture();
    try {
      const prevExit = process.exitCode;
      process.exitCode = 0;
      const output = captureStdout(() => {
        handleSelfCheck('test-change', 'task-draft', { activeDir: sample.activeDir, gitRoot: sample.root });
      });
      process.exitCode = prevExit;

      const events = output.map(parseProgressLine).filter(Boolean);
      assert.equal(events.length >= 6, true);

      assert.equal(events[0].type, 'operation.started');
      assert.equal(events[0].operationType, 'task-verification');
      assert.equal(events[0].totalSteps, 2);

      // Step 1: node -e "process.exit(0)"
      const s1Started = events.find(e => e.type === 'operation.step.started' && e.id === 'cmd-1');
      assert.ok(s1Started);
      const s1Completed = events.find(e => e.type === 'operation.step.completed' && e.id === 'cmd-1');
      assert.ok(s1Completed);

      // Step 2: node -e "process.exit(1)"
      const s2Started = events.find(e => e.type === 'operation.step.started' && e.id === 'cmd-2');
      assert.ok(s2Started);
      const s2Failed = events.find(e => e.type === 'operation.step.failed' && e.id === 'cmd-2');
      assert.ok(s2Failed);

      // Operation overall failed (AC2)
      const opFailed = events.find(e => e.type === 'operation.failed');
      assert.ok(opFailed);
    } finally {
      sample.cleanup();
    }
  });

  await t.test('AC4: handleApprove emits progress events and completes on approved transition', async () => {
    const sample = fixture();
    try {
      const output = await captureStdout(async () => {
        await handleApprove('test-change', 'task-draft', { activeDir: sample.activeDir, gitRoot: sample.root, git: false });
      });

      const events = output.map(parseProgressLine).filter(Boolean);
      assert.equal(events.length >= 2, true);
      assert.equal(events[0].type, 'operation.started');
      assert.equal(events[0].operationType, 'approve');
    } finally {
      sample.cleanup();
    }
  });

  await t.test('AC6 & AC8: loadSpecificationActions (GET /actions) emits no progress events and never calls finalize --check', async () => {
    const sample = fixture();
    try {
      const calls = [];
      const output = await captureStdout(async () => {
        const payload = await loadSpecificationActions({
          slug: 'test-change',
          activeDir: sample.activeDir,
          root: sample.root,
          runSpecs: (_root, args) => { calls.push(args); return JSON.stringify({ result: { ok: true } }); },
          worktreeLoader: () => ({ clean: true }),
          branchLoader: () => 'feature/test-change',
          trackingLoader: () => ({ hasUpstream: true, ahead: 0, behind: 0 }),
        });
        assert.ok(payload);
        assert.equal(payload.slug, 'test-change');
      });

      const events = output.map(parseProgressLine).filter(Boolean);
      assert.equal(events.length, 0, 'GET /actions must never emit step events');
      assert.ok(!calls.some(args => args[0] === 'finalize'), 'GET /actions must never invoke finalize');
    } finally {
      sample.cleanup();
    }
  });
});
