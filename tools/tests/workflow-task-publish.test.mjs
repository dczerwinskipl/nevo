import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { publishTask } from '../specs/workflow/publish/operation.mjs';
import { handleWorkflowTaskPublish } from '../specs/workflow/cli.mjs';
import { loadChange } from '../specs/store.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import * as git from '../lib/git.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = resolve(__dirname, '..');

function setupTempGitRepo() {
  const baseDir = join(tmpdir(), `nevo-publish-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(baseDir, { recursive: true });

  execFileSync('git', ['init'], { cwd: baseDir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: baseDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: baseDir });

  writeFileSync(join(baseDir, 'README.md'), '# Test repo\n');
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: baseDir });
  execFileSync('git', ['add', '.'], { cwd: baseDir });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: baseDir });

  const activeDir = join(baseDir, 'specs', 'active');
  const archiveDir = join(baseDir, 'specs', 'archive');
  const workflowsDir = join(baseDir, '.nevo-ai', 'workflows');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  const testWorkflow = [
    'id: standard',
    'title: "Standard Workflow"',
    'type: standard',
    'version: 1',
    'sourceControl:',
    '  enabled: true',
    '  push: false',
    'steps:',
    '  implementation:',
    '    status:',
    '      active: implementing',
    '      completed: implemented',
    '    entryGates: []',
    '    exitGates: []',
    '    finalize: []',
    '    transitions:',
    '      - to: verified',
    '',
  ].join('\n');
  writeFileSync(join(workflowsDir, 'standard.yaml'), testWorkflow, 'utf8');

  writeFileSync(join(baseDir, 'specs', 'active.generated.md'), '# Active Specs\n');
  writeFileSync(join(baseDir, 'specs', 'archive.generated.md'), '# Archive Specs\n');
  writeFileSync(join(baseDir, 'specs', 'index.generated.json'), JSON.stringify({ generated: new Date().toISOString(), changes: [] }, null, 2));

  execFileSync('git', ['add', '.'], { cwd: baseDir });
  execFileSync('git', ['commit', '-m', 'chore: setup specs infrastructure'], { cwd: baseDir });

  return { baseDir, activeDir, archiveDir, workflowsDir };
}

describe('workflow task publish — static check', () => {
  test('publish operation does not import approveTask or approve operation', () => {
    const operationFile = join(toolsDir, 'specs', 'workflow', 'publish', 'operation.mjs');
    const source = readFileSync(operationFile, 'utf8');

    assert.equal(
      source.includes('approve/operation'),
      false,
      'publish operation must not import from approve/operation.mjs'
    );
    assert.equal(
      source.includes('approveTask'),
      false,
      'publish operation must not call or reference approveTask'
    );
    assert.equal(
      source.includes('lifecycle-primitives'),
      false,
      'publish operation must not import lifecycle-primitives.mjs'
    );
  });
});

describe('workflow task publish — functional tests', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  function createDeterministicSpec(activeDir, slug) {
    const changeDir = join(activeDir, slug);
    const tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const changeYaml = [
      `id: ${slug}`,
      `title: Deterministic Spec`,
      `status: draft`,
      `workflow:`,
      `  mode: deterministic`,
      `  version: 1`,
      `  definition: standard`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      `  - id: t2`,
      `    status: draft`,
      `    file: tasks/02-t2.md`,
      `    depends_on: [ t1 ]`,
      '',
    ].join('\n');

    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
    writeFileSync(join(tasksDir, '02-t2.md'), '---\nid: t2\n---\n# T2\n', 'utf8');

    return { changeDir, changeYamlPath: join(changeDir, 'change.yaml'), changeYaml };
  }

  test('publishing a draft, valid, dependency-clean, not-started task writes status: approved and does not commit or push', async () => {
    const slug = 'pub-valid';
    const { changeYamlPath } = createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const headBefore = git.getCurrentRevision(env.baseDir);
    const branchBefore = git.getCurrentBranch(env.baseDir);

    const result = await handleWorkflowTaskPublish(slug, 't1', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
      silent: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.taskId, 't1');
    assert.equal(result.status, 'approved');

    // Verify change.yaml was updated
    const change = loadChange(slug, env.activeDir);
    const task = change.tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'approved');

    // Verify no commit or push happened (HEAD and branch unchanged, change.yaml is dirty in working tree)
    const headAfter = git.getCurrentRevision(env.baseDir);
    const branchAfter = git.getCurrentBranch(env.baseDir);
    assert.equal(headAfter, headBefore, 'Git HEAD must not change');
    assert.equal(branchAfter, branchBefore, 'Git branch must not change');

    const dirty = git.getDirtyPaths(env.baseDir);
    assert.ok(dirty.some(p => p.includes('change.yaml')), 'change.yaml must be modified in working tree without commit');
  });

  test('publishing a task with depends_on that resolve in the same change succeeds', async () => {
    const slug = 'pub-deps';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    // t2 depends on t1, which is in the same change
    const result = publishTask(slug, 't2', {
      activeDir: env.activeDir,
      repoRoot: env.baseDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'approved');
    const change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 't2').status, 'approved');
  });

  test('publishing against a legacy spec (no workflow) fails via deterministic guard before mutation', () => {
    const slug = 'pub-legacy-none';
    const changeDir = join(env.activeDir, slug);
    mkdirSync(join(changeDir, 'tasks'), { recursive: true });
    const changeYaml = [
      `id: ${slug}`,
      `title: Legacy Spec`,
      `status: draft`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      '',
    ].join('\n');
    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow task publish/);
        return true;
      }
    );

    const contentAfter = readFileSync(join(changeDir, 'change.yaml'), 'utf8');
    assert.equal(contentAfter, changeYaml, 'change.yaml must remain byte-for-byte unchanged');
  });

  test('publishing against a legacy spec (explicit mode) fails via deterministic guard before mutation', () => {
    const slug = 'pub-legacy-explicit';
    const changeDir = join(env.activeDir, slug);
    mkdirSync(join(changeDir, 'tasks'), { recursive: true });
    const changeYaml = [
      `id: ${slug}`,
      `title: Legacy Spec`,
      `status: draft`,
      `workflow:`,
      `  mode: legacy`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      '',
    ].join('\n');
    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        assert.match(err.message, /workflow task publish/);
        return true;
      }
    );

    const contentAfter = readFileSync(join(changeDir, 'change.yaml'), 'utf8');
    assert.equal(contentAfter, changeYaml, 'change.yaml must remain byte-for-byte unchanged');
  });

  test('publishing a task that is not in draft status fails and writes nothing', () => {
    const slug = 'pub-not-draft';
    const { changeDir, changeYaml } = createDeterministicSpec(env.activeDir, slug);
    // Manually set status to approved in change.yaml
    const approvedYaml = changeYaml.replace('status: draft\n    file: tasks/01-t1.md', 'status: approved\n    file: tasks/01-t1.md');
    writeFileSync(join(changeDir, 'change.yaml'), approvedYaml, 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /only 'draft' tasks can be published/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), approvedYaml);
  });

  test('publishing a task with missing task file fails and writes nothing', () => {
    const slug = 'pub-missing-file';
    const { changeDir, changeYaml } = createDeterministicSpec(env.activeDir, slug);
    // Remove the task file
    rmSync(join(changeDir, 'tasks', '01-t1.md'));

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /file not found/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), changeYaml);
  });

  test('publishing a task with mismatched front matter id fails and writes nothing', () => {
    const slug = 'pub-mismatched-id';
    const { changeDir, changeYaml } = createDeterministicSpec(env.activeDir, slug);
    writeFileSync(join(changeDir, 'tasks', '01-t1.md'), '---\nid: wrong-id\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /does not match task id/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), changeYaml);
  });

  test('publishing a task with unknown depends_on entry fails and writes nothing', () => {
    const slug = 'pub-unknown-dep';
    const changeDir = join(env.activeDir, slug);
    const tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const changeYaml = [
      `id: ${slug}`,
      `title: Deterministic Spec`,
      `status: draft`,
      `workflow:`,
      `  mode: deterministic`,
      `  version: 1`,
      `  definition: standard`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      `    depends_on: [ nonexistent-task ]`,
      '',
    ].join('\n');

    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /depends_on unknown task 'nonexistent-task'/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), changeYaml);
  });

  test('publishing a task with self-referencing depends_on fails and writes nothing', () => {
    const slug = 'pub-self-dep';
    const changeDir = join(env.activeDir, slug);
    const tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const changeYaml = [
      `id: ${slug}`,
      `title: Deterministic Spec`,
      `status: draft`,
      `workflow:`,
      `  mode: deterministic`,
      `  version: 1`,
      `  definition: standard`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      `    depends_on: [ t1 ]`,
      '',
    ].join('\n');

    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /cannot depend on itself/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), changeYaml);
  });

  test('publishing a task that already has workflow_progress fails and writes nothing', () => {
    const slug = 'pub-already-started';
    const changeDir = join(env.activeDir, slug);
    const tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const changeYaml = [
      `id: ${slug}`,
      `title: Deterministic Spec`,
      `status: draft`,
      `workflow:`,
      `  mode: deterministic`,
      `  version: 1`,
      `  definition: standard`,
      `tasks:`,
      `  - id: t1`,
      `    status: draft`,
      `    file: tasks/01-t1.md`,
      `    workflow_progress:`,
      `      current_step: implementation`,
      `      state: active`,
      '',
    ].join('\n');

    writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

    assert.throws(
      () => {
        publishTask(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /workflow_progress is present/i);
        return true;
      }
    );

    assert.equal(readFileSync(join(changeDir, 'change.yaml'), 'utf8'), changeYaml);
  });
});
