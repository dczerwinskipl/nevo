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
