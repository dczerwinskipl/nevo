// Small, shared filesystem helpers. Not a generic repository abstraction —
// just the handful of operations tools/specs.mjs and tools/docs.mjs both need.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync } from 'node:fs';
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

export function moveDir(from, to) {
  renameSync(from, to);
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
