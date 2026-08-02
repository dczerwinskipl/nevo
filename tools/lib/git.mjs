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
