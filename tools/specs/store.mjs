import { existsSync, readdirSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveWithinBase } from '../lib/fs.mjs';
import { parseYamlFile, parseYamlString, updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTIVE_DIR = join(ROOT, 'specs', 'active');
export const ARCHIVE_DIR = join(ROOT, 'specs', 'archive');
export const ACTIVE_INDEX_MD = join(ROOT, 'specs', 'active.generated.md');
export const ARCHIVE_INDEX_MD = join(ROOT, 'specs', 'archive.generated.md');
export const INDEX_JSON = join(ROOT, 'specs', 'index.generated.json');

// ── Change manifest loading ────────────────────────────────────────────────

export function loadChange(slug, baseDir = ACTIVE_DIR) {
  const dir = resolveWithinBase(baseDir, slug);
  const file = join(dir, 'change.yaml');
  if (!existsSync(file)) return null;
  const change = parseYamlFile(file);
  if (!change || typeof change !== 'object') return null;
  change._slug = slug;
  change._file = file;
  change._dir = dir;
  change.tasks = change.tasks || [];
  change.pull_requests = change.pull_requests === undefined ? [] : change.pull_requests;
  return change;
}

export async function loadChangeAsync(slug, baseDir = ACTIVE_DIR) {
  const dir = resolveWithinBase(baseDir, slug);
  const file = join(dir, 'change.yaml');
  try {
    const raw = await readFile(file, 'utf8');
    const change = parseYamlString(raw, file);
    if (!change || typeof change !== 'object') return null;
    change._slug = slug;
    change._file = file;
    change._dir = dir;
    change.tasks = change.tasks || [];
    change.pull_requests = change.pull_requests === undefined ? [] : change.pull_requests;
    return change;
  } catch {
    return null;
  }
}

export function listChanges(dir = ACTIVE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort((a, b) => a.localeCompare(b))
    .filter(name => {
      const full = join(dir, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'change.yaml'));
    })
    .map(slug => loadChange(slug, dir))
    .filter(Boolean);
}

export async function listChangesAsync(dir = ACTIVE_DIR) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const results = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => loadChangeAsync(entry.name, dir))
  );
  return results.filter(Boolean);
}

/** Active-first lookup used by PR attachment, finalize, and dashboard reads. */
export function loadChangeAnywhere(slug, { activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const active = loadChange(slug, activeDir);
  if (active) return { change: active, location: 'active' };
  const archived = loadChange(slug, archiveDir);
  if (archived) return { change: archived, location: 'archive' };
  return null;
}

export function requireChange(slug, baseDir = ACTIVE_DIR) {
  const change = loadChange(slug, baseDir);
  if (!change) throw new CliError(`Change '${slug}' not found in specs/active/`);
  return change;
}

export function requireChangeAnywhere(slug, { activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const located = loadChangeAnywhere(slug, { activeDir, archiveDir });
  if (located) return located;
  throw new CliError(`Change '${slug}' not found in specs/active/ or specs/archive/`);
}

export function requireTask(change, taskId) {
  const task = change.tasks.find(t => t.id === taskId);
  if (!task) throw new CliError(`Task '${taskId}' not found in change '${change._slug}'`);
  return task;
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

/**
 * The single write path for `/nevo-ai:implementation-review`'s bulk status
 * transition (D30, task 12) — one read-modify-write of `change.yaml` covering every
 * eligible task's transition together, never one write per task.
 */
export function writeBulkTransition(change, transitions) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    for (const t of transitions) {
      if (t.noop) continue;
      const item = tasks?.items?.find(it => it.get('id') === t.id);
      if (!item) throw new CliError(`Task '${t.id}' not found in ${change._file}`);
      item.set('status', t.to);
    }
  });
}
