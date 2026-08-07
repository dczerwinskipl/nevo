// Reusable fixture-repository builder for end-to-end tests of
// repository-bound handlers (D34/D35, task 20, area handler-testability —
// closes FU-007). Creates a throwaway directory containing both a real git
// repository (so tools/lib/git.mjs operations work against it) and a
// minimal specs/active/<change>/ structure, so handlers like `handleStart`/
// `checkSpecsIndexes`/`buildSpecsIndexes` can be driven exactly as they
// would be against the real repository, without ever touching it. Not a
// test file itself — imported by tests that need it.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

/**
 * `tasks` is an array of `{ id, status, allowedPaths, dependsOn }` — order
 * in the array is each task's own `order` field (1-based). Returns the
 * fixture's paths (matching the parameter shapes `handleStart`/
 * `checkSpecsIndexes`/`buildSpecsIndexes` now accept, D34/D35) plus a
 * `teardown()` that removes the whole fixture.
 */
export function createFixtureRepo({
  changeSlug = 'fixture-change',
  tasks = [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'], dependsOn: [] }],
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nevo-fixture-repo-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['checkout', '-q', '-b', 'main']);

  const specsDir = join(root, 'specs');
  const activeDir = join(specsDir, 'active');
  const archiveDir = join(specsDir, 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  const changeDir = join(activeDir, changeSlug);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  mkdirSync(join(changeDir, 'areas'), { recursive: true });

  const taskEntries = tasks.map((t, i) => {
    const order = i + 1;
    const deps = t.dependsOn?.length ? `\n    depends_on: [${t.dependsOn.join(', ')}]` : '';
    return `  - id: ${t.id}\n    order: ${order}\n    file: tasks/${String(order).padStart(2, '0')}-${t.id}.md\n    status: ${t.status}${deps}`;
  }).join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), [
    `id: ${changeSlug}`, 'title: Fixture change', 'status: draft', '',
    'branch:', '  mode: per-change', '  prefix: fixture', '',
    'tasks:', taskEntries, '',
  ].join('\n'));
  writeFileSync(join(changeDir, 'overview.md'), '# Fixture change\n\nGoal text.\n');
  writeFileSync(join(changeDir, 'owner-decisions.md'), '## D1\n\nSome decision.\n');

  tasks.forEach((t, i) => {
    const order = String(i + 1).padStart(2, '0');
    writeFileSync(join(changeDir, 'tasks', `${order}-${t.id}.md`), [
      '---', `id: ${changeSlug}.${t.id}`, 'status: draft', `change: ${changeSlug}`,
      'allowed_paths:', ...(t.allowedPaths || ['fixture/**']).map(p => `  - ${p}`),
      'forbidden_paths: []',
      '---', `# Task: ${t.id}`, '',
    ].join('\n'));
  });

  writeFileSync(join(root, '.gitignore'), '');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'Initial fixture commit']);

  return {
    root,
    activeDir,
    archiveDir,
    activeIndexMd: join(specsDir, 'active.generated.md'),
    archiveIndexMd: join(specsDir, 'archive.generated.md'),
    indexJson: join(specsDir, 'index.generated.json'),
    changeDir,
    changeYamlPath: join(changeDir, 'change.yaml'),
    teardown: () => rmSync(root, { recursive: true, force: true }),
  };
}
