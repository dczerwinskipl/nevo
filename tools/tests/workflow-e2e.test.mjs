// Vertical proof-of-concept, end-to-end (Task 07): the full agent-facing/operator-facing
// CLI sequence — `workflow step start` -> work -> `workflow step finish` (blocked) ->
// `workflow verify-human --confirm` -> `workflow step finish` (completes) — driven only
// through tools/specs/workflow/cli.mjs's public handlers (AC8): no test in this suite
// manually edits change.yaml/task files to simulate progress, and no test calls an
// internal gate/action API (HumanVerificationGate.verify(), ActionContract.execute()) in
// place of a CLI call. Covers AC2-AC9 (area concrete-actions-and-vertical-poc, Scenarios
// A-J). Interruption/reconciliation (AC4, Scenarios G/H) reuses the crafted-record
// technique already exhaustively unit-tested per-stage in
// tools/tests/workflow-finish-operation.test.mjs — here it is exercised representatively
// through the CLI to prove the wiring, not to re-derive Task 06's own coverage.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
  handleWorkflowVerifyHuman,
} from '../specs/workflow/cli.mjs';
import { loadOperationRecord, saveOperationRecord } from '../specs/workflow/finish-operation.mjs';
import { resolveWorkflowMode } from '../specs/workflow/compatibility.mjs';
import { requireChange, requireTask, loadChange } from '../specs/store.mjs';
import { handleStart } from '../specs/start/cli.mjs';
import { handleComplete } from '../specs/complete/cli.mjs';
import { getCurrentRevision, getCommitInfo } from '../lib/git.mjs';
import { loadWorkflowDefinition, parseWorkflowDefinition } from '../specs/workflow/definitions/loader.mjs';
import { defaultActionRegistry } from '../specs/workflow/registry.mjs';

const CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: vertical-poc
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

const WORKFLOW_YAML = `id: vertical-poc
title: "Vertical PoC"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    entryGates: []
    exitGates:
      - type: command
        command: "node -e \\"process.exit(0)\\""
      - type: human
        required: true
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixture(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), CHANGE_YAML);

  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'vertical-poc.yaml'), WORKFLOW_YAML);

  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);

  return { root, remote, activeDir };
}

function cleanup(fx) {
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(fx.remote, { recursive: true, force: true });
}

const RT = { silent: true };

describe('Vertical PoC — the full step start / step finish / verify-human sequence (AC2, AC3)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-e2e-poc'); });
  after(() => cleanup(fx));

  test('Scenario A: step start returns the finish contract in advance', async () => {
    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.finishContract.requiredInputs['commit.title'].required, true);
    assert.equal(stepContext.finishContract.requiredInputs['include'].required, true);
    const humanGate = stepContext.finishContract.gates.find(g => g.gateType === 'human');
    assert.equal(humanGate.status, 'blocked');
  });

  test('Scenario B/E: agent work + step finish --check aggregates planning facts and fail-closed rejects missing inputs', async () => {
    writeFileSync(join(fx.root, 'feature.txt'), 'implementation work\n');

    const check = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, check: true, activeDir: fx.activeDir, repoRoot: fx.root });
    // Human gate is still unmet — planning reports it blocked (Scenario D's first half)
    // rather than reaching the missing-inputs check.
    assert.equal(check.status, 'blocked');
    assert.equal(check.blockers[0].gateType, 'human');

    // Zero mutation: no commit, no task status change, no operation record created.
    assert.equal(requireTask(requireChange('demo-change', fx.activeDir), 'demo-task').status, 'in-implementation');
    assert.equal(loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation'), null);
  });

  test('Scenario D: step finish reports the blocked human gate and mutates nothing; only verify-human --confirm can satisfy it', async () => {
    const attempt = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Finish demo task', include: '*',
    });
    assert.equal(attempt.status, 'blocked');
    assert.equal(loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation'), null, 'no operation record while blocked');

    const confirmation = handleWorkflowVerifyHuman('demo-change', 'demo-task', { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(confirmation.confirmed, true);
  });

  test('Scenario E: a subsequent finish still fails closed on the missing commit.title/include (input-required, zero mutation)', async () => {
    const plan = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, check: true, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(plan.status, 'input-required');
    assert.ok(plan.missingInputs.includes('commit.title'));
    assert.ok(plan.missingInputs.includes('include'));

    const attempt = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(attempt.status, 'input-required');
    assert.equal(loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation'), null);
  });

  let completedSha;

  test('Scenario F: valid inputs complete the finalize step — one commit, push confirmed, transition to next step', async () => {
    const result = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Finish demo task', include: '*',
    });

    assert.equal(result.status, 'completed');
    assert.equal(requireTask(requireChange('demo-change', fx.activeDir), 'demo-task').status, 'verified');

    completedSha = getCurrentRevision(fx.root);
    const info = getCommitInfo(fx.root, completedSha);
    assert.equal(info.subject, 'Finish demo task');
    const changedInCommit = git(fx.root, ['show', '--name-only', '--format=', completedSha]).split('\n').filter(Boolean);
    assert.ok(changedInCommit.includes('feature.txt'));
    assert.ok(changedInCommit.some(p => p.endsWith('change.yaml')));

    const remoteHead = git(fx.remote, ['rev-parse', 'main']).trim();
    assert.equal(remoteHead, completedSha);
  });

  test('Scenario J: the worktree is clean and the operation record shows fully completed (C17)', () => {
    const status = git(fx.root, ['status', '--porcelain']);
    assert.equal(status, '');
    const record = loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation');
    assert.equal(record.status, 'completed');
  });

  test('Scenario H1: a repeated step finish after full success returns the already-completed result, no repeated action', async () => {
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();
    const result = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(result.status, 'already-completed');
    assert.equal(result.result.commit.sha, completedSha);
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore);
  });
});

describe('Vertical PoC — interrupted-and-resumed finish via the CLI (AC4, AC6, Scenarios G/H2/H3)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-e2e-resume'); });
  after(() => cleanup(fx));

  test('a commit-stage crash window (left running) is reconciled on retry via step finish, without a second commit', async () => {
    // Establish the "gates already satisfied, inputs already resolved, commit already
    // physically happened" precondition that a real crash between "git commit succeeded"
    // and "recorded completed" would leave behind. The finish-operation record is
    // runtime/execution state (not a spec file) — crafting it directly is this
    // subsystem's own supported resumability mechanism (Task 06), not a substitute for
    // driving the change/task through the CLI.
    // D37: a human-verification exit gate is only meaningful for an active step —
    // activate it first via the normal CLI entry point.
    await handleWorkflowStepStart('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    handleWorkflowVerifyHuman('demo-change', 'demo-task', { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });

    const change = requireChange('demo-change', fx.activeDir);
    const { setTaskStatus } = await import('../specs/store.mjs');
    setTaskStatus(change, 'demo-task', 'verified');
    writeFileSync(join(fx.root, 'feature.txt'), 'work\n');
    git(fx.root, ['add', '-A']);
    git(fx.root, ['commit', '-q', '-m', 'Finish demo task']);
    const commitSha = getCurrentRevision(fx.root);
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();

    saveOperationRecord(fx.root, {
      operationId: 'crafted-e2e-op-1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: { 'commit.title': 'Finish demo task', 'commit.message': '', include: ['*'], exclude: [] },
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'running', intent: { preCommitHead: commitSha.replace(/.$/, commitSha.at(-1) === '0' ? '1' : '0') } },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });
    // The crafted preCommitHead above is deliberately wrong (crash-window fixtures need a
    // real parent to reconcile against) — overwrite it with the actual parent of the
    // already-made commit so reconciliation has a true precondition to prove.
    const info = getCommitInfo(fx.root, commitSha);
    const record = loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation');
    record.operations.find(o => o.id === 'commit').intent = { preCommitHead: info.parentSha };
    saveOperationRecord(fx.root, record);

    const result = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });

    assert.equal(result.status, 'completed');
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore, 'no second commit must be created');
    const remoteHead = git(fx.remote, ['rev-parse', 'main']).trim();
    assert.equal(remoteHead, commitSha);
  });

  test('retrying with no inputs resumes from persisted resolvedInputs, and a conflicting resupply is rejected (AC6)', async () => {
    // Fresh in-flight operation: inputs resolved, nothing executed yet.
    saveOperationRecord(fx.root, {
      operationId: 'crafted-e2e-op-2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: { 'commit.title': 'Second finish', 'commit.message': '', include: ['*'], exclude: [] },
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'pending' },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    await assert.rejects(() => handleWorkflowStepFinish('demo-change', 'demo-task', {
      ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'A conflicting different title',
    }));
    const unchangedRecord = loadOperationRecord(fx.root, 'demo-change', 'demo-task', 'implementation');
    assert.equal(unchangedRecord.resolvedInputs['commit.title'], 'Second finish');

    writeFileSync(join(fx.root, 'more-work.txt'), 'more\n');
    const result = await handleWorkflowStepFinish('demo-change', 'demo-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(result.status, 'completed');
    const info = getCommitInfo(fx.root, result.result.commit.sha);
    assert.equal(info.subject, 'Second finish');
  });
});

describe('Legacy coexistence — zero regressions for specifications without workflow.mode (AC9, Scenario I)', () => {
  let root;
  let activeDir;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'nevo-e2e-legacy-'));
    execFileSync('git', ['-C', root, 'init', '-q', '--initial-branch=main']);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'legacy@example.com']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Legacy']);
    activeDir = join(root, 'specs', 'active');
    const changeDir = join(activeDir, 'legacy-change');
    mkdirSync(join(changeDir, 'tasks'), { recursive: true });
    writeFileSync(join(changeDir, 'change.yaml'), [
      'id: legacy-change', 'title: Legacy change', 'status: draft', '',
      'branch:', '  mode: per-change', '  prefix: legacy', '',
      'tasks:', '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: approved', '',
    ].join('\n'));
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), [
      '---', 'id: legacy-change.t1', 'status: draft', 'change: legacy-change',
      'allowed_paths:', '  - fixture/**', 'forbidden_paths: []', '---', '# Task: t1', '',
    ].join('\n'));
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'initial']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('a specification with no workflow.mode resolves to legacy mode', () => {
    const change = loadChange('legacy-change', activeDir);
    const resolved = resolveWorkflowMode(change);
    assert.equal(resolved.mode, 'legacy');
    assert.equal(resolved.isExplicit, false);
  });

  test('legacy start/complete lifecycle commands still execute their existing behavior unaffected by the workflow module', () => {
    handleStart('legacy-change', 't1', { activeDir, gitRoot: root });
    assert.equal(requireTask(requireChange('legacy-change', activeDir), 't1').status, 'in-implementation');

    handleComplete('legacy-change', 't1', { activeDir });
    assert.equal(requireTask(requireChange('legacy-change', activeDir), 't1').status, 'implemented');
  });
});

describe('Production multi-step Standard workflow definition (Task 11, D31, D39)', () => {
  const repoRoot = join(import.meta.dirname, '..', '..');

  test('AC2, AC3: .nevo-ai/workflows/standard.yaml loads cleanly and validates against registered actions/gates and schema', () => {
    const def = loadWorkflowDefinition('standard', { repoRoot });

    assert.equal(def.id, 'standard-v1');
    assert.equal(def.title, 'Standard Specification Workflow');
    assert.equal(def.type, 'standard');
    assert.equal(def.version, 1);
    assert.equal(def.entryStep, 'implementation');

    const stepNames = Object.keys(def.steps);
    assert.deepEqual(stepNames, ['implementation', 'review', 'human-verification']);

    // 1. implementation step
    const impl = def.steps.implementation;
    assert.deepEqual(impl.status, { active: 'implementing', completed: 'implemented' });
    assert.equal(impl.exitGates.length, 1);
    assert.deepEqual(impl.exitGates[0], { type: 'command', action: 'test' });
    assert.deepEqual(impl.finalize, [{ id: 'commit-and-push' }]);
    assert.deepEqual(impl.transitions, [{ to: 'review' }]);

    // 2. review step
    const rev = def.steps.review;
    assert.deepEqual(rev.status, { active: 'reviewing', completed: 'reviewed' });
    assert.equal(rev.exitGates.length, 1);
    assert.deepEqual(rev.exitGates[0], { type: 'command', action: 'test' });
    assert.deepEqual(rev.finalize, [{ id: 'commit-and-push' }]);
    assert.deepEqual(rev.transitions, [{ to: 'human-verification' }]);

    // 3. human-verification step
    const hv = def.steps['human-verification'];
    assert.deepEqual(hv.status, { active: 'awaiting-human-verification', completed: 'completed' });
    assert.equal(hv.exitGates.length, 1);
    assert.deepEqual(hv.exitGates[0], { type: 'human', required: true, id: 'owner-acceptance' });
    assert.deepEqual(hv.finalize, [{ id: 'commit-and-push' }]);
    assert.deepEqual(hv.transitions, [{ to: 'verified' }]);
  });

  test('AC2: tools/specs/workflow/templates/standard.yaml matches .nevo-ai/workflows/standard.yaml identically', () => {
    const templateContent = readFileSync(join(repoRoot, 'tools', 'specs', 'workflow', 'templates', 'standard.yaml'), 'utf8');
    const templateDef = parseWorkflowDefinition(templateContent, { knownActions: defaultActionRegistry.list() });
    const repoDef = loadWorkflowDefinition('standard', { repoRoot });

    assert.deepEqual(templateDef, repoDef);
  });

  test('AC4: every step declares authored purpose, expectedWork.summary, and hints referencing real repository documents', () => {
    const def = loadWorkflowDefinition('standard', { repoRoot });

    for (const [stepName, stepConfig] of Object.entries(def.steps)) {
      assert.ok(typeof stepConfig.purpose === 'string' && stepConfig.purpose.trim().length > 0, `${stepName}.purpose must be non-empty string`);
      assert.ok(typeof stepConfig.expectedWork?.summary === 'string' && stepConfig.expectedWork.summary.trim().length > 0, `${stepName}.expectedWork.summary must be non-empty string`);
      assert.ok(Array.isArray(stepConfig.hints) && stepConfig.hints.length > 0, `${stepName}.hints must be a non-empty array`);

      for (const hint of stepConfig.hints) {
        assert.equal(hint.type, 'doc', `${stepName} hint must be type: doc`);
        assert.ok(typeof hint.ref === 'string' && hint.ref.trim().length > 0, `${stepName} hint ref must be non-empty`);
        const docPath = join(repoRoot, hint.ref);
        assert.ok(existsSync(docPath), `${stepName} hint references non-existent doc: ${hint.ref}`);
      }
    }
  });

  describe('3-step Standard workflow full lifecycle execution through CLI (AC2, AC3, D39)', () => {
    let fx;

    function makeStandardFixture(prefix) {
      const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
      git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

      const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
      git(root, ['init', '-q', '--initial-branch=main']);
      git(root, ['config', 'user.email', 'fixture@example.com']);
      git(root, ['config', 'user.name', 'Fixture']);
      git(root, ['remote', 'add', 'origin', remote]);

      const activeDir = join(root, 'specs', 'active');
      const changeDir = join(activeDir, 'standard-change');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), [
        'id: standard-change',
        'title: "Standard Change"',
        'type: standard',
        'status: draft',
        'workflow:',
        '  mode: deterministic',
        '  definition: standard',
        'tasks:',
        '  - id: standard-task',
        '    order: 1',
        '    file: tasks/01-task.md',
        '    status: in-implementation',
        '',
      ].join('\n'));

      writeFileSync(join(changeDir, 'tasks', '01-task.md'), [
        '---',
        'id: standard-change.standard-task',
        'status: draft',
        'change: standard-change',
        'allowed_paths:',
        '  - src/**',
        'forbidden_paths: []',
        '---',
        '# Task: standard task',
        '',
      ].join('\n'));

      // Copy real standard.yaml into fixture
      const workflowsDir = join(root, '.nevo-ai', 'workflows');
      mkdirSync(workflowsDir, { recursive: true });
      const standardYamlContent = readFileSync(join(repoRoot, '.nevo-ai', 'workflows', 'standard.yaml'), 'utf8');
      writeFileSync(join(workflowsDir, 'standard.yaml'), standardYamlContent);

      // Package.json with a test script so `npm test` gate passes
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'fixture-pkg',
        version: '1.0.0',
        scripts: { test: 'node -e "process.exit(0)"' },
      }, null, 2));

      writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\\n');
      writeFileSync(join(root, 'root.txt'), 'root\\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'initial']);
      git(root, ['push', '-q', '-u', 'origin', 'main']);

      return { root, remote, activeDir };
    }

    before(() => { fx = makeStandardFixture('nevo-standard-e2e'); });
    after(() => cleanup(fx));

    test('Phase 1: step start activates implementation step with semantic status implementing', async () => {
      const stepContext = await handleWorkflowStepStart('standard-change', 'standard-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.equal(stepContext.currentStep, 'implementation');
      assert.equal(stepContext.runtimeState, 'active');
      assert.equal(stepContext.semanticStatus, 'implementing');
      assert.equal(stepContext.nextStepGuidance.onSuccess, 'review');
      assert.ok(stepContext.stepContract.purpose.includes('implementation work'));
    });

    test('Phase 1: step finish completes implementation and transitions to review (state: completed, semantic status: implemented)', async () => {
      mkdirSync(join(fx.root, 'src'), { recursive: true });
      writeFileSync(join(fx.root, 'src', 'code.js'), 'export const a = 1;\\n');

      const result = await handleWorkflowStepFinish('standard-change', 'standard-task', {
        ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Implement standard task', include: '*',
      });

      assert.equal(result.status, 'completed');
      const task = requireTask(requireChange('standard-change', fx.activeDir), 'standard-task');
      assert.equal(task.status, 'in-implementation');
      assert.equal(task.workflow_progress.current_step, 'implementation');
      assert.equal(task.workflow_progress.state, 'completed');
      assert.equal(task.workflow_progress.history.length, 1);
      assert.equal(task.workflow_progress.history[0].step, 'implementation');
      assert.equal(task.workflow_progress.history[0].transitioned_to, 'review');
    });

    test('Phase 2: step start activates review step with semantic status reviewing', async () => {
      const stepContext = await handleWorkflowStepStart('standard-change', 'standard-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.equal(stepContext.currentStep, 'review');
      assert.equal(stepContext.runtimeState, 'active');
      assert.equal(stepContext.semanticStatus, 'reviewing');
      assert.equal(stepContext.nextStepGuidance.onSuccess, 'human-verification');
      assert.ok(stepContext.stepContract.purpose.includes('independent quality review'));
    });

    test('Phase 2: step finish completes review and transitions to human-verification (state: completed, semantic status: reviewed)', async () => {
      writeFileSync(join(fx.root, 'src', 'review-fix.js'), '// review pass\\n');

      const result = await handleWorkflowStepFinish('standard-change', 'standard-task', {
        ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Review standard task', include: '*',
      });

      assert.equal(result.status, 'completed');
      const task = requireTask(requireChange('standard-change', fx.activeDir), 'standard-task');
      assert.equal(task.status, 'in-implementation');
      assert.equal(task.workflow_progress.current_step, 'review');
      assert.equal(task.workflow_progress.state, 'completed');
      assert.equal(task.workflow_progress.history.length, 2);
      assert.equal(task.workflow_progress.history[1].step, 'review');
      assert.equal(task.workflow_progress.history[1].transitioned_to, 'human-verification');
    });

    test('Phase 3: step start activates human-verification step with semantic status awaiting-human-verification', async () => {
      const stepContext = await handleWorkflowStepStart('standard-change', 'standard-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.equal(stepContext.currentStep, 'human-verification');
      assert.equal(stepContext.runtimeState, 'active');
      assert.equal(stepContext.semanticStatus, 'awaiting-human-verification');
      assert.equal(stepContext.nextStepGuidance.onSuccess, 'verified');
      assert.ok(stepContext.stepContract.purpose.includes('Explicit owner/user acceptance'));
      const humanGate = stepContext.finishContract.gates.find(g => g.gateType === 'human');
      assert.equal(humanGate.status, 'blocked');
      assert.equal(humanGate.id, 'owner-acceptance');
    });

    test('Phase 3: step finish fails closed while human verification gate is unconfirmed', async () => {
      const attempt = await handleWorkflowStepFinish('standard-change', 'standard-task', {
        ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Attempt finish without verification', include: '*',
      });
      assert.equal(attempt.status, 'blocked');
      assert.equal(attempt.blockers[0].gateType, 'human');
      assert.equal(attempt.blockers[0].id, 'owner-acceptance');

      const task = requireTask(requireChange('standard-change', fx.activeDir), 'standard-task');
      assert.equal(task.status, 'in-implementation');
      assert.equal(task.workflow_progress.state, 'active');
    });

    test('Phase 3: verify-human --confirm satisfies the gate and step finish completes to terminal verified status', async () => {
      const confirmation = handleWorkflowVerifyHuman('standard-change', 'standard-task', { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.equal(confirmation.confirmed, true);

      const result = await handleWorkflowStepFinish('standard-change', 'standard-task', {
        ...RT, activeDir: fx.activeDir, repoRoot: fx.root, title: 'Finalize human verification', include: '*',
      });

      assert.equal(result.status, 'completed');
      const task = requireTask(requireChange('standard-change', fx.activeDir), 'standard-task');
      assert.equal(task.status, 'verified');
      assert.equal(task.workflow_progress.current_step, 'human-verification');
      assert.equal(task.workflow_progress.state, 'completed');
      assert.equal(task.workflow_progress.history.length, 3);
      assert.equal(task.workflow_progress.history[2].step, 'human-verification');
      assert.equal(task.workflow_progress.history[2].transitioned_to, 'verified');

      const headSha = getCurrentRevision(fx.root);
      const remoteHead = git(fx.remote, ['rev-parse', 'main']).trim();
      assert.equal(remoteHead, headSha);
    });

    test('Phase 3: repeated finish after completion returns already-completed', async () => {
      const result = await handleWorkflowStepFinish('standard-change', 'standard-task', { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.equal(result.status, 'already-completed');
    });
  });
});

