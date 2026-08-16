import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { open as openFile, readdir as readdirAsync, readFile as readFileAsync, stat as statAsync } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  loadChange,
  listChanges,
} from '../../specs/service.mjs';
import { isTaskReady } from '../../specs/lifecycle.mjs';
import {
  SPEC_STAGES,
  isCompletedStatus,
  isTerminalStatus,
  stageForStatus,
} from '../shared/status-stages.js';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function stripFrontMatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function toPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, maxLength = 280) {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > maxLength * 0.65 ? lastSpace : slice.length)}…`;
}

function sectionBody(markdown, heading) {
  const body = stripFrontMatter(markdown);
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(body);
  if (!match) return '';
  const afterHeading = body.slice(match.index + match[0].length);
  return afterHeading.split(/^##\s+/m)[0].trim();
}

export function extractOverviewSummary(markdown, fallbackTitle = 'Specification change') {
  if (!markdown?.trim()) return `Specification: ${fallbackTitle}`;

  const preferred = ['Summary', 'Context', 'Goal', 'Problem']
    .map(heading => sectionBody(markdown, heading))
    .find(Boolean);
  const withoutFrontMatter = stripFrontMatter(markdown)
    .replace(/^#\s+.*$/m, '')
    .trim();
  const source = preferred || withoutFrontMatter;
  const paragraph = source.split(/\r?\n\s*\r?\n/).map(toPlainText).find(Boolean);
  return truncate(paragraph || `Specification: ${fallbackTitle}`);
}

function extractDocumentTitle(markdown, fallback, stripTaskPrefix = false) {
  const body = stripFrontMatter(markdown || '');
  const rawHeading = body.match(/^#\s+(.+)$/m)?.[1];
  const heading = stripTaskPrefix ? rawHeading?.replace(/^Task:\s*/i, '') : rawHeading;
  return toPlainText(heading || fallback);
}

function extractTaskTitle(markdown, fallback) {
  return extractDocumentTitle(markdown, fallback, true);
}

function safeChildPath(baseDir, childPath) {
  if (!childPath || typeof childPath !== 'string') return null;
  const base = resolve(baseDir);
  const candidate = resolve(base, childPath);
  if (candidate === base || candidate.startsWith(`${base}${sep}`)) return candidate;
  return null;
}

function readOptional(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

function collectRelevantFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectRelevantFiles(fullPath));
    else if (/\.(?:md|ya?ml)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function latestModifiedAt(changeDir) {
  const timestamps = collectRelevantFiles(changeDir)
    .map(file => statSync(file).mtimeMs)
    .filter(Number.isFinite);
  return new Date(timestamps.length ? Math.max(...timestamps) : Date.now()).toISOString();
}

function repositoryPath(repoRoot, absolutePath) {
  const result = relative(repoRoot, absolutePath).replace(/\\/g, '/');
  return result.startsWith('../') ? null : result;
}

function sourceDirectory(source, activeDir, archiveDir) {
  if (source === 'active') return activeDir;
  if (source === 'archive') return archiveDir;
  return null;
}

// ── Manifest + per-document content (async fs, no full-body reads on the
// manifest path) ─────────────────────────────────────────────────────────
//
// Replaces the old single-bundle loadSpecificationContent: the manifest lists
// every document (id/title/path/available) without bodies, and
// loadSpecificationDocument serves exactly one document's markdown on demand.
// `docId` is `overview`, `area:<id>`, or `task:<id>` — unambiguous even if an
// area and a task happen to share an id.

const TITLE_READ_BYTES = 8192;

async function pathStat(filePath) {
  if (!filePath) return null;
  try {
    const stats = await statAsync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

// A fast partial read — enough to find the leading H1 without paying for a
// full-file read on every manifest request (area doc: "derive it more
// cheaply than a full-file read").
async function readTitleChunk(filePath) {
  const handle = await openFile(filePath, 'r');
  try {
    const buffer = Buffer.alloc(TITLE_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, TITLE_READ_BYTES, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function manifestDocument({ id, docId, kind, filePath, fallbackTitle, repoRoot, metadata = {} }) {
  const stats = await pathStat(filePath);
  const available = Boolean(stats);
  const chunk = available ? await readTitleChunk(filePath) : '';
  return {
    id,
    docId,
    kind,
    title: extractDocumentTitle(chunk, fallbackTitle, kind === 'task'),
    path: filePath ? repositoryPath(repoRoot, filePath) : null,
    available,
    lastModified: stats ? new Date(stats.mtimeMs).toISOString() : null,
    ...metadata,
  };
}

async function listMarkdownFiles(dir) {
  let entries;
  try {
    entries = await readdirAsync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
    .map(entry => safeChildPath(dir, entry.name))
    .filter(Boolean)
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export async function loadSpecificationManifest({
  source,
  slug,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  repoRoot = REPOSITORY_ROOT,
} = {}) {
  const baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;

  const change = loadChange(slug, baseDir);
  if (!change) return null;

  const overviewPath = safeChildPath(change._dir, 'overview.md');
  const areasDir = safeChildPath(change._dir, 'areas');
  const areaFiles = areasDir ? await listMarkdownFiles(areasDir) : [];

  const overview = await manifestDocument({
    id: 'overview',
    docId: 'overview',
    kind: 'overview',
    filePath: overviewPath,
    fallbackTitle: change.title || change._slug,
    repoRoot,
  });
  const areas = await Promise.all(areaFiles.map(filePath => {
    const id = basename(filePath, extname(filePath));
    return manifestDocument({
      id,
      docId: `area:${id}`,
      kind: 'area',
      filePath,
      fallbackTitle: id.replace(/[-_]+/g, ' '),
      repoRoot,
    });
  }));
  const tasks = await Promise.all(change.tasks.map(task => {
    const filePath = safeChildPath(change._dir, task.file);
    return manifestDocument({
      id: task.id,
      docId: `task:${task.id}`,
      kind: 'task',
      filePath,
      fallbackTitle: task.id,
      repoRoot,
      metadata: {
        status: task.status || 'draft',
        order: task.order ?? null,
        dependsOn: task.depends_on || [],
      },
    });
  }));
  tasks.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  return {
    id: change.id || change._slug,
    specId: change.spec_id ?? null,
    slug: change._slug,
    title: change.title || change._slug,
    source,
    path: repositoryPath(repoRoot, change._dir),
    overview,
    areas,
    tasks,
  };
}

/** Resolve one manifest `docId` to `{ filePath, kind, id, fallbackTitle, metadata }`, or `null` if unknown/unsafe. */
function resolveDocumentTarget(change, docId) {
  if (docId === 'overview') {
    return {
      filePath: safeChildPath(change._dir, 'overview.md'),
      kind: 'overview',
      id: 'overview',
      fallbackTitle: change.title || change._slug,
      metadata: {},
    };
  }
  if (docId.startsWith('area:')) {
    const id = docId.slice('area:'.length);
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return null;
    return {
      filePath: safeChildPath(change._dir, `areas/${id}.md`),
      kind: 'area',
      id,
      fallbackTitle: id.replace(/[-_]+/g, ' '),
      metadata: {},
    };
  }
  if (docId.startsWith('task:')) {
    const id = docId.slice('task:'.length);
    const task = change.tasks.find(t => t.id === id);
    if (!task) return null;
    return {
      filePath: safeChildPath(change._dir, task.file),
      kind: 'task',
      id,
      fallbackTitle: id,
      metadata: {
        status: task.status || 'draft',
        order: task.order ?? null,
        dependsOn: task.depends_on || [],
      },
    };
  }
  return null;
}

export async function loadSpecificationDocument({
  source,
  slug,
  docId,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  repoRoot = REPOSITORY_ROOT,
} = {}) {
  const baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
  if (typeof docId !== 'string' || !docId) return null;

  const change = loadChange(slug, baseDir);
  if (!change) return null;

  const target = resolveDocumentTarget(change, docId);
  if (!target || !target.filePath) return null;

  const stats = await pathStat(target.filePath);
  const available = Boolean(stats);
  const markdown = available ? stripFrontMatter(await readFileAsync(target.filePath, 'utf8')).trim() : '';

  return {
    id: target.id,
    docId,
    kind: target.kind,
    title: extractDocumentTitle(markdown, target.fallbackTitle, target.kind === 'task'),
    path: repositoryPath(repoRoot, target.filePath),
    available,
    markdown,
    ...target.metadata,
  };
}

// ── Task statuses (small, fast-pollable — sourced entirely from change.yaml,
// never a per-task file read) ───────────────────────────────────────────────

function taskStatusProjection(task, change) {
  const dependencyStatuses = new Map(change.tasks.map(item => [item.id, item.status]));
  const blockedBy = (task.depends_on || []).filter(id => {
    const status = dependencyStatuses.get(id);
    return !['implemented', 'verified', 'archived'].includes(status);
  });

  return {
    id: task.id,
    status: task.status || 'draft',
    stage: stageForStatus(task.status),
    order: task.order ?? null,
    dependsOn: task.depends_on || [],
    blockedBy,
    ready: isTaskReady(task, change),
    terminal: isTerminalStatus(task.status),
  };
}

export function loadTaskStatuses({
  source,
  slug,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
} = {}) {
  const baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;

  const change = loadChange(slug, baseDir);
  if (!change) return null;

  const tasks = change.tasks
    .map(task => taskStatusProjection(task, change))
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  const revision = createHash('sha1').update(JSON.stringify(tasks)).digest('hex');

  return {
    id: change.id || change._slug,
    slug: change._slug,
    source,
    revision,
    tasks,
  };
}

function taskProjection(change, task, repoRoot) {
  const filePath = safeChildPath(change._dir, task.file);
  const dependencyStatuses = new Map(change.tasks.map(item => [item.id, item.status]));
  const blockedBy = (task.depends_on || []).filter(id => {
    const status = dependencyStatuses.get(id);
    return !['implemented', 'verified', 'archived'].includes(status);
  });

  return {
    id: task.id,
    title: extractTaskTitle(readOptional(filePath), task.id),
    status: task.status || 'draft',
    stage: stageForStatus(task.status),
    order: task.order ?? null,
    dependsOn: task.depends_on || [],
    blockedBy,
    ready: isTaskReady(task, change),
    terminal: isTerminalStatus(task.status),
    file: filePath ? repositoryPath(repoRoot, filePath) : null,
  };
}

function changeProjection(change, source, repoRoot) {
  const overviewPath = safeChildPath(change._dir, 'overview.md');
  const tasks = change.tasks
    .map(task => taskProjection(change, task, repoRoot))
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  const actionableTasks = tasks.filter(task => task.status !== 'abandoned');
  const actionableCount = actionableTasks.length;
  const completedCount = tasks.filter(task => isCompletedStatus(task.status)).length;
  const stageCounts = Object.fromEntries(
    SPEC_STAGES.map(stage => [stage.id, actionableTasks.filter(task => task.stage === stage.id).length]),
  );
  const activeTask = tasks.find(task => task.status === 'in-implementation');
  const readyTask = tasks.find(task => task.ready);
  const lanes = SPEC_STAGES.map(stage => ({
    ...stage,
    tasks: tasks.filter(task => task.stage === stage.id),
  }));

  return {
    id: change.id || change._slug,
    specId: change.spec_id ?? null,
    slug: change._slug,
    title: change.title || change._slug,
    status: source === 'archive' ? 'archived' : (change.status || 'draft'),
    source,
    priority: change.priority ?? null,
    created: change.created ?? null,
    updatedAt: latestModifiedAt(change._dir),
    path: repositoryPath(repoRoot, change._dir),
    overviewFile: overviewPath ? repositoryPath(repoRoot, overviewPath) : null,
    summary: extractOverviewSummary(readOptional(overviewPath), change.title || change._slug),
    tasks,
    lanes,
    nextTask: activeTask || readyTask || null,
    metrics: {
      total: tasks.length,
      actionable: actionableCount,
      completed: completedCount,
      abandoned: tasks.filter(task => task.status === 'abandoned').length,
      inImplementation: tasks.filter(task => task.status === 'in-implementation').length,
      inReview: tasks.filter(task => task.status === 'implemented').length,
      ready: tasks.filter(task => task.ready).length,
      stageCounts,
      progress: actionableCount ? Math.round((completedCount / actionableCount) * 100) : 0,
    },
  };
}

function activeSort(a, b) {
  const rank = new Map([['in-implementation', 0], ['approved', 1], ['draft', 2]]);
  return (rank.get(a.status) ?? 9) - (rank.get(b.status) ?? 9)
    || (a.priority ?? 999) - (b.priority ?? 999)
    || a.title.localeCompare(b.title);
}

export function loadDashboardData({
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  repoRoot = REPOSITORY_ROOT,
} = {}) {
  const active = listChanges(activeDir).map(change => changeProjection(change, 'active', repoRoot)).sort(activeSort);
  const archive = listChanges(archiveDir)
    .map(change => changeProjection(change, 'archive', repoRoot))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    generatedAt: new Date().toISOString(),
    counts: { active: active.length, archived: archive.length },
    active,
    archive,
  };
}

export { safeChildPath };
