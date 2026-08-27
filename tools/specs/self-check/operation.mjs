import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  requireChange,
  requireTask,
  ACTIVE_DIR,
  ROOT,
} from '../store.mjs';
import {
  loadTaskFileParts,
  parseVerificationCommands,
  computeTaskFingerprint,
} from '../fingerprint.mjs';
import { buildContextPacket } from '../context.mjs';
import { buildSelfCheckResult } from '../lifecycle/batch.mjs';
import {
  computeTaskAttributedChangedPaths,
  detectProvenanceOverlap,
  mergeAttributedChangedPaths,
  writeSelfCheck,
  writeImplementationProvenance,
} from '../lifecycle/provenance.mjs';
import {
  buildSpecsIndexes,
  writeSpecsIndexes,
} from '../indexes.mjs';
import { runVerificationCommand } from '../verify/operation.mjs';
import * as git from '../../lib/git.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: execute a task's self-check verification commands,
 * persist self_check results, update implementation provenance and generated indexes.
 *
 * `incremental` (default `false`, fully backward compatible): when `true` and the task
 * already has a persisted `implementation.review_revision` from a prior self-check,
 * attribution is computed only from the changes introduced since that task's own
 * *previous* `review_revision` — i.e. exactly `previousReviewRevision..currentRevision`,
 * using the same Git abstraction (and the same worktree/untracked-file handling) the
 * default path already uses — and *unioned* onto the existing `changed_paths`, instead
 * of re-deriving the full since-`baseline_revision` range every time. The previous
 * `review_revision` and `changed_paths` are captured up front, before any new
 * attribution is computed; the new `review_revision` is persisted only once that
 * attribution has actually been calculated. Use this for a review-fix re-check that
 * touches several sibling tasks sharing overlapping `allowed_paths` — the default
 * (non-incremental) full-range recompute would otherwise re-absorb every sibling task's
 * own unrelated intervening commits into this task's evidence. Multiple commits landing
 * between two self-checks (e.g. two separate review-fix commits touching this task
 * before it's re-checked) are all captured in one call, since the range spans all of
 * them — never just the single most recent commit.
 */
export function executeSelfCheck(changeSlug, taskId, {
  activeDir = ACTIVE_DIR,
  gitRoot = ROOT,
  emitter = null,
  runCommand = runVerificationCommand,
  incremental = false,
} = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  const { body } = loadTaskFileParts(change, task);
  const commands = parseVerificationCommands(body);
  if (!commands.length) throw new CliError(`Task '${taskId}' has no "## Verification" commands to run.`);

  emitter?.operationStarted({
    type: 'task-verification',
    totalSteps: commands.length,
    steps: commands.map((cmd, idx) => ({ id: `cmd-${idx + 1}`, label: cmd })),
  });

  const commandResults = [];
  for (let idx = 0; idx < commands.length; idx++) {
    const cmd = commands[idx];
    const stepId = `cmd-${idx + 1}`;
    emitter?.stepStarted({ id: stepId, label: cmd, total: commands.length });
    const result = runCommand(cmd);
    commandResults.push(result);
    if (result.exit_code === 0) {
      emitter?.stepCompleted({ id: stepId, detail: 'Passed' });
    } else {
      emitter?.stepFailed({ id: stepId, error: { message: `Exit code ${result.exit_code}`, code: String(result.exit_code) } });
    }
  }

  const currentRevision = git.getCurrentRevision(gitRoot);
  const selfCheck = buildSelfCheckResult({
    commandResults,
    fingerprint: computeTaskFingerprint(change, taskId),
    revision: currentRevision,
  });
  writeSelfCheck(change, taskId, selfCheck);

  const overlaps = [];
  if (task.implementation?.baseline_revision) {
    const packet = buildContextPacket(change, task);
    // Captured before any new attribution is computed — `useIncremental`'s diff base
    // and the union below both read these, never a value derived after the fact.
    const previousReviewRevision = task.implementation.review_revision;
    const priorChangedPaths = task.implementation.changed_paths || [];
    const useIncremental = incremental && Boolean(previousReviewRevision) && priorChangedPaths.length > 0;
    const diffBase = useIncremental ? previousReviewRevision : task.implementation.baseline_revision;
    // No explicit `head` — same call shape the default (baseline) path already uses,
    // so both diff base..working-tree and pick up any still-uncommitted, task-related
    // worktree changes the same way (tools/lib/git.mjs's own worktree/untracked handling).
    const changedSinceDiffBase = git.getChangedFiles(gitRoot, diffBase);
    const newlyAttributedPaths = computeTaskAttributedChangedPaths(changedSinceDiffBase, packet.allowed_paths);
    const attributedPaths = useIncremental
      ? mergeAttributedChangedPaths(priorChangedPaths, newlyAttributedPaths)
      : newlyAttributedPaths;
    const worktreeDiff = git.getWorktreeDiff(gitRoot, attributedPaths);
    writeImplementationProvenance(change, taskId, {
      baseline_revision: task.implementation.baseline_revision,
      review_revision: currentRevision,
      changed_paths: attributedPaths,
      worktree_patch_fingerprint: worktreeDiff ? createHash('sha256').update(worktreeDiff).digest('hex') : null,
    });

    const detected = detectProvenanceOverlap(change.tasks, taskId, attributedPaths);
    overlaps.push(...detected);
  }

  const built = buildSpecsIndexes({ activeDir });
  writeSpecsIndexes(built, {
    activeIndexMd: join(gitRoot, 'specs', 'active.generated.md'),
    archiveIndexMd: join(gitRoot, 'specs', 'archive.generated.md'),
    indexJson: join(gitRoot, 'specs', 'index.generated.json'),
  });

  const passed = selfCheck.status !== 'failed';
  if (!passed) {
    emitter?.operationFailed({
      error: { message: `Self-check FAILED: ${selfCheck.failed_criteria.join(', ')}` },
      summary: 'Self-check failed',
    });
  } else {
    emitter?.operationCompleted({
      result: selfCheck,
      summary: `Self-check passed for '${taskId}'.`,
    });
  }

  return {
    change,
    task,
    selfCheck,
    overlaps,
    passed,
  };
}
