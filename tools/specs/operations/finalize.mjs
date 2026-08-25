import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadChangeAnywhere,
  buildSpecsIndexes,
  writeSpecsIndexes,
  ARCHIVE_DIR,
  ROOT,
} from '../service.mjs';
import {
  validateFinalize,
  TERMINAL_STATUSES,
} from '../lifecycle.mjs';
import { validateSpecs } from '../validation.mjs';
import { checkSpecsIndexes } from '../service.mjs';
import { scanDocs, validateDocs, checkDocsIndexes } from '../../docs/service.mjs';
import {
  runGitAsync,
  getCurrentBranchAsync,
  isWorkingTreeCleanAsync,
  commitAllAsync,
  pushAsync,
  touchesPathsAsync,
} from '../../lib/git.mjs';
import {
  isGhAvailable,
  getPrForBranchAsync,
  getUnresolvedReviewThreadCountAsync,
  mergePrAsync,
} from '../../lib/github.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import { ensureDir, moveDir } from '../../lib/fs.mjs';
import { updateYamlFile } from '../../lib/yaml.mjs';

const execFileAsync = promisify(execFile);

export function archiveSpecificationSync(changeSlug, changeDir) {
  ensureDir(ARCHIVE_DIR);
  const targetDir = join(ARCHIVE_DIR, changeSlug);
  moveDir(changeDir, targetDir);
  updateYamlFile(join(targetDir, 'change.yaml'), doc => doc.set('status', 'archived'));
  writeSpecsIndexes(buildSpecsIndexes());
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

export async function runDotnetCheckAsync(name, args, { root = ROOT, signal = null } = {}) {
  try {
    await execFileAsync('dotnet', args, { cwd: root, encoding: 'utf8', signal });
    return { name, passed: true };
  } catch (error) {
    const tail = String(error?.stdout || error?.message || '').trim().split('\n').slice(-5).join(' | ');
    return { name, passed: false, detail: tail };
  }
}

export async function gatherFinalizeFactsAsync(branch, change, emitter = null, root = ROOT, { signal = null } = {}) {
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
  const ghAvailable = isGhAvailable();
  if (!ghAvailable) {
    verification.push({ name: 'gh CLI', passed: false, detail: 'not installed or not on PATH' });
    emitter?.stepFailed({ id: 'load-pr-review', error: 'GitHub CLI not available' });
  } else {
    try {
      pr = await getPrForBranchAsync(root, branch, { signal });
      if (pr) {
        pr.unresolvedThreads = pr.state === 'MERGED'
          ? 0
          : await getUnresolvedReviewThreadCountAsync(root, pr.number, { signal });
      }
      emitter?.stepCompleted({ id: 'load-pr-review' });
    } catch (e) {
      emitter?.stepFailed({ id: 'load-pr-review', error: e.message });
      throw e;
    }
  }

  const touchesSource = pr && await touchesPathsAsync(root, `origin/${pr.baseRefName}`, branch, ['src', 'tests'], { signal });
  if (touchesSource) {
    emitter?.stepStarted({ id: 'dotnet-build', label: 'Dotnet build' });
    const buildRes = await runDotnetCheckAsync('dotnet build', ['build'], { root, signal });
    verification.push(buildRes);
    if (buildRes.passed) emitter?.stepCompleted({ id: 'dotnet-build' });
    else emitter?.stepFailed({ id: 'dotnet-build', error: buildRes.detail || 'Build failed' });

    emitter?.stepStarted({ id: 'dotnet-test', label: 'Dotnet test' });
    const testRes = await runDotnetCheckAsync('dotnet test', ['test'], { root, signal });
    verification.push(testRes);
    if (testRes.passed) emitter?.stepCompleted({ id: 'dotnet-test' });
    else emitter?.stepFailed({ id: 'dotnet-test', error: testRes.detail || 'Test failed' });
  } else if (pr) {
    verification.push({ name: 'dotnet build/test', passed: true, detail: 'skipped -- no src/**/tests/** changes on this branch' });
  }

  return { pr, ghAvailable, verification };
}

export async function runPostMergeCheckAsync(root, branch, computeCheckFailures, { signal = null } = {}) {
  await runGitAsync(root, ['fetch', 'origin'], { signal });
  await runGitAsync(root, ['checkout', 'main'], { signal });
  await runGitAsync(root, ['pull', '--ff-only'], { signal });
  const mergedSha = await runGitAsync(root, ['rev-parse', 'HEAD'], { signal });

  const failed = computeCheckFailures();
  if (failed.length) {
    return { ok: false, mergedSha, diagnosticBranch: branch, failed };
  }

  await runGitAsync(root, ['push', 'origin', '--delete', branch], { signal });
  await runGitAsync(root, ['branch', '-D', branch], { signal });
  return { ok: true, mergedSha, deletedBranch: branch };
}

export async function finalizeChange({
  changeSlug,
  gitRoot = ROOT,
  check = false,
  emitter = null,
  signal = null,
} = {}) {
  const located = loadChangeAnywhere(changeSlug);
  if (!located) {
    throw new CliError(`Change '${changeSlug}' not found in specs/active/ or specs/archive/`);
  }
  const change = located;
  const location = located._dir?.includes('archive') ? 'archive' : 'active';

  const branch = await getCurrentBranchAsync(gitRoot, { signal });
  const allTerminal = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
  if (!allTerminal) {
    throw new CliError('Cannot finalize: not all tasks are in a terminal status.');
  }

  const steps = [
    { id: 'validate-specs', label: 'Validate specs' },
    { id: 'check-specs-indexes', label: 'Check spec indexes' },
    { id: 'validate-docs', label: 'Validate docs' },
    { id: 'check-docs-indexes', label: 'Check docs indexes' },
    { id: 'load-pr-review', label: 'Load PR and review state' },
    { id: 'evaluate-finalize-gate', label: 'Evaluate finalize gate' },
    { id: 'archive-change', label: 'Archive specification' },
    { id: 'push-and-merge', label: 'Push and merge' },
    { id: 'post-merge-check', label: 'Post-merge check' },
  ];

  const progress = emitter || createProgressEmitter({ out: null });
  progress.operationStarted({ type: 'finalize', steps });

  const facts = await gatherFinalizeFactsAsync(branch, change, progress, gitRoot, { signal });

  progress.stepStarted({ id: 'evaluate-finalize-gate', label: 'Evaluate finalize gate' });
  const result = validateFinalize(change, facts);

  if (check) {
    return { change: changeSlug, branch, location, facts, result };
  }

  if (!result.ok) {
    progress.stepFailed({ id: 'evaluate-finalize-gate', error: result.reason || 'Finalize gate blocked' });
    progress.operationFailed({ error: result.reason || 'Finalize gate blocked' });
    throw new CliError(result.reason || 'Finalize gate blocked');
  }
  progress.stepCompleted({ id: 'evaluate-finalize-gate' });

  progress.stepStarted({ id: 'archive-change', label: 'Archive specification' });
  if (location === 'active') {
    archiveSpecificationSync(changeSlug, change._dir);
    if (!(await isWorkingTreeCleanAsync(gitRoot, { signal }))) {
      await commitAllAsync(gitRoot, `chore(specs): archive ${changeSlug}`, { signal });
    }
  } else {
    if (!(await isWorkingTreeCleanAsync(gitRoot, { signal }))) {
      await commitAllAsync(gitRoot, `chore(specs): finalize ${changeSlug}`, { signal });
    }
  }
  progress.stepCompleted({ id: 'archive-change' });

  if (result.idempotent) {
    const summary = 'PR was already merged. Any pending local changes were committed.';
    progress.operationCompleted({ summary });
    return { ok: true, idempotent: true, summary, facts, result };
  }

  progress.stepStarted({ id: 'push-and-merge', label: 'Push and merge' });
  await pushAsync(gitRoot, branch, { signal });
  await mergePrAsync(gitRoot, facts.pr.number, { signal });
  progress.stepCompleted({ id: 'push-and-merge' });

  progress.stepStarted({ id: 'post-merge-check', label: 'Post-merge check' });
  const postMerge = await runPostMergeCheckAsync(gitRoot, branch, gatherPostMergeCheckFailures, { signal });
  if (!postMerge.ok) {
    progress.stepFailed({ id: 'post-merge-check', error: 'Post-merge check failed' });
    progress.operationFailed({ error: 'Post-merge check failed' });
    throw new CliError(`Post-merge check FAILED after merging PR #${facts.pr.number} (merged SHA: ${postMerge.mergedSha}).`);
  }

  progress.stepCompleted({ id: 'post-merge-check' });
  const summary = `Pushed and merged PR #${facts.pr.number} (squash). Post-merge check passed -- branch '${postMerge.deletedBranch}' deleted.`;
  progress.operationCompleted({ summary });

  return { ok: true, summary, facts, result, postMerge };
}
