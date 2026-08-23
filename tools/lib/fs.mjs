// Small, shared filesystem helpers. Not a generic repository abstraction —
// just the handful of operations tools/specs.mjs and tools/docs.mjs both need.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { CliError } from './cli-errors.mjs';

export function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

export function writeUtf8(path, content) {
  writeFileSync(path, content);
}

/**
 * Resolve `relPath` against `baseDir` and reject the result if it escapes
 * `baseDir` — the guard for any path that comes from YAML, front matter, or a
 * command argument rather than from walking the filesystem ourselves.
 * Rejects both `../`-style escapes and absolute paths.
 */
export function resolveWithinBase(baseDir, relPath) {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = resolve(resolvedBase, relPath);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new CliError(`Path '${relPath}' escapes its allowed directory '${resolvedBase}'`);
  }
  return resolvedTarget;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function moveDir(from, to, operations = {}) {
  const exists = operations.existsSync ?? existsSync;
  const stat = operations.statSync ?? statSync;
  const rename = operations.renameSync ?? renameSync;
  const copy = operations.cpSync ?? cpSync;
  const remove = operations.rmSync ?? rmSync;
  const temporaryPath = operations.temporaryPath ?? `${to}.tmp-${process.pid}-${randomUUID()}`;

  if (!exists(from)) {
    const error = new Error(`Cannot move missing directory '${from}'.`);
    error.code = 'ENOENT';
    throw error;
  }
  if (!stat(from).isDirectory()) {
    const error = new Error(`Cannot move '${from}' because it is not a directory.`);
    error.code = 'ENOTDIR';
    throw error;
  }
  if (exists(to)) {
    const error = new Error(`Cannot archive '${from}' because destination '${to}' already exists.`);
    error.code = 'EEXIST';
    throw error;
  }

  try {
    rename(from, to);
    return;
  } catch (error) {
    if (!['EPERM', 'EXDEV'].includes(error?.code)) throw error;
  }

  if (exists(temporaryPath)) {
    const error = new Error(`Cannot stage archive because temporary destination '${temporaryPath}' already exists.`);
    error.code = 'EEXIST';
    throw error;
  }

  try {
    copy(from, temporaryPath, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
  } catch (error) {
    try { if (exists(temporaryPath)) remove(temporaryPath, { recursive: true, force: true }); } catch {}
    throw error;
  }

  try {
    remove(from, { recursive: true, force: false });
  } catch (cause) {
    let cleanupError;
    try { remove(temporaryPath, { recursive: true, force: true }); } catch (error) { cleanupError = error; }
    const error = new Error(`Could not remove source '${from}' after staging its archive; the active source remains authoritative.`, { cause });
    error.code = 'ARCHIVE_SOURCE_CLEANUP_FAILED';
    if (cleanupError) error.cleanupError = cleanupError;
    throw error;
  }

  try {
    if (exists(to)) {
      const conflict = new Error(`Cannot publish staged archive because destination '${to}' now exists.`);
      conflict.code = 'EEXIST';
      throw conflict;
    }
    rename(temporaryPath, to);
  } catch (cause) {
    let rollbackError;
    try {
      copy(temporaryPath, from, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      remove(temporaryPath, { recursive: true, force: true });
    } catch (error) {
      rollbackError = error;
    }
    const error = new Error(`Could not publish staged archive '${temporaryPath}' to '${to}'.`, { cause });
    error.code = 'ARCHIVE_PUBLISH_FAILED';
    if (rollbackError) error.rollbackError = rollbackError;
    throw error;
  }
}

/** Recursively collect files under `dir` with extension `ext`, skipping generated files. */
export function walkFiles(dir, { ext = '.md' } = {}) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full, { ext }));
    } else if (extname(entry) === ext && !entry.includes('.generated.')) {
      results.push(full);
    }
  }
  return results;
}
