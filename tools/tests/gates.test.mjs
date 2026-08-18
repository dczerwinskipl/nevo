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
    assert.equal(res.validations.filter(v => v.status === 'passed').length, 5); // cheap checks
    assert.equal(res.validations.filter(v => v.status === 'skipped').length, 6); // expensive checks (gh-available, PR, checks)
  });

  await t.test('fast mode with missing upstream facts returns needs-full-check and never fabricates passed status', () => {
    // Context with only cheap facts (no ghAvailable, no pr, no verification)
    const partialContext = {
      change: validFacts.change,
      worktree: { clean: true },
      branch: { hasUpstream: true, ahead: 0, behind: 0 },
      openBlockingFollowUps: [],
    };
    const res = evaluateGate('finalize', partialContext, { mode: 'fast' });
    assert.equal(res.status, 'needs-full-check');
    const skipped = res.validations.filter(v => v.status === 'skipped');
    assert.equal(skipped.length, 6);
    assert.ok(skipped.some(v => v.id === 'gh-available'));
    assert.ok(skipped.some(v => v.id === 'pr-exists'));
  });

  await t.test('full mode with missing ghAvailable fact fails safely without guessing true', () => {
    const missingGhFacts = { ...validFacts, ghAvailable: undefined, facts: {} };
    const res = evaluateGate('finalize', missingGhFacts, { mode: 'full' });
    assert.equal(res.status, 'blocked');
    assert.ok(res.reason.includes('gh CLI availability was not checked'));
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

test('Task Verify Gate (task.verify)', async (t) => {
  await t.test('allows verify when task status is implemented', () => {
    const context = {
      task: { id: 'task-1', status: 'implemented' },
      change: { id: 'test-change', tasks: [] },
    };
    const res = evaluateGate('task.verify', context, { mode: 'full' });
    assert.equal(res.status, 'allowed');
    assert.equal(res.ok, true);
    assert.equal(res.idempotent, false);
  });

  await t.test('treats verify as idempotent when task is already verified', () => {
    const context = {
      task: { id: 'task-1', status: 'verified' },
      change: { id: 'test-change', tasks: [] },
    };
    const res = evaluateGate('task.verify', context, { mode: 'full' });
    assert.equal(res.status, 'allowed');
    assert.equal(res.ok, true);
    assert.equal(res.idempotent, true);
  });

  await t.test('blocks verify when task is in draft or in-implementation', () => {
    const draftContext = {
      task: { id: 'task-1', status: 'draft' },
      change: { id: 'test-change', tasks: [] },
    };
    const draftRes = evaluateGate('task.verify', draftContext, { mode: 'full' });
    assert.equal(draftRes.status, 'blocked');
    assert.equal(draftRes.ok, false);
    assert.ok(draftRes.reason.includes("Task has status 'draft' — 'verify' requires status 'implemented'"));

    const implContext = {
      task: { id: 'task-1', status: 'in-implementation' },
      change: { id: 'test-change', tasks: [] },
    };
    const implRes = evaluateGate('task.verify', implContext, { mode: 'full' });
    assert.equal(implRes.status, 'blocked');
    assert.equal(implRes.ok, false);
    assert.ok(implRes.reason.includes("Task has status 'in-implementation' — 'verify' requires status 'implemented'"));
  });

  await t.test('blocks verify when self_check is failing or revision predates implementation', () => {
    const failedSelfCheckContext = {
      task: {
        id: 'task-1',
        status: 'implemented',
        self_check: { status: 'failed', revision: 'rev-2', fingerprint: 'fp-1' },
      },
      change: { id: 'test-change', tasks: [] },
    };
    const failedRes = evaluateGate('task.verify', failedSelfCheckContext, { mode: 'full' });
    assert.equal(failedRes.status, 'blocked');
    assert.equal(failedRes.ok, false);
    assert.ok(failedRes.reason.includes("self-check status is 'failed'"));

    const staleRevisionContext = {
      task: {
        id: 'task-1',
        status: 'implemented',
        implementation: {
          baseline_revision: 'sha-base',
          review_revision: 'sha-review',
          changed_paths: ['file-a.mjs'],
        },
        self_check: { status: 'passed', revision: 'sha-base', fingerprint: 'fp-1' },
      },
      change: { id: 'test-change', tasks: [] },
    };
    const staleRes = evaluateGate('task.verify', staleRevisionContext, { mode: 'full' });
    assert.equal(staleRes.status, 'blocked');
    assert.equal(staleRes.ok, false);
    assert.ok(staleRes.reason.includes("matches baseline_revision and predates task implementation"));

    const validFreshContext = {
      task: {
        id: 'task-1',
        status: 'implemented',
        implementation: {
          baseline_revision: 'sha-base',
          review_revision: 'sha-review',
          changed_paths: ['file-a.mjs'],
        },
        self_check: { status: 'passed', revision: 'sha-review', fingerprint: 'fp-1' },
      },
      change: { id: 'test-change', tasks: [] },
    };
    const validRes = evaluateGate('task.verify', validFreshContext, { mode: 'full' });
    assert.equal(validRes.status, 'allowed');
    assert.equal(validRes.ok, true);
  });
});

test('Architecture: Unidirectional Lifecycle & Gate Dependencies', async (t) => {
  await t.test('gates.mjs does not import lifecycle.mjs (no circular dependencies)', async () => {
    const { readFileSync } = await import('node:fs');
    const gatesSource = readFileSync(new URL('../specs/gates.mjs', import.meta.url), 'utf8');
    const primitivesSource = readFileSync(new URL('../specs/lifecycle-primitives.mjs', import.meta.url), 'utf8');

    // gates.mjs must only import primitives, never lifecycle.mjs
    assert.doesNotMatch(gatesSource, /from\s+['"]\.\/lifecycle\.mjs['"]/);
    assert.match(gatesSource, /from\s+['"]\.\/lifecycle-primitives\.mjs['"]/);

    // lifecycle-primitives.mjs must not import gates.mjs or lifecycle.mjs
    assert.doesNotMatch(primitivesSource, /from\s+['"]\.\/gates\.mjs['"]/);
    assert.doesNotMatch(primitivesSource, /from\s+['"]\.\/lifecycle\.mjs['"]/);
  });
});
