// Tests for GateContract, CommandGate, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GateContract,
  GateInspectionResult,
  GateVerificationResult,
  CommandGate,
  resolveCommandTarget,
  MarkdownGate,
  analyzeMarkdownArtifact,
  HumanVerificationGate,
  GateRegistry,
  createDefaultGateRegistry,
  defaultGateRegistry,
  WorkflowError,
} from '../specs/workflow/index.mjs';

describe('GateRegistry and GateContract (AC1)', () => {
  let registry;

  beforeEach(() => {
    registry = new GateRegistry();
  });

  test('GateContract base class enforces required methods', async () => {
    class UnimplementedGate extends GateContract {}
    const gate = new UnimplementedGate();

    assert.throws(() => gate.type, /must implement get type\(\)/);
    await assert.rejects(async () => await gate.inspect({}, {}), /must implement inspect/);
    await assert.rejects(async () => await gate.verify({}, {}), /must implement verify/);
  });

  test('GateRegistry registers, retrieves, and unregisters gate handlers', () => {
    const cmdGate = new CommandGate();
    registry.register(cmdGate);

    assert.equal(registry.has('command'), true);
    assert.equal(registry.get('command'), cmdGate);
    assert.equal(registry.require('command'), cmdGate);
    assert.deepEqual(registry.list(), ['command']);

    assert.equal(registry.unregister('command'), true);
    assert.equal(registry.has('command'), false);
  });

  test('GateRegistry rejects duplicate registration', () => {
    registry.register(new CommandGate());
    assert.throws(
      () => registry.register(new CommandGate()),
      /Gate type 'command' is already registered/
    );
  });

  test('createDefaultGateRegistry pre-registers built-in command, markdown, and human gates', () => {
    const defRegistry = createDefaultGateRegistry();
    assert.equal(defRegistry.has('command'), true);
    assert.equal(defRegistry.has('markdown'), true);
    assert.equal(defRegistry.has('human'), true);
  });
});

describe('CommandGate (AC2, AC3, AC6)', () => {
  const gate = new CommandGate();

  test('resolveCommandTarget resolves logical actions and raw commands', () => {
    // Action 'test'
    assert.equal(resolveCommandTarget({ action: 'test' }), 'npm test');
    assert.equal(resolveCommandTarget({ action: 'test' }, { testCommand: 'dotnet test' }), 'dotnet test');

    // Action 'build'
    assert.equal(resolveCommandTarget({ action: 'build' }), 'npm run build');

    // Raw command
    assert.equal(resolveCommandTarget({ command: 'cargo test --lib' }), 'cargo test --lib');

    // Custom action mapping
    assert.equal(
      resolveCommandTarget({ action: 'lint' }, { actionCommands: { lint: 'eslint .' } }),
      'eslint .'
    );
  });

  test('inspect is 100% non-mutating and returns target and staleness without executing (AC2)', async () => {
    let runnerCalled = false;
    const context = {
      testCommand: 'npm test',
      runner: () => { runnerCalled = true; },
      lastVerification: { 'npm test': { passed: true } },
      testStale: false,
    };

    const result = await gate.inspect({ action: 'test' }, context);

    assert.equal(runnerCalled, false, 'inspect must NEVER execute the command runner');
    assert.ok(result instanceof GateInspectionResult);
    assert.equal(result.gateType, 'command');
    assert.equal(result.status, 'passed');
    assert.equal(result.target, 'npm test');
    assert.equal(result.stale, false);
    assert.match(result.message, /Command gate targets 'npm test'/);
  });

  test('inspect returns pending status when no verification has been recorded', async () => {
    const result = await gate.inspect({ command: 'node --test' }, {});
    assert.equal(result.status, 'pending');
    assert.equal(result.target, 'node --test');
    assert.equal(result.stale, true);
  });

  test('verify executes command via runner and records result (AC3)', async () => {
    const mockContext = {
      runner: async (cmd) => {
        if (cmd === 'failing-test') {
          return { passed: false, exitCode: 1, stderr: 'Tests failed' };
        }
        return { passed: true, exitCode: 0, stdout: 'All passed' };
      },
    };

    const passResult = await gate.verify({ command: 'passing-test' }, mockContext);
    assert.ok(passResult instanceof GateVerificationResult);
    assert.equal(passResult.passed, true);
    assert.equal(passResult.status, 'passed');

    const failResult = await gate.verify({ command: 'failing-test' }, mockContext);
    assert.equal(failResult.passed, false);
    assert.equal(failResult.status, 'failed');
  });
});

describe('MarkdownGate (AC4, AC6)', () => {
  const gate = new MarkdownGate();

  test('analyzeMarkdownArtifact detects checklist items and required sections', () => {
    const completeContent = `
# Verification Plan
## Requirements
- [x] Item 1
- [X] Item 2
`;
    const analysis = analyzeMarkdownArtifact(completeContent, ['Requirements']);
    assert.equal(analysis.complete, true);
    assert.equal(analysis.incompleteChecklistItems.length, 0);
    assert.equal(analysis.completedChecklistItems.length, 2);
    assert.equal(analysis.missingSections.length, 0);

    const incompleteContent = `
# Verification Plan
- [ ] Incomplete item
- [x] Completed item
`;
    const incompleteAnalysis = analyzeMarkdownArtifact(incompleteContent, ['Requirements']);
    assert.equal(incompleteAnalysis.complete, false);
    assert.equal(incompleteAnalysis.incompleteChecklistItems.length, 1);
    assert.equal(incompleteAnalysis.incompleteChecklistItems[0], 'Incomplete item');
    assert.deepEqual(incompleteAnalysis.missingSections, ['Requirements']);
  });

  test('inspect reports blocked when artifact does not exist (AC4)', async () => {
    const mockContext = {
      fs: {
        existsSync: () => false,
      },
    };

    const result = await gate.inspect({ file: 'docs/missing-verification.md' }, mockContext);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'artifact-missing');
    assert.match(result.message, /does not exist/);
  });

  test('inspect reports blocked when artifact has incomplete items', async () => {
    const mockContext = {
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [ ] Pending check\n- [x] Done',
      },
    };

    const result = await gate.inspect({ file: 'verification.md' }, mockContext);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'artifact-incomplete');
    assert.match(result.message, /1 incomplete checklist item/);
  });

  test('verify passes when markdown artifact is complete', async () => {
    const mockContext = {
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Verified step 1\n- [x] Verified step 2',
      },
    };

    const result = await gate.verify({ file: 'verification.md' }, mockContext);
    assert.equal(result.passed, true);
    assert.equal(result.status, 'passed');
  });
});

describe('HumanVerificationGate (AC5, AC6)', () => {
  const gate = new HumanVerificationGate();

  test('inspect returns blocked machine-readable state when sign-off is missing (AC5)', async () => {
    const context = {
      taskId: '04-concrete-action-commit-and-push',
      step: 'implementation',
    };

    const result = await gate.inspect({ required: true, role: 'owner' }, context);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'human-verification-required');
    assert.equal(result.gateType, 'human');
    assert.deepEqual(result.signoff, {
      requiredRole: 'owner',
      scope: 'task',
      targetId: '04-concrete-action-commit-and-push',
    });
  });

  test('inspect returns passed when human operator sign-off is recorded in context', async () => {
    const context = {
      taskId: '04-concrete-action-commit-and-push',
      humanVerification: {
        confirmed: true,
        confirmedBy: 'owner',
        timestamp: '2026-08-19T08:30:00Z',
      },
    };

    const result = await gate.inspect({ required: true }, context);
    assert.equal(result.status, 'passed');
    assert.equal(result.signoff.confirmedBy, 'owner');
  });

  test('verify returns blocked when human verification is not recorded', async () => {
    const result = await gate.verify({ required: true }, { taskId: 'task-1' });
    assert.equal(result.passed, false);
    assert.equal(result.status, 'blocked');
  });

  test('verify passes when valid human sign-off is present', async () => {
    const context = {
      taskId: 'task-1',
      humanVerification: { confirmed: true, confirmedBy: 'owner' },
    };

    const result = await gate.verify({ required: true }, context);
    assert.equal(result.passed, true);
    assert.equal(result.status, 'passed');
  });
});
