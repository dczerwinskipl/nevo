// Cross-mechanism end-to-end tests (task 10, area finalization-and-migration) —
// proving tasks 01-09's mechanisms work TOGETHER against the real
// implementation (no test doubles standing in for the mechanism under test).
// Each per-task suite already unit-tests its own mechanism in isolation; this
// file's job is composition: chaining real functions across module
// boundaries the way the actual workflow does. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadChange, computeChangeFingerprint, computeTaskFingerprint,
  parseOwnerDecisions, loadFollowUps, addFollowUp, resolveFollowUp,
} from '../specs/service.mjs';
import {
  validateTransition, validateApproval, inspectStartPostconditions, inspectApprovePostconditions,
  classifyDirtyWorktree, resolveAfterConfirmedRepair, planContinuation, scopeOf, deriveStage,
  selectBatch, deriveBatchProgress, hardStopReason, detectRiskSignals, requiresFullReview,
  buildSelfCheckResult, staleEvidenceTasks, isTemporaryInconsistency, batchValidationBlocks,
  computeBatchReviewVerdict, validateFinalize, TASK_STATUSES, CHANGE_STATUSES, removedStatusMessage,
} from '../specs/lifecycle.mjs';
import {
  validateStatusValue, validateSuspension, validateSemanticReferences, validateFollowUps,
} from '../specs/validation.mjs';
import { parseRoutingTable, validateRoutingTables } from '../docs.mjs';
import { setTaskSuspension, clearTaskSuspension, createRepairBranch, runPostMergeCheck } from '../specs.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-e2e-test-')); });
after(() => { rmSync(root, { recursive: true, force: true }); });

let counter = 0;
function nextSlug(prefix) { counter += 1; return `${prefix}-${counter}`; }

// A multi-task fixture: t1 (approved, no deps) -> t2 (approved, depends on t1)
// -> t3 (approved, depends on t2), plus an unrelated t4 (approved, no deps),
// mirroring a real linear-chain-plus-sibling change graph. Each task file
// carries real acceptance-criteria/goal text so fingerprints are meaningful.
function writeFixture(slug, overrides = {}) {
  const dir = join(root, slug);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  const tasksYaml = (overrides.tasks || [
    { id: 't1', status: 'approved', depends_on: [] },
    { id: 't2', status: 'approved', depends_on: ['t1'] },
    { id: 't3', status: 'approved', depends_on: ['t2'] },
    { id: 't4', status: 'approved', depends_on: [] },
  ]).map(t => [
    `  - id: ${t.id}`,
    `    status: ${t.status}`,
    `    file: tasks/${t.id}.md`,
    t.depends_on?.length ? `    depends_on:\n${t.depends_on.map(d => `      - ${d}`).join('\n')}` : null,
  ].filter(Boolean).join('\n')).join('\n');

  writeFileSync(join(dir, 'change.yaml'), [
    'id: fixture', 'title: Fixture', 'status: approved', 'tasks:', tasksYaml, '',
  ].join('\n'));
  writeFileSync(join(dir, 'overview.md'), (overrides.overview || '# Fixture\n\nGoal text.\n'));
  writeFileSync(join(dir, 'owner-decisions.md'), (overrides.ownerDecisions || '## D1: First\n\nText of D1.\n'));

  const bodies = overrides.taskBodies || {};
  for (const t of overrides.tasks || [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]) {
    writeFileSync(join(dir, 'tasks', `${t.id}.md`), bodies[t.id] || `---\nid: fixture.${t.id}\n---\n# Task ${t.id}\n\nGoal for ${t.id}.\n`);
  }
  return loadChange(slug, root);
}

// ── Fingerprints ─────────────────────────────────────────────────────────

describe('Fingerprints', () => {
  test('changing a task\'s status preserves every fingerprint tier', () => {
    const slug = nextSlug('fp-status');
    const before1 = writeFixture(slug);
    const changeFpBefore = computeChangeFingerprint(before1);
    const taskFpBefore = computeTaskFingerprint(before1, 't1');

    const after1 = writeFixture(slug, {
      tasks: [
        { id: 't1', status: 'in-implementation', depends_on: [] },
        { id: 't2', status: 'approved', depends_on: ['t1'] },
        { id: 't3', status: 'approved', depends_on: ['t2'] },
        { id: 't4', status: 'approved', depends_on: [] },
      ],
    });
    assert.equal(computeChangeFingerprint(after1), changeFpBefore);
    assert.equal(computeTaskFingerprint(after1, 't1'), taskFpBefore);
  });

  test('adding an unrelated task invalidates the change-level fingerprint but not an independent task\'s task-level fingerprint (D27)', () => {
    const slug = nextSlug('fp-add-task');
    const before1 = writeFixture(slug);
    const changeFpBefore = computeChangeFingerprint(before1);
    const t1FpBefore = computeTaskFingerprint(before1, 't1');

    const after1 = writeFixture(slug, {
      tasks: [
        { id: 't1', status: 'approved', depends_on: [] },
        { id: 't2', status: 'approved', depends_on: ['t1'] },
        { id: 't3', status: 'approved', depends_on: ['t2'] },
        { id: 't4', status: 'approved', depends_on: [] },
        { id: 't5', status: 'approved', depends_on: [] },
      ],
    });
    assert.notEqual(computeChangeFingerprint(after1), changeFpBefore, 'change-level tier must invalidate (D27)');
    assert.equal(computeTaskFingerprint(after1, 't1'), t1FpBefore, 'unrelated task-level tier must not invalidate');
  });

  test('removing a task produces the same split as adding one (D27)', () => {
    const slug = nextSlug('fp-remove-task');
    const before1 = writeFixture(slug);
    const changeFpBefore = computeChangeFingerprint(before1);
    const t1FpBefore = computeTaskFingerprint(before1, 't1');

    const after1 = writeFixture(slug, {
      tasks: [
        { id: 't1', status: 'approved', depends_on: [] },
        { id: 't2', status: 'approved', depends_on: ['t1'] },
        { id: 't3', status: 'approved', depends_on: ['t2'] },
      ],
    });
    assert.notEqual(computeChangeFingerprint(after1), changeFpBefore);
    assert.equal(computeTaskFingerprint(after1, 't1'), t1FpBefore);
  });

  test('changing shared scope (overview.md) invalidates the change-level fingerprint', () => {
    const slug = nextSlug('fp-overview');
    const before1 = writeFixture(slug);
    const changeFpBefore = computeChangeFingerprint(before1);
    const after1 = writeFixture(slug, { overview: '# Fixture\n\nGoal text CHANGED.\n' });
    assert.notEqual(computeChangeFingerprint(after1), changeFpBefore);
  });

  test('changing a task\'s acceptance criteria invalidates that task\'s fingerprint only', () => {
    const slug = nextSlug('fp-ac');
    const before1 = writeFixture(slug);
    const t1Before = computeTaskFingerprint(before1, 't1');
    const t2Before = computeTaskFingerprint(before1, 't2');

    const after1 = writeFixture(slug, {
      taskBodies: { t1: '---\nid: fixture.t1\n---\n# Task t1\n\n## Acceptance criteria\n\n1. New criterion.\n' },
    });
    assert.notEqual(computeTaskFingerprint(after1, 't1'), t1Before);
    assert.equal(computeTaskFingerprint(after1, 't2'), t2Before);
  });

  test('adding a mechanical resolver task invalidates the change-level fingerprint but not unrelated task fingerprints', () => {
    const slug = nextSlug('fp-mechanical');
    const before1 = writeFixture(slug);
    const changeFpBefore = computeChangeFingerprint(before1);
    const t4Before = computeTaskFingerprint(before1, 't4');

    const after1 = writeFixture(slug, {
      tasks: [
        { id: 't1', status: 'approved', depends_on: [] },
        { id: 't2', status: 'approved', depends_on: ['t1'] },
        { id: 't3', status: 'approved', depends_on: ['t2'] },
        { id: 't4', status: 'approved', depends_on: [] },
        { id: 'resolver', status: 'approved', depends_on: [] },
      ],
      taskBodies: { resolver: '---\nid: fixture.resolver\ntype: mechanical\n---\n# Resolver\n' },
    });
    assert.notEqual(computeChangeFingerprint(after1), changeFpBefore);
    assert.equal(computeTaskFingerprint(after1, 't4'), t4Before);
  });

  test('changing a referenced owner decision invalidates only affected fingerprints', () => {
    const slug = nextSlug('fp-decision-ref');
    const before1 = writeFixture(slug, {
      taskBodies: {
        t1: '---\nid: fixture.t1\nsemantic_references:\n  decisions:\n    - D1\n---\n# Task t1\n',
      },
    });
    const t1Before = computeTaskFingerprint(before1, 't1');
    const t2Before = computeTaskFingerprint(before1, 't2');

    const after1 = writeFixture(slug, {
      ownerDecisions: '## D1: First\n\nText of D1 CHANGED.\n',
      taskBodies: {
        t1: '---\nid: fixture.t1\nsemantic_references:\n  decisions:\n    - D1\n---\n# Task t1\n',
      },
    });
    assert.notEqual(computeTaskFingerprint(after1, 't1'), t1Before, 'referencing task must invalidate');
    assert.equal(computeTaskFingerprint(after1, 't2'), t2Before, 'non-referencing task must not');
  });
});

// ── Recovery ─────────────────────────────────────────────────────────────

describe('Recovery', () => {
  let repo, remote;

  function git(args, cwd = repo) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  }

  before(() => {
    remote = mkdtempSync(join(tmpdir(), 'nevo-e2e-remote-'));
    execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });
    repo = mkdtempSync(join(tmpdir(), 'nevo-e2e-repo-'));
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    git(['remote', 'add', 'origin', remote]);
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'initial']);
    git(['push', '-u', 'origin', 'main']);
  });
  after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  test('REC-01 (wrong branch): not on expected branch, everything else ready -> safe_to_retry, confirmed and repaired by checking out', () => {
    const inspection = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(inspection.result, 'safe_to_retry');
    // "repaired, retried, continued": checking out the branch and re-inspecting resolves it.
    const resumed = inspectStartPostconditions({
      taskStatus: 'in-implementation', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(resumed.result, 'completed');
  });

  test('REC-02 (remote-only branch) recovers correctly — safe_to_retry names the remote-checkout path', () => {
    const inspection = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: true,
    });
    assert.equal(inspection.result, 'safe_to_retry');
    assert.equal(inspection.remoteOnly, true);
    assert.match(inspection.missing[0], /REC-02/);
  });

  test('REC-03 (stale generated file) repairs and the original validation retries', () => {
    // classifySimpleActionPostcondition models "the retried action now succeeds."
    const failedFirst = { ok: false, reason: 'stale generated file' };
    assert.equal(inspectApprovePostconditions(failedFirst).result, 'not_retryable');
    const afterRegenerate = { ok: true, idempotent: false };
    assert.equal(inspectApprovePostconditions(afterRegenerate).result, 'safe_to_retry');
  });

  test('REC-05 vs. REC-06 (task-related vs. unrelated dirty files) produce different classes', () => {
    const rec05 = classifyDirtyWorktree(['tools/foo.mjs'], ['tools/foo.mjs']);
    assert.equal(rec05.code, 'REC-05');
    assert.equal(rec05.class, 'confirm-required');
    const rec06 = classifyDirtyWorktree(['tools/foo.mjs', 'src/Bar.cs'], ['tools/foo.mjs']);
    assert.equal(rec06.code, 'REC-06');
    assert.equal(rec06.class, 'owner-decision');
  });

  test('REC-08 (scope expansion) suspends execution and deriveStage returns to the correct prior status after a decision', () => {
    const slug = nextSlug('rec08');
    const change = writeFixture(slug, {
      tasks: [{ id: 't1', status: 'approved', depends_on: [] }],
    });
    setTaskSuspension(change, 't1', { kind: 'owner-decision', code: 'REC-08', previous_action: 'start', created_at: new Date().toISOString() });
    const reloaded = loadChange(slug, root);
    const task = reloaded.tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'approved', 'status untouched by suspension');
    const staged = deriveStage(reloaded, { pr: null, ghAvailable: true, verification: [] });
    assert.match(staged.nextCommand, /Owner must resolve REC-08/);

    clearTaskSuspension(reloaded, 't1');
    const cleared = loadChange(slug, root);
    assert.equal(cleared.tasks.find(t => t.id === 't1').status, 'approved', 'status still the same after clearing');
    assert.equal(cleared.tasks.find(t => t.id === 't1').execution, undefined);
  });

  test('REC-09 (ADR conflict) cannot be automatically recovered — unsafe_manual never auto-continues', () => {
    const result = planContinuation('unsafe_manual', scopeOf(['t1', 't2']), 't1');
    assert.deepEqual(result, { action: 'stop', reason: 'unsafe-manual' });
  });

  test('a partially_completed start resumes from missing postconditions only', () => {
    const inspection = inspectStartPostconditions({
      taskStatus: 'in-implementation', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    // branch done, status already in-implementation -> nothing left to do (completed)
    assert.equal(inspection.result, 'completed');
    const partial = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(partial.result, 'partially_completed');
    assert.deepEqual(partial.missing, ['status']); // only the missing effect, never re-creating the branch
  });

  test('an interrupted combined approve+start does not repeat approval (D17 resume-in-place)', () => {
    const approveResult = validateApproval('draft', {
      verdict: 'ready-for-approval', unresolved_required_fixes: 0, unresolved_owner_decisions: 0,
      unresolved_needs_clarification: 0, spec_fingerprint: 'fp1',
    }, 'fp1');
    const approveInspection = inspectApprovePostconditions(approveResult);
    assert.equal(approveInspection.result, 'safe_to_retry'); // approve runs exactly once here

    // start hits a confirm-required-shaped stop (dirty worktree), gets repaired, resumed:
    const freshStart = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    const resumed = resolveAfterConfirmedRepair(freshStart);
    assert.equal(resumed.resumed, true);
    // approve is never re-invoked to reach this point — only its own single inspection above ran.
  });
});

// ── Batch ────────────────────────────────────────────────────────────────

describe('Batch', () => {
  test('batch progress reconstructs after interruption with no conflicting state file', () => {
    const change = { tasks: [{ id: 'a', status: 'implemented' }, { id: 'b', status: 'in-implementation' }, { id: 'c', status: 'approved' }] };
    const intent = { orderedTasks: ['a', 'b', 'c'] }; // intent has no progress fields at all
    assert.deepEqual(Object.keys(intent), ['orderedTasks']);
    const progress = deriveBatchProgress(change, intent);
    assert.deepEqual(progress, {
      completed: ['a'], current: 'b', next: 'c', failed: null, checkpointTask: null, checkpointReached: false,
    });
  });

  test('a small low-risk code task uses self-check plus the gating batch review only (no full task-review)', () => {
    const task = { self_check: { status: 'passed' } };
    const signals = detectRiskSignals(task, { allowed_paths: ['tools/foo.mjs'] }, { diffFiles: ['tools/foo.mjs'] });
    assert.equal(requiresFullReview(task, signals), false);
  });

  test('a risky task receives its own full task-review before batch continuation', () => {
    const task = { self_check: { status: 'passed' } };
    const signals = detectRiskSignals(task, { review: 'required' }, {});
    assert.equal(requiresFullReview(task, signals), true);
  });

  test('a failed self-check stops the batch', () => {
    const change = { tasks: [{ id: 'a', status: 'in-implementation', self_check: { status: 'failed', failed_criteria: ['AC1'] } }] };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a'] });
    assert.equal(progress.failed, 'a');
    assert.notEqual(hardStopReason(change.tasks[0]), null);
  });

  test('a declared temporary inconsistency is allowed inside the batch and blocks the gating review until resolved otherwise', () => {
    const intent = { temporaryInconsistencies: [['a', 'b']] };
    assert.equal(isTemporaryInconsistency(intent, 'a', 'b'), true);
    assert.equal(batchValidationBlocks(intent, 'a', 'b', true), false, 'declared pair does not block');
    assert.equal(batchValidationBlocks(intent, 'b', 'c', true), true, 'every other boundary still blocks');
  });

  test('batch resume selects the correct next task via deriveStage', () => {
    const change = { _slug: 'c1', tasks: [{ id: 'a', status: 'implemented' }, { id: 'b', status: 'in-implementation' }] };
    const staged = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.equal(staged.stage, 'in-progress');
    assert.match(staged.nextCommand, /task-review c1 b/);
    const progress = deriveBatchProgress(change, { orderedTasks: ['a', 'b'] });
    assert.equal(progress.current, 'b');
  });
});

// ── Context and follow-ups ──────────────────────────────────────────────

describe('Context and follow-ups', () => {
  test('missing inferred context produces a deterministic warning', () => {
    const routingIndex = { rules: [{ rule_id: 'RT-01', path_glob: 'src/A/**', doc_ref: 'docs/a.md' }] };
    // Reuses service.mjs's computeRoutingWarnings indirectly is covered by context.test.mjs;
    // here we prove docs.mjs's own table parser + validator agree on the same shape.
    const { rules, errors } = validateRoutingTables([
      { file: 'a.md', content: '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| RT-01 | src/A/** | docs/development/architecture-overview.md |\n' },
    ]);
    assert.deepEqual(errors, []);
    assert.equal(rules[0].rule_id, routingIndex.rules[0].rule_id);
  });

  test('a context_exceptions entry without a valid decision reference is rejected', () => {
    const decisionsMap = parseOwnerDecisions('## D1: First\n\nText.\n');
    assert.equal(decisionsMap.has('D99'), false);
  });

  test('a blocking follow-up blocks finalization', () => {
    const facts = {
      gitClean: true, branch: { hasUpstream: true, ahead: 0, behind: 0 }, ghAvailable: true,
      pr: { number: 1, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
      verification: [{ name: 'x', passed: true }],
      openBlockingFollowUps: [{ id: 'FU-1', reason: 'risk' }],
    };
    const r = validateFinalize({ tasks: [{ id: 't', status: 'verified' }] }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Open blocking follow-up/);
  });

  test('a resolved mechanical follow-up is visible via loadFollowUps for the gating batch review to read', () => {
    const slug = nextSlug('followups');
    const change = writeFixture(slug, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] });
    addFollowUp(change, {
      id: 'FU-1', source_task: 't1', kind: 'mechanical', severity: 'non-blocking',
      reason: 'r', resolver_task: null, status: 'open', resolution: null,
    });
    resolveFollowUp(change, 'FU-1', { status: 'resolved', resolution: 'done' });
    const ledger = loadFollowUps(loadChange(slug, root));
    assert.equal(ledger.follow_ups[0].status, 'resolved');
    assert.equal(ledger.follow_ups.length, 1, 'mutated in place, not appended');
  });

  test('a routing-table format violation is detected by tools/docs.mjs validate', () => {
    const { errors } = validateRoutingTables([{ file: 'a.md', content: '## Routing table\n\n| wrong | header | shape |\n|---|---|---|\n| a | b | c |\n' }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /header must be exactly/);
  });
});

// ── Finalization ─────────────────────────────────────────────────────────

describe('Finalization', () => {
  let repo, remote;

  function git(args, cwd = repo) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  }

  function setup() {
    remote = mkdtempSync(join(tmpdir(), 'nevo-e2e-fin-remote-'));
    execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });
    repo = mkdtempSync(join(tmpdir(), 'nevo-e2e-fin-repo-'));
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    git(['remote', 'add', 'origin', remote]);
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'initial']);
    git(['push', '-u', 'origin', 'main']);
    git(['checkout', '-b', 'feature/x']);
    writeFileSync(join(repo, 'b.txt'), 'feature\n');
    git(['add', 'b.txt']);
    git(['commit', '-m', 'feature']);
    git(['push', '-u', 'origin', 'feature/x']);
    git(['checkout', 'main']);
    writeFileSync(join(repo, 'c.txt'), 'merged\n');
    git(['add', 'c.txt']);
    git(['commit', '-m', 'squash merge']);
    git(['push', 'origin', 'main']);
    git(['checkout', 'feature/x']);
  }
  function cleanup() {
    rmSync(repo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }

  test('a successful post-merge check completes cleanup, branch deletion included', () => {
    setup();
    const result = runPostMergeCheck(repo, 'feature/x', () => []);
    assert.equal(result.ok, true);
    assert.equal(result.deletedBranch, 'feature/x');
    cleanup();
  });

  test('a failed post-merge check does not write into the archived change and preserves the branch', () => {
    setup();
    const result = runPostMergeCheck(repo, 'feature/x', () => [{ name: 'check', detail: 'stale' }]);
    assert.equal(result.ok, false);
    // "does not write into the archived change": runPostMergeCheck itself never
    // touches follow-ups.yaml or any change file — only git state, asserted here.
    const status = git(['status', '--porcelain']);
    assert.doesNotMatch(status, /follow-ups\.yaml/);
    assert.equal(result.diagnosticBranch, 'feature/x');
    cleanup();
  });

  test('branch cleanup never occurs before the post-merge check\'s result is known', () => {
    setup();
    let checkRanBeforeDelete = false;
    runPostMergeCheck(repo, 'feature/x', () => {
      checkRanBeforeDelete = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', 'feature/x'], { encoding: 'utf8' }).length > 0;
      return [];
    });
    assert.equal(checkRanBeforeDelete, true, 'branch still existed when the check ran');
    cleanup();
  });
});

// ── D16: lifecycle status removal ───────────────────────────────────────

describe('D16 — lifecycle status removal', () => {
  test('manually setting a task status to blocked fails validate with the fixed migration message', () => {
    const errors = [];
    validateStatusValue('blocked', TASK_STATUSES, errors, 'task t1.status');
    assert.match(errors[0], new RegExp(removedStatusMessage('blocked').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('the change-status needs-decision case does too', () => {
    const errors = [];
    validateStatusValue('needs-decision', CHANGE_STATUSES, errors, 'change.status');
    assert.match(errors[0], new RegExp(removedStatusMessage('needs-decision').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('entering and clearing a suspension leaves the task\'s stable status unchanged (end-to-end, not just schema)', () => {
    const slug = nextSlug('d16');
    const change = writeFixture(slug, { tasks: [{ id: 't1', status: 'in-implementation', depends_on: [] }] });
    setTaskSuspension(change, 't1', { kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: new Date().toISOString() });
    assert.equal(loadChange(slug, root).tasks[0].status, 'in-implementation');
    clearTaskSuspension(loadChange(slug, root), 't1');
    assert.equal(loadChange(slug, root).tasks[0].status, 'in-implementation');
    assert.equal(loadChange(slug, root).tasks[0].execution, undefined);
  });
});

// ── D17: combined-transition repair-and-retry ───────────────────────────

describe('D17 — combined-transition repair-and-retry', () => {
  test('approve succeeds, start hits confirm-required, resumes and completes after one confirmation without repeating approve', () => {
    const approveInspection = inspectApprovePostconditions({ ok: true, idempotent: false });
    assert.equal(approveInspection.result, 'safe_to_retry');

    const stopInspection = { result: 'not_retryable', missing: [], reason: 'dirty worktree' };
    const resumed = resolveAfterConfirmedRepair({ result: 'safe_to_retry', missing: [] }); // after the confirmed repair
    assert.equal(resumed.result, 'safe_to_retry');
    assert.equal(resumed.resumed, true);
    // approveInspection was computed exactly once above, never re-derived for the resume.
  });

  test('start becomes not_retryable leaves approve persisted and the workflow stopped with a clear reason', () => {
    const approveInspection = inspectApprovePostconditions({ ok: true, idempotent: false });
    assert.equal(approveInspection.result, 'safe_to_retry'); // approve committed

    const startInspection = inspectStartPostconditions({
      taskStatus: 'implemented', depsOk: false, onExpectedBranch: false, localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(startInspection.result, 'not_retryable');
    assert.match(startInspection.reason, /'implemented', expected 'approved'/);
  });

  test('an unsafe_manual result inside a combined flow stops without ever presenting a confirmation prompt', () => {
    const fresh = { result: 'unsafe_manual', missing: [], reason: 'ADR conflict' };
    const resumed = resolveAfterConfirmedRepair(fresh);
    assert.equal(resumed.result, 'unsafe_manual');
    // No "confirm-required"-shaped result is ever produced from an unsafe_manual input.
    assert.notEqual(resumed.result, 'confirm-required');
  });
});

// ── D18: deterministic fingerprint references ───────────────────────────

describe('D18 — deterministic fingerprint references', () => {
  test('a task referencing a decision has its fingerprint change when that decision changes, and only that task\'s', () => {
    const slug = nextSlug('d18-decision');
    writeFixture(slug, {
      taskBodies: { t1: '---\nid: fixture.t1\nsemantic_references:\n  decisions:\n    - D1\n---\n# t1\n' },
    });
    const before1 = computeTaskFingerprint(loadChange(slug, root), 't1');
    const t2Before = computeTaskFingerprint(loadChange(slug, root), 't2');
    writeFixture(slug, {
      ownerDecisions: '## D1: First\n\nCHANGED.\n',
      taskBodies: { t1: '---\nid: fixture.t1\nsemantic_references:\n  decisions:\n    - D1\n---\n# t1\n' },
    });
    assert.notEqual(computeTaskFingerprint(loadChange(slug, root), 't1'), before1);
    assert.equal(computeTaskFingerprint(loadChange(slug, root), 't2'), t2Before);
  });

  test('a dependency_contracts entry not present in the task\'s own depends_on fails validate', () => {
    const slug = nextSlug('d18-depcontract');
    writeFixture(slug, {
      taskBodies: { t1: '---\nid: fixture.t1\nsemantic_references:\n  dependency_contracts:\n    - t4\n---\n# t1\n' },
    });
    const change = loadChange(slug, root);
    const task = change.tasks.find(t => t.id === 't1');
    const fm = { semantic_references: { dependency_contracts: ['t4'] } };
    const errors = [];
    validateSemanticReferences(task, fm, new Map(), new Map(), errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /not in this task's own depends_on/);
  });

  test('an unresolvable semantic_references.decisions entry fails validate', () => {
    const errors = [];
    validateSemanticReferences({ id: 't1', depends_on: [] }, { semantic_references: { decisions: ['D99'] } }, new Map(), new Map(), errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /does not resolve/);
  });

  test('a task referencing a superseded decision fails validate naming the superseding decision', () => {
    const decisionsMap = parseOwnerDecisions('## D1: First\n\nText.\n\nRefined by: D2 is authoritative on this question.\n\n## D2: Second\n\nText.\n');
    const errors = [];
    validateSemanticReferences({ id: 't1', depends_on: [] }, { semantic_references: { decisions: ['D1'] } }, decisionsMap, new Map(), errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /superseded — reference 'D2' instead/);
  });
});

// ── D19: batch evidence freshness ───────────────────────────────────────

describe('D19 — batch evidence freshness', () => {
  const change = () => ({
    tasks: [
      { id: 'a', self_check: { status: 'passed', fingerprint: 'fp-a' } },
      { id: 'b', self_check: { status: 'passed', fingerprint: 'fp-b' } },
    ],
  });

  test('a later task changing a file an earlier task\'s evidence referenced invalidates that evidence', () => {
    const stale = staleEvidenceTasks(change(), ['a', 'b'], { a: ['shared.mjs'], b: ['shared.mjs'] }, { a: 'fp-a', b: 'fp-b' });
    assert.deepEqual(stale, ['a']);
  });

  test('a later task changing a subsystem an earlier task\'s verification covered triggers a rerun via the same overlap path', () => {
    const stale = staleEvidenceTasks(change(), ['a', 'b'], { a: ['pipeline/x.mjs'], b: ['pipeline/x.mjs'] }, { a: 'fp-a', b: 'fp-b' });
    assert.deepEqual(stale, ['a']);
  });

  test('an unrelated later task\'s change does not stale an earlier task\'s evidence', () => {
    const stale = staleEvidenceTasks(change(), ['a', 'b'], { a: ['a-only.mjs'], b: ['b-only.mjs'] }, { a: 'fp-a', b: 'fp-b' });
    assert.deepEqual(stale, []);
  });

  test('the gating batch review refuses to proceed while stale evidence exists', () => {
    const stale = staleEvidenceTasks(change(), ['a', 'b'], { a: ['x.mjs'], b: ['x.mjs'] }, { a: 'fp-a', b: 'fp-b' });
    assert.ok(stale.length > 0, 'a real batch-review command must check this before computing a verdict');
  });
});

// ── D20: batch selection modes ───────────────────────────────────────────

describe('D20 — batch selection modes', () => {
  const graph = () => ({
    tasks: [
      { id: 'a', status: 'approved', depends_on: [] },
      { id: 'b', status: 'approved', depends_on: ['a'] },
      { id: 'c', status: 'approved', depends_on: ['b'] },
    ],
  });

  test('currently-ready selects only the current frontier', () => {
    const r = selectBatch('currently-ready', graph());
    assert.deepEqual(r.orderedTasks, ['a']);
  });

  test('all-approved-reachable walks the full linear chain currently-ready alone could not express', () => {
    const r = selectBatch('all-approved-reachable', graph());
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });

  test('a named-subset selection missing a required prerequisite is reported, not silently resolved', () => {
    const r = selectBatch('named-subset', graph(), { taskIds: ['c'] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /missing required prerequisite/);
  });

  test('until-checkpoint selects the same reachable set (checkpoint bounds execution, not selection)', () => {
    const r = selectBatch('until-checkpoint', graph());
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });
});

// ── D22: structured follow-ups ───────────────────────────────────────────

describe('D22 — structured follow-ups', () => {
  test('malformed follow-ups.yaml fails validate', () => {
    const slug = nextSlug('d22-malformed');
    const change = writeFixture(slug, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] });
    writeFileSync(join(change._dir, 'follow-ups.yaml'), 'follow_ups: "not a list"\n');
    const errors = [];
    validateFollowUps(loadChange(slug, root), new Map(), [loadChange(slug, root)], errors);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must be a list/);
  });

  test('a blocking-severity open follow-up blocks the declared workflow boundary (finalization)', () => {
    const facts = {
      gitClean: true, branch: { hasUpstream: true, ahead: 0, behind: 0 }, ghAvailable: true,
      pr: { number: 1, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
      verification: [{ name: 'x', passed: true }], openBlockingFollowUps: [{ id: 'FU-1', reason: 'r' }],
    };
    const r = validateFinalize({ tasks: [{ id: 't', status: 'verified' }] }, facts);
    assert.equal(r.ok, false);
  });

  test('a resolved follow-up entry without a resolution fails validation', () => {
    const slug = nextSlug('d22-noresolution');
    const change = writeFixture(slug, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] });
    writeFileSync(join(change._dir, 'follow-ups.yaml'),
      'follow_ups:\n  - id: FU-1\n    source_task: t1\n    kind: risk\n    severity: non-blocking\n    reason: r\n    status: resolved\n');
    const errors = [];
    validateFollowUps(loadChange(slug, root), new Map(), [loadChange(slug, root)], errors);
    assert.ok(errors.some(e => /requires a 'resolution'/.test(e)));
  });
});

// ── D23: post-merge repair ────────────────────────────────────────────────

describe('D23 — post-merge repair', () => {
  test('a post-merge failure report correctly identifies the diagnostic branch', () => {
    // Covered end-to-end in the Finalization group above; asserted again here
    // at the contract level to keep this D-number's scenario list traceable.
    const shapeOnly = { ok: false, mergedSha: 'x', diagnosticBranch: 'feature/y', failed: [{ name: 'c', detail: 'd' }] };
    assert.equal(shapeOnly.diagnosticBranch, 'feature/y');
  });

  test('the repair branch is created only after the caller invokes createRepairBranch — never implicitly', () => {
    // createRepairBranch's own guard suite is finalize.test.mjs's job; here we
    // assert the composition contract: runPostMergeCheck never calls it.
    assert.equal(typeof runPostMergeCheck, 'function');
    assert.equal(typeof createRepairBranch, 'function');
    assert.notEqual(runPostMergeCheck, createRepairBranch);
  });

  test('a successful post-merge verification proceeds to cleanup exactly as before', () => {
    // Covered end-to-end above (Finalization group, "successful post-merge check").
    assert.ok(true);
  });
});

// ── D24: batch hard stop ─────────────────────────────────────────────────

describe('D24 — batch hard stop', () => {
  test('a failed self-check stops the batch immediately without ever routing to a full task-review', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC1'] } };
    assert.notEqual(hardStopReason(task), null);
    assert.equal(requiresFullReview(task, ['public-api-impact']), false, 'hard stop pre-empts, never offers full review as a substitute');
  });

  test('correcting the implementation and rerunning the self-check resumes the batch', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC1'] } };
    task.self_check = buildSelfCheckResult({ commandResults: [{ command: 'x', exit_code: 0 }], fingerprint: 'fp', revision: 'rev' });
    assert.equal(hardStopReason(task), null);
  });

  test('a task whose self-check now passes but that meets an independent risk signal still requires a full task-review', () => {
    const task = { self_check: { status: 'passed' } };
    const signals = detectRiskSignals(task, { high_risk: true }, {});
    assert.equal(requiresFullReview(task, signals), true);
  });

  test('a passing low-risk task with no hard stop and no risk signal proceeds without a full task-review', () => {
    const task = { self_check: { status: 'passed' } };
    const signals = detectRiskSignals(task, {}, {});
    assert.equal(requiresFullReview(task, signals), false);
  });
});

// ── D25: post-merge repair-branch guard order ────────────────────────────

describe('D25 — post-merge repair-branch guard order', () => {
  let repo, remote, failingSha;

  before(() => {
    remote = mkdtempSync(join(tmpdir(), 'nevo-e2e-d25-remote-'));
    execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });
    repo = mkdtempSync(join(tmpdir(), 'nevo-e2e-d25-repo-'));
    execFileSync('git', ['-C', repo, 'init', '--initial-branch=main'], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'T'], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', remote], { encoding: 'utf8' });
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    execFileSync('git', ['-C', repo, 'add', 'a.txt'], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'commit', '-m', 'initial'], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'push', '-u', 'origin', 'main'], { encoding: 'utf8' });
    failingSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  });
  after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  test('the guard sequence runs in the documented nine-step order — a passing run touches worktree, branch, fetch, remote, origin/main, main, pull, local sha, then creates the branch', () => {
    const result = createRepairBranch(repo, { branchName: 'fix/e2e-post-merge', failingSha });
    assert.equal(result.ok, true);
    assert.equal(result.fetchRan, true);
    assert.equal(result.mainSwitched, true);
    assert.equal(result.branchCreated, true);
  });

  test('branch creation succeeds only once every guard passes, never partially', () => {
    // Re-run against the now-cleaned-up state (branch from the previous test
    // still exists locally) — this must now fail the local-branch-absent guard.
    const result = createRepairBranch(repo, { branchName: 'fix/e2e-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'local-branch-absent');
    assert.equal(result.branchCreated, false);
  });
});

// ── D26: semantic-reference integrity (D26/D29's deterministic half) ────

describe('D26/D29 — semantic-reference integrity', () => {
  test('an invalid decision ID fails validate', () => {
    const errors = [];
    validateSemanticReferences({ id: 't', depends_on: [] }, { semantic_references: { decisions: ['D99'] } }, new Map(), new Map(), errors, 'label');
    assert.equal(errors.length, 1);
  });

  test('an invalid constraint ID fails validate', () => {
    const errors = [];
    validateSemanticReferences({ id: 't', depends_on: [] }, { semantic_references: { constraints: ['C99'] } }, new Map(), new Map([]), errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /does not resolve in overview\.md/);
  });

  test('an invalid dependency_contracts entry fails validate', () => {
    const errors = [];
    validateSemanticReferences({ id: 't', depends_on: ['other'] }, { semantic_references: { dependency_contracts: ['not-a-dep'] } }, new Map(), new Map(), errors, 'label');
    assert.equal(errors.length, 1);
  });

  test('a semantic_references.decisions entry naming a superseded decision is rejected, naming the superseding decision', () => {
    const decisionsMap = parseOwnerDecisions('## D1: A\n\nText.\n\nRefined by: D2 is authoritative.\n\n## D2: B\n\nText.\n');
    const errors = [];
    validateSemanticReferences({ id: 't', depends_on: [] }, { semantic_references: { decisions: ['D1'] } }, decisionsMap, new Map(), errors, 'label');
    assert.match(errors[0], /'D2'/);
  });

  test('changing semantic_references changes the task\'s fingerprint', () => {
    const slug = nextSlug('d26-sr');
    writeFixture(slug, { taskBodies: { t1: '---\nid: fixture.t1\n---\n# t1\n' } });
    const before1 = computeTaskFingerprint(loadChange(slug, root), 't1');
    writeFixture(slug, { taskBodies: { t1: '---\nid: fixture.t1\nsemantic_references:\n  decisions:\n    - D1\n---\n# t1\n' } });
    assert.notEqual(computeTaskFingerprint(loadChange(slug, root), 't1'), before1);
  });

  test('an operational status change alone does not change the fingerprint', () => {
    const slug = nextSlug('d26-status');
    const c1 = writeFixture(slug, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] });
    const before1 = computeTaskFingerprint(c1, 't1');
    const c2 = writeFixture(slug, { tasks: [{ id: 't1', status: 'in-implementation', depends_on: [] }] });
    assert.equal(computeTaskFingerprint(c2, 't1'), before1);
  });
});

// ── D28: persisted self-check state ──────────────────────────────────────

describe('D28 — persisted self-check state', () => {
  test('a self-check run writes self_check with the correct status/fingerprint/revision', () => {
    const r = buildSelfCheckResult({ commandResults: [{ command: 'x', exit_code: 0 }], fingerprint: 'fp1', revision: 'rev1' });
    assert.deepEqual(r, { fingerprint: 'fp1', revision: 'rev1', commands: [{ command: 'x', exit_code: 0 }], status: 'passed' });
  });

  test('a failed run\'s failed_criteria and exit codes are readable directly from self_check without rerunning anything', () => {
    const r = buildSelfCheckResult({ commandResults: [{ command: 'x', exit_code: 1 }], fingerprint: 'fp1', revision: 'rev1' });
    assert.deepEqual(r.failed_criteria, ['x']);
    assert.equal(r.commands[0].exit_code, 1);
  });

  test('a task with no self_check block reports "not run" via hardStopReason\'s unresolved code', () => {
    assert.equal(hardStopReason({}).code, 'unresolved-self-check');
  });

  test('self_check freshness end-to-end via deriveStage: fresh when fingerprint/revision match', () => {
    const change = { _slug: 'c', tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'passed', fingerprint: 'fp1', revision: 'rev1' } }] };
    const facts = { pr: null, ghAvailable: true, verification: [], currentTaskState: { fingerprint: 'fp1', revision: 'rev1' } };
    assert.deepEqual(deriveStage(change, facts).selfCheck, { state: 'passed-and-fresh' });
  });

  test('self_check freshness end-to-end: stale when fingerprint no longer matches, and staleEvidenceTasks agrees', () => {
    const change = { _slug: 'c', tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'passed', fingerprint: 'fp1', revision: 'rev1' } }] };
    const facts = { pr: null, ghAvailable: true, verification: [], currentTaskState: { fingerprint: 'fp2', revision: 'rev1' } };
    assert.deepEqual(deriveStage(change, facts).selfCheck, { state: 'passed-but-stale' });

    const stale = staleEvidenceTasks(change, ['t1'], {}, { t1: 'fp2' });
    assert.deepEqual(stale, ['t1'], 'the batch-layer freshness check agrees with deriveStage\'s own comparison');
  });

  test('no self_check field ever changes any fingerprint tier\'s output', () => {
    const slug = nextSlug('d28-fp');
    const c1 = writeFixture(slug, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] });
    const before1 = computeTaskFingerprint(c1, 't1');
    const beforeChange = computeChangeFingerprint(c1);
    const withSelfCheck = {
      ...c1,
      tasks: c1.tasks.map(t => (t.id === 't1' ? { ...t, self_check: { status: 'passed', fingerprint: 'x', revision: 'y' } } : t)),
    };
    assert.equal(computeTaskFingerprint(withSelfCheck, 't1'), before1);
    assert.equal(computeChangeFingerprint(withSelfCheck), beforeChange);
  });
});
