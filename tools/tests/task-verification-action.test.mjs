import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  defaultCommandCatalog,
  CommandCatalog,
  CommandGate,
  MemoryCommandVerificationStore,
  createDefaultGateRegistry,
} from '../specs/workflow/index.mjs';
import { buildWorkflowGateRegistry } from '../specs/workflow/cli.mjs';
import { loadWorkflowDefinition, parseWorkflowDefinition, TEMPLATES_DIR } from '../specs/workflow/definitions/loader.mjs';
import { validateWorkflowDefinition, normalizeWorkflowDefinition } from '../specs/workflow/definitions/schema.mjs';
import { finishStep } from '../specs/workflow/finish-operation.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/index.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function setupRepoFixture(prefix = 'nevo-task-verif') {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test Runner']);
  git(repo, ['config', 'user.email', 'test@runner.local']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'hello root\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: initial repo root']);
  git(repo, ['push', '-u', 'origin', 'main']);

  const specsActive = join(repo, 'specs', 'active');
  const changeDir = join(specsActive, 'demo-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const changeYaml = [
    'id: demo-change',
    'title: Demo Change',
    'status: in-implementation',
    'tasks:',
    '  - id: t1',
    '    file: tasks/01-t1.md',
    '    status: in-implementation',
    '    workflow_progress:',
    '      current_step: review',
    '      current_attempt: 1',
    '      state: active',
    '      history:',
    '        - step: implementation',
    '          attempt: 1',
    '          completed_at: "2026-10-10T00:00:00.000Z"',
    '          transitioned_to: review',
    '',
  ].join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const taskMd = [
    '---',
    'id: demo-change.t1',
    'status: in-implementation',
    'allowed_paths:',
    '  - allowed.txt',
    '---',
    '# T1',
    '',
    '## Acceptance criteria',
    '- criteria 1',
    '',
    '## Verification',
    '```bash',
    'node -e "process.stdout.write(\'task-verification-ok\')"',
    '```',
    '',
  ].join('\n');
  writeFileSync(join(tasksDir, '01-t1.md'), taskMd);

  writeFileSync(join(repo, 'allowed.txt'), 'allowed content\n');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: add demo-change setup']);
  git(repo, ['push', 'origin', 'main']);

  return { repo, remote };
}

describe('Explicit task-verification catalog action (Task 08, D6)', () => {
  let fixture;

  beforeEach(() => {
    fixture = setupRepoFixture('nevo-task08');
  });

  afterEach(() => {
    try {
      rmSync(fixture.repo, { recursive: true, force: true });
      rmSync(fixture.remote, { recursive: true, force: true });
    } catch {}
  });

  test('CommandCatalog resolves task-verification and test correctly', () => {
    const catalog = defaultCommandCatalog;

    assert.equal(catalog.has('task-verification'), true);
    assert.equal(catalog.get('task-verification'), 'task-verification');
    assert.equal(catalog.resolve({ action: 'task-verification' }), 'task-verification');

    // test continues to mean npm test
    assert.equal(catalog.has('test'), true);
    assert.equal(catalog.get('test'), 'npm test');
    assert.equal(catalog.resolve({ action: 'test' }), 'npm test');

    // build continues to mean npm run build
    assert.equal(catalog.has('build'), true);
    assert.equal(catalog.get('build'), 'npm run build');
    assert.equal(catalog.resolve({ action: 'build' }), 'npm run build');

    // asSet includes all three
    const set = catalog.asSet();
    assert.equal(set.has('task-verification'), true);
    assert.equal(set.has('test'), true);
    assert.equal(set.has('build'), true);
  });

  test('task-verification action executes task ## Verification commands', async () => {
    const executedCommands = [];
    const gateRegistry = buildWorkflowGateRegistry(fixture.repo, 'demo-change', 't1', 1);

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    const def = normalizeWorkflowDefinition({
      id: 'task-verif-def',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'task-verification' },
          ],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [
            { to: 'verified', outcome: 'success' },
          ],
        },
      },
    });

    const result = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry,
    });

    assert.equal(result.status, 'completed');
  });

  test('action: test runs literal npm test and does NOT substitute task commands', async () => {
    const capturedCommands = [];
    const customRegistry = createDefaultGateRegistry({
      commandRunner: async (command, context) => {
        capturedCommands.push(command);
        return { passed: true, exitCode: 0, stdout: 'ok', stderr: '' };
      },
      commandVerificationStore: new MemoryCommandVerificationStore(),
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    const def = normalizeWorkflowDefinition({
      id: 'literal-test-def',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'test' },
          ],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [
            { to: 'verified', outcome: 'success' },
          ],
        },
      },
    });

    const result = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry: customRegistry,
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(capturedCommands, ['npm test']);
  });

  test('failing task ## Verification command blocks task-verification gate', async () => {
    // Overwrite task markdown with a failing command
    const taskPath = join(fixture.repo, 'specs', 'active', 'demo-change', 'tasks', '01-t1.md');
    const failingTaskMd = [
      '---',
      'id: demo-change.t1',
      'status: in-implementation',
      'allowed_paths:',
      '  - allowed.txt',
      '---',
      '# T1',
      '',
      '## Verification',
      '```bash',
      'node -e "process.exit(1)"',
      '```',
      '',
    ].join('\n');
    writeFileSync(taskPath, failingTaskMd);

    const gateRegistry = buildWorkflowGateRegistry(fixture.repo, 'demo-change', 't1', 1);
    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    const def = normalizeWorkflowDefinition({
      id: 'failing-task-verif-def',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'task-verification' },
          ],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [
            { to: 'verified', outcome: 'success' },
          ],
        },
      },
    });

    const result = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.stage, 'verify-gates');
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].status, 'failed');
  });

  test('Shipped workflow definitions use action: task-verification where task commands are intended', () => {
    const shippedStandard = loadWorkflowDefinition('standard', { repoRoot: process.cwd() });
    assert.ok(shippedStandard);
    assert.equal(shippedStandard.steps.implementation.exitGates[0].action, 'task-verification');
    assert.equal(shippedStandard.steps.review.exitGates[0].action, 'task-verification');

    const shippedStandardV1 = loadWorkflowDefinition('standard-v1', { repoRoot: process.cwd() });
    assert.ok(shippedStandardV1);
    assert.equal(shippedStandardV1.steps.implementation.exitGates[0].action, 'task-verification');
    assert.equal(shippedStandardV1.steps.review.exitGates[0].action, 'task-verification');

    const shippedArch = loadWorkflowDefinition('architectural', { repoRoot: process.cwd() });
    assert.ok(shippedArch);
    assert.equal(shippedArch.steps.implementation.exitGates[0].action, 'task-verification');

    const shippedSmall = loadWorkflowDefinition('small', { repoRoot: process.cwd() });
    assert.ok(shippedSmall);
    assert.equal(shippedSmall.steps.implementation.exitGates[0].action, 'task-verification');

    const templateStandard = parseWorkflowDefinition(readFileSync(join(TEMPLATES_DIR, 'standard.yaml'), 'utf8'));
    assert.ok(templateStandard);
    assert.equal(templateStandard.steps.implementation.exitGates[0].action, 'task-verification');
    assert.equal(templateStandard.steps.review.exitGates[0].action, 'task-verification');

    const templateArch = parseWorkflowDefinition(readFileSync(join(TEMPLATES_DIR, 'architectural.yaml'), 'utf8'));
    assert.ok(templateArch);
    assert.equal(templateArch.steps.implementation.exitGates[0].action, 'task-verification');

    const templateSmall = parseWorkflowDefinition(readFileSync(join(TEMPLATES_DIR, 'small.yaml'), 'utf8'));
    assert.ok(templateSmall);
    assert.equal(templateSmall.steps.implementation.exitGates[0].action, 'task-verification');
  });

  test('Pinned definitions with action: test remain valid under schema validation', () => {
    const pinnedDef = {
      id: 'pinned-test-def',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          exitGates: [
            { type: 'command', action: 'test' },
          ],
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const res = validateWorkflowDefinition(pinnedDef);
    assert.equal(res.valid, true, `Expected valid, got: ${res.errors.join('; ')}`);
  });

  test('command: task-verification treats task-verification as literal command, not action', async () => {
    let capturedAction = 'unset';
    let capturedCommand = 'unset';
    const customRegistry = createDefaultGateRegistry({
      commandRunner: async (command, context) => {
        capturedAction = context.action;
        capturedCommand = command;
        return { passed: true, exitCode: 0, stdout: 'ran literal', stderr: '' };
      },
      commandVerificationStore: new MemoryCommandVerificationStore(),
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    const def = normalizeWorkflowDefinition({
      id: 'literal-command-named-task-verification-def',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', command: 'task-verification' },
          ],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [
            { to: 'verified', outcome: 'success' },
          ],
        },
      },
    });

    const result = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry: customRegistry,
    });

    assert.equal(result.status, 'completed');
    assert.equal(capturedAction, null);
    assert.equal(capturedCommand, 'task-verification');
  });

  test('spawn error and store persistence failure result in status blocked (taxonomy)', async () => {
    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    // 1. Runner returning spawnError -> status: 'blocked'
    const spawnErrorRegistry = createDefaultGateRegistry({
      commandRunner: async () => {
        return { passed: false, exitCode: 1, spawnError: new Error('ENOENT: spawn failed') };
      },
      commandVerificationStore: new MemoryCommandVerificationStore(),
    });

    const def = normalizeWorkflowDefinition({
      id: 'spawn-error-def',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'test' },
          ],
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    });

    const spawnResult = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry: spawnErrorRegistry,
    });
    assert.equal(spawnResult.status, 'blocked');
    assert.ok(spawnResult.blockers.some(b => b.status === 'blocked'));

    // 2. Verification store throwing on recordCommandResult -> status: 'blocked'
    const failingStore = {
      getCommandResult: async () => null,
      recordCommandResult: async () => {
        throw new Error('EACCES: permission denied writing verification store');
      },
    };
    const storeErrorRegistry = createDefaultGateRegistry({
      commandRunner: async () => ({ passed: true, exitCode: 0, stdout: 'ok' }),
      commandVerificationStore: failingStore,
    });

    const storeResult = await finishStep({
      change,
      task,
      definition: def,
      context: {
        repoRoot: fixture.repo,
        activeDir: join(fixture.repo, 'specs', 'active'),
        changeSlug: 'demo-change',
      },
      inputs: { 'commit.title': 'review(t1): approve' },
      gateRegistry: storeErrorRegistry,
    });
    assert.equal(storeResult.status, 'blocked');
    assert.ok(storeResult.blockers.some(b => b.status === 'blocked'));
  });
});
