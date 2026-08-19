// Tests for GateContract, CommandGate, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GateContract,
  GateInspectionResult,
  GateVerificationResult,
  CommandGate,
  DEFAULT_COMMAND_ACTIONS,
  KNOWN_COMMAND_ACTIONS,
  resolveCommandTarget,
  MarkdownGate,
  analyzeMarkdownArtifact,
  HumanVerificationGate,
  HumanVerificationReader,
  MemoryHumanVerificationReader,
  resolveHumanScopeTarget,
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

describe('GateInspectionResult and GateVerificationResult contract hardening (Finding 3)', () => {
  test('GateVerificationResult strictly validates passed boolean', () => {
    assert.throws(
      () => new GateVerificationResult({ gateType: 'command', passed: 'true' }),
      /GateVerificationResult 'passed' must be a strict boolean, got 'string'/
    );
  });

  test('GateVerificationResult validates status values and rejects unknown statuses', () => {
    assert.throws(
      () => new GateVerificationResult({ gateType: 'command', passed: true, status: 'unsupported-status' }),
      /GateVerificationResult 'status' must be one of: passed, failed, blocked, got 'unsupported-status'/
    );
  });

  test('GateVerificationResult rejects contradiction between passed and status', () => {
    assert.throws(
      () => new GateVerificationResult({ gateType: 'command', passed: true, status: 'failed' }),
      /GateVerificationResult contradiction: 'passed: true' is incompatible with 'status: failed'/
    );

    assert.throws(
      () => new GateVerificationResult({ gateType: 'command', passed: false, status: 'passed' }),
      /GateVerificationResult contradiction: 'passed: false' is incompatible with 'status: passed'/
    );
  });

  test('GateInspectionResult strictly validates stale boolean and status', () => {
    assert.throws(
      () => new GateInspectionResult({ gateType: 'command', status: 'passed', stale: 'false' }),
      /GateInspectionResult 'stale' must be a strict boolean, got 'string'/
    );

    assert.throws(
      () => new GateInspectionResult({ gateType: 'command', status: 'unknown-status' }),
      /GateInspectionResult 'status' must be one of: passed, failed, blocked, pending, got 'unknown-status'/
    );
  });
});

describe('CommandGate and verification aliases (Finding 2, 3, 4)', () => {
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
    assert.throws(
      () => resolveCommandTarget({ action: 'commit-and-push' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'UNKNOWN_COMMAND_ACTION');
        return true;
      }
    );
  });

  test('supports constructor dependency injection for runner and verificationCommands (Finding 4)', async () => {
    let injectedRunnerCalled = false;
    const injectedRunner = async (cmd) => {
      injectedRunnerCalled = true;
      return { passed: true, exitCode: 0, stdout: 'Injected runner ok' };
    };

    const gateWithDI = new CommandGate({
      runner: injectedRunner,
      verificationCommands: { lint: 'eslint .' },
    });

    const inspectResult = await gateWithDI.inspect({ action: 'lint' }, {});
    assert.equal(inspectResult.status, 'pending');
    assert.equal(inspectResult.target, 'eslint .');

    const verifyResult = await gateWithDI.verify({ action: 'lint' }, {});
    assert.equal(injectedRunnerCalled, true);
    assert.equal(verifyResult.passed, true);
    assert.equal(verifyResult.status, 'passed');
  });

  test('strict runner result evaluation rejects non-boolean strings and contradictions (Finding 3)', async () => {
    const gate = new CommandGate();

    // String "false" is rejected / fails closed
    const resStringFalse = await gate.verify({ command: 'test' }, { runner: async () => ({ passed: 'false' }) });
    assert.equal(resStringFalse.passed, false);
    assert.equal(resStringFalse.status, 'failed');
    assert.match(resStringFalse.message, /must be a strict boolean/);

    // String "0" is rejected / fails closed
    const resStringZero = await gate.verify({ command: 'test' }, { runner: async () => ({ exitCode: '0' }) });
    assert.equal(resStringZero.passed, false);
    assert.equal(resStringZero.status, 'failed');
    assert.match(resStringZero.message, /must be a strict integer/);

    // Contradictory passed=true and exitCode=1
    const resContradict1 = await gate.verify({ command: 'test' }, { runner: async () => ({ passed: true, exitCode: 1 }) });
    assert.equal(resContradict1.passed, false);
    assert.equal(resContradict1.status, 'failed');
    assert.match(resContradict1.message, /Contradictory runner result/);

    // Contradictory passed=false and exitCode=0
    const resContradict2 = await gate.verify({ command: 'test' }, { runner: async () => ({ passed: false, exitCode: 0 }) });
    assert.equal(resContradict2.passed, false);
    assert.equal(resContradict2.status, 'failed');
    assert.match(resContradict2.message, /Contradictory runner result/);

    // Valid exitCode 0
    const resExit0 = await gate.verify({ command: 'test' }, { runner: async () => ({ exitCode: 0 }) });
    assert.equal(resExit0.passed, true);
    assert.equal(resExit0.status, 'passed');

    // Valid non-zero exitCode
    const resExit1 = await gate.verify({ command: 'test' }, { runner: async () => ({ exitCode: 2 }) });
    assert.equal(resExit1.passed, false);
    assert.equal(resExit1.status, 'failed');
  });

  test('real command execution requires explicit context.repoRoot (Finding 4)', async () => {
    const gate = new CommandGate();
    await assert.rejects(
      async () => await gate.verify({ command: 'echo hello' }, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });
});

describe('MarkdownGate repository containment and explicit repoRoot (Finding 3, 4)', () => {
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
  });

  test('inspect requires explicit context.repoRoot', async () => {
    await assert.rejects(
      async () => await gate.inspect({ file: 'verification.md' }, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
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
});

describe('HumanVerificationGate trusted state and scope targeting (Finding 1, 4)', () => {
  test('supports constructor dependency injection for verificationReader', async () => {
    const reader = new MemoryHumanVerificationReader([
      {
        confirmed: true,
        scope: 'task',
        targetId: 'task-di',
        role: 'owner',
      },
    ]);

    const gate = new HumanVerificationGate({ verificationReader: reader });
    const result = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'task-di' });
    assert.equal(result.status, 'passed');
    assert.equal(result.signoff.targetId, 'task-di');
  });

  test('resolves scope targeting for task, step, and change scopes independently (Finding 4)', async () => {
    const reader = new MemoryHumanVerificationReader([
      { confirmed: true, scope: 'task', targetId: '01-task', role: 'owner' },
      { confirmed: true, scope: 'step', targetId: 'impl-step', role: 'owner' },
      { confirmed: true, scope: 'change', targetId: 'my-change', role: 'owner' },
    ]);

    const gate = new HumanVerificationGate({ verificationReader: reader });

    // Task scope
    const taskRes = await gate.inspect({ required: true, scope: 'task' }, { taskId: '01-task' });
    assert.equal(taskRes.status, 'passed');

    // Step scope
    const stepRes = await gate.inspect({ required: true, scope: 'step' }, { stepId: 'impl-step' });
    assert.equal(stepRes.status, 'passed');

    // Change scope
    const changeRes = await gate.inspect({ required: true, scope: 'change' }, { changeId: 'my-change' });
    assert.equal(changeRes.status, 'passed');
  });

  test('missing scope identity fails closed without inventing current-step', async () => {
    const gate = new HumanVerificationGate();

    // Task scope missing taskId
    const taskRes = await gate.inspect({ required: true, scope: 'task' }, {});
    assert.equal(taskRes.status, 'blocked');
    assert.equal(taskRes.reason, 'missing-scope-identity');
    assert.match(taskRes.message, /requires explicit 'task' identity/);

    // Step scope missing stepId
    const stepRes = await gate.inspect({ required: true, scope: 'step' }, {});
    assert.equal(stepRes.status, 'blocked');
    assert.equal(stepRes.reason, 'missing-scope-identity');

    // Change scope missing changeId
    const changeRes = await gate.inspect({ required: true, scope: 'change' }, {});
    assert.equal(changeRes.status, 'blocked');
    assert.equal(changeRes.reason, 'missing-scope-identity');
  });

  test('raw caller JSON context cannot satisfy human gate when reader is missing', async () => {
    const gate = new HumanVerificationGate();
    const rawContext = {
      taskId: '04-task',
      humanVerification: { confirmed: true, confirmedBy: 'owner' },
      humanSignoffs: { '04-task': { confirmed: true } },
    };

    const inspectResult = await gate.inspect({ required: true, scope: 'task' }, rawContext);
    assert.equal(inspectResult.status, 'blocked');
    assert.equal(inspectResult.reason, 'human-verification-required');
  });
});
