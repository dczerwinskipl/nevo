#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|fingerprint|approve|start|complete|verify|archive>

import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { CliError } from './lib/cli-errors.mjs';
import { ensureDir, moveDir } from './lib/fs.mjs';
import * as git from './lib/git.mjs';
import {
  loadChange, listChanges, setTaskStatus, buildContextPacket, getNext,
  computeSpecFingerprint, loadReview,
  buildSpecsIndexes, writeSpecsIndexes, checkSpecsIndexes,
  ACTIVE_DIR, ARCHIVE_DIR,
} from './specs/service.mjs';
import { validateSpecs } from './specs/validation.mjs';
import { TERMINAL_STATUSES, isTaskReady, depsSatisfied, validateTransition, validateApproval } from './specs/lifecycle.mjs';

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
