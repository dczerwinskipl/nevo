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
} from '../specs/workflow/cli.mjs';
import { requireChange, setTaskWorkflowState } from '../specs/store.mjs';
import { WorkflowDefinitionError } from '../specs/workflow/errors.mjs';

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
    entryGates: []
    actions:
      - id: implement-task
    exitGates:
      - type: command
        command: "node -e \\"process.exit(0)\\""
      - type: human
        required: true
    finalize:
      - id: verify-task-output
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
    entryGates: []
    actions:
      - id: implement-task
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
    entryGates: []
    actions:
      - id: implement-task
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
    entryGates: []
    actions:
      - id: implement-task
    exitGates:
      - type: human
        required: true
    finalize:
      - id: commit-and-push
    transitions:
      - to: stepB
  stepB:
    entryGates: []
    actions:
      - id: implement-task
    exitGates:
      - type: human
        required: true
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
    assert.deepEqual(stepContext.nextStepGuidance, { onSuccess: 'verified' });
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
  before(() => {
    fx = makeFixture('nevo-cli-multi-gate', {
      changeYaml: MULTI_GATE_CHANGE_YAML,
      workflowId: 'vertical-poc-multi-gate',
      workflowYaml: MULTI_GATE_WORKFLOW_YAML,
    });
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
    // Task starts on stepA (no workflow_progress yet — resolves to entryStep).
    const confirmA = handleWorkflowVerifyHuman('demo-change', 'demo-task', { confirm: true, activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(confirmA.confirmed, true);

    const stepAContext = await handleWorkflowStepStart('demo-change', 'demo-task', { activeDir: fx.activeDir, repoRoot: fx.root, silent: true });
    assert.equal(stepAContext.finishContract.gates.find(g => g.gateType === 'human').status, 'passed');

    // Advance the task to stepB directly (the finalize sequence itself is exhaustively
    // tested elsewhere; this test isolates the storage-scoping guarantee).
    const change = requireChange('demo-change', fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', { workflowProgress: { current_step: 'stepB', history: [] } });

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
