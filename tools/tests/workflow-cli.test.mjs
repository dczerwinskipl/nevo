// Tests for the CLI wiring itself (Task 07, AC1): `workflow step start`, `workflow step
// finish [--check]`, and `workflow verify-human --confirm` are exposed and return the
// documented StepContext/finish-planning JSON shapes. The full vertical PoC sequence
// (gates, fail-closed inputs, interruption/resumption, coexistence) is covered in
// tools/tests/workflow-e2e.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
  handleWorkflowVerifyHuman,
  parseFinishInputs,
} from '../specs/workflow/cli.mjs';
import { requireChange, requireTask, setTaskWorkflowState } from '../specs/store.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { WorkflowDefinitionError, WorkflowError } from '../specs/workflow/errors.mjs';
import { saveOperationRecord, FINISH_STAGE_IDS } from '../specs/workflow/finish-operation.mjs';

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
  push: false
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

const MULTI_GATE_CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: vertical-poc-multi-gate
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

const MULTI_GATE_WORKFLOW_YAML = `id: vertical-poc-multi-gate
title: "Vertical PoC Multi Gate"
type: standard
version: 1
sourceControl:
  enabled: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    entryGates: []
    exitGates:
      - type: human
        required: true
        id: qa-review
      - type: human
        required: true
        id: owner-review
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

const REVIEWER_ROLE_CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: vertical-poc-reviewer-role
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

const REVIEWER_ROLE_WORKFLOW_YAML = `id: vertical-poc-reviewer-role
title: "Vertical PoC Reviewer Role"
type: standard
version: 1
sourceControl:
  enabled: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    entryGates: []
    exitGates:
      - type: human
        required: true
        role: reviewer
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

const CROSS_STEP_CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: vertical-poc-cross-step
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

const CROSS_STEP_WORKFLOW_YAML = `id: vertical-poc-cross-step
title: "Vertical PoC Cross Step"
type: standard
version: 1
sourceControl:
  enabled: false
steps:
  stepA:
    status:
      active: a-active
      completed: a-completed
    entryGates: []
    exitGates:
      - type: human
        required: true
    finalize:
      - id: commit-and-push
    transitions:
      - to: stepB
  stepB:
    status:
      active: b-active
      completed: b-completed
    entryGates: []
    exitGates:
      - type: human
        required: true
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

const SEQUENCE_CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: vertical-poc-sequence
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

const SEQUENCE_WORKFLOW_YAML = `id: vertical-poc-sequence
title: "Vertical PoC Sequence"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  stepA:
    status:
      active: a-active
      completed: a-completed
    entryGates: []
    exitGates:
      - type: command
        command: "node -e \\"process.exit(0)\\""
    finalize:
      - id: commit-and-push
    transitions:
      - to: stepB
  stepB:
    status:
      active: b-active
      completed: b-completed
    entryGates: []
    exitGates:
      - type: command
        command: "node -e \\"process.exit(0)\\""
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

const VERSION_MISMATCH_CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
workflow:
  mode: deterministic
  version: 2
  definition: vertical-poc
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixture(prefix, {
  changeYaml = CHANGE_YAML,
  workflowId = 'vertical-poc',
  workflowYaml = WORKFLOW_YAML,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${workflowId}.yaml`), workflowYaml);

  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);

  return { root, activeDir };
}

describe('CLI surface: workflow step start / step finish / verify-human (AC1)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-cli-surface'); });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('workflow step start returns the documented StepContext shape', async () => {
    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', {
      activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });

    assert.equal(stepContext.change, 'demo-change');
    assert.equal(stepContext.task, 'demo-task');
    assert.equal(stepContext.workflowMode, 'deterministic');
    assert.equal(stepContext.currentStep, 'implementation');
    assert.ok('entryState' in stepContext && Array.isArray(stepContext.entryState.blockers));
    assert.ok('finishContract' in stepContext);
    assert.ok('requiredInputs' in stepContext.finishContract);
    assert.ok(Array.isArray(stepContext.finishContract.gates));
    assert.equal('nextStepGuidance' in stepContext, false);
  });

  test('workflow step finish --check returns the documented finish-planning shape without mutating', async () => {
    const statusBefore = git(fx.root, ['status', '--porcelain']);

    const plan = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      check: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });

    assert.ok('status' in plan);
    assert.ok(Array.isArray(plan.plannedOperations));
    assert.ok(Array.isArray(plan.blockers));
    assert.ok('requiredInputs' in plan);
    assert.ok('missingInputs' in plan);

    const statusAfter = git(fx.root, ['status', '--porcelain']);
    assert.equal(statusBefore, statusAfter);
  });

  test('workflow verify-human requires --confirm and otherwise persists a durable signoff record', async () => {
    // D37: a human-verification exit gate is only meaningful for an *active* step —
    // activate it first (a prior test in this suite already did, but assert it's a
    // harmless resume either way).
    await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });

    assert.throws(() => handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    }), /--confirm/);

    const response = handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });
    assert.equal(response.confirmed, true);
    assert.equal(response.record.scope, 'task');
    assert.equal(response.record.targetId, 'demo-task');

    // A fresh `step start` call (a separate logical invocation) must see the durable
    // signoff — the human gate no longer reports blocked.
    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', {
      activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });
    const humanGate = stepContext.finishContract.gates.find(g => g.gateType === 'human');
    assert.equal(humanGate.status, 'passed');
  });
});

describe('workflow verify-human --gate disambiguation on a step with multiple human gates (D24/D29/D30, AC10)', () => {
  let fx;
  before(async () => {
    fx = makeFixture('nevo-cli-multi-gate', {
      changeYaml: MULTI_GATE_CHANGE_YAML,
      workflowId: 'vertical-poc-multi-gate',
      workflowYaml: MULTI_GATE_WORKFLOW_YAML,
    });
    // D37: a human-verification exit gate is only meaningful for an active step.
    await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('confirming without --gate on an ambiguous step is rejected, listing both real gate ids', () => {
    assert.throws(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task', { confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      /qa-review.*owner-review|owner-review.*qa-review/
    );
  });

  test('an unknown --gate id is rejected rather than silently confirming a real gate', () => {
    assert.throws(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task', { confirm: true, gate: 'not-a-real-gate', activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      /not-a-real-gate/
    );
  });

  test('--gate confirms only the named gate, leaving the other unmet', async () => {
    const response = handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      confirm: true, gate: 'qa-review', activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });
    assert.equal(response.confirmed, true);

    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    const qaGate = stepContext.finishContract.gates.find(g => g.id === 'qa-review');
    const ownerGate = stepContext.finishContract.gates.find(g => g.id === 'owner-review');
    assert.equal(qaGate.status, 'passed');
    assert.equal(ownerGate.status, 'blocked');
  });

  test('confirming the second gate by id completes both, without needing --gate anymore', async () => {
    handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      confirm: true, gate: 'owner-review', activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });

    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    const qaGate = stepContext.finishContract.gates.find(g => g.id === 'qa-review');
    const ownerGate = stepContext.finishContract.gates.find(g => g.id === 'owner-review');
    assert.equal(qaGate.status, 'passed');
    assert.equal(ownerGate.status, 'passed');
  });
});

describe('workflow verify-human persists the configured gate\'s own role, not a hardcoded "owner" (D29)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-reviewer-role', {
      changeYaml: REVIEWER_ROLE_CHANGE_YAML,
      workflowId: 'vertical-poc-reviewer-role',
      workflowYaml: REVIEWER_ROLE_WORKFLOW_YAML,
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('verify-human --confirm on a role: reviewer gate persists role "reviewer", and a subsequent step start sees it passed', async () => {
    const before = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    const beforeGate = before.finishContract.gates.find(g => g.gateType === 'human');
    assert.equal(beforeGate.status, 'blocked', 'a required reviewer gate with no signoff yet must block, not silently pass');

    const response = handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });
    assert.equal(response.confirmed, true);
    assert.equal(response.record.role, 'reviewer');

    const after = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    const afterGate = after.finishContract.gates.find(g => g.gateType === 'human');
    assert.equal(afterGate.status, 'passed');
  });
});

describe('confirming step A\'s human gate never satisfies an independently-configured gate on step B (D24, task 08 AC10)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-cross-step', {
      changeYaml: CROSS_STEP_CHANGE_YAML,
      workflowId: 'vertical-poc-cross-step',
      workflowYaml: CROSS_STEP_WORKFLOW_YAML,
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('confirming stepA leaves stepB\'s own gate unmet once the task advances there', async () => {
    // D37: `step start` activates stepA (entry step) before its human gate is
    // meaningful to confirm.
    await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    const confirmA = handleWorkflowVerifyHuman('demo-change', 'demo-task', { confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(confirmA.confirmed, true);

    const stepAContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(stepAContext.finishContract.gates.find(g => g.gateType === 'human').status, 'passed');

    // Advance the task to stepB directly (the finalize sequence itself is exhaustively
    // tested elsewhere; this test isolates the storage-scoping guarantee).
    const change = requireChange('demo-change', fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', { workflowProgress: { current_step: 'stepB', current_attempt: 1, state: 'active', history: [{ step: 'stepA', attempt: 1, completed_at: 'x', transitioned_to: 'stepB' }] } });

    const stepBContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(stepBContext.currentStep, 'stepB');
    assert.equal(
      stepBContext.finishContract.gates.find(g => g.gateType === 'human').status,
      'blocked',
      'stepA\'s confirmation must never satisfy stepB\'s independently-configured human gate'
    );

    const confirmB = handleWorkflowVerifyHuman('demo-change', 'demo-task', { confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(confirmB.confirmed, true);
    const stepBContextAfter = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(stepBContextAfter.finishContract.gates.find(g => g.gateType === 'human').status, 'passed');
  });
});

describe('Multi-step CLI sequence: new -> active(A) -> completed(A) -> active(B) -> completed(B) -> terminal (D37, task 10 AC11)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-sequence', {
      changeYaml: SEQUENCE_CHANGE_YAML,
      workflowId: 'vertical-poc-sequence',
      workflowYaml: SEQUENCE_WORKFLOW_YAML,
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('drives the full sequence entirely through handleWorkflowStepStart/handleWorkflowStepFinish, no internal resolution function called', async () => {
    // new -> active(A)
    const startA = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(startA.currentStep, 'stepA');
    assert.equal(startA.runtimeState, 'active');
    assert.equal(startA.semanticStatus, 'a-active');

    // resume: a second step start while still active is a harmless no-op, same result.
    const resumeA = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(resumeA.currentStep, 'stepA');
    assert.equal(resumeA.runtimeState, 'active');

    // active(A) -> completed(A): finish never advances current_step (D37).
    writeFileSync(join(fx.root, 'feature-a.txt'), 'work on stepA\n');
    const finishA = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
      input: JSON.stringify({ 'commit.title': 'Finish stepA', include: ['*'] }),
    });
    assert.equal(finishA.status, 'completed');

    const taskAfterA = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task');
    assert.equal(taskAfterA.workflow_progress.current_step, 'stepA', 'D37: finish never advances current_step');
    assert.equal(taskAfterA.workflow_progress.state, 'completed');

    // repeated finish on the completed step is non-actionable — no new commit, and the
    // response is explicitly `already-completed` (AC7), never the ambiguous `completed`
    // a first-time success returns.
    const commitsBeforeRepeat = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();
    const repeatFinishA = await handleWorkflowStepFinish('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(repeatFinishA.status, 'already-completed');
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBeforeRepeat);

    // completed(A) -> active(B): only the next step start activates the next step.
    const startB = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(startB.currentStep, 'stepB');
    assert.equal(startB.runtimeState, 'active');
    assert.equal(startB.semanticStatus, 'b-active');
    const taskAfterActivateB = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task');
    assert.equal(taskAfterActivateB.workflow_progress.history.length, 1, 'activating the next step appends no history entry');

    // active(B) -> completed(B) + terminal (stepB's transition target is `verified`).
    writeFileSync(join(fx.root, 'feature-b.txt'), 'work on stepB\n');
    const finishB = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
      input: JSON.stringify({ 'commit.title': 'Finish stepB', include: ['*'] }),
    });
    assert.equal(finishB.status, 'completed');

    const taskAfterB = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task');
    assert.equal(taskAfterB.status, 'verified');
    assert.equal(taskAfterB.workflow_progress.current_step, 'stepB');
    assert.equal(taskAfterB.workflow_progress.state, 'completed');
    assert.equal(taskAfterB.workflow_progress.history.length, 2);

    // terminal: a further step start reports complete, mutates nothing.
    const terminalStart = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(terminalStart.currentStep, null);
    assert.equal(terminalStart.stepStatus, 'complete');
    assert.equal(terminalStart.runtimeState, 'completed');
    assert.equal(terminalStart.semanticStatus, 'b-completed');
  });
});

describe('Fail-closed on invalid persisted workflow_progress.state, via the public CLI (AC19, corrective revision)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-invalid-state', {
      changeYaml: `id: demo-change
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
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: bogus
      history: []
`,
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('workflow step start rejects a hand-crafted change.yaml with an invalid state, independent of a prior `specs validate` run', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      (err) => {
        assert.equal(err.code, 'INVALID_WORKFLOW_PROGRESS_STATE');
        return true;
      }
    );
  });

  test('workflow step finish --check rejects it identically', async () => {
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', { check: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      (err) => {
        assert.equal(err.code, 'INVALID_WORKFLOW_PROGRESS_STATE');
        return true;
      }
    );
  });
});

describe('in-flight operation precedes workflow_progress resolution via the public CLI (Task 04 AC1, corrective revision)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-inflight-precedence', {
      // A crash mid-`update-task` write could plausibly leave workflow_progress
      // unresolvable (here: no current_attempt at all) — exactly the state the in-flight
      // record's own reconciliation exists to recover through. handleWorkflowStepFinish
      // must never let resolveWorkflowPosition run — let alone throw — ahead of consulting
      // the in-flight record for execution identity.
      changeYaml: `id: demo-change
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
    workflow_progress:
      current_step: implementation
      state: completed
      history: []
`,
    });
    saveOperationRecord(fx.root, {
      operationId: 'cli-inflight-precedence',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      resolvedInputs: {},
      operations: FINISH_STAGE_IDS.map(id => ({ id, status: 'pending' })),
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('workflow step finish --check resumes via the in-flight record instead of throwing on unresolvable workflow_progress', async () => {
    const plan = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      check: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true,
    });
    assert.equal(plan.stepName, 'implementation');
    assert.equal(plan.attempt, 1);
    assert.notEqual(plan.status, undefined);
  });
});

describe('fail-closed effective workflow-definition version compatibility (D26 refined, task 08 AC13)', () => {
  let fx;
  before(() => {
    fx = makeFixture('nevo-cli-version-mismatch', {
      changeYaml: VERSION_MISMATCH_CHANGE_YAML,
    });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('a change declaring effective workflow.version 2 against a version-1 definition fails step start, naming both versions', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /effective workflow version 2/);
        assert.match(err.message, /version 1/);
        return true;
      }
    );
  });

  test('the same mismatch fails step finish identically', async () => {
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', { check: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true }),
      WorkflowDefinitionError
    );
  });
});

describe('a matching effective version proceeds normally, including the workflow_mode shorthand\'s defaulted version 1 (D26 refined, task 08 AC13)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-cli-version-match'); });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('workflow.version 1 (matching the shipped definition) proceeds normally', async () => {
    const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(stepContext.currentStep, 'implementation');
  });

  test('the workflow_mode: deterministic shorthand (no change.workflow.version field at all) compares against its defaulted effective version 1, never demanding a field that shape doesn\'t have', async () => {
    const shorthandDir = mkdtempSync(join(tmpdir(), 'nevo-cli-version-shorthand-'));
    try {
      git(shorthandDir, ['init', '-q', '--initial-branch=main']);
      git(shorthandDir, ['config', 'user.email', 'fixture@example.com']);
      git(shorthandDir, ['config', 'user.name', 'Fixture']);
      const activeDir = join(shorthandDir, 'specs', 'active');
      const changeDir = join(activeDir, 'demo-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), [
        'id: demo-change', 'title: "Demo change"', 'type: standard', 'status: draft',
        'workflow_mode: deterministic', '',
        'tasks:', '  - id: demo-task', '    order: 1', '    file: tasks/01-demo.md', '    status: in-implementation', '',
      ].join('\n'));
      const workflowsDir = join(shorthandDir, '.nevo-ai', 'workflows');
      mkdirSync(workflowsDir, { recursive: true });
      writeFileSync(join(workflowsDir, 'standard.yaml'), WORKFLOW_YAML.replace('id: vertical-poc', 'id: standard-shorthand'));
      writeFileSync(join(shorthandDir, '.gitignore'), '.nevo-ai-local/\n');
      writeFileSync(join(shorthandDir, 'root.txt'), 'root\n');
      git(shorthandDir, ['add', '-A']);
      git(shorthandDir, ['commit', '-q', '-m', 'initial']);

      const stepContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir, repoRoot: shorthandDir, silent: true });
      assert.equal(stepContext.currentStep, 'implementation');
    } finally {
      rmSync(shorthandDir, { recursive: true, force: true });
    }
  });
});

describe('CLI generic input transport (AC4, AC5)', () => {
  let fx;
  before(async () => {
    fx = makeFixture('nevo-cli-input-transport');
    await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('parseFinishInputs parses valid --input JSON string', () => {
    const payload = { 'commit.title': 'Test title', include: ['*'] };
    const parsed = parseFinishInputs({ input: JSON.stringify(payload) });
    assert.deepEqual(parsed, payload);
  });

  test('parseFinishInputs parses valid --input-file JSON file', () => {
    const filePath = join(fx.root, 'finish-input.json');
    const payload = { 'commit.title': 'File title', include: ['src/*'] };
    writeFileSync(filePath, JSON.stringify(payload));

    const parsed = parseFinishInputs({ inputFile: filePath });
    assert.deepEqual(parsed, payload);

    const parsedKebab = parseFinishInputs({ 'input-file': filePath });
    assert.deepEqual(parsedKebab, payload);
  });

  test('handleWorkflowStepFinish accepts --input <json> in finish check', async () => {
    const plan = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      silent: true,
      check: true,
      input: JSON.stringify({ 'commit.title': 'Valid input title', include: ['*'] }),
    });
    assert.equal(plan.stepName, 'implementation');
  });

  test('handleWorkflowStepFinish accepts --input-file <path> in finish check', async () => {
    const filePath = join(fx.root, 'finish-input-plan.json');
    writeFileSync(filePath, JSON.stringify({ 'commit.title': 'File input title', include: ['*'] }));
    const plan = await handleWorkflowStepFinish('demo-change', 'demo-task', {
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      silent: true,
      check: true,
      inputFile: filePath,
    });
    assert.equal(plan.stepName, 'implementation');
  });

  test('rejects invocation when both --input and --input-file are provided (AC5)', async () => {
    assert.throws(
      () => parseFinishInputs({ input: '{}', inputFile: 'some/path.json' }),
      (err) => {
        assert(err instanceof CliError);
        assert.equal(err.code, 'CLI_USAGE_ERROR');
        assert.match(err.message, /Cannot specify both --input and --input-file/);
        return true;
      }
    );

    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: '{}',
        inputFile: 'some/path.json',
      }),
      (err) => {
        assert(err instanceof CliError);
        assert.equal(err.code, 'CLI_USAGE_ERROR');
        return true;
      }
    );
  });
});

describe('CLI rejection of obsolete flags (AC6)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-cli-obsolete-flags'); });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  const obsoleteFlags = ['title', 'message', 'include', 'exclude', 'result', 'artifact', 'artifacts'];

  for (const flag of obsoleteFlags) {
    test(`rejects obsolete flag --${flag} in parseFinishInputs`, () => {
      assert.throws(
        () => parseFinishInputs({ [flag]: 'some-val' }),
        (err) => {
          assert(err instanceof CliError);
          assert.equal(err.code, 'OBSOLETE_INPUT_FLAG');
          assert.match(
            err.message,
            new RegExp(`^Flag '--${flag}' is obsolete\\. Provide structured inputs via --input '<json>' or --input-file <path>\\.`)
          );
          return true;
        }
      );
    });

    test(`rejects obsolete flag --${flag} in handleWorkflowStepFinish`, async () => {
      await assert.rejects(
        () => handleWorkflowStepFinish('demo-change', 'demo-task', {
          activeDir: fx.activeDir,
          repoRoot: fx.root,
          silent: true,
          [flag]: 'some-val',
        }),
        (err) => {
          assert(err instanceof CliError);
          assert.equal(err.code, 'OBSOLETE_INPUT_FLAG');
          return true;
        }
      );
    });
  }
});

describe('CLI finish input schema validation (AC7)', () => {
  let fx;
  before(async () => {
    fx = makeFixture('nevo-cli-schema-validation');
    await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
  });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('rejects payload with unknown properties (code: UNKNOWN_INPUT_PROPERTY)', async () => {
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 'Valid title',
          include: ['*'],
          unknownProp: 'unexpected',
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'UNKNOWN_INPUT_PROPERTY');
        assert.match(err.message, /Unknown finish input property 'unknownProp'/);
        return true;
      }
    );
  });

  test('rejects payload missing required action inputs (code: MISSING_REQUIRED_INPUT)', async () => {
    // missing include
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 'Valid title',
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'MISSING_REQUIRED_INPUT');
        assert.match(err.message, /Missing required finish input 'include'/);
        return true;
      }
    );

    // missing commit.title
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          include: ['*'],
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'MISSING_REQUIRED_INPUT');
        assert.match(err.message, /Missing required finish input 'commit\.title'/);
        return true;
      }
    );
  });

  test('rejects payload with invalid property types (code: INVALID_INPUT_TYPE)', async () => {
    // commit.title is not string
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 12345,
          include: ['*'],
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_TYPE');
        assert.match(err.message, /Finish input 'commit\.title' must be a string/);
        return true;
      }
    );

    // include is not array
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 'Valid title',
          include: 'not-an-array',
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_TYPE');
        assert.match(err.message, /Finish input 'include' must be an array/);
        return true;
      }
    );

    // include has non-string items
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 'Valid title',
          include: [123],
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_TYPE');
        assert.match(err.message, /Finish input 'include' items must be strings/);
        return true;
      }
    );

    // artifacts is not array
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: JSON.stringify({
          'commit.title': 'Valid title',
          include: ['*'],
          artifacts: 'string-instead-of-array',
        }),
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_TYPE');
        assert.match(err.message, /Finish input 'artifacts' must be an array/);
        return true;
      }
    );
  });

  test('rejects malformed or non-object JSON (code: INVALID_INPUT_JSON)', async () => {
    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: '{ not valid json }',
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_JSON');
        return true;
      }
    );

    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: '123',
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_JSON');
        assert.match(err.message, /Finish input payload must be a non-null object/);
        return true;
      }
    );

    await assert.rejects(
      () => handleWorkflowStepFinish('demo-change', 'demo-task', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
        input: '["array-not-object"]',
      }),
      (err) => {
        assert(err instanceof WorkflowError);
        assert.equal(err.code, 'INVALID_INPUT_JSON');
        assert.match(err.message, /Finish input payload must be a non-null object/);
        return true;
      }
    );
  });
});

