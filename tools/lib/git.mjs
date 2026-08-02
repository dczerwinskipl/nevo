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

export function getCurrentBranch(root) {
  return run(root, ['branch', '--show-current']);
}

export function hasUpstream(root, branch) {
  try {
    run(root, ['rev-parse', '--verify', `origin/${branch}`]);
    return true;
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
