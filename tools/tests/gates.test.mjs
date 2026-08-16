import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateGate,
  gateDefinitions,
  validatorRegistry,
  registerValidator,
  actionDefinitions,
} from '../specs/gates.mjs';

test('Generic Gate Evaluator & Registry', async (t) => {
  await t.test('registerValidator registers building blocks with cost metadata', () => {
    registerValidator('custom-cheap-check', {
      cost: 'cheap',
      validate: (ctx) => ctx.allowCheap ? { ok: true } : { ok: false, reason: 'Cheap check failed.' },
    });
    registerValidator('custom-expensive-check', {
      cost: 'expensive',
      validate: (ctx) => ctx.allowExpensive ? { ok: true } : { ok: false, reason: 'Expensive check failed.' },
    });

    assert.ok(validatorRegistry.has('custom-cheap-check'));
    assert.equal(validatorRegistry.get('custom-cheap-check').cost, 'cheap');
    assert.ok(validatorRegistry.has('custom-expensive-check'));
    assert.equal(validatorRegistry.get('custom-expensive-check').cost, 'expensive');

    assert.throws(() => registerValidator('bad-cost', { cost: 'medium', validate: () => {} }), /Invalid validator cost/);
  });

  await t.test('evaluates fast mode: runs cheap validators and skips expensive validators', () => {
    gateDefinitions['test-composite-gate'] = {
      validators: ['custom-cheap-check', 'custom-expensive-check'],
    };

    // When cheap passes, fast mode returns needs-full-check
    const fastPassed = evaluateGate('test-composite-gate', { allowCheap: true, allowExpensive: false }, { mode: 'fast' });
    assert.equal(fastPassed.status, 'needs-full-check');
    assert.equal(fastPassed.ok, false);
    assert.equal(fastPassed.validations.length, 2);
    assert.equal(fastPassed.validations[0].id, 'custom-cheap-check');
    assert.equal(fastPassed.validations[0].status, 'passed');
    assert.equal(fastPassed.validations[1].id, 'custom-expensive-check');
    assert.equal(fastPassed.validations[1].status, 'skipped');
    assert.equal(fastPassed.validations[1].reason, 'expensive');

    // When cheap fails, fast mode immediately returns blocked
    const fastBlocked = evaluateGate('test-composite-gate', { allowCheap: false, allowExpensive: true }, { mode: 'fast' });
    assert.equal(fastBlocked.status, 'blocked');
    assert.equal(fastBlocked.ok, false);
    assert.equal(fastBlocked.reason, 'Cheap check failed.');
    assert.equal(fastBlocked.validations.length, 1);
    assert.equal(fastBlocked.validations[0].id, 'custom-cheap-check');
    assert.equal(fastBlocked.validations[0].status, 'failed');
  });

  await t.test('evaluates full mode: executes all validators and returns allowed or blocked', () => {
    // Both pass
    const fullAllowed = evaluateGate('test-composite-gate', { allowCheap: true, allowExpensive: true }, { mode: 'full' });
    assert.equal(fullAllowed.status, 'allowed');
    assert.equal(fullAllowed.ok, true);
    assert.equal(fullAllowed.validations.length, 2);
    assert.equal(fullAllowed.validations[0].status, 'passed');
    assert.equal(fullAllowed.validations[1].status, 'passed');

    // Expensive fails
    const fullBlocked = evaluateGate('test-composite-gate', { allowCheap: true, allowExpensive: false }, { mode: 'full' });
    assert.equal(fullBlocked.status, 'blocked');
    assert.equal(fullBlocked.ok, false);
    assert.equal(fullBlocked.reason, 'Expensive check failed.');
    assert.equal(fullBlocked.validations.length, 2);
    assert.equal(fullBlocked.validations[1].status, 'failed');
  });

  await t.test('actionDefinitions exposes declarative gate mappings and step recipes', () => {
    assert.ok(actionDefinitions.finalize);
    assert.equal(actionDefinitions.finalize.gate, 'finalize');
    assert.ok(Array.isArray(actionDefinitions.finalize.steps));

    assert.ok(actionDefinitions.complete);
    assert.equal(actionDefinitions.complete.gate, 'task.request-human-verification');
  });
});

test('SSOT Finalize Gate — fast mode on dashboard vs full mode on execution', async (t) => {
  const validChange = {
    id: 'test-change',
    tasks: [
      { id: 'task-1', status: 'verified' },
      { id: 'task-2', status: 'verified' },
    ],
  };

  const validFacts = {
    change: validChange,
    worktree: { clean: true },
    branch: { hasUpstream: true, ahead: 0, behind: 0 },
    ghAvailable: true,
    pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
    verification: [{ name: 'specs validate', passed: true }],
    openBlockingFollowUps: [],
  };

  await t.test('fast mode on valid local state returns needs-full-check', () => {
    const res = evaluateGate('finalize', validFacts, { mode: 'fast' });
    assert.equal(res.status, 'needs-full-check');
    assert.equal(res.validations.filter(v => v.status === 'passed').length, 6); // cheap checks
    assert.equal(res.validations.filter(v => v.status === 'skipped').length, 5); // expensive checks (PR, checks)
  });

  await t.test('fast mode on dirty working tree returns blocked immediately', () => {
    const dirtyFacts = { ...validFacts, worktree: { clean: false } };
    const res = evaluateGate('finalize', dirtyFacts, { mode: 'fast' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.reason, 'Working tree has uncommitted changes. Commit or discard them first.');
  });

  await t.test('fast mode on non-terminal tasks returns blocked immediately', () => {
    const nonTerminalFacts = {
      ...validFacts,
      change: {
        id: 'test-change',
        tasks: [
          { id: 'task-1', status: 'in-implementation' },
          { id: 'task-2', status: 'verified' },
        ],
      },
    };
    const res = evaluateGate('finalize', nonTerminalFacts, { mode: 'fast' });
    assert.equal(res.status, 'blocked');
    assert.ok(res.reason.includes('Task(s) not in a terminal status'));
  });

  await t.test('full mode on valid facts returns allowed', () => {
    const res = evaluateGate('finalize', validFacts, { mode: 'full' });
    assert.equal(res.status, 'allowed');
    assert.equal(res.ok, true);
    assert.equal(res.validations.length, 11);
    assert.ok(res.validations.every(v => v.status === 'passed'));
  });

  await t.test('full mode with unresolved PR review threads returns blocked', () => {
    const threadFacts = {
      ...validFacts,
      pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 3 },
    };
    const res = evaluateGate('finalize', threadFacts, { mode: 'full' });
    assert.equal(res.status, 'blocked');
    assert.ok(res.reason.includes('3 unresolved review thread(s)'));
  });
});

test('Task Request Human Verification Gate (task.request-human-verification)', async (t) => {
  await t.test('allows transition from in-implementation when self-check is not failing', () => {
    const context = {
      task: { id: 'task-1', status: 'in-implementation', self_check: { status: 'passed' } },
      change: { id: 'test-change', tasks: [] },
      inActiveBatch: false,
    };
    const res = evaluateGate('task.request-human-verification', context, { mode: 'full' });
    assert.equal(res.status, 'allowed');
    assert.equal(res.ok, true);
  });

  await t.test('blocks transition when task is not in in-implementation status', () => {
    const context = {
      task: { id: 'task-1', status: 'draft' },
      change: { id: 'test-change', tasks: [] },
      inActiveBatch: false,
    };
    const res = evaluateGate('task.request-human-verification', context, { mode: 'full' });
    assert.equal(res.status, 'blocked');
    assert.ok(res.reason.includes("Task has status 'draft' — 'complete' requires status 'in-implementation'"));
  });

  await t.test('blocks transition when task has failing self-check (hard-stop)', () => {
    const context = {
      task: {
        id: 'task-1',
        status: 'in-implementation',
        self_check: { status: 'failed', failed_criteria: ['unit tests failed'] },
      },
      change: { id: 'test-change', tasks: [] },
      inActiveBatch: false,
    };
    const res = evaluateGate('task.request-human-verification', context, { mode: 'full' });
    assert.equal(res.status, 'blocked');
    assert.ok(res.reason.includes('has a hard-stopped self-check'));
  });
});
