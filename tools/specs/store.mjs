import { existsSync, readdirSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readUtf8, writeUtf8, resolveWithinBase } from '../lib/fs.mjs';
import { parseYamlFile, parseYamlString, parseFrontMatterFile, updateYamlFile } from '../lib/yaml.mjs';
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
  const results = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => loadChangeAsync(entry.name, dir))
  );
  return results.filter(Boolean);
}

/** Active-first lookup used by PR attachment and dashboard reads. */
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

// ── Pull Request references ────────────────────────────────────────────────

const DEFAULT_PULL_REQUEST_BASE_URLS = Object.freeze({
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
});

/** Normalize the durable, provider-neutral identity stored in change.yaml. */
export function normalizePullRequestReference(reference, label = 'pull request reference') {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new CliError(`${label} must be an object`);
  }

  const provider = String(reference.provider ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider)) {
    throw new CliError(`${label}.provider must be a lowercase provider id (letters, digits, hyphens)`);
  }

  const rawBaseUrl = String(reference.base_url ?? DEFAULT_PULL_REQUEST_BASE_URLS[provider] ?? '').trim();
  if (!rawBaseUrl) {
    throw new CliError(`${label}.base_url is required for provider '${provider}'`);
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username || parsedBaseUrl.password
    || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL without credentials, query, or fragment`);
  }
  const baseUrl = parsedBaseUrl.href.replace(/\/+$/, '');

  let repository = String(reference.repository ?? '').trim().replace(/^\/+|\/+$/g, '');
  repository = repository.replace(/\.git$/i, '');
  const repositoryParts = repository.split('/');
  if (repositoryParts.length < 2
    || repositoryParts.some(part => !part || part === '.' || part === '..')
    || /[\\?#\s]/.test(repository)) {
    throw new CliError(`${label}.repository must be a provider path such as 'owner/repository'`);
  }

  const number = typeof reference.number === 'number'
    ? reference.number
    : Number(String(reference.number ?? '').trim());
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new CliError(`${label}.number must be a positive integer`);
  }

  return { provider, base_url: baseUrl, repository, number };
}

export function pullRequestReferenceKey(reference) {
  const normalized = normalizePullRequestReference(reference);
  return [
    normalized.provider,
    normalized.base_url.toLowerCase(),
    normalized.repository.toLowerCase(),
    normalized.number,
  ].join('|');
}

/** Single structural write path for appending a normalized reference. */
export function addPullRequestReference(change, reference) {
  const normalized = normalizePullRequestReference(reference);
  const key = pullRequestReferenceKey(normalized);
  if ((change.pull_requests || []).some(item => pullRequestReferenceKey(item) === key)) {
    return { added: false, reference: normalized };
  }

  updateYamlFile(change._file, doc => {
    if (!doc.has('pull_requests')) doc.set('pull_requests', []);
    const references = doc.get('pull_requests', true);
    if (Array.isArray(references)) {
      references.push(normalized);
      doc.set('pull_requests', references);
    } else if (references && typeof references.add === 'function') {
      references.flow = false;
      references.add(normalized);
    } else {
      throw new CliError(`pull_requests must be an array in ${change._file}`);
    }
  });
  change.pull_requests = [...(change.pull_requests || []), normalized];
  return { added: true, reference: normalized };
}

// ── Review loading ─────────────────────────────────────────────────────────

export function loadReview(change) {
  const file = join(change._dir, 'reviews', 'spec.md');
  if (!existsSync(file)) return null;
  return parseFrontMatterFile(file);
}

// ── Implementation provenance writer (D34/D35, task 15) ────────────────────

/** Write `task`'s `implementation` provenance block — overwrites any prior value. */
export function writeImplementationProvenance(change, taskId, implementation) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('implementation', implementation);
  });
}

// ── Self-check writer (D28, task 08) ────────────────────────────────────────

/** Write `task`'s `self_check` block — overwrites any prior value. */
export function writeSelfCheck(change, taskId, selfCheck) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('self_check', selfCheck);
  });
}

// ── Batch intent ───────────────────────────────────────────────────────────

export function batchIntentFile(change) {
  return join(change._dir, 'batch.json');
}

/** Load a change's active batch intent, or `null` if none is in progress. */
export function loadBatchIntent(change) {
  const file = batchIntentFile(change);
  if (!existsSync(file)) return null;
  const raw = readUtf8(file);
  if (!raw.trim()) return null; // cleared (clearBatchIntent's empty-file convention)
  return JSON.parse(raw);
}

/** Persist a new batch's intent. */
export function writeBatchIntent(change, intent) {
  writeUtf8(batchIntentFile(change), JSON.stringify(intent, null, 2));
}

/** Clear a change's batch intent file once the batch is done (or abandoned). */
export function clearBatchIntent(change) {
  const file = batchIntentFile(change);
  if (existsSync(file)) writeUtf8(file, '');
}

// ── Suspension management ──────────────────────────────────────────────────

export function setTaskSuspension(change, taskId, suspension) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    if (item.has('execution')) {
      item.get('execution', true).set('suspension', suspension);
    } else {
      item.set('execution', { suspension });
    }
  });
}

export function clearTaskSuspension(change, taskId) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item?.has('execution')) return;
    const execution = item.get('execution', true);
    if (execution.has('suspension')) execution.delete('suspension');
    if (execution.items.length === 0) item.delete('execution');
  });
}

export function guardAgainstUnsafeManual(task, taskId, action) {
  const suspension = task.execution?.suspension;
  if (suspension?.kind === 'unsafe-manual') {
    throw new CliError(
      `Task '${taskId}' has an unresolved unsafe-manual suspension (${suspension.code}) — ` +
      `it must be resolved manually before '${action}' can be retried.`
    );
  }
}
