import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
} from '../specs/workflow/cli.mjs';
import { CliError } from '../lib/cli-errors.mjs';

function setupFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'nevo-det-guard-test-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });

  const activeDir = join(root, 'specs', 'active');
  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  const workflowDef = `id: test-workflow
title: "Test Workflow"
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
    exitGates: []
    finalize: []
    transitions:
      - to: verified
`;
  writeFileSync(join(workflowsDir, 'test-workflow.yaml'), workflowDef, 'utf8');

  writeFileSync(join(root, 'README.md'), '# Fixture\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: root });

  return { root, activeDir, workflowsDir };
}

function createLegacySpecNoWorkflow(activeDir, slug = 'legacy-no-wf') {
  const changeDir = join(activeDir, slug);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYaml = `id: ${slug}
title: "Legacy No Workflow"
status: draft
tasks:
  - id: t1
    order: 1
    file: tasks/01-t1.md
    status: approved
`;
  const file = join(changeDir, 'change.yaml');
  writeFileSync(file, changeYaml, 'utf8');
  writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
  return { changeDir, file, content: changeYaml };
}

function createLegacySpecExplicit(activeDir, slug = 'legacy-explicit') {
  const changeDir = join(activeDir, slug);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYaml = `id: ${slug}
title: "Legacy Explicit"
status: draft
workflow:
  mode: legacy
tasks:
  - id: t1
    order: 1
    file: tasks/01-t1.md
    status: approved
`;
  const file = join(changeDir, 'change.yaml');
  writeFileSync(file, changeYaml, 'utf8');
  writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
  return { changeDir, file, content: changeYaml };
}

function createDeterministicSpec(activeDir, slug = 'det-spec') {
  const changeDir = join(activeDir, slug);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYaml = `id: ${slug}
title: "Deterministic Spec"
status: draft
workflow:
  mode: deterministic
  version: 1
  definition: test-workflow
tasks:
  - id: t1
    order: 1
    file: tasks/01-t1.md
    status: approved
`;
  const file = join(changeDir, 'change.yaml');
  writeFileSync(file, changeYaml, 'utf8');
  writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
  return { changeDir, file, content: changeYaml };
}

describe('deterministic-mutation-guard — refuse to run against legacy specs', () => {
  let env;

  before(() => {
    env = setupFixtureRepo();
  });

  after(() => {
    rmSync(env.root, { recursive: true, force: true });
  });

  test('handleWorkflowStepStart against spec with no workflow field throws CliError and leaves change.yaml unchanged', async () => {
    const slug = 'start-no-wf';
    const { file, content } = createLegacySpecNoWorkflow(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError, got: ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /approve/);
        assert.match(err.message, /start/);
        assert.match(err.message, /complete/);
        assert.match(err.message, /verify/);
        return true;
      }
    );

    const after = readFileSync(file, 'utf8');
    assert.equal(after, content, 'change.yaml must be byte-for-byte unchanged');
  });

  test('handleWorkflowStepStart against spec with explicit workflow.mode: legacy throws CliError and leaves change.yaml unchanged', async () => {
    const slug = 'start-explicit';
    const { file, content } = createLegacySpecExplicit(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError, got: ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /approve/);
        assert.match(err.message, /start/);
        assert.match(err.message, /complete/);
        assert.match(err.message, /verify/);
        return true;
      }
    );

    const after = readFileSync(file, 'utf8');
    assert.equal(after, content, 'change.yaml must be byte-for-byte unchanged');
  });

  test('handleWorkflowStepFinish against spec with no workflow field throws CliError and leaves change.yaml unchanged', async () => {
    const slug = 'finish-no-wf';
    const { file, content } = createLegacySpecNoWorkflow(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepFinish(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError, got: ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /approve/);
        assert.match(err.message, /start/);
        assert.match(err.message, /complete/);
        assert.match(err.message, /verify/);
        return true;
      }
    );

    const after = readFileSync(file, 'utf8');
    assert.equal(after, content, 'change.yaml must be byte-for-byte unchanged');
  });

  test('handleWorkflowStepFinish against spec with explicit workflow.mode: legacy throws CliError and leaves change.yaml unchanged', async () => {
    const slug = 'finish-explicit';
    const { file, content } = createLegacySpecExplicit(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepFinish(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError, got: ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /approve/);
        assert.match(err.message, /start/);
        assert.match(err.message, /complete/);
        assert.match(err.message, /verify/);
        return true;
      }
    );

    const after = readFileSync(file, 'utf8');
    assert.equal(after, content, 'change.yaml must be byte-for-byte unchanged');
  });

  test('deterministic spec is unaffected and handleWorkflowStepStart proceeds', async () => {
    const slug = 'det-normal';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', 'chore: add deterministic spec'], { cwd: env.root });

    const stepContext = await handleWorkflowStepStart(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.root,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.runtimeState, 'active');
  });
});
