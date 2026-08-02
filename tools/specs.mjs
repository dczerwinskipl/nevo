#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|fingerprint|approve|start|complete|verify|archive|finalize|status|comments|resolve-comment>

import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import { CliError } from './lib/cli-errors.mjs';
import { ensureDir, moveDir } from './lib/fs.mjs';
import * as git from './lib/git.mjs';
import * as github from './lib/github.mjs';
import {
  loadChange, listChanges, setTaskStatus, buildContextPacket, getNext,
  computeSpecFingerprint, loadReview,
  buildSpecsIndexes, writeSpecsIndexes, checkSpecsIndexes,
  ACTIVE_DIR, ARCHIVE_DIR,
} from './specs/service.mjs';
import { validateSpecs } from './specs/validation.mjs';
import { scanDocs, validateDocs, checkDocsIndexes } from './docs/service.mjs';
import {
  TERMINAL_STATUSES, isTaskReady, depsSatisfied, validateTransition, validateApproval, validateFinalize,
  deriveStage,
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

function requireTask(change, taskId) {
  const task = change.tasks.find(t => t.id === taskId);
  if (!task) throw new CliError(`Task '${taskId}' not found in change '${change._slug}'`);
  return task;
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

export function handleFingerprint(changeSlug) {
  const change = requireChange(changeSlug);
  console.log(computeSpecFingerprint(change));
}

export function handleApprove(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);

  const review = loadReview(change);
  const currentFingerprint = computeSpecFingerprint(change);
  const result = validateApproval(task.status, review, currentFingerprint);

  if (!result.ok) throw new CliError(result.reason);
  if (result.idempotent) { console.log(`Task '${taskId}' is already approved.`); return; }

  setTaskStatus(change, taskId, 'approved');
  console.log(`Task '${taskId}' marked as approved.`);
}

export function handleStart(changeSlug, taskId) {
  if (!git.isWorkingTreeClean(ROOT)) {
    throw new CliError('Working tree has uncommitted changes. Stash or commit before starting a task.');
  }

  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);

  const transition = validateTransition('start', task.status);
  if (!transition.ok) throw new CliError(transition.reason);
  if (!transition.idempotent && !depsSatisfied(task, change)) {
    throw new CliError(`Task '${taskId}' has unsatisfied dependencies: ${(task.depends_on || []).join(', ')}`);
  }

  const packet = buildContextPacket(change, task);
  const branch = packet.branch;

  if (!git.branchExists(ROOT, branch)) {
    git.createAndCheckoutBranch(ROOT, branch);
    console.log(`Created branch: ${branch}`);
  } else {
    git.checkoutBranch(ROOT, branch);
    console.log(`Switched to branch: ${branch}`);
  }

  if (transition.idempotent) {
    console.log(`Task '${taskId}' is already in-implementation.`);
  } else {
    setTaskStatus(change, taskId, 'in-implementation');
    console.log(`Task '${taskId}' set to in-implementation.`);
  }
  console.log('\nContext packet:');
  console.log(JSON.stringify(packet, null, 2));
}

export function handleComplete(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);

  const transition = validateTransition('complete', task.status);
  if (!transition.ok) throw new CliError(transition.reason);
  if (transition.idempotent) { console.log(`Task '${taskId}' is already implemented.`); return; }

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
function gatherFinalizeFacts(branch) {
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
  if (!github.isGhAvailable()) {
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

  return {
    gitClean: git.isWorkingTreeClean(ROOT),
    branch: git.getAheadBehind(ROOT, branch),
    pr: pr ? { number: pr.number, state: pr.state, isDraft: pr.isDraft, unresolvedThreads: pr.unresolvedThreads } : null,
    verification,
  };
}

// Finalize gate: every task terminal, working tree clean and pushed, an open (or
// already-merged, idempotently) PR with zero unresolved review threads, and every
// verification command green. `--check` only reports the gate result — no side
// effects. Without it, once the gate passes, this archives the change locally, commits
// and pushes that, then squash-merges the PR — matching the order the owner specified:
// verify → archive locally → commit → push → merge. Never merges or archives on a
// failing gate, and the interactive "are you sure" for this whole action lives one
// layer up, in /nevo-ai:spec-finalize — this command does exactly what it's told,
// deterministically, the same split as `approve`/`archive`.
export function handleFinalize(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const facts = gatherFinalizeFacts(branch);
  const result = validateFinalize(change, facts);

  if (options.check) {
    console.log(JSON.stringify({ change: changeSlug, branch, facts, result }, null, 2));
    return;
  }

  if (!result.ok) throw new CliError(result.reason);

  handleArchive(changeSlug);
  git.commitAll(ROOT, `chore(specs): archive ${changeSlug}`);

  if (result.idempotent) {
    console.log('PR was already merged. Archive committed locally — push manually if the remote branch still exists.');
    return;
  }

  git.push(ROOT, branch);
  github.mergePr(ROOT, facts.pr.number);
  console.log(`Pushed archive commit and merged PR #${facts.pr.number} (squash, branch deleted).`);
}

// Read-only lifecycle navigator: where does this change sit right now, across the
// whole spec → task → PR → merge chain, and what is the single next action. Never
// writes anything. Skips the git/gh/verification calls entirely while any task is
// still non-terminal, since deriveStage's task-status checks always win first in that
// case — no need to pay for a PR lookup or a dotnet build just to report "task X is
// still in-implementation."
export function handleStatus(changeSlug) {
  const change = requireChange(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const allTerminal = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
  const facts = allTerminal ? gatherFinalizeFacts(branch) : { pr: null, verification: [] };
  const result = deriveStage(change, facts);
  console.log(JSON.stringify({ change: changeSlug, branch, ...result }, null, 2));
}

function requirePrForChange(changeSlug) {
  requireChange(changeSlug); // only to give the usual "not found" error for a bad slug
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
    .description('Print a deterministic hash of the spec inputs')
    .argument('<change>')
    .action(handleFingerprint);

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
