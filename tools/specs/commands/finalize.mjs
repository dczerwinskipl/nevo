import { execFileSync } from 'node:child_process';

import { finalizeChange } from '../operations/index.mjs';
import { validateSpecs } from '../validation.mjs';
import { checkSpecsIndexes } from '../indexes.mjs';
import { scanDocs, validateDocs, checkDocsIndexes } from '../../docs/service.mjs';
import { loadFollowUps } from '../follow-ups.mjs';
import { requireChangeAnywhere, ROOT } from '../store.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import * as git from '../../lib/git.mjs';
import * as github from '../../lib/github.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

function runDotnetCheck(name, args) {
  try {
    execFileSync('dotnet', args, { cwd: ROOT, encoding: 'utf8' });
    return { name, passed: true };
  } catch (error) {
    const tail = String(error?.stdout || error?.message || '').trim().split('\n').slice(-5).join(' | ');
    return { name, passed: false, detail: tail };
  }
}

// Gathers every fact validateFinalize needs, doing no writes itself.
export function gatherFinalizeFacts(branch, change, emitter = null) {
  const verification = [];

  emitter?.stepStarted({ id: 'validate-specs', label: 'Validate specs' });
  const specErrors = validateSpecs();
  const specPassed = specErrors.length === 0;
  verification.push({ name: 'specs validate', passed: specPassed, detail: specErrors[0] });
  if (specPassed) emitter?.stepCompleted({ id: 'validate-specs' });
  else emitter?.stepFailed({ id: 'validate-specs', error: specErrors[0] || 'Spec validation failed' });

  emitter?.stepStarted({ id: 'check-specs-indexes', label: 'Check spec indexes' });
  const specCheckProblems = checkSpecsIndexes();
  const specCheckPassed = specCheckProblems.length === 0;
  verification.push({ name: 'specs check', passed: specCheckPassed, detail: specCheckProblems[0] });
  if (specCheckPassed) emitter?.stepCompleted({ id: 'check-specs-indexes' });
  else emitter?.stepFailed({ id: 'check-specs-indexes', error: specCheckProblems[0] || 'Spec indexes stale' });

  emitter?.stepStarted({ id: 'validate-docs', label: 'Validate docs' });
  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  const docPassed = docErrors.length === 0;
  verification.push({ name: 'docs validate', passed: docPassed, detail: docErrors[0] });
  if (docPassed) emitter?.stepCompleted({ id: 'validate-docs' });
  else emitter?.stepFailed({ id: 'validate-docs', error: docErrors[0] || 'Docs validation failed' });

  emitter?.stepStarted({ id: 'check-docs-indexes', label: 'Check docs indexes' });
  const docCheckProblems = checkDocsIndexes(docs);
  const docCheckPassed = docCheckProblems.length === 0;
  verification.push({ name: 'docs check', passed: docCheckPassed, detail: docCheckProblems[0] });
  if (docCheckPassed) emitter?.stepCompleted({ id: 'check-docs-indexes' });
  else emitter?.stepFailed({ id: 'check-docs-indexes', error: docCheckProblems[0] || 'Docs indexes stale' });

  emitter?.stepStarted({ id: 'load-pr-review', label: 'Load PR and review state' });
  let pr = null;
  const ghAvailable = github.isGhAvailable();
  if (!ghAvailable) {
    verification.push({ name: 'gh CLI', passed: false, detail: 'not installed or not on PATH' });
    emitter?.stepFailed({ id: 'load-pr-review', error: 'GitHub CLI not available' });
  } else {
    pr = github.getPrForBranch(ROOT, branch);
    if (pr) {
      pr.unresolvedThreads = pr.state === 'MERGED' ? 0 : github.getUnresolvedReviewThreadCount(ROOT, pr.number);
    }
    emitter?.stepCompleted({ id: 'load-pr-review' });
  }

  if (pr?.baseRefName) {
    if (git.touchesPaths(ROOT, `origin/${pr.baseRefName}`, branch, ['src', 'tests'])) {
      emitter?.stepStarted({ id: 'dotnet-build', label: 'Dotnet build' });
      const buildRes = runDotnetCheck('dotnet build', ['build']);
      verification.push(buildRes);
      if (buildRes.passed) emitter?.stepCompleted({ id: 'dotnet-build' });
      else emitter?.stepFailed({ id: 'dotnet-build', error: buildRes.detail || 'Build failed' });

      emitter?.stepStarted({ id: 'dotnet-test', label: 'Dotnet test' });
      const testRes = runDotnetCheck('dotnet test', ['test']);
      verification.push(testRes);
      if (testRes.passed) emitter?.stepCompleted({ id: 'dotnet-test' });
      else emitter?.stepFailed({ id: 'dotnet-test', error: testRes.detail || 'Test failed' });
    } else {
      verification.push({ name: 'dotnet build/test', passed: true, detail: 'skipped — no src/**/tests/** changes on this branch' });
    }
  }

  const followUps = loadFollowUps(change);
  const openBlockingFollowUps = (followUps.follow_ups || [])
    .filter(f => f.status === 'open' && f.severity === 'blocking')
    .map(f => ({ id: f.id, reason: f.reason }));

  return {
    gitClean: git.isWorkingTreeClean(ROOT),
    branch: git.getAheadBehind(ROOT, branch),
    ghAvailable,
    pr: pr ? { number: pr.number, state: pr.state, isDraft: pr.isDraft, unresolvedThreads: pr.unresolvedThreads } : null,
    verification,
    openBlockingFollowUps,
  };
}

function runGit(args, root = ROOT) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function tryRevParse(root, ref) {
  try { return runGit(['rev-parse', ref], root); } catch { return null; }
}

function remoteBranchExists(root, name) {
  return tryRevParse(root, `refs/remotes/origin/${name}`) !== null;
}

/**
 * Verify-before-destructive-cleanup (D9): fetches and fast-forwards local
 * main, then invokes computeCheckFailures().
 */
export function runPostMergeCheck(root, branch, computeCheckFailures) {
  runGit(['fetch', 'origin'], root);
  git.checkoutBranch(root, 'main');
  runGit(['pull', '--ff-only'], root);
  const mergedSha = git.getCurrentRevision(root);

  const failed = computeCheckFailures();
  if (failed.length) {
    return { ok: false, mergedSha, diagnosticBranch: branch, failed };
  }

  runGit(['push', 'origin', '--delete', branch], root);
  runGit(['branch', '-D', branch], root);
  return { ok: true, mergedSha, deletedBranch: branch };
}

export function gatherPostMergeCheckFailures() {
  const failed = [];
  const specErrors = validateSpecs();
  if (specErrors.length) failed.push({ name: 'specs validate', detail: specErrors[0] });
  const specCheckProblems = checkSpecsIndexes();
  if (specCheckProblems.length) failed.push({ name: 'specs check', detail: specCheckProblems[0] });
  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  if (docErrors.length) failed.push({ name: 'docs validate', detail: docErrors[0] });
  const docCheckProblems = checkDocsIndexes(docs);
  if (docCheckProblems.length) failed.push({ name: 'docs check', detail: docCheckProblems[0] });
  return failed;
}

/**
 * The nine-step guarded repair-branch creation (D23, corrected by D25).
 */
export function createRepairBranch(root, { branchName, failingSha }) {
  if (!git.isWorkingTreeClean(root)) {
    return { ok: false, failedGuard: 'clean-worktree', mainSwitched: false, fetchRan: false, branchCreated: false };
  }
  if (git.branchExists(root, branchName)) {
    return { ok: false, failedGuard: 'local-branch-absent', mainSwitched: false, fetchRan: false, branchCreated: false };
  }

  runGit(['fetch', 'origin'], root);
  const fetchRan = true;

  if (remoteBranchExists(root, branchName)) {
    return { ok: false, failedGuard: 'remote-branch-absent', mainSwitched: false, fetchRan, branchCreated: false };
  }
  if (tryRevParse(root, 'origin/main') !== failingSha) {
    return { ok: false, failedGuard: 'origin-main-unchanged', mainSwitched: false, fetchRan, branchCreated: false };
  }

  git.checkoutBranch(root, 'main');
  const mainSwitched = true;
  try {
    runGit(['pull', '--ff-only'], root);
  } catch {
    // A genuine non-fast-forward (local main has diverged)
  }

  if (git.getCurrentRevision(root) !== failingSha) {
    return { ok: false, failedGuard: 'local-main-matches-failing-sha', mainSwitched, fetchRan, branchCreated: false };
  }

  git.createAndCheckoutBranch(root, branchName);
  return { ok: true, mainSwitched, fetchRan, branchCreated: true };
}

export function handleFinalizeRepairBranch(changeSlug, options = {}) {
  requireChangeAnywhere(changeSlug);
  if (!options.failingSha) {
    throw new CliError('finalize-repair-branch requires --failing-sha (the merged SHA the failed post-merge check reported).');
  }
  const branchName = `fix/${changeSlug}-post-merge`;
  const result = createRepairBranch(ROOT, { branchName, failingSha: options.failingSha });

  if (!result.ok) {
    const stateNote = result.mainSwitched
      ? 'local main was already switched to and/or fast-forwarded.'
      : result.fetchRan
        ? 'a read-only fetch already ran; nothing else was modified.'
        : 'nothing was modified.';
    throw new CliError(`Repair branch not created — guard '${result.failedGuard}' failed (${stateNote})`);
  }
  console.log(`Repair branch '${branchName}' created and checked out.`);
}

export async function handleFinalize(changeSlug, options = {}) {
  const emitter = options.emitter || createProgressEmitter({ out: options.out ?? (options.silent ? null : process.stdout) });
  if (options.check) {
    const checkReport = await finalizeChange({ changeSlug, ...options, check: true, emitter });
    console.log(JSON.stringify(checkReport, null, 2));
    return checkReport;
  }
  const result = await finalizeChange({ changeSlug, ...options, emitter });
  if (!options.silent && !options.emitter) {
    console.log(result.summary);
  }
  return result;
}
