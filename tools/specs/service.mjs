// Domain logic for tools/specs.mjs: loading changes, building context packets,
// fingerprinting, and generating indexes. No Commander, no process.argv here.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { readUtf8, writeUtf8, resolveWithinBase } from '../lib/fs.mjs';
import { parseYamlFile, parseFrontMatterFile, updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { ACTIVE_CHANGE_STATUSES, isTaskReady } from './lifecycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTIVE_DIR = join(ROOT, 'specs', 'active');
export const ARCHIVE_DIR = join(ROOT, 'specs', 'archive');
export const ACTIVE_INDEX_MD = join(ROOT, 'specs', 'active.generated.md');
export const ARCHIVE_INDEX_MD = join(ROOT, 'specs', 'archive.generated.md');
export const INDEX_JSON = join(ROOT, 'specs', 'index.generated.json');

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/specs.mjs generate -->\n\n';

// ── Change manifest loading ────────────────────────────────────────────────

export function loadChange(slug, baseDir = ACTIVE_DIR) {
  const dir = resolveWithinBase(baseDir, slug);
  const file = join(dir, 'change.yaml');
  if (!existsSync(file)) return null;
  const change = parseYamlFile(file);
  change._slug = slug;
  change._file = file;
  change._dir = dir;
  change.tasks = change.tasks || [];
  return change;
}

export function listChanges(dir = ACTIVE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => {
      const full = join(dir, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'change.yaml'));
    })
    .map(slug => loadChange(slug, dir))
    .filter(Boolean);
}

/** Structural update: set one task's status in change.yaml, preserving comments/formatting. */
export function setTaskStatus(change, taskId, status) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('status', status);
  });
}

/** Structural update: set the change's top-level status in change.yaml. */
export function setChangeStatus(change, status) {
  updateYamlFile(change._file, doc => doc.set('status', status));
}

// ── Context packet ─────────────────────────────────────────────────────────

export function buildContextPacket(change, task) {
  const taskFile = task.file ? resolveWithinBase(change._dir, task.file) : null;
  const taskFm = taskFile ? parseFrontMatterFile(taskFile) : {};

  const branchMode = change.branch?.mode || 'per-change';
  const prefix = change.branch?.prefix || 'feature';
  const branch = branchMode === 'per-task'
    ? `${prefix}/${change._slug}/${task.id}`
    : `${prefix}/${change._slug}`;

  return {
    change: { id: change.id, title: change.title },
    task: {
      id: task.id,
      file: task.file ? `specs/active/${change._slug}/${task.file}` : null,
    },
    context: {
      required: (taskFm.context?.required || []).map(p =>
        p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
      ),
      optional: (taskFm.context?.optional || []).map(p =>
        p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
      ),
    },
    allowed_paths: taskFm.allowed_paths || [],
    forbidden_paths: taskFm.forbidden_paths || [],
    branch,
  };
}

// ── Next task selection ────────────────────────────────────────────────────

export function getNext() {
  const changes = listChanges().filter(c => ACTIVE_CHANGE_STATUSES.has(c.status));

  const candidates = [];
  for (const change of changes) {
    for (const task of change.tasks) {
      if (isTaskReady(task, change)) {
        candidates.push({ change, task });
      }
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const pa = a.change.priority ?? 999;
    const pb = b.change.priority ?? 999;
    if (pa !== pb) return pa - pb;
    if (a.task.order !== b.task.order) return (a.task.order ?? 999) - (b.task.order ?? 999);
    return a.change._slug.localeCompare(b.change._slug);
  });

  return buildContextPacket(candidates[0].change, candidates[0].task);
}

// ── Deterministic spec fingerprint ─────────────────────────────────────────
//
// A hash over the specification inputs that matter for approval readiness —
// deliberately excluding `reviews/**` so writing a review never invalidates
// its own fingerprint.

export function collectSpecFingerprintFiles(change) {
  const files = ['change.yaml'];
  if (existsSync(join(change._dir, 'overview.md'))) files.push('overview.md');
  if (existsSync(join(change._dir, 'owner-decisions.md'))) files.push('owner-decisions.md');
  for (const sub of ['areas', 'tasks']) {
    const dir = join(change._dir, sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      if (entry.endsWith('.md')) files.push(`${sub}/${entry}`);
    }
  }
  return files.sort();
}

export function computeSpecFingerprint(change) {
  const files = collectSpecFingerprintFiles(change);
  const hash = createHash('sha256');
  for (const relPath of files) {
    const content = readUtf8(join(change._dir, ...relPath.split('/')));
    hash.update(relPath);
    hash.update('\n');
    hash.update(content);
    hash.update('\n\x00\n');
  }
  return hash.digest('hex');
}

export function loadReview(change) {
  const file = join(change._dir, 'reviews', 'spec.md');
  if (!existsSync(file)) return null;
  return parseFrontMatterFile(file);
}

// ── Index generation: build (pure, deterministic) + write (I/O) ────────────

const STATUS_ORDER = [
  'in-implementation', 'approved', 'needs-decision', 'draft', 'blocked',
  'implemented', 'verified', 'abandoned', 'superseded', 'archived',
];

function toRow(c) {
  return `| \`${c.id}\` | ${c.title} | ${c.status} | ${c.priority ?? '-'} | ${c.created ?? '-'} |\n`;
}

/** Build the expected generated index content in memory. Deterministic — no timestamps in the Markdown. */
export function buildSpecsIndexes() {
  const active = listChanges(ACTIVE_DIR).sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return (a.priority ?? 999) - (b.priority ?? 999);
  });
  const archive = listChanges(ARCHIVE_DIR);

  const header = '| ID | Title | Status | Priority | Created |\n|---|---|---|---|---|\n';

  let activeMd = GENERATED_NOTICE + '# Active specifications\n\n' + header;
  for (const c of active) activeMd += toRow(c);

  let archiveMd = GENERATED_NOTICE + '# Archived specifications\n\n' + header;
  for (const c of archive) archiveMd += toRow(c);

  const changes = [...active, ...archive].map(c => ({
    id: c.id, title: c.title, status: c.status, priority: c.priority,
    created: c.created, tasks: c.tasks,
  }));

  return { activeMd, archiveMd, changes, activeCount: active.length, archiveCount: archive.length };
}

/** Persist already-built index content. No decisions made here — just writes. */
export function writeSpecsIndexes(built) {
  writeUtf8(ACTIVE_INDEX_MD, built.activeMd);
  writeUtf8(ARCHIVE_INDEX_MD, built.archiveMd);
  writeUtf8(INDEX_JSON, JSON.stringify({ generated: new Date().toISOString(), changes: built.changes }, null, 2));
}

/** Compare on-disk generated files against freshly-built expected content, ignoring the JSON timestamp. */
export function checkSpecsIndexes() {
  const built = buildSpecsIndexes();
  const problems = [];

  if (!existsSync(ACTIVE_INDEX_MD)) problems.push('missing: specs/active.generated.md');
  else if (readUtf8(ACTIVE_INDEX_MD) !== built.activeMd) problems.push('stale: specs/active.generated.md');

  if (!existsSync(ARCHIVE_INDEX_MD)) problems.push('missing: specs/archive.generated.md');
  else if (readUtf8(ARCHIVE_INDEX_MD) !== built.archiveMd) problems.push('stale: specs/archive.generated.md');

  if (!existsSync(INDEX_JSON)) {
    problems.push('missing: specs/index.generated.json');
  } else {
    const existing = JSON.parse(readUtf8(INDEX_JSON));
    if (JSON.stringify(existing.changes) !== JSON.stringify(built.changes)) {
      problems.push('stale: specs/index.generated.json');
    }
  }

  return problems;
}
