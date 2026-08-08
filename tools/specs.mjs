#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|fingerprint|approve|start|complete|verify|archive|finalize|status|comments|resolve-comment>

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { CliError, RecoveryError } from './lib/cli-errors.mjs';
import { ensureDir, moveDir, readUtf8, writeUtf8 } from './lib/fs.mjs';
import { updateYamlFile } from './lib/yaml.mjs';
import { splitShellWords } from './lib/shell-words.mjs';
import * as git from './lib/git.mjs';
import * as github from './lib/github.mjs';
import {
  loadChange, listChanges, setTaskStatus, buildContextPacket, getNext,
  computeChangeFingerprint, computeTaskFingerprint, loadReview,
  buildSpecsIndexes, writeSpecsIndexes, checkSpecsIndexes,
  parseOwnerDecisions, loadFollowUps, addFollowUp, resolveFollowUp,
  FOLLOW_UP_SEVERITIES,
  loadTaskFileParts, parseVerificationCommands, writeSelfCheck,
  loadBatchIntent, writeBatchIntent, clearBatchIntent, writeBulkTransition,
  writeImplementationProvenance,
  ACTIVE_DIR, ARCHIVE_DIR,
} from './specs/service.mjs';
import { validateSpecs, computeMechanicalExemption } from './specs/validation.mjs';
import { scanDocs, validateDocs, checkDocsIndexes } from './docs/service.mjs';
import {
  TERMINAL_STATUSES, DEPENDENCY_SATISFYING_STATUSES, isTaskReady, depsSatisfied, validateTransition, validateApproval,
  validateFinalize, deriveStage, inspectStartPostconditions, inspectApprovePostconditions, classifyDirtyWorktree,
  BATCH_SELECTION_MODES, selectBatch, deriveBatchProgress, hardStopReason, detectRiskSignals, requiresFullReview,
  buildSelfCheckResult, batchValidationBlocks, staleEvidenceTasks, computeBatchReviewVerdict, validateBatchCheckpoint,
  completionHardStop, attributeTouchedPaths, detectBatchIntegrationFindings,
  resolveReviewScope, validateBulkTransition, nextSuspensionForNotRetryable,
  computeTaskAttributedChangedPaths, nextImplementationBaseline, resolveProvenanceMappings,
} from './specs/lifecycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Command handlers ────────────────────────────────────────────────────────
// Plain functions, testable without touching process.argv or Commander.

function reportErrors(errors) {
  errors.forEach(e => console.error(e));
  process.exitCode = 1;
}

function requireChange(slug, baseDir = ACTIVE_DIR) {
  const change = loadChange(slug, baseDir);
  if (!change) throw new CliError(`Change '${slug}' not found in specs/active/`);
  return change;
}

// Looks in specs/active/ first, then specs/archive/ — for commands that need to reason
// about a change's PR/merge state regardless of whether it was (possibly prematurely)
// archived already. A change archived before its PR was pushed/merged is exactly the
// scenario status/finalize/comments need to keep working for, not error out on.
function requireChangeAnywhere(slug) {
  const active = loadChange(slug, ACTIVE_DIR);
  if (active) return { change: active, location: 'active' };
  const archived = loadChange(slug, ARCHIVE_DIR);
  if (archived) return { change: archived, location: 'archive' };
  throw new CliError(`Change '${slug}' not found in specs/active/ or specs/archive/`);
}

function requireTask(change, taskId) {
  const task = change.tasks.find(t => t.id === taskId);
  if (!task) throw new CliError(`Task '${taskId}' not found in change '${change._slug}'`);
  return task;
}

// Structural writers for the operational `execution.suspension` block (D8) —
// mirrors service.mjs's setTaskStatus, kept here since service.mjs is outside
// this area's scope. Suspension is only ever written for a stop that must
// survive a session boundary (confirm-required/owner-decision/unsafe-manual);
// an `automatic`-class recovery fixes itself same-turn and never calls this.
// Exported for direct testing (tools/tests/recovery.test.mjs) — writing this
// block must never touch the task's own `status` field (acceptance criterion 5).
// Sets/clears only `execution.suspension` in place — never replaces the
// whole `execution` object (PR review packet 03, secondary issue). No other
// field lives under `execution` today, but a wholesale replace would
// silently drop one the moment something else is added there.
export function setTaskSuspension(change, taskId, suspension) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    if (item.has('execution')) {
      item.get('execution', true).set('suspension', suspension);
    } else {
      item.set('execution', { suspension });
    }
  });
}

export function clearTaskSuspension(change, taskId) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item?.has('execution')) return;
    const execution = item.get('execution', true);
    if (execution.has('suspension')) execution.delete('suspension');
    if (execution.items.length === 0) item.delete('execution');
  });
}

// unsafe-manual never resolves itself and is never auto-retried (constraint,
// area recovery-and-resume) — a controller that observes it must stop, the
// same as an unresolved owner-decision, before attempting anything else.
// Exported for direct testing (tools/tests/recovery.test.mjs).
export function guardAgainstUnsafeManual(task, taskId, action) {
  const suspension = task.execution?.suspension;
  if (suspension?.kind === 'unsafe-manual') {
    throw new CliError(
      `Task '${taskId}' has an unresolved unsafe-manual suspension (${suspension.code}) — ` +
      `it must be resolved manually before '${action}' can be retried.`
    );
  }
}

// PR review packet 03, Problem 1: `handleStart`'s dirty-tree check must never
// run for a `completed`/`not_retryable` postcondition result (nothing left
// to do, or nothing safe to retry either way), and must only run when a
// branch checkout/creation is actually about to happen — never while already
// on the expected branch, where a dirty tree is just the task's own
// in-progress implementation work, not something blocking a git operation
// this call still needs to perform. Exported for direct testing
// (tools/tests/start.test.mjs) — `handleStart` itself can't be driven
// end-to-end in a unit test (it reads the real repository's `ACTIVE_DIR`),
// so this predicate is the testable seam for the fix.
export function startNeedsDirtyTreeCheck(postconditionResult, onExpectedBranch) {
  if (postconditionResult === 'completed' || postconditionResult === 'not_retryable') return false;
  return !onExpectedBranch;
}

export function handleGenerate() {
  const errors = validateSpecs();
  if (errors.length) { reportErrors(errors); return; }
  const built = buildSpecsIndexes();
  writeSpecsIndexes(built);
  console.log(`Generated: specs/active.generated.md (${built.activeCount} changes)`);
  console.log(`Generated: specs/archive.generated.md (${built.archiveCount} changes)`);
  console.log('Generated: specs/index.generated.json');
}

export function handleValidate() {
  const errors = validateSpecs();
  if (errors.length) { reportErrors(errors); return; }
  const n = listChanges(ACTIVE_DIR).length + listChanges(ARCHIVE_DIR).length;
  console.log(`Validated ${n} changes — no errors.`);
}

export function handleCheck() {
  const errors = validateSpecs();
  if (errors.length) { reportErrors(errors); return; }
  const problems = checkSpecsIndexes();
  if (problems.length) {
    problems.forEach(p => console.error(p));
    console.error('Run: node tools/specs.mjs generate');
    process.exitCode = 1;
    return;
  }
  console.log('Specs valid and indexes are current.');
}

export function handleList() {
  const changes = listChanges(ACTIVE_DIR);
  if (!changes.length) { console.log('No active changes.'); return; }
  for (const c of changes) {
    console.log(`\n[${c.status}] ${c.id} — ${c.title} (priority: ${c.priority ?? '-'})`);
    for (const t of c.tasks) {
      const ready = isTaskReady(t, c) ? ' ✓' : '';
      console.log(`  ${t.order ?? '-'}. [${t.status}] ${t.id}${ready}`);
    }
  }
}

export function handleNext() {
  const packet = getNext();
  if (!packet) { console.log('No approved tasks ready.'); return; }
  console.log(JSON.stringify(packet, null, 2));
}

export function handleContext(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  console.log(JSON.stringify(buildContextPacket(change, task), null, 2));
}

// D7/D9 migration (task 09) — this now prints the change-level tier
// (`computeChangeFingerprint`), not the old whole-file `computeSpecFingerprint`
// (still exported from service.mjs, but no longer read by any command here).
// `/nevo-ai:spec-review` records this exact output as a spec review's
// `spec_fingerprint`; a status-only or unrelated-task edit no longer
// invalidates it, closing the gap D7 exists to fix.
// --task prints computeTaskFingerprint instead (PR re-review packet 01) — the
// exact value `/nevo-ai:spec-review` copies into a review's
// `task_fingerprints.<task-id>` entry, same convention as the change-level
// value's own doc comment above.
export function handleFingerprint(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  if (options.task) {
    requireTask(change, options.task);
    console.log(computeTaskFingerprint(change, options.task));
    return;
  }
  console.log(computeChangeFingerprint(change));
}

export function handleApprove(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  guardAgainstUnsafeManual(task, taskId, 'approve');

  // D14, task 07 — "review-exempt deterministic approval": re-verifies all six
  // conditions itself (defense in depth alongside `validate`'s own hard error)
  // rather than trusting a `type: mechanical` declaration at face value.
  const { eligible: mechanicalExempt } = computeMechanicalExemption(change, task);

  const review = loadReview(change);
  // D7/D9 migration (task 09): compares against the change-level tier — a
  // spec review's own scope — instead of the old whole-file hash, which
  // invalidated on any status write, execution.suspension change, or
  // unrelated task edit (exactly the cost D7 exists to remove). The
  // task-level fingerprint (PR re-review packet 01) closes the gap this left:
  // change_fingerprint excludes task body/AC/context by design, so this
  // task's own content changing after review must still be caught.
  const currentFingerprint = computeChangeFingerprint(change);
  const currentTaskFingerprint = computeTaskFingerprint(change, taskId);
  const result = validateApproval(task.status, review, currentFingerprint, {
    mechanicalExempt, taskId, currentTaskFingerprint,
  });
  const inspection = inspectApprovePostconditions(result);

  if (inspection.result === 'not_retryable') {
    // REC-07 STALE_REVIEW_AFTER_SEMANTIC_CHANGE — recoverable, confirm-required:
    // re-run the review, then retry approval. Persisted so a resumed session
    // knows a confirmation is still owed, without re-deriving it from prose.
    // Covers all three staleness shapes (change-level, missing/stale
    // task-level) — same recovery scenario, same remedy.
    if (inspection.code === 'stale-fingerprint' || inspection.code === 'missing-task-fingerprint' || inspection.code === 'stale-task-fingerprint') {
      setTaskSuspension(change, taskId, {
        kind: 'confirm-required', code: 'REC-07', previous_action: 'approve',
        created_at: new Date().toISOString(),
      });
      throw new RecoveryError('REC-07', { detail: inspection.reason });
    }
    throw new CliError(inspection.reason);
  }
  if (inspection.result === 'completed') { console.log(`Task '${taskId}' is already approved.`); return; }

  clearTaskSuspension(change, taskId);
  setTaskStatus(change, taskId, 'approved');
  console.log(
    mechanicalExempt
      ? `Task '${taskId}' marked as approved (type: mechanical — review-exempt deterministic approval).`
      : `Task '${taskId}' marked as approved.`
  );
}

// Postcondition-based start (D8 reference example, area recovery-and-resume):
// inspects real state, executes only the missing effects, and never repeats a
// completed one (e.g. never re-runs `git checkout -b` on a branch that
// already exists). A dirty tree is classified (REC-05 task-related vs. REC-06
// unrelated) rather than a single flat refusal, since only REC-05's files are
// ever safe to reason about touching on the task's behalf.
//
// Postconditions are inspected *before* the dirty-tree check (PR review
// packet 03, Problem 1): a task already `completed` — in-implementation, on
// its expected branch — must return early as a no-op even with a dirty tree,
// since that's just the task's own in-progress implementation work, not
// something blocking a git operation this call still needs to perform. The
// dirty-tree check only matters when a branch checkout/creation is actually
// about to happen (`!onExpectedBranch`) — never for a `partially_completed`
// case where only the `status` write is still missing.
// D34/D35, task 20 (closes FU-007) — `activeDir`/`gitRoot` are optional,
// defaulting to the real repository's own paths, so every existing call site
// (the CLI, `handleBatchStart`'s forward reference) is unaffected. A
// fixture-backed test passes its own temp `activeDir` (a `specs/active/`-
// shaped tree) and `gitRoot` (a real, throwaway git repository) to drive this
// handler end-to-end without touching the real checkout.
export function handleStart(changeSlug, taskId, { activeDir = ACTIVE_DIR, gitRoot = ROOT } = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  guardAgainstUnsafeManual(task, taskId, 'start');
  const packet = buildContextPacket(change, task);
  const branch = packet.branch;

  const transition = validateTransition('start', task.status);
  if (!transition.ok) throw new CliError(transition.reason);

  const depsOk = transition.idempotent || depsSatisfied(task, change);
  const localExists = git.branchExists(gitRoot, branch);
  const remoteOnly = !localExists && git.hasUpstream(gitRoot, branch);
  const onExpectedBranch = git.getCurrentBranch(gitRoot) === branch;

  const inspection = inspectStartPostconditions({
    taskStatus: task.status, depsOk, onExpectedBranch, localBranchExists: localExists, remoteBranchExists: remoteOnly,
    unsatisfiedDeps: (task.depends_on || []).filter(depId => {
      const dep = change.tasks.find(t => t.id === depId);
      return !dep || !DEPENDENCY_SATISFYING_STATUSES.has(dep.status);
    }),
  });

  if (inspection.result === 'not_retryable') {
    // requirement 4 (AC4): when the original action's own preconditions no
    // longer hold, resuming a prior suspension creates a *new* one describing
    // the new situation rather than blindly retrying the stale
    // previous_action — nextSuspensionForNotRetryable (tools/specs/lifecycle.mjs)
    // is the pure decision, unit-tested there since handleStart itself reads
    // the real repository and can't be driven end-to-end in a fixture test.
    const nextSuspension = nextSuspensionForNotRetryable(task.execution?.suspension);
    if (nextSuspension) setTaskSuspension(change, taskId, nextSuspension);
    throw new CliError(`Task '${taskId}' cannot be started: ${inspection.reason}`);
  }
  if (inspection.result === 'completed') {
    console.log(`Task '${taskId}' is already in-implementation on branch '${branch}'.`);
    return;
  }

  if (startNeedsDirtyTreeCheck(inspection.result, onExpectedBranch)) {
    // Classification runs against real paths (getDirtyPaths — a rename
    // contributes both its old and new path separately), never the
    // "old -> new" human-readable display string, which can never match a
    // real allowed_paths pattern (PR review packet 03, Problem 3).
    const dirtyPaths = git.getDirtyPaths(gitRoot);
    if (dirtyPaths.length) {
      const classification = classifyDirtyWorktree(dirtyPaths, packet.allowed_paths);
      setTaskSuspension(change, taskId, {
        kind: classification.class, code: classification.code, previous_action: 'start',
        created_at: new Date().toISOString(),
      });
      throw new RecoveryError(classification.code, { detail: `Dirty file(s): ${classification.files.join(', ')}` });
    }

    if (localExists) {
      git.checkoutBranch(gitRoot, branch);
      console.log(`Switched to branch: ${branch}`);
    } else if (remoteOnly) {
      // REC-02, automatic class — fixes itself same-turn, no suspension.
      git.checkoutTrackingBranch(gitRoot, branch);
      console.log(`Checked out existing remote branch: ${branch} (REC-02)`);
    } else {
      git.createAndCheckoutBranch(gitRoot, branch);
      console.log(`Created branch: ${branch}`);
    }
  }

  if (task.status !== 'in-implementation') {
    setTaskStatus(change, taskId, 'in-implementation');
    console.log(`Task '${taskId}' set to in-implementation.`);
  }

  // D34/D35, task 15 — record baseline_revision exactly once, on the first
  // successful start; nextImplementationBaseline is a no-op once it's already
  // set, so a later safe_to_retry/idempotent start never overwrites it.
  const baseline = nextImplementationBaseline(task.implementation, git.getCurrentRevision(gitRoot));
  if (baseline !== task.implementation?.baseline_revision) {
    writeImplementationProvenance(change, taskId, {
      ...(task.implementation || {}),
      baseline_revision: baseline,
    });
  }

  clearTaskSuspension(change, taskId);
  console.log('\nContext packet:');
  console.log(JSON.stringify(packet, null, 2));
}

export function handleComplete(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);

  const transition = validateTransition('complete', task.status);
  if (!transition.ok) throw new CliError(transition.reason);
  if (transition.idempotent) { console.log(`Task '${taskId}' is already implemented.`); return; }

  // D24, task 08 — a hard-stopped task (a recorded, still-failing self-check)
  // can never be marked complete; a full task-review is never a substitute
  // for correcting the implementation and rerunning the self-check (the only
  // path that clears this). A task with no self_check at all is unaffected
  // when it's not part of an active batch — self-check is optional there.
  // Inside an active batch that includes this task, a *missing* self-check
  // is a hard stop too (PR re-review packet 02) — see completionHardStop's
  // own doc comment.
  const intent = loadBatchIntent(change);
  const inActiveBatch = Boolean(intent?.orderedTasks?.includes(taskId));
  const stop = completionHardStop(task, { inActiveBatch });
  if (stop) {
    throw new CliError(
      `Task '${taskId}' has a hard-stopped self-check (${stop.code}: ${stop.detail}) — ` +
      `correct the implementation and rerun 'node tools/specs.mjs self-check ${changeSlug} ${taskId}' before marking it complete.`
    );
  }

  setTaskStatus(change, taskId, 'implemented');
  console.log(`Task '${taskId}' marked as implemented. Present results to owner for verification.`);
}

export function handleVerify(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);

  const transition = validateTransition('verify', task.status);
  if (!transition.ok) throw new CliError(transition.reason);
  if (transition.idempotent) { console.log(`Task '${taskId}' is already verified.`); return; }

  setTaskStatus(change, taskId, 'verified');
  console.log(`Task '${taskId}' marked as verified.`);
}

// ── Self-check (D28) — the single write path for self_check ────────────────

// Quote-aware (splitShellWords, PR re-review packet 05): a whitespace split
// broke any command with a quoted argument containing a space or a filter
// expression (e.g. `dotnet test --filter "Category=A|Category=B"`). A
// malformed command string (an unterminated quote) is reported as a failed
// verification command, same as a non-zero exit code, rather than crashing
// the whole self-check run.
export function runVerificationCommand(commandString) {
  try {
    const [program, ...args] = splitShellWords(commandString);
    execFileSync(program, args, { cwd: ROOT, encoding: 'utf8' });
    return { command: commandString, exit_code: 0 };
  } catch (error) {
    return { command: commandString, exit_code: typeof error.status === 'number' ? error.status : 1 };
  }
}

// Runs every command the task's own "## Verification" section names and
// records pass/fail, the task's current semantic fingerprint, and git
// revision — exactly what deriveStage's self-check-freshness comparison
// (D28) reads back. No other code writes `self_check` (constraint, area
// batch-execution-and-gating-review).
export function handleSelfCheck(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  const { body } = loadTaskFileParts(change, task);
  const commands = parseVerificationCommands(body);
  if (!commands.length) throw new CliError(`Task '${taskId}' has no "## Verification" commands to run.`);

  const commandResults = commands.map(runVerificationCommand);
  const currentRevision = git.getCurrentRevision(ROOT);
  const selfCheck = buildSelfCheckResult({
    commandResults,
    fingerprint: computeTaskFingerprint(change, taskId),
    revision: currentRevision,
  });
  writeSelfCheck(change, taskId, selfCheck);

  // D34/D35, task 15 — alongside self_check, refresh this task's own
  // attributed implementation provenance. Only when a baseline already
  // exists (a task started before this mechanism, or a fixture task with no
  // real start, has nothing to attribute yet — this is not itself an error).
  if (task.implementation?.baseline_revision) {
    const packet = buildContextPacket(change, task);
    const changedSinceBaseline = git.getChangedFiles(ROOT, task.implementation.baseline_revision);
    const attributedPaths = computeTaskAttributedChangedPaths(changedSinceBaseline, packet.allowed_paths);
    const worktreeDiff = git.getWorktreeDiff(ROOT, attributedPaths);
    writeImplementationProvenance(change, taskId, {
      baseline_revision: task.implementation.baseline_revision,
      review_revision: currentRevision,
      changed_paths: attributedPaths,
      worktree_patch_fingerprint: worktreeDiff ? createHash('sha256').update(worktreeDiff).digest('hex') : null,
    });
  }

  if (selfCheck.status === 'failed') {
    console.log(`Self-check FAILED for '${taskId}': ${selfCheck.failed_criteria.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Self-check passed for '${taskId}'.`);
  }
}

// ── Implementation provenance migration flow (D34/D35, task 15) ────────────
//
// Owner-confirmed migration for a task with no persisted `implementation`
// block (e.g. tasks 01-13, already-terminal before this mechanism existed —
// same "not silently backfilled" precedent D32 already established).
// `suggest-provenance` is strictly read-only; `apply-provenance` never writes
// without `--confirm`. Commit-message matching is a *suggestion* only (area
// implementation-provenance-and-attribution requirement 2) — never treated
// as authoritative once written.

export function handleSuggestProvenance(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  if (task.implementation?.baseline_revision) {
    console.log(JSON.stringify({ taskId, alreadyHasProvenance: true, implementation: task.implementation }, null, 2));
    return;
  }
  const packet = buildContextPacket(change, task);
  const commits = git.findCommitsMentioning(ROOT, taskId);
  console.log(JSON.stringify({
    taskId,
    suggested: true,
    note: 'Commit-message matching is a suggestion only, never authoritative — review before applying with apply-provenance --confirm.',
    candidateBaselineRevision: commits.length ? commits[commits.length - 1].sha : null,
    candidateCommits: commits,
    allowedPaths: packet.allowed_paths,
  }, null, 2));
}

// Owner correction (seventh refinement pass): several proposed legacy
// provenance reconstructions may be confirmed in one owner action — one
// --confirm covers every mapping passed via --mappings, never one prompt per
// task. A single task id with --baseline/--changed-paths keeps working
// exactly as before (single-task shape, unchanged for existing callers).
// Parsing/validation itself is `resolveProvenanceMappings` (lifecycle.mjs,
// pure, no repository I/O) — this handler only gates on --confirm and
// performs the actual repository writes.
export function handleApplyProvenance(changeSlug, taskIdOrList, options = {}) {
  const change = requireChange(changeSlug);
  if (!options.confirm) {
    throw new CliError('apply-provenance requires --confirm — a persisted implementation block is written only after explicit owner confirmation, never unattended.');
  }

  let mappings;
  try {
    mappings = resolveProvenanceMappings(taskIdOrList, options);
  } catch (error) {
    throw new CliError(error.message);
  }

  for (const { taskId } of mappings) requireTask(change, taskId);

  for (const { taskId, baseline, changedPaths } of mappings) {
    writeImplementationProvenance(change, taskId, {
      baseline_revision: baseline,
      review_revision: baseline,
      changed_paths: changedPaths,
      worktree_patch_fingerprint: null,
    });
  }

  const summary = mappings.map(m => `'${m.taskId}' (baseline ${m.baseline})`).join(', ');
  console.log(`Implementation provenance written for: ${summary}.`);
}

// ── Batch execution and gating review (D10, D19, D20, D24, D28, task 08) ───

// Batch selection/ordering only — the batch controller calls the existing
// `start`/`complete` transitions unchanged (constraint), never a new write
// path to change.yaml. handleStart is a function declaration, hoisted, so
// this forward reference (it's defined later in this file) is safe.
// `until-checkpoint` (D20, PR re-review packet 04): the mode used to select
// the same reachable set as `all-approved-reachable` and never actually
// bounded execution — `checkpointPolicy` was persisted but nothing ever read
// it. `--checkpoint` is now required for this mode, must name a real task
// that was actually selected into this batch, and must not already be
// terminal (an already-passed checkpoint is rejected rather than silently
// treated as "reached immediately"). `deriveBatchProgress`'s
// `checkpointReached` is what the conversational continuation offer
// (`/nevo-ai:task-review` step 9a0) checks to stop at the boundary — see
// that function's own doc comment.
export function handleBatchStart(changeSlug, mode, options = {}) {
  const change = requireChange(changeSlug);
  if (loadBatchIntent(change)) {
    throw new CliError(`Change '${changeSlug}' already has an active batch. Finish it (or clear batch.json) before starting another.`);
  }

  const taskIds = options.tasks ? options.tasks.split(',').map(s => s.trim()) : undefined;
  const selection = selectBatch(mode, change, { taskIds });
  if (!selection.ok) throw new CliError(selection.reason);
  if (!selection.orderedTasks.length) throw new CliError(`No tasks selected for mode '${mode}'.`);

  const checkpointId = options.checkpoint || null;
  const checkpointTaskStatus = checkpointId ? change.tasks.find(t => t.id === checkpointId)?.status : undefined;
  const checkpointCheck = validateBatchCheckpoint(mode, checkpointId, selection.orderedTasks, checkpointTaskStatus);
  if (!checkpointCheck.ok) throw new CliError(checkpointCheck.reason);
  const checkpointTask = mode === 'until-checkpoint' ? checkpointId : null;

  const intent = {
    change: changeSlug,
    requestedTasks: taskIds || selection.orderedTasks,
    orderedTasks: selection.orderedTasks,
    startRevision: git.getCurrentRevision(ROOT),
    reviewMode: 'batch',
    checkpointPolicy: checkpointTask,
    temporaryInconsistencies: options.tempInconsistentPair
      ? [options.tempInconsistentPair.split(',').map(s => s.trim())]
      : [],
  };
  writeBatchIntent(change, intent);
  console.log(
    checkpointTask
      ? `Batch started for '${changeSlug}' (mode: ${mode}, checkpoint: ${checkpointTask}): ${selection.orderedTasks.join(' -> ')}`
      : `Batch started for '${changeSlug}' (mode: ${mode}): ${selection.orderedTasks.join(' -> ')}`
  );

  handleStart(changeSlug, selection.orderedTasks[0]);
}

// Read-only: batch progress is always derived (D10), never a second copy —
// this command computes it fresh every call, safe after any interruption.
export function handleBatchStatus(changeSlug) {
  const change = requireChange(changeSlug);
  const intent = loadBatchIntent(change);
  if (!intent) { console.log(JSON.stringify({ change: changeSlug, active: false }, null, 2)); return; }

  const progress = deriveBatchProgress(change, intent);
  const currentTask = progress.current ? requireTask(change, progress.current) : null;
  const hardStop = currentTask ? hardStopReason(currentTask) : null;
  const riskSignals = currentTask && !hardStop
    ? detectRiskSignals(currentTask, loadTaskFileParts(change, currentTask).fm, {})
    : [];
  const needsFullReview = currentTask ? requiresFullReview(currentTask, riskSignals) : false;

  // Temporary-inconsistency exemption (unchanged from the original draft):
  // a `validate` failure right at the declared pair's own boundary doesn't
  // block the batch continuing from `current` into `next` — every other
  // boundary still enforces it normally.
  const hasValidationErrors = validateSpecs().length > 0;
  const validationBlocksContinuation = batchValidationBlocks(intent, progress.current, progress.next, hasValidationErrors);

  console.log(JSON.stringify({
    change: changeSlug, active: true, intent, progress, hardStop, riskSignals, needsFullReview,
    validationBlocksContinuation,
  }, null, 2));
}

// The one gating batch review that closes a batch (requirement) — never
// re-evaluates any individual batched task's own acceptance criteria; checks
// the whole-batch diff since startRevision, cross-task integration, and open
// blocking follow-up entries only. Evidence freshness (D19) is a distinct
// step run immediately before, never folded silently into the review.
export function handleBatchReview(changeSlug) {
  const change = requireChange(changeSlug);
  const intent = loadBatchIntent(change);
  if (!intent) throw new CliError(`Change '${changeSlug}' has no active batch.`);

  const progress = deriveBatchProgress(change, intent);
  if (progress.failed) {
    const failedTask = requireTask(change, progress.failed);
    const stop = hardStopReason(failedTask);
    throw new CliError(
      `Batch has a hard stop at '${progress.failed}'${stop ? ` (${stop.code}: ${stop.detail})` : ''} — ` +
      `cannot run the gating review until it's resolved. A full task-review is never a substitute for this.`
    );
  }
  if (progress.current) {
    throw new CliError(`Task '${progress.current}' is not yet complete — the gating review runs only once every batched task is terminal.`);
  }

  const currentFingerprints = {};
  for (const id of intent.orderedTasks) currentFingerprints[id] = computeTaskFingerprint(change, id);

  // Real whole-batch diff attribution (PR re-review packet 03) — the
  // previous version passed `{}` for touched paths, so staleEvidenceTasks'
  // overlap half (and any cross-task integration signal) could never fire.
  // `changedFiles` is the complete diff since `startRevision` (requirement:
  // "excludes anything that predates the batch"); each file is attributed to
  // every batched task whose own declared allowed_paths/consequential_paths
  // match it (attributeTouchedPaths' documented rule — see its own doc
  // comment for how an ambiguous shared file is handled).
  const changedFiles = git.getChangedFiles(ROOT, intent.startRevision);
  const taskDeclaredPaths = {};
  for (const id of intent.orderedTasks) {
    const t = requireTask(change, id);
    const { fm } = loadTaskFileParts(change, t);
    taskDeclaredPaths[id] = [...(fm.allowed_paths || []), ...(fm.consequential_paths || [])];
  }
  const touchedPaths = attributeTouchedPaths(intent.orderedTasks, taskDeclaredPaths, changedFiles);

  const stale = staleEvidenceTasks(change, intent.orderedTasks, touchedPaths, currentFingerprints);
  if (stale.length) {
    throw new CliError(
      `Stale evidence for: ${stale.join(', ')}. Rerun self-check (node tools/specs.mjs self-check ${changeSlug} <task-id>) ` +
      `before the gating review — the review never proceeds past stale, unrefreshed evidence.`
    );
  }

  const followUps = loadFollowUps(change);
  const openBlocking = (followUps.follow_ups || []).filter(f => f.status === 'open' && f.severity === 'blocking');
  // Deterministic structural findings (Phase 3, PR re-review packet 03) — the
  // "no findings" case must be attributable to an explicit review step, not
  // merely "no blocking follow-up happened to be open."
  const integrationFindings = detectBatchIntegrationFindings(intent, intent.orderedTasks, touchedPaths);
  const verdict = computeBatchReviewVerdict({
    ownerDecisionFindings: openBlocking.length, otherFindings: integrationFindings.length,
  });

  const batchId = intent.startRevision.slice(0, 8);
  const reviewsDir = join(change._dir, 'reviews');
  ensureDir(reviewsDir);
  const reportFile = join(reviewsDir, `batch-${batchId}.md`);
  const generated = new Date().toISOString();
  const followUpRows = openBlocking.map(f => `| ${f.id} | OWNER_DECISION | open blocking follow-up | ${f.reason} |`);
  const integrationRows = integrationFindings.map((f, i) =>
    `| BR-${String(i + 1).padStart(3, '0')} | NON_BLOCKING | cross-task integration | ${f.summary} |`
  );
  const allFindingsRows = [...followUpRows, ...integrationRows];
  const findingsRows = allFindingsRows.length ? allFindingsRows.join('\n') : '| — | — | No findings | — |';

  const report = [
    '---',
    'review-of: batch',
    `change: ${changeSlug}`,
    `batch: ${batchId}`,
    `batched-tasks: [${intent.orderedTasks.join(', ')}]`,
    `generated: ${generated}`,
    `verdict: ${verdict}`,
    '---',
    '',
    `# Batch review: ${changeSlug} (${batchId})`,
    '',
    '## Verdict',
    '',
    `${verdict}`,
    '',
    '## Findings',
    '',
    '| ID | Category | Finding | Detail |',
    '|---|---|---|---|',
    findingsRows,
    '',
    '## Batch integration',
    '',
    `Batched tasks (in order): ${intent.orderedTasks.join(', ')}.`,
    '',
    `Complete diff since \`${intent.startRevision}\`: ${changedFiles.length} file(s) changed.`,
    '',
    integrationFindings.length
      ? 'Cross-task path overlap (same file touched by more than one batched task, per attributed declared paths):'
      : 'No cross-task path overlap detected between batched tasks\' attributed touched paths.',
    ...integrationFindings.map(f => `- ${f.summary}`),
    '',
  ].join('\n');

  writeUtf8(reportFile, report);
  clearBatchIntent(change);
  console.log(`Batch review written: specs/active/${changeSlug}/reviews/batch-${batchId}.md`);
  console.log(`Verdict: ${verdict}`);
}

// Records a new follow-up entry (task-review/spec-audit's "record as follow-up"
// action for a NON_BLOCKING finding) — always a fresh id, never mutates an
// existing entry (that's handleFollowUpResolve's job).
export function handleFollowUpAdd(changeSlug, id, options = {}) {
  const change = requireChange(changeSlug);
  if (!options.sourceTask || !options.kind || !options.severity || !options.reason) {
    throw new CliError('follow-up-add requires --source-task, --kind, --severity, and --reason.');
  }
  if (!FOLLOW_UP_SEVERITIES.has(options.severity)) {
    throw new CliError(`--severity must be one of ${[...FOLLOW_UP_SEVERITIES].join('/')}, got '${options.severity}'.`);
  }
  const existing = loadFollowUps(change).follow_ups || [];
  if (existing.some(f => f.id === id)) throw new CliError(`Follow-up '${id}' already exists in change '${changeSlug}'.`);

  addFollowUp(change, {
    id, source_task: options.sourceTask, kind: options.kind, severity: options.severity,
    reason: options.reason, resolver_task: options.resolverTask || null, status: 'open', resolution: null,
  });
  console.log(`Follow-up '${id}' recorded (status: open).`);
}

// Mutates an existing follow-up entry's status/resolution in place (D15 — the
// ledger is mutable current-state, never append-only) — resolve by default,
// --dismiss for a dismissal. Dismissing a blocking entry fails closed without
// a --decision-ref citing a recorded, currently-active owner decision (PR
// review packet 05B, Problem 1) — never a regex scan over --resolution's
// free-form text for an incidental 'D<n>' mention.
export function handleFollowUpResolve(changeSlug, id, options = {}) {
  const change = requireChange(changeSlug);
  const entry = (loadFollowUps(change).follow_ups || []).find(f => f.id === id);
  if (!entry) throw new CliError(`Follow-up '${id}' not found in change '${changeSlug}'.`);
  if (!options.resolution) throw new CliError('follow-up-resolve requires --resolution.');

  const status = options.dismiss ? 'dismissed' : 'resolved';
  if (status === 'dismissed' && entry.severity === 'blocking') {
    if (!options.decisionRef) {
      throw new CliError(
        `Dismissing blocking follow-up '${id}' requires --decision-ref citing a recorded owner decision (e.g. --decision-ref D12).`
      );
    }
    const decisionsMap = parseOwnerDecisions(
      existsSync(join(change._dir, 'owner-decisions.md')) ? readUtf8(join(change._dir, 'owner-decisions.md')) : ''
    );
    const decision = decisionsMap.get(options.decisionRef);
    if (!decision) {
      throw new CliError(`--decision-ref '${options.decisionRef}' does not resolve in owner-decisions.md.`);
    }
    if (decision.supersededBy) {
      throw new CliError(`--decision-ref '${options.decisionRef}' is superseded — cite '${decision.supersededBy}' instead.`);
    }
  }

  resolveFollowUp(change, id, { status, resolution: options.resolution, decisionRef: options.decisionRef || null });
  console.log(`Follow-up '${id}' marked as ${status}.`);
}

export function handleArchive(changeSlug) {
  const change = requireChange(changeSlug);
  const allDone = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
  if (!allDone) throw new CliError('Not all tasks are in a terminal status. Cannot archive.');

  ensureDir(ARCHIVE_DIR);
  moveDir(change._dir, join(ARCHIVE_DIR, changeSlug));
  writeSpecsIndexes(buildSpecsIndexes());
  console.log(`Change '${changeSlug}' archived to specs/archive/.`);
}

function runDotnetCheck(name, args) {
  try {
    execFileSync('dotnet', args, { cwd: ROOT, encoding: 'utf8' });
    return { name, passed: true };
  } catch (error) {
    const tail = String(error?.stdout || error?.message || '').trim().split('\n').slice(-5).join(' | ');
    return { name, passed: false, detail: tail };
  }
}

// Gathers every fact validateFinalize needs, doing no writes itself. Split out from
// handleFinalize so `--check` (read-only) and the real run share exactly one code path
// for "what does the current state look like" — the only difference between them is
// whether the result is acted on.
function gatherFinalizeFacts(branch, change) {
  const verification = [];

  const specErrors = validateSpecs();
  verification.push({ name: 'specs validate', passed: specErrors.length === 0, detail: specErrors[0] });
  const specCheckProblems = checkSpecsIndexes();
  verification.push({ name: 'specs check', passed: specCheckProblems.length === 0, detail: specCheckProblems[0] });

  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  verification.push({ name: 'docs validate', passed: docErrors.length === 0, detail: docErrors[0] });
  const docCheckProblems = checkDocsIndexes(docs);
  verification.push({ name: 'docs check', passed: docCheckProblems.length === 0, detail: docCheckProblems[0] });

  let pr = null;
  const ghAvailable = github.isGhAvailable();
  if (!ghAvailable) {
    verification.push({ name: 'gh CLI', passed: false, detail: 'not installed or not on PATH' });
  } else {
    pr = github.getPrForBranch(ROOT, branch);
    if (pr) {
      pr.unresolvedThreads = pr.state === 'MERGED' ? 0 : github.getUnresolvedReviewThreadCount(ROOT, pr.number);
    }
  }

  if (pr?.baseRefName) {
    if (git.touchesPaths(ROOT, `origin/${pr.baseRefName}`, branch, ['src', 'tests'])) {
      verification.push(runDotnetCheck('dotnet build', ['build']));
      verification.push(runDotnetCheck('dotnet test', ['test']));
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
    // null means "checked, genuinely none" ONLY when ghAvailable is true — when
    // ghAvailable is false this is "unknown," never treat it as "confirmed absent."
    pr: pr ? { number: pr.number, state: pr.state, isDraft: pr.isDraft, unresolvedThreads: pr.unresolvedThreads } : null,
    verification,
    openBlockingFollowUps,
  };
}

// ── Post-merge verify-before-destructive-cleanup (D9, task 09) ─────────────
//
// git operations not already exported by tools/lib/git.mjs (fetch, an
// arbitrary ref's revision, `pull --ff-only`, branch deletion) — that module
// is outside this task's allowed_paths, so these live here as small, local,
// same-pattern helpers instead of growing it.

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
 * `main`, then invokes `computeCheckFailures()` — deliberately a callback,
 * not a precomputed value, so it only ever runs against the *post-merge*
 * tree, never a stale pre-fetch snapshot. Branch deletion (local + remote)
 * happens only when it returns no failures; on failure, nothing is deleted
 * and no `follow-ups.yaml` entry is written (that mutates an
 * already-archived change with no commit path — exactly the contradiction
 * D9 exists to avoid; the caller must not do it either). `root` defaults to
 * this process's `ROOT`; tests pass a temp repo.
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

function gatherPostMergeCheckFailures() {
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
 * The nine-step guarded repair-branch creation (D23, corrected by D25) —
 * exported for direct testing against a real temp git repo, decoupled from
 * `gh`/PR concerns. Every read-only/remote guard (worktree clean, local
 * branch absent, remote branch absent, `origin/main` still at the recorded
 * failing SHA) is checked *before* switching/fast-forwarding local `main`;
 * only after all of those pass does it touch `main`, and only then checks
 * the final guard (local `main` now equals the failing SHA) before creating
 * the branch. Never `reset`/`clean`/force-checkout/stash at any step — every
 * git call here is `status`/`rev-parse` (read-only), `fetch` (read-only),
 * `checkout <branch>` (no `-f`), `pull --ff-only`, or `checkout -b` (create).
 * Returns `{ ok, failedGuard, mainSwitched, fetchRan, branchCreated }` —
 * never throws for a guard failure, since that's an expected, reported
 * outcome, not a programmer error. `root` defaults to this process's `ROOT`.
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
    // A genuine non-fast-forward (local main has diverged) — the literal
    // "local main cannot fast-forward" failure mode (AC6). Falls through to
    // the same SHA-comparison guard below rather than a second failedGuard
    // code: either way, local main not landing on `failingSha` is the one
    // observable fact that matters.
  }

  if (git.getCurrentRevision(root) !== failingSha) {
    return { ok: false, failedGuard: 'local-main-matches-failing-sha', mainSwitched, fetchRan, branchCreated: false };
  }

  git.createAndCheckoutBranch(root, branchName);
  return { ok: true, mainSwitched, fetchRan, branchCreated: true };
}

// Confirm-then-create entry point (D23) — spec-finalize.md's prose runs this
// only after the owner's explicit confirmation, following a reported
// post-merge check failure. The nine-step guard sequence itself
// (createRepairBranch) runs immediately before creating the branch, not at
// report time — state can change in the gap between the failure report and
// the confirmation.
export function handleFinalizeRepairBranch(changeSlug, options = {}) {
  requireChangeAnywhere(changeSlug); // only for the usual "not found" error on a bad slug
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

// ── Multi-task implementation review orchestration (D30, task 12) ──────────

// Deterministic scope resolution for `/nevo-ai:implementation-review` — read-only,
// never parsed ad hoc by the command's own conversational flow (area
// implementation-review-orchestration, requirement 2).
export function handleReviewScope(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  const result = resolveReviewScope(change, { all: Boolean(options.all), tasks: options.tasks });
  if (!result.ok) throw new CliError(result.reason);
  console.log(JSON.stringify({ change: changeSlug, orderedTasks: result.orderedTasks }, null, 2));
}

// The single write path for the bulk-transition operation (requirement 12) —
// validates every named task's computed transition before writing any of
// them (all-or-nothing), then performs exactly one change.yaml read-modify-
// write covering all of them together.
export function handleBulkTransition(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  if (!options.tasks) throw new CliError('bulk-transition requires --tasks <id,id,...>.');
  if (!options.outcome) throw new CliError('bulk-transition requires --outcome <self-verified|verified>.');

  const taskIds = options.tasks.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = taskIds.filter(id => !change.tasks.some(t => t.id === id));
  if (unknown.length) throw new CliError(`Unknown task id(s): ${unknown.join(', ')}`);

  const result = validateBulkTransition(change, taskIds, options.outcome);
  if (!result.ok) throw new CliError(result.reason);

  writeBulkTransition(change, result.transitions);

  const changed = result.transitions.filter(t => !t.noop);
  if (!changed.length) {
    console.log('No task needed a status change (every selected task was already at or past the target).');
    return;
  }
  console.log(`Bulk transition applied (outcome: ${options.outcome}):`);
  for (const t of changed) console.log(`  '${t.id}': ${t.from} -> ${t.to}`);
}

// Finalize gate: every task terminal, working tree clean and pushed, an open (or
// already-merged, idempotently) PR with zero unresolved review threads, and every
// verification command green. `--check` only reports the gate result — no side
// effects. Without it, once the gate passes: archive locally (skipped if the change was
// already archived — e.g. someone ran bare `archive` before finalizing, which this
// command still needs to recover from, not just refuse) → commit → push → squash-merge
// the PR → verify-before-destructive-cleanup (D9). Never merges or archives on a
// failing gate, and the interactive "are you sure" for this whole action lives one layer
// up, in /nevo-ai:spec-finalize — this command does exactly what it's told,
// deterministically, the same split as `approve`/`archive`.
export function handleFinalize(changeSlug, options = {}) {
  const { change, location } = requireChangeAnywhere(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const facts = gatherFinalizeFacts(branch, change);
  const result = validateFinalize(change, facts);

  if (options.check) {
    console.log(JSON.stringify({ change: changeSlug, branch, location, facts, result }, null, 2));
    return;
  }

  if (!result.ok) throw new CliError(result.reason);

  if (location === 'active') {
    handleArchive(changeSlug);
    if (!git.isWorkingTreeClean(ROOT)) git.commitAll(ROOT, `chore(specs): archive ${changeSlug}`);
  } else {
    console.log(`Change '${changeSlug}' is already archived.`);
    if (!git.isWorkingTreeClean(ROOT)) git.commitAll(ROOT, `chore(specs): finalize ${changeSlug}`);
  }

  if (result.idempotent) {
    console.log('PR was already merged. Any pending local changes were committed — push manually if the remote branch still exists.');
    return;
  }

  git.push(ROOT, branch);
  github.mergePr(ROOT, facts.pr.number);

  const postMerge = runPostMergeCheck(ROOT, branch, gatherPostMergeCheckFailures);
  if (!postMerge.ok) {
    console.error(`Post-merge check FAILED after merging PR #${facts.pr.number} (merged SHA: ${postMerge.mergedSha}).`);
    for (const f of postMerge.failed) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    console.error(
      `Branch '${postMerge.diagnosticBranch}' preserved as a diagnostic anchor (not deleted). ` +
      `No follow-up entry was written for this already-archived change.`
    );
    console.error(
      `To create a repair branch once confirmed: node tools/specs.mjs finalize-repair-branch ` +
      `${changeSlug} --failing-sha ${postMerge.mergedSha}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Pushed and merged PR #${facts.pr.number} (squash). Post-merge check passed — ` +
    `branch '${postMerge.deletedBranch}' deleted.`
  );
}

// Read-only lifecycle navigator: where does this change sit right now, across the
// whole spec → task → PR → merge chain, and what is the single next action. Never
// writes anything. Skips the git/gh/verification calls entirely while any task is
// still non-terminal, since deriveStage's task-status checks always win first in that
// case — no need to pay for a PR lookup or a dotnet build just to report "task X is
// still in-implementation." Checks specs/archive/ too — a change archived before its
// PR was pushed/merged (the exact incident this command exists to prevent recurring)
// must still be reportable, not just error out with "not found."
export function handleStatus(changeSlug) {
  const { change, location } = requireChangeAnywhere(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const allTerminal = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
  const facts = allTerminal ? gatherFinalizeFacts(branch, change) : { pr: null, ghAvailable: true, verification: [] };

  // Self-check freshness (D28) needs the in-implementation task's *current*
  // fingerprint/revision to compare against what self_check recorded —
  // computed here (I/O), consumed by deriveStage as a pure comparison.
  const inProgress = change.tasks.find(t => t.status === 'in-implementation');
  if (inProgress) {
    facts.currentTaskState = {
      fingerprint: computeTaskFingerprint(change, inProgress.id),
      revision: git.getCurrentRevision(ROOT),
    };
  }

  const result = deriveStage(change, facts);
  console.log(JSON.stringify({ change: changeSlug, branch, location, ...result }, null, 2));
}

function requirePrForChange(changeSlug) {
  requireChangeAnywhere(changeSlug); // only for the usual "not found" error on a bad slug
  const branch = git.getCurrentBranch(ROOT);
  const pr = github.getPrForBranch(ROOT, branch);
  if (!pr) throw new CliError(`No pull request found for branch '${branch}'.`);
  return pr;
}

// Read-only: every review thread on this change's PR, unresolved ones first, with full
// comment text and each comment's databaseId (needed by `resolve-comment --reply`).
// Never filters out bot reviewers (e.g. GitHub Copilot) — a thread is a thread
// regardless of who opened it.
export function handleComments(changeSlug) {
  const pr = requirePrForChange(changeSlug);
  const threads = github.getReviewThreads(ROOT, pr.number);
  threads.sort((a, b) => Number(a.isResolved) - Number(b.isResolved));
  console.log(JSON.stringify({ change: changeSlug, pr: pr.number, threads }, null, 2));
}

// Resolves one review thread (its GraphQL `id`, from `comments`' output — not a
// comment's databaseId). `--reply` posts a reply on the thread's first comment before
// resolving, so the reviewer sees why it was closed instead of a silent resolution.
export function handleResolveComment(changeSlug, threadId, options = {}) {
  const pr = requirePrForChange(changeSlug);
  if (options.reply) {
    const threads = github.getReviewThreads(ROOT, pr.number);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) throw new CliError(`Thread '${threadId}' not found on PR #${pr.number}.`);
    const firstComment = thread.comments[0];
    if (!firstComment) throw new CliError(`Thread '${threadId}' has no comments to reply to.`);
    github.replyToReviewComment(ROOT, pr.number, firstComment.databaseId, options.reply);
    console.log(`Replied on thread '${threadId}'.`);
  }
  const result = github.resolveReviewThread(ROOT, threadId);
  console.log(`Thread '${threadId}' resolved: ${result.isResolved}`);
}

// ── CLI wiring ───────────────────────────────────────────────────────────────

export function buildProgram() {
  const program = new Command();
  program
    .name('node tools/specs.mjs')
    .description('Specification lifecycle CLI')
    .exitOverride();

  program.command('generate').description('Rebuild generated indexes').action(handleGenerate);
  program.command('validate').description('Validate all change manifests').action(handleValidate);
  program.command('check').description('Validate + check indexes are current').action(handleCheck);
  program.command('list').description('List active changes and task statuses').action(handleList);
  program.command('next').description('Select next approved, dependency-ready task → JSON').action(handleNext);

  program.command('context')
    .description('Print context packet for one task → JSON')
    .argument('<change>')
    .argument('<task>')
    .action(handleContext);

  program.command('fingerprint')
    .description('Print a deterministic hash of the spec inputs (--task for one task\'s own semantic fingerprint)')
    .argument('<change>')
    .option('--task <task-id>', 'Print this task\'s own semantic fingerprint instead of the change-level one')
    .action((changeSlug, opts) => handleFingerprint(changeSlug, opts));

  program.command('approve')
    .description('Mark task as approved (requires a clean, ready review)')
    .argument('<change>')
    .argument('<task>')
    .action(handleApprove);

  program.command('start')
    .description('Create/switch branch, set task in-implementation')
    .argument('<change>')
    .argument('<task>')
    .action(handleStart);

  program.command('complete')
    .description('Mark task as implemented')
    .argument('<change>')
    .argument('<task>')
    .action(handleComplete);

  program.command('verify')
    .description('Mark task as verified')
    .argument('<change>')
    .argument('<task>')
    .action(handleVerify);

  program.command('archive')
    .description('Move a fully terminal change to specs/archive/')
    .argument('<change>')
    .action(handleArchive);

  program.command('finalize')
    .description('Gate on PR/review/verification state, then merge + archive (--check for a dry-run report)')
    .argument('<change>')
    .option('--check', 'Report the gate result only — no merge, no archive, no writes')
    .action((changeSlug, opts) => handleFinalize(changeSlug, opts));

  program.command('status')
    .description('Read-only: where this change sits in the spec→task→PR→merge chain, and the one next action')
    .argument('<change>')
    .action(handleStatus);

  program.command('comments')
    .description("Read-only: this change's PR review threads, unresolved first, with full comment text")
    .argument('<change>')
    .action(handleComments);

  program.command('resolve-comment')
    .description('Resolve one PR review thread (--reply to post a reply first)')
    .argument('<change>')
    .argument('<thread-id>')
    .option('--reply <text>', 'Reply on the thread before resolving it')
    .action((changeSlug, threadId, opts) => handleResolveComment(changeSlug, threadId, opts));

  program.command('follow-up-add')
    .description('Record a new follow-ups.yaml entry (status: open)')
    .argument('<change>')
    .argument('<id>')
    .requiredOption('--source-task <task-id>')
    .requiredOption('--kind <kind>')
    .requiredOption('--severity <blocking|non-blocking>')
    .requiredOption('--reason <text>')
    .option('--resolver-task <task-id>')
    .action((changeSlug, id, opts) => handleFollowUpAdd(changeSlug, id, opts));

  program.command('follow-up-resolve')
    .description('Mutate an existing follow-ups.yaml entry in place (resolve, or --dismiss)')
    .argument('<change>')
    .argument('<id>')
    .requiredOption('--resolution <text>')
    .option('--dismiss', 'Dismiss instead of resolve')
    .option('--decision-ref <D-id>', 'Required when dismissing a blocking entry — the recorded owner decision that justifies it')
    .action((changeSlug, id, opts) => handleFollowUpResolve(changeSlug, id, opts));

  program.command('self-check')
    .description('Run a task\'s own "## Verification" commands and write self_check (D28)')
    .argument('<change>')
    .argument('<task>')
    .action(handleSelfCheck);

  program.command('suggest-provenance')
    .description('Read-only: suggest a baseline_revision/changed_paths reconstruction for a task with no persisted implementation block (D34/D35)')
    .argument('<change>')
    .argument('<task>')
    .action(handleSuggestProvenance);

  program.command('apply-provenance')
    .description('Write one or more tasks\' implementation provenance block after explicit owner confirmation (D34/D35) — requires --confirm; use --mappings to confirm several legacy reconstructions in one action')
    .argument('<change>')
    .argument('<tasks>', 'A single task id, or a comma-separated list when using --mappings')
    .option('--baseline <revision>', 'Single-task shape only')
    .option('--changed-paths <path,path,...>', 'Single-task shape only')
    .option('--mappings <json>', 'JSON array of {task, baseline, changedPaths} — required for more than one task; all written under this one --confirm')
    .option('--confirm', 'Required — this writes only after explicit confirmation, never unattended')
    .action((changeSlug, tasks, opts) => handleApplyProvenance(changeSlug, tasks, opts));

  program.command('batch-start')
    .description(`Select a batch (${[...BATCH_SELECTION_MODES].join('/')}) and start its first task`)
    .argument('<change>')
    .argument('<mode>')
    .option('--tasks <id,id,...>', 'Explicit task-id list — required for named-subset')
    .option('--checkpoint <task-id>', 'Named checkpoint — until-checkpoint only')
    .option('--temp-inconsistent-pair <task-id,task-id>', 'Declare exactly one temporary-inconsistency pair')
    .action((changeSlug, mode, opts) => handleBatchStart(changeSlug, mode, opts));

  program.command('batch-status')
    .description('Read-only: derived batch progress (completed/current/next/failed), hard-stop and risk-signal state')
    .argument('<change>')
    .action(handleBatchStatus);

  program.command('batch-review')
    .description('Run the evidence-freshness check, then the one gating batch review that closes a batch')
    .argument('<change>')
    .action(handleBatchReview);

  program.command('review-scope')
    .description('Resolve --all/--tasks (order range or list) into an ordered, eligibility-checked task id list (D30)')
    .argument('<change>')
    .option('--all', 'Every eligible task in the change')
    .option('--tasks <spec>', "Order range ('01-03') or comma list ('01,03,07')")
    .action((changeSlug, opts) => handleReviewScope(changeSlug, opts));

  program.command('bulk-transition')
    .description('Apply one status transition to multiple eligible tasks in a single atomic change.yaml write (D30)')
    .argument('<change>')
    .requiredOption('--tasks <id,id,...>')
    .requiredOption('--outcome <self-verified|verified>')
    .action((changeSlug, opts) => handleBulkTransition(changeSlug, opts));

  program.command('finalize-repair-branch')
    .description('D23/D25: confirm-then-create repair branch after a failed post-merge check (nine-step guarded sequence)')
    .argument('<change>')
    .requiredOption('--failing-sha <sha>', 'The merged SHA the failed post-merge check reported')
    .action((changeSlug, opts) => handleFinalizeRepairBranch(changeSlug, opts));

  return program;
}

async function runCli() {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('commander.')) {
      process.exitCode = typeof error.exitCode === 'number' ? error.exitCode : 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof RecoveryError) {
      // Machine-readable, not just a human sentence — the whole point of this task.
      console.error(JSON.stringify({ code: error.code, recovery: error.recovery }));
    }
    process.exitCode = 1;
  }
}

// Only run the CLI when this file is executed directly (`node tools/specs.mjs
// ...`), not when it's imported — e.g. by tests importing the exported handler
// and pure functions above.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await runCli();
}
