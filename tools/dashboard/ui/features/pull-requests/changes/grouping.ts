// Pure, deterministic file grouping/filtering (area changes-grouping-and-filtering,
// task 03) — no AI/heuristic classification, `picomatch` (D1) against
// server-delivered `changeView`/`generatedFiles` config only. Kept framework-free
// so every rule here is directly unit-testable without a DOM/React renderer.

import picomatch from 'picomatch';

import type { ChangeViewConfig, GeneratedFilesConfig } from '../types';

export type GroupByMode = 'area' | 'directory' | 'flat';

export interface FileGroup {
  name: string;
  paths: string[];
}

const matcherCache = new Map<string, (path: string) => boolean>();

function matcher(glob: string): (path: string) => boolean {
  let fn = matcherCache.get(glob);
  if (!fn) {
    fn = picomatch(glob);
    matcherCache.set(glob, fn);
  }
  return fn;
}

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some(glob => matcher(glob)(path));
}

/**
 * First-match-wins group assignment for one path against `changeView.groups`
 * (AC1: deterministic — same input always produces the same group). A rule
 * with `fallback: true` matches unconditionally, regardless of `paths` —
 * whatever position it holds in the ordered list is where it wins.
 */
export function assignGroup(path: string, config: ChangeViewConfig | undefined | null): string {
  for (const rule of config?.groups ?? []) {
    if (rule.fallback || matchesAny(path, rule.paths ?? [])) return rule.name ?? 'Other';
  }
  return 'Other';
}

function bucket(paths: string[], nameFor: (path: string) => string): FileGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, string[]>();
  for (const path of paths) {
    const name = nameFor(path);
    if (!buckets.has(name)) {
      buckets.set(name, []);
      order.push(name);
    }
    buckets.get(name)!.push(path);
  }
  return order.map(name => ({ name, paths: buckets.get(name)! }));
}

/** Natural repo structure — each file's own containing directory, sorted alphabetically. Requires no config (AC5). */
function groupByDirectory(paths: string[]): FileGroup[] {
  const groups = bucket(paths, path => {
    const index = path.lastIndexOf('/');
    return index === -1 ? '(root)' : path.slice(0, index);
  });
  return [...groups].sort((a, b) => a.name.localeCompare(b.name));
}

/** The existing flat behavior (task 03: "kept as an option"), no config required (AC5). */
function groupFlat(paths: string[]): FileGroup[] {
  return paths.length ? [{ name: 'Wszystkie pliki', paths: [...paths] }] : [];
}

export function groupFiles(paths: string[], mode: GroupByMode, config: ChangeViewConfig | undefined | null): FileGroup[] {
  if (mode === 'flat') return groupFlat(paths);
  if (mode === 'directory') return groupByDirectory(paths);
  return bucket(paths, path => assignGroup(path, config));
}

/** A lockfile is tracked as its own concept, never auto-folded into "generated" (area doc). */
export function isLockfile(path: string, config: GeneratedFilesConfig | undefined | null): boolean {
  return matchesAny(path, config?.lockfiles ?? []);
}

export function isGeneratedFile(path: string, config: GeneratedFilesConfig | undefined | null): boolean {
  if (isLockfile(path, config)) return false;
  const globs = (config?.rules ?? []).flatMap(rule => rule.paths ?? []);
  return matchesAny(path, globs);
}

export interface VisibilityResult {
  visiblePaths: string[];
  hiddenPaths: string[];
  visibleCount: number;
  hiddenCount: number;
}

/**
 * Purely a filter over already-fetched paths — reversible without any
 * network call (AC3: toggling `hideGenerated` back shows previously hidden
 * files without a fresh manifest fetch, since this never touches the
 * manifest itself, only which of its already-loaded entries are shown).
 */
export function computeVisibility(
  paths: string[],
  config: GeneratedFilesConfig | undefined | null,
  hideGenerated: boolean,
): VisibilityResult {
  const visiblePaths: string[] = [];
  const hiddenPaths: string[] = [];
  for (const path of paths) {
    if (hideGenerated && isGeneratedFile(path, config)) hiddenPaths.push(path);
    else visiblePaths.push(path);
  }
  return { visiblePaths, hiddenPaths, visibleCount: visiblePaths.length, hiddenCount: hiddenPaths.length };
}
