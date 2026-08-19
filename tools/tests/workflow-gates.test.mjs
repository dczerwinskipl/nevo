// Tests for GateContract, CommandGate, CommandCatalog, MarkdownGate, HumanVerificationGate, and GateRegistry.
// Run: node --test tools/tests/workflow-gates.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

describe('CommandCatalog neutral module and runtime XOR enforcement (Finding 3)', () => {
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

  test('CommandCatalog.resolve enforces strict action/command XOR at runtime (Finding 3)', () => {
    const catalog = new CommandCatalog();

    // Both action and command declared -> rejected
    assert.throws(
      () => catalog.resolve({ action: 'test', command: 'npm test' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'AMBIGUOUS_COMMAND_CONFIG');
        assert.match(err.message, /cannot declare both 'action' and 'command'/);
        return true;
      }
    );

    // Neither action nor command declared -> rejected
    assert.throws(
      () => catalog.resolve({}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'INVALID_COMMAND_CONFIG');
        assert.match(err.message, /must declare either 'action' or 'command'/);
        return true;
      }
    );

    // Empty action string -> rejected
    assert.throws(
      () => catalog.resolve({ action: '  ' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'INVALID_COMMAND_CONFIG');
        return true;
      }
    );

    // Empty command string -> rejected
    assert.throws(
      () => catalog.resolve({ command: '  ' }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'INVALID_COMMAND_CONFIG');
        return true;
      }
    );
  });
});

describe('CommandGate authoritative verification state recording (Finding 2)', () => {
  test('inspect before verify is pending/stale', async () => {
    const store = new MemoryCommandVerificationStore();
    const gate = new CommandGate({ verificationStore: store });

    const inspectRes = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspectRes.status, 'pending');
    assert.equal(inspectRes.stale, true);
  });

  test('verify pass executes runner and records passed result in store; subsequent inspect sees passed', async () => {
    const store = new MemoryCommandVerificationStore();
    const mockRunner = async () => ({ passed: true, exitCode: 0, stdout: 'tests passed' });

    const gate = new CommandGate({
      runner: mockRunner,
      verificationStore: store,
    });

    // 1. Initial inspect is pending
    const inspect1 = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspect1.status, 'pending');
    assert.equal(inspect1.stale, true);

    // 2. Explicit verify executes and records
    const verifyRes = await gate.verify({ action: 'test' }, {});
    assert.equal(verifyRes.passed, true);
    assert.equal(verifyRes.status, 'passed');

    // 3. Subsequent inspect reflects recorded pass state
    const inspect2 = await gate.inspect({ action: 'test' }, {});
    assert.equal(inspect2.status, 'passed');
    assert.equal(inspect2.stale, false);
    assert.ok(inspect2.details?.lastRun?.timestamp);
  });

  test('verify failure executes runner and records failed result in store; subsequent inspect sees failed', async () => {
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

  test('malformed runner result records failure, never pass', async () => {
    const store = new MemoryCommandVerificationStore();
    const gate = new CommandGate({
      runner: async () => ({ passed: 'false' }), // Malformed non-boolean string
      verificationStore: store,
    });

    const verifyRes = await gate.verify({ command: 'npm test' }, {});
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'failed');

    const inspectRes = await gate.inspect({ command: 'npm test' }, {});
    assert.equal(inspectRes.status, 'failed');
  });

  test('adversarial test: caller context CANNOT replace runner, command mapping, or verification state', async () => {
    const store = new MemoryCommandVerificationStore();
    const gate = new CommandGate({ verificationStore: store });

    const maliciousContext = {
      runner: async () => ({ passed: true }),
      lastVerification: { 'npm test': { passed: true } },
      verificationResults: { 'npm test': { passed: true } },
      verificationStore: new MemoryCommandVerificationStore({ 'npm test': { passed: true } }),
    };

    // Caller context cannot forge pass in inspect()
    const inspectRes = await gate.inspect({ action: 'test' }, maliciousContext);
    assert.equal(inspectRes.status, 'pending');
    assert.equal(inspectRes.stale, true);

    // Caller context cannot replace runner in verify()
    await assert.rejects(
      async () => await gate.verify({ action: 'test' }, maliciousContext),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });
});

describe('MarkdownGate content hash binding and strict evidence verification (Finding 1, 4)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nevo-md-test-'));
  });

  test('computeArtifactHash computes deterministic SHA-256 digest', () => {
    const hash1 = computeArtifactHash('# Hello');
    const hash2 = computeArtifactHash('# Hello');
    const hash3 = computeArtifactHash('# Different');

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
  });

  test('matching evidence passes verify() when content hash and identity match exactly', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1\n- [x] Item 2';
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

    // 1. inspect() passes structural check and provides hash
    const inspectRes = await gate.inspect({ file: artifactPath, scope: 'task' }, context);
    assert.equal(inspectRes.status, 'passed');
    assert.equal(inspectRes.details.artifactHash, artifactHash);

    // 2. verify() passes with exact evidence match
    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, true);
    assert.equal(verifyRes.status, 'passed');
  });

  test('same artifact modified after evidence was recorded becomes blocked (content hash mismatch)', async () => {
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

    // Modify artifact content in repository (e.g. agent added a line)
    const modifiedContent = '# Verification\n- [x] Item 1\n- [x] Extra modified line';
    writeFileSync(join(tempDir, artifactPath), modifiedContent, 'utf8');

    // verify() must fail closed / block because content hash no longer matches recorded evidence
    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, context);
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');
    assert.equal(verifyRes.details.reason, 'evidence-hash-mismatch');
  });

  test('evidence for wrong scope, target, file, or generic { verified: true } is blocked', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), content, 'utf8');

    const artifactHash = computeArtifactHash(content);

    // 1. Wrong scope
    const wrongScopeReader = new MemoryMarkdownEvidenceReader([
      { verified: true, scope: 'change', targetId: '05-task', file: artifactPath, artifactHash },
    ]);
    const gate1 = new MarkdownGate({ evidenceReader: wrongScopeReader });
    const res1 = await gate1.verify({ file: artifactPath, scope: 'task' }, { repoRoot: tempDir, taskId: '05-task' });
    assert.equal(res1.passed, false);
    assert.equal(res1.status, 'blocked');

    // 2. Wrong target
    const wrongTargetReader = new MemoryMarkdownEvidenceReader([
      { verified: true, scope: 'task', targetId: 'different-task', file: artifactPath, artifactHash },
    ]);
    const gate2 = new MarkdownGate({ evidenceReader: wrongTargetReader });
    const res2 = await gate2.verify({ file: artifactPath, scope: 'task' }, { repoRoot: tempDir, taskId: '05-task' });
    assert.equal(res2.passed, false);
    assert.equal(res2.status, 'blocked');

    // 3. Wrong file
    const wrongFileReader = new MemoryMarkdownEvidenceReader([
      { verified: true, scope: 'task', targetId: '05-task', file: 'other.md', artifactHash },
    ]);
    const gate3 = new MarkdownGate({ evidenceReader: wrongFileReader });
    const res3 = await gate3.verify({ file: artifactPath, scope: 'task' }, { repoRoot: tempDir, taskId: '05-task' });
    assert.equal(res3.passed, false);
    assert.equal(res3.status, 'blocked');

    // 4. Generic { verified: true } missing identity/hash
    const genericReader = new MemoryMarkdownEvidenceReader([
      { verified: true },
    ]);
    const gate4 = new MarkdownGate({ evidenceReader: genericReader });
    const res4 = await gate4.verify({ file: artifactPath, scope: 'task' }, { repoRoot: tempDir, taskId: '05-task' });
    assert.equal(res4.passed, false);
    assert.equal(res4.status, 'blocked');
  });

  test('caller context CANNOT inject context.fs or fake evidence objects', async () => {
    const artifactPath = 'verification.md';
    const content = '# Verification\n- [x] Item 1';
    writeFileSync(join(tempDir, artifactPath), content, 'utf8');

    const gate = new MarkdownGate(); // No evidence reader configured

    const maliciousContext = {
      repoRoot: tempDir,
      taskId: '05-task',
      fs: {
        existsSync: () => true,
        readFileSync: () => '# Spoofed',
      },
      evidence: { verified: true },
      evidenceReader: new MemoryMarkdownEvidenceReader([{ verified: true }]),
    };

    const verifyRes = await gate.verify({ file: artifactPath, scope: 'task' }, maliciousContext);
    assert.equal(verifyRes.passed, false);
    assert.equal(verifyRes.status, 'blocked');
    assert.match(verifyRes.message, /no trusted evidence reader is configured/);
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
});
