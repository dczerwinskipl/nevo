import { execFile } from 'node:child_process';
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
