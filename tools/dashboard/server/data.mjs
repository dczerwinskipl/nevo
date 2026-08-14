import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function markdownDocument({ id, kind, filePath, fallbackTitle, repoRoot, metadata = {} }) {
  const available = Boolean(filePath && existsSync(filePath) && statSync(filePath).isFile());
  const markdown = available ? stripFrontMatter(readOptional(filePath)).trim() : '';
  return {
    id,
    kind,
    title: extractDocumentTitle(markdown, fallbackTitle, kind === 'task'),
    path: filePath ? repositoryPath(repoRoot, filePath) : null,
    available,
    markdown,
    ...metadata,
  };
}

export function loadSpecificationContent({
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
  const areaFiles = areasDir && existsSync(areasDir)
    ? readdirSync(areasDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
      .map(entry => safeChildPath(areasDir, entry.name))
      .filter(Boolean)
      .sort((a, b) => basename(a).localeCompare(basename(b)))
    : [];

  const overview = markdownDocument({
    id: 'overview',
    kind: 'overview',
    filePath: overviewPath,
    fallbackTitle: change.title || change._slug,
    repoRoot,
  });
  const areas = areaFiles.map(filePath => markdownDocument({
    id: basename(filePath, extname(filePath)),
    kind: 'area',
    filePath,
    fallbackTitle: basename(filePath, extname(filePath)).replace(/[-_]+/g, ' '),
    repoRoot,
  }));
  const tasks = change.tasks
    .map(task => {
      const filePath = safeChildPath(change._dir, task.file);
      return markdownDocument({
        id: task.id,
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
    })
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  return {
    id: change.id || change._slug,
    slug: change._slug,
    title: change.title || change._slug,
    source,
    path: repositoryPath(repoRoot, change._dir),
    overview,
    areas,
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
