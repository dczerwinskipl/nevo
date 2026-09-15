import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const ARCHIVED_FIXTURE_SLUG = 'archived-route-fixture';
export const ACTIVE_FIXTURE_SLUG = 'active-route-fixture';
const execFileAsync = promisify(execFile);

export async function createSpecificationRouteFixtures(t) {
  const root = await mkdtemp(join(tmpdir(), 'nevo-dashboard-spec-routes-'));
  const activeDir = join(root, 'specs', 'active');
  const archiveDir = join(root, 'specs', 'archive');

  await Promise.all([
    writeChange(activeDir, ACTIVE_FIXTURE_SLUG, 'Active route fixture', 'fixture-task'),
    writeChange(archiveDir, ARCHIVED_FIXTURE_SLUG, 'Archived route fixture'),
  ]);
  await execFileAsync('git', ['init', root]);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Dashboard fixture']);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'dashboard-fixture@example.test']);
  await execFileAsync('git', ['-C', root, 'add', '.']);
  await execFileAsync('git', ['-C', root, 'commit', '-m', 'Add dashboard route fixtures']);
  t.after(() => rm(root, { recursive: true, force: true }));

  return { root, activeDir, archiveDir };
}

/**
 * Writes a minimal, real, legacy-mode change.yaml fixture (`spec_id`, `tasks`, no
 * `workflow` key at all — legacy is `resolveWorkflowMode`'s own default) directly under
 * `<repoRoot>/specs/active/<slug>/change.yaml`.
 *
 * Many AI-session tests pass a stable, hardcoded `specId` purely as an inert label for
 * task/binding bookkeeping — they were never meant to exercise deterministic workflow
 * resolution. Since AgentSessionService's fail-closed contract (Task 02) now rejects an
 * explicit specId that resolves to no real spec under the service's repoRoot, those tests
 * need a genuine (if minimal) spec on disk to remain legacy — not a special-cased
 * workaround in `service.mjs` itself. Synchronous so it can run at test-file module scope
 * (a single fixture shared by every test in the file) or inline inside a test body.
 */
export function writeLegacySpecFixtureSync(repoRoot, specId, { slug = 'fixture-change', taskIds = [] } = {}) {
  const changeDir = join(repoRoot, 'specs', 'active', slug);
  mkdirSync(changeDir, { recursive: true });
  const tasksYaml = taskIds.length > 0 ? `tasks:\n${taskIds.map((id) => `  - id: "${id}"\n`).join('')}` : 'tasks: []\n';
  writeFileSync(join(changeDir, 'change.yaml'), `spec_id: ${specId}\n${tasksYaml}`, 'utf-8');
}

async function writeChange(parentDir, slug, title, taskId) {
  const changeDir = join(parentDir, slug);
  await mkdir(join(changeDir, 'tasks'), { recursive: true });
  const tasks = taskId
    ? [`  - id: ${taskId}`, '    order: 1', `    file: tasks/01-${taskId}.md`, '    status: draft']
    : [];
  await writeFile(join(changeDir, 'change.yaml'), [`id: ${slug}`, `title: ${title}`, 'status: draft', 'tasks:', ...tasks, ''].join('\n'));
  await writeFile(join(changeDir, 'overview.md'), `# ${title}\n`);
  if (taskId) await writeFile(join(changeDir, 'tasks', `01-${taskId}.md`), `# Task: ${taskId}\n`);
}
