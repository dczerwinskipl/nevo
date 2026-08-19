// Tests for GateContract, CommandGate, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GateContract,
  GateInspectionResult,
  GateVerificationResult,
  CommandGate,
  KNOWN_COMMAND_ACTIONS,
  resolveCommandTarget,
  MarkdownGate,
  analyzeMarkdownArtifact,
  HumanVerificationGate,
  HumanVerificationReader,
  MemoryHumanVerificationReader,
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

describe('CommandGate and verification aliases (Finding 2)', () => {
  const gate = new CommandGate();

  test('resolves built-in test and build command aliases', () => {
    // Built-in test alias
    assert.equal(resolveCommandTarget({ action: 'test' }), 'npm test');
    assert.equal(resolveCommandTarget({ action: 'test' }, { testCommand: 'dotnet test' }), 'dotnet test');

    // Built-in build alias
    assert.equal(resolveCommandTarget({ action: 'build' }), 'npm run build');
    assert.equal(resolveCommandTarget({ action: 'build' }, { buildCommand: 'dotnet build' }), 'dotnet build');
  });

  test('resolves configured custom verification command aliases', () => {
    assert.equal(
      resolveCommandTarget({ action: 'lint' }, { verificationCommands: { lint: 'eslint .' } }),
      'eslint .'
    );
    assert.equal(
      resolveCommandTarget({ action: 'typecheck' }, { actionCommands: { typecheck: 'tsc --noEmit' } }),
      'tsc --noEmit'
    );
  });

  test('unknown logical alias fails closed without fail-open shell execution', () => {
    assert.throws(
      () => resolveCommandTarget({ action: 'unknown-cmd-alias' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Unknown command verification alias 'unknown-cmd-alias'/);
        assert.equal(err.details?.code, 'UNKNOWN_COMMAND_ACTION');
        return true;
      }
    );
  });

  test('workflow ActionRegistry IDs are not accidentally accepted as command aliases', () => {
    // 'commit-and-push' and 'verify-task-output' are ActionContract IDs, NOT command aliases
    assert.throws(
      () => resolveCommandTarget({ action: 'commit-and-push' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'UNKNOWN_COMMAND_ACTION');
        return true;
      }
    );
  });

  test('raw command execution remains supported via explicit command field', () => {
    assert.equal(resolveCommandTarget({ command: 'cargo test --lib' }), 'cargo test --lib');
    assert.equal(resolveCommandTarget({ command: 'pytest -v' }), 'pytest -v');
  });

  test('inspect is 100% non-mutating and returns target and staleness without executing', async () => {
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

  test('verify executes command via runner and records result', async () => {
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

describe('MarkdownGate repository containment (Finding 3)', () => {
  const gate = new MarkdownGate();
  const repoRoot = 'D:/repos/git/nevo';

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

  test('resolves valid repository-relative and nested markdown files', async () => {
    const mockContext = {
      repoRoot,
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Done',
      },
    };

    const topLevelResult = await gate.inspect({ file: 'verification.md' }, mockContext);
    assert.equal(topLevelResult.status, 'passed');

    const nestedResult = await gate.inspect({ file: 'docs/verification/task-01.md' }, mockContext);
    assert.equal(nestedResult.status, 'passed');
  });

  test('rejects ../ path traversal escaping repository root', async () => {
    const context = { repoRoot };

    await assert.rejects(
      async () => await gate.inspect({ file: '../outside-repo.md' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    await assert.rejects(
      async () => await gate.inspect({ file: 'docs/../../outside.md' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );
  });

  test('rejects absolute POSIX and Windows paths', async () => {
    const context = { repoRoot };

    await assert.rejects(
      async () => await gate.inspect({ file: '/etc/passwd' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    await assert.rejects(
      async () => await gate.inspect({ file: 'C:\\Windows\\System32\\secrets.md' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );
  });

  test('inspect reports blocked when artifact does not exist', async () => {
    const mockContext = {
      repoRoot,
      fs: {
        existsSync: () => false,
      },
    };

    const result = await gate.inspect({ file: 'docs/missing-verification.md' }, mockContext);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'artifact-missing');
    assert.match(result.message, /does not exist/);
  });

  test('verify passes when markdown artifact is complete', async () => {
    const mockContext = {
      repoRoot,
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

describe('HumanVerificationGate trusted state boundary (Finding 1)', () => {
  const gate = new HumanVerificationGate();

  test('raw caller JSON context cannot satisfy human gate when reader is missing', async () => {
    // An agent passing confirmed: true in raw caller context must remain BLOCKED
    const rawContext = {
      taskId: '04-task',
      step: 'implementation',
      humanVerification: { confirmed: true, confirmedBy: 'owner' },
      humanSignoffs: { '04-task': { confirmed: true } },
    };

    const inspectResult = await gate.inspect({ required: true }, rawContext);
    assert.equal(inspectResult.status, 'blocked');
    assert.equal(inspectResult.reason, 'human-verification-required');

    const verifyResult = await gate.verify({ required: true }, rawContext);
    assert.equal(verifyResult.passed, false);
    assert.equal(verifyResult.status, 'blocked');
  });

  test('trusted matching owner signoff passes gate inspection and verification', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: true,
        scope: 'task',
        targetId: '04-task',
        role: 'owner',
        confirmedBy: 'owner',
        timestamp: '2026-08-19T09:00:00Z',
      },
    ]);

    const context = {
      taskId: '04-task',
      step: 'implementation',
      humanVerificationReader: reader,
    };

    const inspectResult = await gate.inspect({ required: true, role: 'owner', scope: 'task' }, context);
    assert.equal(inspectResult.status, 'passed');
    assert.equal(inspectResult.signoff.confirmedBy, 'owner');
    assert.equal(inspectResult.signoff.targetId, '04-task');

    const verifyResult = await gate.verify({ required: true, role: 'owner', scope: 'task' }, context);
    assert.equal(verifyResult.passed, true);
    assert.equal(verifyResult.status, 'passed');
  });

  test('wrong role in signoff fails gate', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: true,
        scope: 'task',
        targetId: '04-task',
        role: 'contributor', // Required is 'owner'
      },
    ]);

    const context = {
      taskId: '04-task',
      humanVerificationReader: reader,
    };

    const result = await gate.inspect({ required: true, role: 'owner' }, context);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'human-verification-required');
  });

  test('wrong targetId in signoff fails gate', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: true,
        scope: 'task',
        targetId: 'other-task',
        role: 'owner',
      },
    ]);

    const context = {
      taskId: '04-task',
      humanVerificationReader: reader,
    };

    const result = await gate.inspect({ required: true, role: 'owner' }, context);
    assert.equal(result.status, 'blocked');
  });

  test('wrong scope in signoff fails gate', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: true,
        scope: 'step', // Required is 'task'
        targetId: '04-task',
        role: 'owner',
      },
    ]);

    const context = {
      taskId: '04-task',
      humanVerificationReader: reader,
    };

    const result = await gate.inspect({ required: true, role: 'owner', scope: 'task' }, context);
    assert.equal(result.status, 'blocked');
  });

  test('malformed signoff (confirmed: false or non-object) fails gate', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: false,
        scope: 'task',
        targetId: '04-task',
        role: 'owner',
      },
    ]);

    const context = {
      taskId: '04-task',
      humanVerificationReader: reader,
    };

    const result = await gate.inspect({ required: true, role: 'owner' }, context);
    assert.equal(result.status, 'blocked');
  });

  test('inspect is 100% non-mutating and does not alter signoffs', async () => {
    const reader = new MemoryHumanVerificationReader([]);
    const context = {
      taskId: '04-task',
      humanVerificationReader: reader,
    };

    const result = await gate.inspect({ required: true }, context);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(reader._signoffs, []);
  });
});
