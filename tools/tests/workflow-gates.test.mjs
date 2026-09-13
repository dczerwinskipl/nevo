// Tests for GateContract, CommandGate, CommandCatalog, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  CommandVerificationStore,
  CommandVerificationReader,
  MemoryCommandVerificationStore,
  MemoryCommandVerificationReader,
  MarkdownGate,
  analyzeMarkdownArtifact,
  computeArtifactHash,
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

describe('GateRegistry and createDefaultGateRegistry factory', () => {
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
    const cmdStore = new MemoryCommandVerificationStore();
    const humanReader = new MemoryHumanVerificationReader();
    const mdReader = new MemoryMarkdownEvidenceReader();

    const customRegistry = createDefaultGateRegistry({
      commandRunner: mockRunner,
      commandCatalog: customCatalog,
      commandVerificationStore: cmdStore,
      humanVerificationReader: humanReader,
      markdownEvidenceReader: mdReader,
    });

    assert.equal(customRegistry.has('command'), true);
    assert.equal(customRegistry.has('markdown'), true);
    assert.equal(customRegistry.has('human'), true);
  });
});

describe('CommandCatalog neutral module and runtime XOR enforcement', () => {
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

  test('CommandCatalog.resolve enforces strict action/command XOR at runtime', () => {
    const catalog = new CommandCatalog();

    assert.throws(
      () => catalog.resolve({ action: 'test', command: 'npm test' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'AMBIGUOUS_COMMAND_CONFIG');
        return true;
      }
    );

    assert.throws(
      () => catalog.resolve({}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'INVALID_COMMAND_CONFIG');
        return true;
      }
    );
  });
});

describe('CommandGate authoritative verification state recording and composite identity (Finding 2, 3)', () => {
  test('inspect before verify is pending/stale', async () => {
    const store = new MemoryCommandVerificationStore();
    const gate = new CommandGate({ verificationStore: store });

    const inspectRes = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspectRes.status, 'pending');
    assert.equal(inspectRes.stale, true);
  });

  test('verify pass records result in store; subsequent inspect sees passed', async () => {
    const store = new MemoryCommandVerificationStore();
    const mockRunner = async () => ({ passed: true, exitCode: 0, stdout: 'tests passed' });

    const gate = new CommandGate({
      runner: mockRunner,
      verificationStore: store,
    });

    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, true);
    assert.equal(verifyRes.status, 'passed');

    const inspectRes = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspectRes.status, 'passed');
    assert.equal(inspectRes.stale, false);
    assert.ok(inspectRes.details?.lastRun?.timestamp);
  });

  test('verify failure records result in store; subsequent inspect sees failed', async () => {
    const store = new MemoryCommandVerificationStore();
    const mockRunner = async () => ({ passed: false, exitCode: 1, stderr: 'test error' });

    const gate = new CommandGate({
      runner: mockRunner,
      verificationStore: store,
    });

    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'failed');

    const inspectRes = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspectRes.status, 'failed');
    assert.equal(inspectRes.stale, false);
  });

  test('verify fails closed when no verification store is configured (Finding 2)', async () => {
    const mockRunner = async () => ({ passed: true, exitCode: 0 });
    const gate = new CommandGate({ runner: mockRunner }); // No verificationStore

    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');
    assert.equal(verifyRes.details.reason, 'verification-store-missing');
  });

  test('verify fails closed when store recording throws error (Finding 2)', async () => {
    const faultyStore = {
      getCommandResult: () => null,
      recordCommandResult: () => {
        throw new Error('Disk full');
      },
    };

    const mockRunner = async () => ({ passed: true, exitCode: 0 });
    const gate = new CommandGate({ runner: mockRunner, verificationStore: faultyStore });

    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'failed');
    assert.match(verifyRes.message, /Failed to record authoritative verification state: Disk full/);
    assert.equal(verifyRes.details.reason, 'verification-record-failed');
    assert.equal(verifyRes.details.executionPassed, true);
  });

  test('verify fails closed when store recording throws error on a failing command (Finding 2)', async () => {
    const faultyStore = {
      getCommandResult: () => null,
      recordCommandResult: () => {
        throw new Error('Disk full');
      },
    };

    const mockRunner = async () => ({ passed: false, exitCode: 1, stderr: 'boom' });
    const gate = new CommandGate({ runner: mockRunner, verificationStore: faultyStore });

    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'failed');
    assert.match(verifyRes.message, /Failed to record authoritative verification state: Disk full/);
    assert.equal(verifyRes.details.reason, 'verification-record-failed');
    assert.equal(verifyRes.details.executionPassed, false);

    // Subsequent inspect must not resurrect a passed state either, since nothing was persisted
    const inspectRes = await gate.inspect({ action: 'test' }, {});
    assert.notEqual(inspectRes.status, 'passed');
  });

  test('different action pointing to same command does not inherit another action\'s recorded result (Finding 3)', async () => {
    const store = new MemoryCommandVerificationStore();
    const catalog = new CommandCatalog({ test: 'npm run check', lint: 'npm run check' });
    const passingRunner = async () => ({ passed: true, exitCode: 0 });

    const testGate = new CommandGate({
      commandCatalog: catalog,
      runner: passingRunner,
      verificationStore: store,
    });

    await testGate.verify({ action: 'test' }, {});
    const testInspect = await testGate.inspect({ action: 'test' }, {});
    assert.equal(testInspect.status, 'passed');

    const lintGate = new CommandGate({
      commandCatalog: catalog,
      verificationStore: store,
    });

    // 'lint' resolves to the identical concrete command 'npm run check', but must not
    // inherit 'test' action's recorded result absent an explicit sharing decision
    const lintInspect = await lintGate.inspect({ action: 'lint' }, {});
    assert.equal(lintInspect.status, 'pending');
    assert.equal(lintInspect.stale, true);
  });

  test('binds recorded command verification to exact composite identity (Finding 3)', async () => {
    const store = new MemoryCommandVerificationStore();
    const catalogA = new CommandCatalog({ test: 'npm test' });
    const mockRunner = async () => ({ passed: true, exitCode: 0 });

    const gateA = new CommandGate({
      commandCatalog: catalogA,
      runner: mockRunner,
      verificationStore: store,
    });

    // 1. Verify 'test' with 'npm test'
    await gateA.verify({ action: 'test' }, {});
    const inspectA = await gateA.inspect({ action: 'test' }, {});
    assert.equal(inspectA.status, 'passed');

    // 2. Gate with changed command mapping for 'test' -> 'pnpm test'
    const catalogB = new CommandCatalog({ test: 'pnpm test' });
    const gateB = new CommandGate({
      commandCatalog: catalogB,
      verificationStore: store,
    });

    // Old 'npm test' record must NOT satisfy new 'pnpm test' target
    const inspectB = await gateB.inspect({ action: 'test' }, {});
    assert.equal(inspectB.status, 'pending');
    assert.equal(inspectB.stale, true);

    // 3. Raw command gate
    const rawGate = new CommandGate({ runner: mockRunner, verificationStore: store });
    await rawGate.verify({ command: 'npm run lint' }, {});
    const rawInspect = await rawGate.inspect({ command: 'npm run lint' }, {});
    assert.equal(rawInspect.status, 'passed');
  });

  test('adversarial: shifting the action/command delimiter boundary cannot collide into the same stored record (Finding 3)', async () => {
    const store = new MemoryCommandVerificationStore();
    const passingRunner = async () => ({ passed: true, exitCode: 0 });
    const failingRunner = async () => ({ passed: false, exitCode: 1 });

    // Under a naive delimiter-joined key `action:${action}::cmd:${command}`, these two
    // distinct (action, command) pairs produce the identical concatenated string
    // "action:a::cmd:b::cmd:c" by shifting where the delimiter boundary falls:
    //   pair 1: action = "a::cmd:b", command = "c"
    //   pair 2: action = "a",        command = "b::cmd:c"
    const catalogOne = new CommandCatalog({ 'a::cmd:b': 'c' });
    const catalogTwo = new CommandCatalog({ a: 'b::cmd:c' });

    const gateOne = new CommandGate({
      commandCatalog: catalogOne,
      runner: passingRunner,
      verificationStore: store,
    });
    const gateTwo = new CommandGate({
      commandCatalog: catalogTwo,
      runner: failingRunner,
      verificationStore: store,
    });

    await gateOne.verify({ action: 'a::cmd:b' }, {});
    await gateTwo.verify({ action: 'a' }, {});

    const inspectOne = await gateOne.inspect({ action: 'a::cmd:b' }, {});
    const inspectTwo = await gateTwo.inspect({ action: 'a' }, {});

    // Each gate must see its own recorded result, not the other's, despite the
    // delimiter-colliding string shapes of their action/command identities.
    assert.equal(inspectOne.status, 'passed');
    assert.equal(inspectTwo.status, 'failed');
  });
});

describe('MarkdownGate status uniformity and content hash binding (Finding 1)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nevo-md-test-'));
  });

  test('structurally complete artifact without evidence -> inspect is blocked (Finding 1)', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), content, 'utf8');

    // Gate without evidence reader
    const gate = new MarkdownGate();
    const context = { repoRoot: tempDir, taskId: '05-task' };

    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'blocked');
    assert.equal(inspectRes.reason, 'evidence-required');

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');

    // Both inspect and verify agree that gate is NOT satisfied
    assert.equal(inspectRes.status === 'passed', false);
    assert.equal(verifyRes.passed, false);
  });

  test('matching evidence -> inspect and verify both return passed (Finding 1)', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), content, 'utf8');

    const artifactHash = computeArtifactHash(content);
    const evidenceReader = new MemoryMarkdownEvidenceReader([
      {
        verified: true,
        scope: 'task',
        targetId: '05-task',
        file: artifactPath,
        artifactHash,
      },
    ]);

    const gate = new MarkdownGate({ evidenceReader });
    const context = { repoRoot: tempDir, taskId: '05-task' };

    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'passed');

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, true);
    assert.equal(verifyRes.status, 'passed');

    // Both inspect and verify agree that gate IS satisfied
    assert.equal(inspectRes.status === 'passed', true);
    assert.equal(verifyRes.passed, true);
  });

  test('artifact modified after evidence was recorded -> inspect and verify both blocked (Finding 1)', async () => {
    const artifactPath = 'verification.md';
    const originalContent = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), originalContent, 'utf8');

    const originalHash = computeArtifactHash(originalContent);
    const evidenceReader = new MemoryMarkdownEvidenceReader([
      {
        verified: true,
        scope: 'task',
        targetId: '05-task',
        file: artifactPath,
        artifactHash: originalHash,
      },
    ]);

    const gate = new MarkdownGate({ evidenceReader });
    const context = { repoRoot: tempDir, taskId: '05-task' };

    // Modify artifact content in repository
    const modifiedContent = '# Verification\n- [x] Item 1\n- [x] Extra modified line';
    writeFileSync(join(tempDir, artifactPath), modifiedContent, 'utf8');

    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'blocked');
    assert.equal(inspectRes.reason, 'evidence-hash-mismatch');

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');
    assert.equal(verifyRes.details.reason, 'evidence-hash-mismatch');
  });

  test('multiple evidence versions exist -> current matching hash is selected (Finding 1)', async () => {
    const artifactPath = 'verification.md';
    const oldContent = '# Old Verification\n- [x] Old Item';
    const newContent = '# New Verification\n- [x] New Item';
    writeFileSync(join(tempDir, artifactPath), newContent, 'utf8');

    const oldHash = computeArtifactHash(oldContent);
    const newHash = computeArtifactHash(newContent);

    const evidenceReader = new MemoryMarkdownEvidenceReader([
      { verified: true, scope: 'task', targetId: '05-task', file: artifactPath, artifactHash: oldHash },
      { verified: true, scope: 'task', targetId: '05-task', file: artifactPath, artifactHash: newHash },
    ]);

    const gate = new MarkdownGate({ evidenceReader });
    const context = { repoRoot: tempDir, taskId: '05-task' };

    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'passed');

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, true);
    assert.equal(verifyRes.status, 'passed');
  });

  test('evidence for wrong scope/target/file -> inspect and verify blocked', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), content, 'utf8');

    const artifactHash = computeArtifactHash(content);
    const wrongReader = new MemoryMarkdownEvidenceReader([
      { verified: true, scope: 'task', targetId: 'wrong-task', file: artifactPath, artifactHash },
    ]);

    const gate = new MarkdownGate({ evidenceReader: wrongReader });
    const context = { repoRoot: tempDir, taskId: '05-task' };

    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'blocked');
    assert.equal(inspectRes.reason, 'evidence-required');

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');
  });
});

describe('HumanVerificationGate trusted state and adversarial context rejection', () => {
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

  test('inspect()/verify() build and pass the extended changeId/taskId/stepId/gateId query alongside scope/targetId/requiredRole (D29, task 08 AC9)', async () => {
    const capturedQueries = [];
    class SpyReader extends HumanVerificationReader {
      getSignoff(query) {
        capturedQueries.push(query);
        return { confirmed: true, scope: query.scope, targetId: query.targetId, role: 'owner' };
      }
    }
    const gate = new HumanVerificationGate({ verificationReader: new SpyReader() });
    const config = { required: true, scope: 'task', role: 'owner', id: 'my-gate' };
    const context = { changeId: 'my-change', taskId: 'my-task', stepId: 'my-step' };

    const inspectResult = await gate.inspect(config, context);
    assert.equal(inspectResult.status, 'passed');
    assert.equal(capturedQueries.length, 1);
    assert.deepEqual(capturedQueries[0], {
      scope: 'task', targetId: 'my-task', requiredRole: 'owner',
      changeId: 'my-change', taskId: 'my-task', stepId: 'my-step', gateId: 'my-gate', attempt: null,
    });

    const verifyResult = await gate.verify(config, context);
    assert.equal(verifyResult.passed, true);
    assert.equal(capturedQueries.length, 2);
    assert.deepEqual(capturedQueries[1], capturedQueries[0]);
  });

  test('a reader that only reads the original scope/targetId/requiredRole fields (Task 05 contract) still works unmodified (D29 additive guarantee)', async () => {
    // MemoryHumanVerificationReader.getSignoff destructures only {scope, targetId,
    // requiredRole} — proving the extended fields are additive, not a breaking change to
    // the pre-existing reader contract.
    const reader = new MemoryHumanVerificationReader([{ confirmed: true, scope: 'task', targetId: 'legacy-task', role: 'owner' }]);
    const gate = new HumanVerificationGate({ verificationReader: reader });
    const result = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'legacy-task' });
    assert.equal(result.status, 'passed');
  });

  test('changeId/taskId/stepId/gateId/attempt are null, never invented, when context/config do not supply them', async () => {
    const capturedQueries = [];
    class SpyReader extends HumanVerificationReader {
      getSignoff(query) {
        capturedQueries.push(query);
        return null;
      }
    }
    const gate = new HumanVerificationGate({ verificationReader: new SpyReader() });
    await gate.inspect({ required: true, scope: 'task' }, { taskId: 'bare-task' });

    assert.equal(capturedQueries[0].changeId, null);
    assert.equal(capturedQueries[0].stepId, null);
    assert.equal(capturedQueries[0].gateId, null);
    assert.equal(capturedQueries[0].attempt, null);
    assert.equal(capturedQueries[0].taskId, 'bare-task');
  });

  describe('deterministic (step, attempt) verification identity and regression cases', () => {
    test('MemoryHumanVerificationReader: enforces strict attempt matching when query has attempt, preserves legacy signoffs when query has no attempt', () => {
      // 1. signoff attempt 1, query attempt 1 => returns signoff
      const reader1 = new MemoryHumanVerificationReader([
        { confirmed: true, scope: 'task', targetId: 'task-1', role: 'owner', attempt: 1 },
      ]);
      const res1 = reader1.getSignoff({ scope: 'task', targetId: 'task-1', requiredRole: 'owner', attempt: 1 });
      assert.ok(res1);
      assert.equal(res1.attempt, 1);

      // 2. signoff attempt 1, query attempt 2 => blocked (null)
      const res2 = reader1.getSignoff({ scope: 'task', targetId: 'task-1', requiredRole: 'owner', attempt: 2 });
      assert.equal(res2, null);

      // 3. signoff has no attempt, query attempt 2 => blocked (null)
      const readerLegacy = new MemoryHumanVerificationReader([
        { confirmed: true, scope: 'task', targetId: 'task-1', role: 'owner' },
      ]);
      const res3 = readerLegacy.getSignoff({ scope: 'task', targetId: 'task-1', requiredRole: 'owner', attempt: 2 });
      assert.equal(res3, null, 'attempt-less signoff must never satisfy an attempt-scoped query');

      // 4. query has no attempt, legacy signoff has no attempt => existing behavior remains valid
      const res4 = readerLegacy.getSignoff({ scope: 'task', targetId: 'task-1', requiredRole: 'owner' });
      assert.ok(res4);
      assert.equal(res4.confirmed, true);
    });

    test('HumanVerificationGate: final trusted validation independently enforces attempt identity when context carries attempt', async () => {
      // Proves gate enforces contract itself even if reader unconditionally returns signoff
      class PermissiveStubReader extends HumanVerificationReader {
        constructor(signoff) {
          super();
          this.signoff = signoff;
        }
        getSignoff() {
          return this.signoff;
        }
      }

      // Case 1: signoff attempt 1, query attempt 1 => passed
      const gate1 = new HumanVerificationGate({
        verificationReader: new PermissiveStubReader({ confirmed: true, scope: 'task', targetId: 't1', role: 'owner', attempt: 1 }),
      });
      const res1 = await gate1.inspect({ required: true, scope: 'task' }, { taskId: 't1', attempt: 1 });
      assert.equal(res1.status, 'passed');

      // Case 2: signoff attempt 1, query attempt 2 => blocked
      const res2 = await gate1.inspect({ required: true, scope: 'task' }, { taskId: 't1', attempt: 2 });
      assert.equal(res2.status, 'blocked');

      // Case 3: signoff has no attempt, query attempt 2 => blocked
      const gateLegacy = new HumanVerificationGate({
        verificationReader: new PermissiveStubReader({ confirmed: true, scope: 'task', targetId: 't1', role: 'owner' }),
      });
      const res3 = await gateLegacy.inspect({ required: true, scope: 'task' }, { taskId: 't1', attempt: 2 });
      assert.equal(res3.status, 'blocked', 'gate final validation must reject attempt-less signoff when query has attempt');

      // Case 4: query has no attempt, legacy signoff has no attempt => passed
      const res4 = await gateLegacy.inspect({ required: true, scope: 'task' }, { taskId: 't1' });
      assert.equal(res4.status, 'passed');
    });

    test('HumanVerificationGate with MemoryHumanVerificationReader: end-to-end attempt scoping regression suite', async () => {
      const reader = new MemoryHumanVerificationReader([
        { confirmed: true, scope: 'task', targetId: 'attempt-task', role: 'owner', attempt: 1 },
        { confirmed: true, scope: 'task', targetId: 'legacy-task', role: 'owner' },
      ]);
      const gate = new HumanVerificationGate({ verificationReader: reader });

      // signoff attempt 1, query attempt 1 => passed
      const attempt1 = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'attempt-task', attempt: 1 });
      assert.equal(attempt1.status, 'passed');

      // signoff attempt 1, query attempt 2 => blocked
      const attempt2 = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'attempt-task', attempt: 2 });
      assert.equal(attempt2.status, 'blocked');

      // signoff has no attempt, query attempt 2 => blocked
      const attemptNoSignoff = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'legacy-task', attempt: 2 });
      assert.equal(attemptNoSignoff.status, 'blocked');

      // query has no attempt, legacy signoff has no attempt => passed
      const legacyQuery = await gate.inspect({ required: true, scope: 'task' }, { taskId: 'legacy-task' });
      assert.equal(legacyQuery.status, 'passed');
    });
  });
});
