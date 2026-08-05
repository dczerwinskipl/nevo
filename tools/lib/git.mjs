// Thin Git wrapper — only the operations tools/specs.mjs actually needs.
// Always execFileSync with an argument array, never shell string concatenation.

import { execFileSync } from 'node:child_process';

function run(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

export function getWorkingTreeStatus(root) {
  return run(root, ['status', '--porcelain']);
}

export function isWorkingTreeClean(root) {
  return getWorkingTreeStatus(root) === '';
}

export function branchExists(root, name) {
  try {
    run(root, ['rev-parse', '--verify', name]);
    return true;
  } catch {
    return false;
  }
}

export function checkoutBranch(root, name) {
  run(root, ['checkout', name]);
}

export function createAndCheckoutBranch(root, name) {
  run(root, ['checkout', '-b', name]);
}

// REC-02 fix: the branch exists on origin but not locally — fetch it and create a
// local branch tracking it, rather than `createAndCheckoutBranch` creating a
// second, diverging local branch of the same name.
export function checkoutTrackingBranch(root, name) {
  run(root, ['fetch', 'origin', name]);
  run(root, ['checkout', '-b', name, '--track', `origin/${name}`]);
}

// NUL-delimited porcelain (`-z`) parses structurally instead of line-oriented
// text: `git status --porcelain` (no `-z`) quotes paths containing spaces/
// special characters in ways that are easy to mis-slice, and a rename/copy
// record is *two* consecutive NUL-terminated fields (new path, then old
// path) rather than the single "old -> new" arrow string the porcelain v1
// *text* format renders for a human to read (see `git status --help` §
// "Porcelain Format Version 1"). Called via `execFileSync` directly, not
// `run()` — `run()`'s `.trim()` is for human-readable output and must not
// touch a NUL-delimited byte stream.
function getDirtyRecords(root) {
  const raw = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z'], { encoding: 'utf8' });
  const fields = raw.split('\0').filter(f => f.length > 0);
  const records = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const status = field.slice(0, 2);
    const path = field.slice(3);
    const isRenameOrCopy = status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C';
    if (isRenameOrCopy) {
      records.push({ status, path, oldPath: fields[++i] });
    } else {
      records.push({ status, path });
    }
  }
  return records;
}

// Changed file paths, human-readable — a rename/copy renders as "old -> new"
// in one string, same convention as `git status`'s own default output.
export function getDirtyFiles(root) {
  return getDirtyRecords(root).map(r => (r.oldPath ? `${r.oldPath} -> ${r.path}` : r.path));
}

// Every real path the dirty worktree touches, for classification (PR review
// packet 03, Problem 3) — a rename/copy contributes *both* its old and new
// path as separate entries, since either one could independently be governed
// by a task's `allowed_paths`; comparing the combined "old -> new" display
// string against a path pattern (as `getDirtyFiles`'s output would) can never
// match a real pattern, silently misclassifying every rename as unrelated.
export function getDirtyPaths(root) {
  const paths = [];
  for (const r of getDirtyRecords(root)) {
    paths.push(r.path);
    if (r.oldPath) paths.push(r.oldPath);
  }
  return paths;
}

export function getCurrentBranch(root) {
  return run(root, ['branch', '--show-current']);
}

export function getCurrentRevision(root) {
  return run(root, ['rev-parse', 'HEAD']);
}

// Asks the remote directly (PR review packet 03, Problem 2) rather than a
// cached local `origin/<branch>` ref: in a clone where the remote branch
// exists but its remote-tracking ref was never fetched, `rev-parse --verify
// origin/<branch>` incorrectly reports "no upstream," which used to lead
// `handleStart` to create a diverging local branch instead of detecting
// REC-02 and checking out the real remote one. `ls-remote` queries the
// remote itself and never mutates local refs as a side effect of a check.
export function hasUpstream(root, branch) {
  try {
    const out = run(root, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`]);
    return out.length > 0;
  } catch {
    return false;
  }
}

// Commits the local branch has that its origin tracking branch doesn't (`ahead`) and
// vice versa (`behind`). `hasUpstream: false` means the branch was never pushed at
// all — `ahead`/`behind` are meaningless in that case, not zero.
export function getAheadBehind(root, branch) {
  if (!hasUpstream(root, branch)) {
    return { hasUpstream: false, ahead: null, behind: null };
  }
  // hasUpstream now checks the remote directly, not a local tracking ref —
  // fetch that exact ref so the rev-list below reflects the remote's real
  // current state, not a possibly-stale or entirely-absent local copy of it.
  run(root, ['fetch', 'origin', branch]);
  const raw = run(root, ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`]);
  const [behind, ahead] = raw.split(/\s+/).map(Number);
  return { hasUpstream: true, ahead, behind };
}

export function commitAll(root, message) {
  run(root, ['add', '-A']);
  run(root, ['commit', '-m', message]);
}

export function push(root, branch) {
  run(root, ['push', '-u', 'origin', branch]);
}

// True if any commit reachable from `branch` but not `base` touches one of `paths` —
// used to decide whether a .NET build/test run is actually relevant to this branch's
// changes, not run unconditionally regardless of what changed.
export function touchesPaths(root, base, branch, paths) {
  const out = run(root, ['diff', '--stat', `${base}...${branch}`, '--', ...paths]);
  return out.trim().length > 0;
}
