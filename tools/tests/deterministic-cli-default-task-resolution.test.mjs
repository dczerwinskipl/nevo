import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
} from '../specs/workflow/cli.mjs';
import { CliError } from '../lib/cli-errors.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = resolve(__dirname, '..');

function setupFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'nevo-det-cli-res-test-'));
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

function createDeterministicSpec(activeDir, slug, taskStatuses = ['approved']) {
  const changeDir = join(activeDir, slug);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const tasksYaml = taskStatuses.map((st, i) => {
    const taskId = `t${i + 1}`;
    writeFileSync(join(tasksDir, `0${i + 1}-${taskId}.md`), `---\nid: ${taskId}\n---\n# Task ${taskId}\n`, 'utf8');
    return `  - id: ${taskId}\n    order: ${i + 1}\n    file: tasks/0${i + 1}-${taskId}.md\n    status: ${st}`;
  }).join('\n');

  const changeYaml = `id: ${slug}
title: "Deterministic Spec"
status: draft
workflow:
  mode: deterministic
  version: 1
  definition: test-workflow
tasks:
${tasksYaml}
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  return { changeDir };
}

describe('deterministic CLI default-task resolution (D2)', () => {
  let env;

  before(() => {
    env = setupFixtureRepo();
  });

  after(() => {
    rmSync(env.root, { recursive: true, force: true });
  });

  test('static check: no reference to in-implementation or resolveDefaultTask remains in cli.mjs', () => {
    const cliSource = readFileSync(join(toolsDir, 'specs', 'workflow', 'cli.mjs'), 'utf8');
    assert.equal(
      cliSource.includes('in-implementation'),
      false,
      "cli.mjs must contain no references to 'in-implementation'"
    );
    assert.equal(
      cliSource.includes('resolveDefaultTask'),
      false,
      'cli.mjs must contain no references to resolveDefaultTask'
    );
  });

  test('workflow step start without task id fails with task id required error when 1 task is in-implementation', async () => {
    const slug = 'det-single-impl';
    createDeterministicSpec(env.activeDir, slug, ['in-implementation']);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.root });

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, undefined, {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /task id is required/i);
        return true;
      }
    );
  });

  test('workflow step start without task id fails with task id required error when multiple tasks are in-implementation', async () => {
    const slug = 'det-multi-impl';
    createDeterministicSpec(env.activeDir, slug, ['in-implementation', 'in-implementation']);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.root });

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, undefined, {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /task id is required/i);
        return true;
      }
    );
  });

  test('workflow step start without task id fails with task id required error when 0 tasks are in-implementation', async () => {
    const slug = 'det-zero-impl';
    createDeterministicSpec(env.activeDir, slug, ['approved', 'draft']);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.root });

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, undefined, {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /task id is required/i);
        return true;
      }
    );
  });

  test('workflow step finish without task id fails identically with task id required error', async () => {
    const slug = 'det-finish-no-task';
    createDeterministicSpec(env.activeDir, slug, ['in-implementation']);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.root });

    await assert.rejects(
      async () => {
        await handleWorkflowStepFinish(slug, undefined, {
          activeDir: env.activeDir,
          repoRoot: env.root,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /task id is required/i);
        return true;
      }
    );
  });

  test('workflow step start with explicit task id is unaffected and succeeds', async () => {
    const slug = 'det-explicit-task';
    createDeterministicSpec(env.activeDir, slug, ['approved']);
    execFileSync('git', ['add', '.'], { cwd: env.root });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.root });

    const stepContext = await handleWorkflowStepStart(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.root,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.runtimeState, 'active');
  });
});
