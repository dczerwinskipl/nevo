import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { approveTask } from '../specs/approve/operation.mjs';
import { startTask } from '../specs/start/operation.mjs';
import { completeTask } from '../specs/complete/operation.mjs';
import { verifyTask } from '../specs/verify/operation.mjs';
import { handleWorkflowStepStart, handleWorkflowStepFinish } from '../specs/workflow/cli.mjs';
import { loadChange, setTaskStatus } from '../specs/store.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../specs/fingerprint.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import * as git from '../lib/git.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsDir = resolve(__dirname, '..');
const specsDir = join(toolsDir, 'specs');

// ── Static Import Boundary Utilities ──────────────────────────────────────────

function listSourceFiles(dir, extensions = ['.mjs', '.js']) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listSourceFiles(full, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  const importExportRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importExportRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

// ── Static Import Boundary Suite ─────────────────────────────────────────────

describe('Lifecycle Boundary — Static Import Boundary Checks', () => {
  test('legacy mutation operations do not import workflow mutation entry points', () => {
    const legacyDirs = ['approve', 'start', 'complete', 'verify'].map(d => join(specsDir, d));
    const mutationEntryPoints = [
      normalizePath(join(specsDir, 'workflow', 'cli.mjs')),
      normalizePath(join(specsDir, 'workflow', 'step-context.mjs')),
      normalizePath(join(specsDir, 'workflow', 'finish-operation.mjs')),
      normalizePath(join(specsDir, 'workflow', 'publish.mjs')),
    ];

    const violations = [];
    for (const lDir of legacyDirs) {
      const files = listSourceFiles(lDir);
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        const specifiers = extractImportSpecifiers(source);
        for (const spec of specifiers) {
          if (!spec.startsWith('.')) continue;
          const resolved = normalizePath(resolve(dirname(file), spec));
          for (const entryPoint of mutationEntryPoints) {
            if (resolved === entryPoint || resolved === entryPoint.replace(/\.mjs$/, '')) {
              violations.push({
                file: normalizePath(relative(toolsDir, file)),
                spec,
                target: entryPoint,
              });
            }
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found forbidden imports from legacy operations to workflow mutation entry points: ${JSON.stringify(violations, null, 2)}`
    );
  });

  test('workflow modules do not import from legacy mutation operations', () => {
    const workflowDir = join(specsDir, 'workflow');
    const legacyDirPaths = ['approve', 'start', 'complete', 'verify'].map(d =>
      normalizePath(join(specsDir, d))
    );

    const violations = [];
    const files = listSourceFiles(workflowDir);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const specifiers = extractImportSpecifiers(source);
      for (const spec of specifiers) {
        if (!spec.startsWith('.')) continue;
        const resolved = normalizePath(resolve(dirname(file), spec));
        for (const lDir of legacyDirPaths) {
          if (resolved.startsWith(lDir + '/') || resolved === lDir) {
            violations.push({
              file: normalizePath(relative(toolsDir, file)),
              spec,
              target: resolved,
            });
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found forbidden imports from workflow modules to legacy operations: ${JSON.stringify(violations, null, 2)}`
    );
  });

  test('no file under tools/specs/workflow/** imports lifecycle-primitives.mjs (D8)', () => {
    const workflowDir = join(specsDir, 'workflow');
    const lifecyclePrimitivesPath = normalizePath(join(specsDir, 'lifecycle-primitives.mjs'));

    const violations = [];
    const files = listSourceFiles(workflowDir);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const specifiers = extractImportSpecifiers(source);
      for (const spec of specifiers) {
        if (!spec.startsWith('.')) continue;
        const resolved = normalizePath(resolve(dirname(file), spec));
        if (resolved === lifecyclePrimitivesPath || resolved === lifecyclePrimitivesPath.replace(/\.mjs$/, '')) {
          violations.push({
            file: normalizePath(relative(toolsDir, file)),
            spec,
          });
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found forbidden imports of lifecycle-primitives.mjs in tools/specs/workflow/**: ${JSON.stringify(violations, null, 2)}`
    );
  });

  test('exempt modules (status-vocabulary.mjs, store.mjs, compatibility.mjs resolveWorkflowMode) remain importable by both sides', async () => {
    const { TERMINAL_STATUSES } = await import('../specs/status-vocabulary.mjs');
    assert.ok(TERMINAL_STATUSES instanceof Set);
    assert.ok(TERMINAL_STATUSES.has('implemented'));
    assert.ok(TERMINAL_STATUSES.has('verified'));

    const { setTaskStatus, setTaskWorkflowState, requireChange, requireTask } = await import('../specs/store.mjs');
    assert.equal(typeof setTaskStatus, 'function');
    assert.equal(typeof setTaskWorkflowState, 'function');
    assert.equal(typeof requireChange, 'function');
    assert.equal(typeof requireTask, 'function');

    const { resolveWorkflowMode } = await import('../specs/workflow/compatibility.mjs');
    assert.equal(typeof resolveWorkflowMode, 'function');

    // Verify resolveWorkflowMode handles both legacy and deterministic descriptors
    assert.equal(resolveWorkflowMode({ id: 's1' }).mode, 'legacy');
    assert.equal(resolveWorkflowMode({ id: 's2', workflow: { mode: 'legacy' } }).mode, 'legacy');
    assert.equal(resolveWorkflowMode({ id: 's3', workflow: { mode: 'deterministic' } }).mode, 'deterministic');
  });
});

// ── Fixture & State Capture Helpers ──────────────────────────────────────────

function setupTempGitRepo() {
  const baseDir = join(tmpdir(), `nevo-boundary-test-${Math.random().toString(36).slice(2)}`);
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

function captureState(env, changeSlug) {
  const changeYamlPath = join(env.activeDir, changeSlug, 'change.yaml');
  const changeYamlContent = existsSync(changeYamlPath) ? readFileSync(changeYamlPath, 'utf8') : null;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.baseDir }).toString().trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: env.baseDir }).toString().trim();
  const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: env.baseDir }).toString().trim();
  const localDir = join(env.baseDir, '.nevo-ai-local');
  const localFiles = existsSync(localDir) ? readdirSync(localDir, { recursive: true }) : [];
  return { changeYamlContent, head, branch, gitStatus, localFiles };
}

function assertStateUnchanged(before, after, label) {
  assert.equal(after.changeYamlContent, before.changeYamlContent, `${label}: change.yaml must be byte-for-byte unchanged`);
  assert.equal(after.head, before.head, `${label}: git HEAD must be unchanged`);
  assert.equal(after.branch, before.branch, `${label}: git branch must be unchanged`);
  assert.equal(after.gitStatus, before.gitStatus, `${label}: working tree status must be unchanged`);
  assert.deepEqual(after.localFiles, before.localFiles, `${label}: workflow/runtime state must be unchanged`);
}

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
    `    status: approved`,
    `    file: tasks/02-t2.md`,
    `  - id: t3`,
    `    status: in-implementation`,
    `    file: tasks/03-t3.md`,
    `  - id: t4`,
    `    status: implemented`,
    `    file: tasks/04-t4.md`,
    '',
  ].join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');
  writeFileSync(join(tasksDir, '02-t2.md'), '---\nid: t2\n---\n# T2\n', 'utf8');
  writeFileSync(join(tasksDir, '03-t3.md'), '---\nid: t3\n---\n# T3\n', 'utf8');
  writeFileSync(join(tasksDir, '04-t4.md'), '---\nid: t4\n---\n# T4\n', 'utf8');

  return { changeDir, changeYamlPath: join(changeDir, 'change.yaml'), changeYaml };
}

function createLegacySpec(activeDir, slug, explicitMode = false) {
  const changeDir = join(activeDir, slug);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const lines = [
    `id: ${slug}`,
    `title: Legacy Spec`,
    `status: draft`,
  ];
  if (explicitMode) {
    lines.push('workflow:', '  mode: legacy');
  }
  lines.push(
    `tasks:`,
    `  - id: t1`,
    `    status: draft`,
    `    file: tasks/01-t1.md`,
    ''
  );

  const changeYaml = lines.join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  writeFileSync(join(tasksDir, '01-t1.md'), '---\nid: t1\n---\n# T1\n', 'utf8');

  return { changeDir, changeYamlPath: join(changeDir, 'change.yaml'), changeYaml };
}

// ── Side-effect: No Mutation Before Guard Failure ─────────────────────────────

describe('Lifecycle Boundary — Side-Effect Isolation on Guard Failure', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  test('legacy approve against deterministic spec fails and leaves all state byte-for-byte unchanged', async () => {
    const slug = 'det-approve-guard';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await approveTask({
          changeSlug: slug,
          taskId: 't1',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'approveTask against deterministic');
  });

  test('legacy start against deterministic spec fails and leaves all state byte-for-byte unchanged', () => {
    const slug = 'det-start-guard';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    assert.throws(
      () => {
        startTask(slug, 't2', {
          activeDir: env.activeDir,
          gitRoot: env.baseDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'startTask against deterministic');
  });

  test('legacy complete against deterministic spec fails and leaves all state byte-for-byte unchanged', () => {
    const slug = 'det-complete-guard';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    assert.throws(
      () => {
        completeTask(slug, 't3', {
          activeDir: env.activeDir,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'completeTask against deterministic');
  });

  test('legacy verify against deterministic spec fails and leaves all state byte-for-byte unchanged', async () => {
    const slug = 'det-verify-guard';
    createDeterministicSpec(env.activeDir, slug);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await verifyTask({
          changeSlug: slug,
          taskId: 't4',
          gitRoot: env.baseDir,
          activeDir: env.activeDir,
          archiveDir: env.archiveDir,
          git: false,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /deterministic/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'verifyTask against deterministic');
  });

  test('workflow step start against legacy spec (no workflow field) fails and leaves state unchanged', async () => {
    const slug = 'legacy-start-guard-none';
    createLegacySpec(env.activeDir, slug, false);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'workflow step start against legacy (no workflow)');
  });

  test('workflow step finish against legacy spec (no workflow field) fails and leaves state unchanged', async () => {
    const slug = 'legacy-finish-guard-none';
    createLegacySpec(env.activeDir, slug, false);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepFinish(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'workflow step finish against legacy (no workflow)');
  });

  test('workflow step start against legacy spec (explicit mode) fails and leaves state unchanged', async () => {
    const slug = 'legacy-start-guard-explicit';
    createLegacySpec(env.activeDir, slug, true);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepStart(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'workflow step start against legacy (explicit mode)');
  });

  test('workflow step finish against legacy spec (explicit mode) fails and leaves state unchanged', async () => {
    const slug = 'legacy-finish-guard-explicit';
    createLegacySpec(env.activeDir, slug, true);
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: add ${slug}`], { cwd: env.baseDir });

    const beforeState = captureState(env, slug);

    await assert.rejects(
      async () => {
        await handleWorkflowStepFinish(slug, 't1', {
          activeDir: env.activeDir,
          repoRoot: env.baseDir,
          silent: true,
        });
      },
      (err) => {
        assert.ok(err instanceof CliError);
        assert.match(err.message, /legacy/i);
        return true;
      }
    );

    const afterState = captureState(env, slug);
    assertStateUnchanged(beforeState, afterState, 'workflow step finish against legacy (explicit mode)');
  });
});

// ── Full Legacy Lifecycle Suite ──────────────────────────────────────────────

describe('Lifecycle Boundary — Full Legacy Lifecycle Progression', () => {
  let env;

  before(() => {
    env = setupTempGitRepo();
  });

  after(() => {
    rmSync(env.baseDir, { recursive: true, force: true });
  });

  function setupLegacySpecForFullLifecycle(slug, explicitMode) {
    execFileSync('git', ['checkout', 'main'], { cwd: env.baseDir });

    const changeDir = join(env.activeDir, slug);
    const tasksDir = join(changeDir, 'tasks');
    const reviewsDir = join(changeDir, 'reviews');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(reviewsDir, { recursive: true });

    const lines = [
      `id: ${slug}`,
      `title: Legacy Lifecycle Spec`,
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
      ''
    );

    writeFileSync(join(changeDir, 'change.yaml'), lines.join('\n'), 'utf8');
    writeFileSync(join(tasksDir, '01-task-1.md'), '# Task 1\n', 'utf8');

    const changeObj = {
      id: slug,
      _dir: changeDir,
      tasks: [{ id: 'task-1', file: 'tasks/01-task-1.md', status: 'draft' }],
    };
    const fingerprint = computeChangeFingerprint(changeObj);
    const task1Fingerprint = computeTaskFingerprint(changeObj, 'task-1');

    const reviewMd = [
      '---',
      'verdict: ready-for-approval',
      `spec_fingerprint: ${fingerprint}`,
      'task_fingerprints:',
      `  task-1: ${task1Fingerprint}`,
      'unresolved_required_fixes: 0',
      'unresolved_owner_decisions: 0',
      'unresolved_needs_clarification: 0',
      '---',
      '',
      '# Spec Review',
      '',
    ].join('\n');
    writeFileSync(join(reviewsDir, 'spec.md'), reviewMd, 'utf8');

    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: setup ${slug}`], { cwd: env.baseDir });

    return { changeDir };
  }

  test('spec with no workflow field completes full legacy lifecycle (approve -> start -> complete -> verify)', async () => {
    const slug = 'legacy-full-no-wf';
    setupLegacySpecForFullLifecycle(slug, false);

    // 1. approve
    await approveTask({
      changeSlug: slug,
      taskId: 'task-1',
      gitRoot: env.baseDir,
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      git: false,
    });
    let change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'approved');

    // Commit approval changes so working tree is clean for startTask
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: approve ${slug}/task-1`], { cwd: env.baseDir });

    // 2. start
    const startResult = startTask(slug, 'task-1', {
      activeDir: env.activeDir,
      gitRoot: env.baseDir,
    });
    assert.equal(startResult.statusChanged, true);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'in-implementation');

    // 3. complete
    const completeResult = completeTask(slug, 'task-1', {
      activeDir: env.activeDir,
    });
    assert.equal(completeResult.alreadyImplemented, false);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'implemented');

    // 4. verify
    const verifyResult = await verifyTask({
      changeSlug: slug,
      taskId: 'task-1',
      gitRoot: env.baseDir,
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      git: false,
    });
    assert.equal(verifyResult.ok, true);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'verified');
  });

  test('spec with explicit workflow.mode: legacy completes full legacy lifecycle identically', async () => {
    const slug = 'legacy-full-explicit';
    setupLegacySpecForFullLifecycle(slug, true);

    // 1. approve
    await approveTask({
      changeSlug: slug,
      taskId: 'task-1',
      gitRoot: env.baseDir,
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      git: false,
    });
    let change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'approved');

    // Commit approval changes so working tree is clean for startTask
    execFileSync('git', ['add', '.'], { cwd: env.baseDir });
    execFileSync('git', ['commit', '-m', `chore: approve ${slug}/task-1`], { cwd: env.baseDir });

    // 2. start
    const startResult = startTask(slug, 'task-1', {
      activeDir: env.activeDir,
      gitRoot: env.baseDir,
    });
    assert.equal(startResult.statusChanged, true);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'in-implementation');

    // 3. complete
    const completeResult = completeTask(slug, 'task-1', {
      activeDir: env.activeDir,
    });
    assert.equal(completeResult.alreadyImplemented, false);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'implemented');

    // 4. verify
    const verifyResult = await verifyTask({
      changeSlug: slug,
      taskId: 'task-1',
      gitRoot: env.baseDir,
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      git: false,
    });
    assert.equal(verifyResult.ok, true);
    change = loadChange(slug, env.activeDir);
    assert.equal(change.tasks.find(t => t.id === 'task-1').status, 'verified');
  });
});
