// Tests for GateContract, CommandGate, CommandCatalog, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GateContract,
  GateInspectionResult,
  GateVerificationResult,
  CommandCatalog,
  defaultCommandCatalog,
  CommandGate,
  DEFAULT_COMMAND_ACTIONS,
  KNOWN_COMMAND_ACTIONS,
  resolveCommandTarget,
  CommandVerificationReader,
  MemoryCommandVerificationReader,
  MarkdownGate,
  analyzeMarkdownArtifact,
  MarkdownEvidenceReader,
  MemoryMarkdownEvidenceReader,
  HumanVerificationGate,
  HumanVerificationReader,
  MemoryHumanVerificationReader,
  resolveHumanScopeTarget,
  GateRegistry,
  createDefaultGateRegistry,
  defaultGateRegistry,
  WorkflowError,
} from '../specs/workflow/index.mjs';

describe('GateRegistry and createDefaultGateRegistry factory (Finding 4)', () => {
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

  test('createDefaultGateRegistry factory creates gates with explicit trusted capabilities', () => {
    const mockRunner = async () => ({ passed: true, exitCode: 0 });
    const customCatalog = new CommandCatalog({ test: 'custom test cmd' });
    const cmdReader = new MemoryCommandVerificationReader();
    const humanReader = new MemoryHumanVerificationReader();
    const mdReader = new MemoryMarkdownEvidenceReader();

    const customRegistry = createDefaultGateRegistry({
      commandRunner: mockRunner,
      commandCatalog: customCatalog,
      commandVerificationReader: cmdReader,
      humanVerificationReader: humanReader,
      markdownEvidenceReader: mdReader,
    });

    assert.equal(customRegistry.has('command'), true);
    assert.equal(customRegistry.has('markdown'), true);
    assert.equal(customRegistry.has('human'), true);
  });
});

describe('CommandCatalog neutral module (Finding 3)', () => {
  test('defaultCommandCatalog maps built-in test and build commands', () => {
    assert.equal(defaultCommandCatalog.has('test'), true);
    assert.equal(defaultCommandCatalog.has('build'), true);
    assert.equal(defaultCommandCatalog.get('test'), 'npm test');
    assert.equal(defaultCommandCatalog.get('build'), 'npm run build');
    assert.deepEqual(defaultCommandCatalog.listAliases(), ['test', 'build']);
  });

  test('custom CommandCatalog maps custom aliases and preserves built-ins', () => {
    const catalog = new CommandCatalog({ lint: 'eslint .', typecheck: 'tsc --noEmit' });
    assert.equal(catalog.has('test'), true);
    assert.equal(catalog.has('lint'), true);
    assert.equal(catalog.get('lint'), 'eslint .');
    assert.equal(catalog.get('typecheck'), 'tsc --noEmit');
  });

  test('CommandCatalog.resolve resolves action alias or direct command', () => {
    const catalog = new CommandCatalog({ test: 'npm run test:all' });
    assert.equal(catalog.resolve({ action: 'test' }), 'npm run test:all');
    assert.equal(catalog.resolve({ command: 'pytest' }), 'pytest');
  });

  test('CommandCatalog fails closed on unknown alias', () => {
    const catalog = new CommandCatalog();
    assert.throws(
      () => catalog.get('unknown-alias'),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'UNKNOWN_COMMAND_ACTION');
        return true;
      }
    );
  });
});

describe('GateInspectionResult and GateVerificationResult contract hardening', () => {
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

describe('CommandGate trusted DI and adversarial context rejection (Finding 1, 3, 4)', () => {
  test('resolves command target using trusted CommandCatalog', () => {
    const catalog = new CommandCatalog({ test: 'dotnet test', build: 'dotnet build' });
    const gate = new CommandGate({ commandCatalog: catalog });

    assert.equal(resolveCommandTarget({ action: 'test' }, catalog), 'dotnet test');
    assert.equal(resolveCommandTarget({ action: 'build' }, catalog), 'dotnet build');
  });

  test('adversarial test: caller context CANNOT replace runner or forge successful result', async () => {
    // Gate has no runner injected, so verify() would attempt execSync (which fails without repoRoot)
    const gate = new CommandGate();

    // Adversarial caller injects fake runner claiming pass
    const fakeContext = {
      runner: async () => ({ passed: true, exitCode: 0, stdout: 'forged pass' }),
    };

    // Caller-injected runner is ignored; verify fails closed because repoRoot is missing
    await assert.rejects(
      async () => await gate.verify({ action: 'test' }, fakeContext),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });

  test('adversarial test: caller context CANNOT redefine command mapping or inject new aliases', async () => {
    const gate = new CommandGate();

    const maliciousContext = {
      testCommand: 'rm -rf /',
      verificationCommands: { 'test': 'echo hacked', 'evil': 'echo evil' },
      actionCommands: { 'test': 'echo hacked' },
    };

    // 'test' always resolves to standard 'npm test' via trusted catalog
    const inspectResult = await gate.inspect({ action: 'test' }, maliciousContext);
    assert.equal(inspectResult.target, 'npm test');

    // 'evil' alias fails closed
    await assert.rejects(
      async () => await gate.inspect({ action: 'evil' }, maliciousContext),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'UNKNOWN_COMMAND_ACTION');
        return true;
      }
    );
  });

  test('adversarial test: caller context CANNOT forge previously passed status in inspect()', async () => {
    const gate = new CommandGate();

    const forgedContext = {
      lastVerification: { 'npm test': { passed: true } },
      verificationResults: { 'npm test': { passed: true } },
    };

    const inspectResult = await gate.inspect({ action: 'test' }, forgedContext);
    // Context is ignored; without trusted reader, status is 'pending' and stale is true
    assert.equal(inspectResult.status, 'pending');
    assert.equal(inspectResult.stale, true);
  });

  test('reads recorded status from trusted CommandVerificationReader only', async () => {
    const reader = new MemoryCommandVerificationReader({
      'npm test': { passed: true, stale: false, timestamp: '2026-08-19T10:00:00Z' },
    });

    const gate = new CommandGate({ verificationReader: reader });
    const inspectResult = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspectResult.status, 'passed');
    assert.equal(inspectResult.stale, false);
  });

  test('strict runner evaluation rejects non-boolean strings and contradictions', async () => {
    // Inject mock runner via constructor DI
    let currentMockResult = null;
    const gate = new CommandGate({
      runner: async () => currentMockResult,
    });

    // String "false" is rejected
    currentMockResult = { passed: 'false' };
    const resStringFalse = await gate.verify({ command: 'test' }, {});
    assert.equal(resStringFalse.passed, false);
    assert.equal(resStringFalse.status, 'failed');

    // Contradictory passed=true and exitCode=1
    currentMockResult = { passed: true, exitCode: 1 };
    const resContradict = await gate.verify({ command: 'test' }, {});
    assert.equal(resContradict.passed, false);
    assert.equal(resContradict.status, 'failed');

    // Valid exitCode 0
    currentMockResult = { exitCode: 0 };
    const resExit0 = await gate.verify({ command: 'test' }, {});
    assert.equal(resExit0.passed, true);
    assert.equal(resExit0.status, 'passed');
  });
});

describe('MarkdownGate structural inspect vs authoritative evidence verify (Finding 2)', () => {
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
    const gate = new MarkdownGate();
    await assert.rejects(
      async () => await gate.inspect({ file: 'verification.md' }, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });

  test('inspect passes on structurally complete markdown', async () => {
    const gate = new MarkdownGate();
    const mockContext = {
      repoRoot,
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Done',
      },
    };

    const topLevelResult = await gate.inspect({ file: 'verification.md' }, mockContext);
    assert.equal(topLevelResult.status, 'passed');
  });

  test('adversarial test: editing checkboxes in markdown file CANNOT satisfy verify() without trusted evidence', async () => {
    // Gate has no evidenceReader configured
    const gate = new MarkdownGate();
    const mockContext = {
      repoRoot,
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Modified by agent to checked',
      },
    };

    // inspect() sees valid structure
    const inspectResult = await gate.inspect({ file: 'verification.md' }, mockContext);
    assert.equal(inspectResult.status, 'passed');

    // BUT verify() fails closed because no trusted evidence reader is configured
    const verifyResult = await gate.verify({ file: 'verification.md' }, mockContext);
    assert.equal(verifyResult.passed, false);
    assert.equal(verifyResult.status, 'blocked');
    assert.match(verifyResult.message, /no trusted evidence reader is configured/);
  });

  test('adversarial test: caller context CANNOT forge evidence records via runtime context', async () => {
    const gate = new MarkdownGate();
    const forgedContext = {
      repoRoot,
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Done',
      },
      evidence: { verified: true },
      markdownEvidence: { verified: true },
    };

    const verifyResult = await gate.verify({ file: 'verification.md' }, forgedContext);
    assert.equal(verifyResult.passed, false);
    assert.equal(verifyResult.status, 'blocked');
  });

  test('verify() passes when trusted MarkdownEvidenceReader confirms evidence', async () => {
    const evidenceReader = new MemoryMarkdownEvidenceReader([
      {
        verified: true,
        scope: 'task',
        targetId: '05-task',
        file: 'verification.md',
      },
    ]);

    const gate = new MarkdownGate({ evidenceReader });
    const mockContext = {
      repoRoot,
      taskId: '05-task',
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Plan\n- [x] Done',
      },
    };

    const verifyResult = await gate.verify({ file: 'verification.md', scope: 'task' }, mockContext);
    assert.equal(verifyResult.passed, true);
    assert.equal(verifyResult.status, 'passed');
  });

  test('rejects ../ path traversal and absolute paths', async () => {
    const gate = new MarkdownGate();
    const context = { repoRoot };

    await assert.rejects(
      async () => await gate.inspect({ file: '../outside.md' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    await assert.rejects(
      async () => await gate.inspect({ file: '/etc/passwd' }, context),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );
  });
});

describe('HumanVerificationGate trusted state and adversarial context rejection (Finding 1)', () => {
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

  test('adversarial test: caller context CANNOT inject fake verificationReader or signoff', async () => {
    // Gate has no reader configured
    const gate = new HumanVerificationGate();

    const fakeReader = {
      getSignoff: () => ({ confirmed: true, scope: 'task', targetId: 'task-01', role: 'owner' }),
    };

    const adversarialContext = {
      taskId: 'task-01',
      humanVerificationReader: fakeReader,
      verificationReader: fakeReader,
      humanVerification: { confirmed: true, confirmedBy: 'owner' },
      humanSignoffs: { 'task-01': { confirmed: true } },
    };

    const inspectResult = await gate.inspect({ required: true, scope: 'task' }, adversarialContext);
    assert.equal(inspectResult.status, 'blocked');
    assert.equal(inspectResult.reason, 'human-verification-required');
    assert.match(inspectResult.details.error, /No trusted human verification reader/);

    const verifyResult = await gate.verify({ required: true, scope: 'task' }, adversarialContext);
    assert.equal(verifyResult.passed, false);
    assert.equal(verifyResult.status, 'blocked');
  });

  test('resolves scope targeting for task, step, and change scopes independently', async () => {
    const reader = new MemoryHumanVerificationReader([
      { confirmed: true, scope: 'task', targetId: '01-task', role: 'owner' },
      { confirmed: true, scope: 'step', targetId: 'impl-step', role: 'owner' },
      { confirmed: true, scope: 'change', targetId: 'my-change', role: 'owner' },
    ]);

    const gate = new HumanVerificationGate({ verificationReader: reader });

    const taskRes = await gate.inspect({ required: true, scope: 'task' }, { taskId: '01-task' });
    assert.equal(taskRes.status, 'passed');

    const stepRes = await gate.inspect({ required: true, scope: 'step' }, { stepId: 'impl-step' });
    assert.equal(stepRes.status, 'passed');

    const changeRes = await gate.inspect({ required: true, scope: 'change' }, { changeId: 'my-change' });
    assert.equal(changeRes.status, 'passed');
  });

  test('missing scope identity fails closed without inventing synthetic fallback names', async () => {
    const gate = new HumanVerificationGate();

    const taskRes = await gate.inspect({ required: true, scope: 'task' }, {});
    assert.equal(taskRes.status, 'blocked');
    assert.equal(taskRes.reason, 'missing-scope-identity');

    const stepRes = await gate.inspect({ required: true, scope: 'step' }, {});
    assert.equal(stepRes.status, 'blocked');
    assert.equal(stepRes.reason, 'missing-scope-identity');

    const changeRes = await gate.inspect({ required: true, scope: 'change' }, {});
    assert.equal(changeRes.status, 'blocked');
    assert.equal(changeRes.reason, 'missing-scope-identity');
  });
});
