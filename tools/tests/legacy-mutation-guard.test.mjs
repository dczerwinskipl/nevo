import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { approveTask } from '../specs/approve/operation.mjs';
import { startTask } from '../specs/start/operation.mjs';
import { completeTask } from '../specs/complete/operation.mjs';
import { verifyTask } from '../specs/verify/operation.mjs';
import { loadChange } from '../specs/store.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import * as git from '../lib/git.mjs';

function setupTempGitRepo() {
  const baseDir = join(tmpdir(), `nevo-legacy-guard-test-${Math.random().toString(36).slice(2)}`);
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
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  writeFileSync(join(baseDir, 'specs', 'active.generated.md'), '# Active Specs\n');
  writeFileSync(join(baseDir, 'specs', 'archive.generated.md'), '# Archive Specs\n');
  writeFileSync(join(baseDir, 'specs', 'index.generated.json'), JSON.stringify({ generated: new Date().toISOString(), changes: [] }, null, 2));

  return { baseDir, activeDir, archiveDir };
}

function createDeterministicSpec(activeDir, slug = 'det-change') {
  const changeDir = join(activeDir, slug);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const changeYamlContent = [
    `id: ${slug}`,
    `title: Deterministic Change`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  version: 1`,
    `  definition: standard`,
    `tasks:`,
    `  - id: task-1`,
    `    status: draft`,
    `    file: tasks/01-task-1.md`,
    `  - id: task-2`,
    `    status: approved`,
    `    file: tasks/02-task-2.md`,
    `  - id: task-3`,
    `    status: in-implementation`,
    `    file: tasks/03-task-3.md`,
    `  - id: task-4`,
    `    status: implemented`,
    `    file: tasks/04-task-4.md`,
    '',
  ].join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent, 'utf8');
  writeFileSync(join(tasksDir, '01-task-1.md'), '---\nid: task-1\n---\n# Task 1\n', 'utf8');
  writeFileSync(join(tasksDir, '02-task-2.md'), '---\nid: task-2\n---\n# Task 2\n', 'utf8');
  writeFileSync(join(tasksDir, '03-task-3.md'), '---\nid: task-3\n---\n# Task 3\n', 'utf8');
  writeFileSync(join(tasksDir, '04-task-4.md'), '---\nid: task-4\n---\n# Task 4\n', 'utf8');

  return { changeDir, changeYamlFile: join(changeDir, 'change.yaml'), changeYamlContent };
}

function createLegacySpec(activeDir, slug = 'legacy-change', explicitMode = false) {
  const changeDir = join(activeDir, slug);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const lines = [
    `id: ${slug}`,
    `title: Legacy Change`,
    `status: draft`,
  ];
  if (explicitMode) {
    lines.push('workflow:', '  mode: legacy');
  }
  lines.push(
    `tasks:`,
    `  - id: task-1`,
    `    status: draft`,
    `    file: tasks/01-task-1.md`,
    `  - id: task-2`,
    `    status: approved`,
    `    file: tasks/02-task-2.md`,
    ''
  );

  const changeYamlContent = lines.join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent, 'utf8');
  writeFileSync(join(tasksDir, '01-task-1.md'), '---\nid: task-1\n---\n# Task 1\n', 'utf8');
  writeFileSync(join(tasksDir, '02-task-2.md'), '---\nid: task-2\n---\n# Task 2\n', 'utf8');

  return { changeDir, changeYamlFile: join(changeDir, 'change.yaml'), changeYamlContent };
}

describe('legacy-mutation-guard — refuse to run against deterministic specs', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  test('approveTask refuses to run against deterministic spec and leaves change.yaml unchanged', async () => {
    const slug = 'det-approve';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await approveTask({
          changeSlug: slug,
          taskId: 'task-1',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError but got ${err.constructor.name}`);
        assert.match(err.message, /deterministic/i);
        assert.match(err.message, /approve/i);
        assert.match(err.message, /workflow task publish/);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /startHumanStep/);
        assert.match(err.message, /submitHumanStepResult/);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
  });

  test('approveTask with check: true also refuses to run against deterministic spec', async () => {
    const slug = 'det-approve-check';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await approveTask({
          changeSlug: slug,
          taskId: 'task-1',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
          check: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
  });

  test('startTask refuses to run against deterministic spec and leaves git state and change.yaml unchanged', () => {
    const slug = 'det-start';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    const initialBranch = git.getCurrentBranch(env.baseDir);
    const initialRev = git.getCurrentRevision(env.baseDir);

    assert.throws(
      () => {
        startTask(slug, 'task-2', {
          activeDir: env.activeDir,
          gitRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError but got ${err.constructor.name}`);
        assert.match(err.message, /deterministic/i);
        assert.match(err.message, /start/i);
        assert.match(err.message, /workflow task publish/);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /startHumanStep/);
        assert.match(err.message, /submitHumanStepResult/);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
    assert.equal(git.getCurrentBranch(env.baseDir), initialBranch, 'current branch must be unchanged');
    assert.equal(git.getCurrentRevision(env.baseDir), initialRev, 'HEAD revision must be unchanged');
    assert.equal(git.branchExists(env.baseDir, `feature/${slug}`), false, 'feature branch must not have been created');
  });

  test('completeTask refuses to run against deterministic spec and leaves change.yaml unchanged', () => {
    const slug = 'det-complete';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    assert.throws(
      () => {
        completeTask(slug, 'task-3', {
          activeDir: env.activeDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError but got ${err.constructor.name}`);
        assert.match(err.message, /deterministic/i);
        assert.match(err.message, /complete/i);
        assert.match(err.message, /workflow task publish/);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /startHumanStep/);
        assert.match(err.message, /submitHumanStepResult/);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
  });

  test('verifyTask refuses to run against deterministic spec and leaves change.yaml unchanged', async () => {
    const slug = 'det-verify';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await verifyTask({
          changeSlug: slug,
          taskId: 'task-4',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError, `Expected CliError but got ${err.constructor.name}`);
        assert.match(err.message, /deterministic/i);
        assert.match(err.message, /verify/i);
        assert.match(err.message, /workflow task publish/);
        assert.match(err.message, /workflow step start/);
        assert.match(err.message, /workflow step finish/);
        assert.match(err.message, /startHumanStep/);
        assert.match(err.message, /submitHumanStepResult/);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
  });

  test('verifyTask with check: true refuses to run against deterministic spec', async () => {
    const slug = 'det-verify-check';
    const { changeYamlFile, changeYamlContent } = createDeterministicSpec(env.activeDir, slug);

    await assert.rejects(
      async () => {
        await verifyTask({
          changeSlug: slug,
          taskId: 'task-4',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
          check: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterContent = readFileSync(changeYamlFile, 'utf8');
    assert.equal(afterContent, changeYamlContent, 'change.yaml must be unchanged byte-for-byte');
  });
});

describe('legacy-mutation-guard — legacy specs are unaffected', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  test('spec without workflow field is unaffected by deterministic guard', () => {
    const slug = 'legacy-no-workflow';
    createLegacySpec(env.activeDir, slug, false);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', 'chore: add legacy spec'], { cwd: env.baseDir });

    // startTask should proceed with legacy behavior (and transition task-2 to in-implementation)
    const result = startTask(slug, 'task-2', {
      activeDir: env.activeDir,
      gitRoot: env.baseDir,
    });

    assert.equal(result.statusChanged, true);
    const reloaded = loadChange(slug, env.activeDir);
    assert.equal(reloaded.tasks.find(t => t.id === 'task-2').status, 'in-implementation');
  });

  test('spec with explicit workflow.mode: legacy is unaffected by deterministic guard', () => {
    const slug = 'legacy-explicit-mode';
    createLegacySpec(env.activeDir, slug, true);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', 'chore: add legacy spec with explicit mode'], { cwd: env.baseDir });

    // startTask should proceed with legacy behavior (and transition task-2 to in-implementation)
    const result = startTask(slug, 'task-2', {
      activeDir: env.activeDir,
      gitRoot: env.baseDir,
    });

    assert.equal(result.statusChanged, true);
    const reloaded = loadChange(slug, env.activeDir);
    assert.equal(reloaded.tasks.find(t => t.id === 'task-2').status, 'in-implementation');
  });
});
