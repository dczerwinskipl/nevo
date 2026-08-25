// Thin Git wrapper — only the operations tools/specs.mjs actually needs.
// Always execFileSync with an argument array, never shell string concatenation.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function run(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

export async function runGitAsync(root, args, options = {}) {
  const execOptions = {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  if (!execOptions.signal) {
    delete execOptions.signal;
  }
  const result = await execFileAsync('git', ['-C', root, ...args], execOptions);
  return result.stdout.trim();
}

export function getWorkingTreeStatus(root) {
  return run(root, ['status', '--porcelain']);
}

export async function getWorkingTreeStatusAsync(root, options = {}) {
  return await runGitAsync(root, ['status', '--porcelain'], options);
}

export function isWorkingTreeClean(root) {
  return getWorkingTreeStatus(root) === '';
}

export async function isWorkingTreeCleanAsync(root, options = {}) {
  const status = await getWorkingTreeStatusAsync(root, options);
  return status === '';
}

export function branchExists(root, name) {
  try {
    run(root, ['rev-parse', '--verify', name]);
    return true;
  } catch {
    return false;
  }
}

export async function branchExistsAsync(root, name, options = {}) {
  try {
    await runGitAsync(root, ['rev-parse', '--verify', name], options);
    return true;
  } catch {
    return false;
  }
}

export function checkoutBranch(root, name) {
  run(root, ['checkout', name]);
}

export async function checkoutBranchAsync(root, name, options = {}) {
  await runGitAsync(root, ['checkout', name], options);
}

export function createAndCheckoutBranch(root, name) {
  run(root, ['checkout', '-b', name]);
}

export async function createAndCheckoutBranchAsync(root, name, options = {}) {
  await runGitAsync(root, ['checkout', '-b', name], options);
}

// REC-02 fix: the branch exists on origin but not locally — fetch it and create a
// local branch tracking it, rather than `createAndCheckoutBranch` creating a
// second, diverging local branch of the same name.
export function checkoutTrackingBranch(root, name) {
  run(root, ['fetch', 'origin', name]);
  run(root, ['checkout', '-b', name, '--track', `origin/${name}`]);
}

export async function checkoutTrackingBranchAsync(root, name, options = {}) {
  await runGitAsync(root, ['fetch', 'origin', name], options);
  await runGitAsync(root, ['checkout', '-b', name, '--track', `origin/${name}`], options);
}

function parsePorcelainZ(raw) {
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

function getDirtyRecords(root) {
  const raw = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z'], { encoding: 'utf8' });
  return parsePorcelainZ(raw);
}

export async function getDirtyRecordsAsync(root, options = {}) {
  const execOptions = {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  if (!execOptions.signal) {
    delete execOptions.signal;
  }
  const result = await execFileAsync('git', ['-C', root, 'status', '--porcelain=v1', '-z'], execOptions);
  return parsePorcelainZ(result.stdout);
}

// Changed file paths, human-readable — a rename/copy renders as "old -> new"
// in one string, same convention as `git status`'s own default output.
export function getDirtyFiles(root) {
  return getDirtyRecords(root).map(r => (r.oldPath ? `${r.oldPath} -> ${r.path}` : r.path));
}

export async function getDirtyFilesAsync(root, options = {}) {
  const records = await getDirtyRecordsAsync(root, options);
  return records.map(r => (r.oldPath ? `${r.oldPath} -> ${r.path}` : r.path));
}

function extractDirtyPaths(records) {
  const paths = [];
  for (const r of records) {
    paths.push(r.path);
    if (r.oldPath) paths.push(r.oldPath);
  }
  return paths;
}

// Every real path the dirty worktree touches, for classification (PR review
// packet 03, Problem 3) — a rename/copy contributes *both* its old and new
// path as separate entries, since either one could independently be governed
// by a task's `allowed_paths`; comparing the combined "old -> new" display
// string against a path pattern (as `getDirtyFiles`'s output would) can never
// match a real pattern, silently misclassifying every rename as unrelated.
export function getDirtyPaths(root) {
  return extractDirtyPaths(getDirtyRecords(root));
}

export async function getDirtyPathsAsync(root, options = {}) {
  const records = await getDirtyRecordsAsync(root, options);
  return extractDirtyPaths(records);
}

function buildWorkingTreeSummary(records) {
  const files = records.map(record => ({
    status: record.status,
    path: record.oldPath ? `${record.oldPath} -> ${record.path}` : record.path,
  }));
  return {
    clean: records.length === 0,
    total: records.length,
    staged: records.filter(record => record.status[0] !== ' ' && record.status[0] !== '?').length,
    unstaged: records.filter(record => record.status[1] !== ' ' && record.status[1] !== '?').length,
    untracked: records.filter(record => record.status === '??').length,
    files,
  };
}

/** Dashboard-safe worktree projection with counts, statuses, and display paths. */
export function getWorkingTreeSummary(root) {
  return buildWorkingTreeSummary(getDirtyRecords(root));
}

export async function getWorkingTreeSummaryAsync(root, options = {}) {
  const records = await getDirtyRecordsAsync(root, options);
  return buildWorkingTreeSummary(records);
}

export function getCurrentBranch(root) {
  return run(root, ['branch', '--show-current']);
}

export async function getCurrentBranchAsync(root, options = {}) {
  return await runGitAsync(root, ['branch', '--show-current'], options);
}

export function getCurrentRevision(root) {
  return run(root, ['rev-parse', 'HEAD']);
}

export async function getCurrentRevisionAsync(root, options = {}) {
  return await runGitAsync(root, ['rev-parse', 'HEAD'], options);
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

export async function hasUpstreamAsync(root, branch, options = {}) {
  try {
    const out = await runGitAsync(root, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], options);
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

export async function getAheadBehindAsync(root, branch, options = {}) {
  const upstream = await hasUpstreamAsync(root, branch, options);
  if (!upstream) {
    return { hasUpstream: false, ahead: null, behind: null };
  }
  await runGitAsync(root, ['fetch', 'origin', branch], options);
  const raw = await runGitAsync(root, ['rev-list', '--left-right', '--count', `origin/${branch}...${branch}`], options);
  const [behind, ahead] = raw.split(/\s+/).map(Number);
  return { hasUpstream: true, ahead, behind };
}

export function commitAll(root, message) {
  run(root, ['add', '-A']);
  run(root, ['commit', '-m', message]);
}

export async function commitAllAsync(root, message, options = {}) {
  await runGitAsync(root, ['add', '-A'], options);
  await runGitAsync(root, ['commit', '-m', message], options);
}

export async function addAndCommitAsync(root, paths, message, options = {}) {
  if (Array.isArray(paths) && paths.length > 0) {
    await runGitAsync(root, ['add', '--', ...paths], options);
  } else {
    await runGitAsync(root, ['add', '-A'], options);
  }
  await runGitAsync(root, ['commit', '-m', message], options);
}

export function push(root, branch) {
  run(root, ['push', '-u', 'origin', branch]);
}

export async function pushAsync(root, branch, options = {}) {
  await runGitAsync(root, ['push', '-u', 'origin', branch], options);
}

// True if any commit reachable from `branch` but not `base` touches one of `paths` —
// used to decide whether a .NET build/test run is actually relevant to this branch's
// changes, not run unconditionally regardless of what changed.
export function touchesPaths(root, base, branch, paths) {
  const out = run(root, ['diff', '--stat', `${base}...${branch}`, '--', ...paths]);
  return out.trim().length > 0;
}

export async function touchesPathsAsync(root, base, branch, paths, options = {}) {
  const out = await runGitAsync(root, ['diff', '--stat', `${base}...${branch}`, '--', ...paths], options);
  return out.trim().length > 0;
}

// Every file changed between `base` and `head` (default the current worktree
// state) — the real whole-batch diff (D19/D24, gating batch review, PR
// re-review packet 03), never `{}` passed by the caller in place of real
// touched-path data. Plain two-dot range (not `base...head`) — the batch
// runs linearly on one branch, so this is exactly "every change made since
// batch start" — excludes anything that predates the batch, same requirement
// `touchesPaths` above serves for the unrelated dotnet-build-relevance check.
// `git diff` alone never reports untracked files (by design — it only knows
// about tracked content), so when `head` is omitted (comparing against the
// live worktree, not a second fixed commit) this also unions in
// `git ls-files --others --exclude-standard` — a new file added as part of
// this batch's work but not yet `git add`ed at review time must still count
// as touched, not silently excluded from evidence-staleness/integration
// detection.
export function getChangedFiles(root, base, head = '') {
  const range = head ? `${base}..${head}` : base;
  const out = run(root, ['diff', '--name-only', range]);
  const tracked = out ? out.split('\n').filter(Boolean) : [];
  if (head) return tracked;
  const untracked = run(root, ['ls-files', '--others', '--exclude-standard']);
  const untrackedFiles = untracked ? untracked.split('\n').filter(Boolean) : [];
  return [...new Set([...tracked, ...untrackedFiles])];
}

// Raw uncommitted diff (staged + unstaged, tracked files only) for specific
// paths — used to fingerprint a task's own uncommitted work
// (`implementation.worktree_patch_fingerprint`, area
// implementation-provenance-and-attribution, task 15) so a content-only edit
// changes the fingerprint even when the touched-path list doesn't. Restricted
// to `paths` (never the whole tree) so a concurrent, unrelated dirty file
// never perturbs this task's own recorded provenance.
export function getWorktreeDiff(root, paths = []) {
  if (!paths.length) return '';
  return run(root, ['diff', 'HEAD', '--', ...paths]);
}

// Commits whose message mentions `needle` (case-insensitive) — a migration-flow
// *suggestion* only (area implementation-provenance-and-attribution requirement
// 8: "commit-message matching may suggest boundaries but is never authoritative"),
// never treated as the persisted record itself.
export function findCommitsMentioning(root, needle) {
  let out;
  try {
    out = run(root, ['log', '--all', '--format=%H %s', '--grep', needle, '-i']);
  } catch {
    return [];
  }
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ');
    return spaceIdx === -1 ? { sha: line, subject: '' } : { sha: line.slice(0, spaceIdx), subject: line.slice(spaceIdx + 1) };
  });
}
