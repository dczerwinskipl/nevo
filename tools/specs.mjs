#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|fingerprint|approve|start|complete|verify|archive|finalize|status|comments|resolve-comment|pull-request-add>

import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

import { RecoveryError } from './lib/cli-errors.mjs';
import { readAgentExecutionContext, createAgentSessionBindingService } from './ai/binding-service.mjs';
import { isValidSpecId } from './specs/identity.mjs';
import {
  setTaskSuspension,
  clearTaskSuspension,
  guardAgainstUnsafeManual,
} from './specs/store.mjs';
import { BATCH_SELECTION_MODES } from './specs/lifecycle/batch.mjs';

import {
  handleGenerate,
  handleValidate,
  handleCheck,
  handleList,
  handleNext,
  handleContext,
  handleFingerprint,
  handleBackfillSpecId,
  handleApprove,
  handleStart,
  handleComplete,
  handleVerify,
  handleArchive,
  handleFinalize,
  handleFinalizeRepairBranch,
  handleStatus,
  handleComments,
  handleResolveComment,
  handlePullRequestAdd,
  handleFollowUpAdd,
  handleFollowUpResolve,
  handleSelfCheck,
  handleSuggestProvenance,
  handleApplyProvenance,
  handleBatchStart,
  handleBatchStatus,
  handleBatchReview,
  handleReviewScope,
  handleBulkTransition,
  handleAgentSessionAttach,
} from './specs/commands/index.mjs';

// Re-export command handlers and domain capabilities for backward compatibility with external/test callers
export * from './specs/commands/index.mjs';
export {
  setTaskSuspension,
  clearTaskSuspension,
  guardAgainstUnsafeManual,
};

export function autoBindAgentSession(change, taskId, purpose) {
  const context = readAgentExecutionContext();
  if (context && change) {
    try {
      const specId = change.spec_id;
      if (!specId || !isValidSpecId(specId)) {
        console.error(`[nevo-ai] Warning: Cannot auto-bind session: change '${change._slug || 'unknown'}' has no valid spec_id.`);
        return;
      }
      const bindingService = createAgentSessionBindingService();
      bindingService.bindSessionSync({
        provider: context.provider,
        providerSessionId: context.providerSessionId,
        specId,
        taskId: taskId || undefined,
        purpose,
      });
    } catch (err) {
      console.error(`[nevo-ai] Warning: Failed to auto-bind agent session (${context.provider}/${context.providerSessionId}): ${err.message}`);
    }
  }
}

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
    .description("Print a deterministic hash of the spec inputs (--task for one task's own semantic fingerprint)")
    .argument('<change>')
    .option('--task <task-id>', "Print this task's own semantic fingerprint instead of the change-level one")
    .action((changeSlug, opts) => handleFingerprint(changeSlug, opts));

  program.command('backfill-spec-id')
    .description('Idempotently assign a fresh canonical UUID spec_id to any manifest missing one (D2)')
    .action(handleBackfillSpecId);

  program.command('approve')
    .description('Mark task as approved (requires a clean, ready review)')
    .argument('<change>')
    .argument('<task>')
    .option('--check', 'Report the approval gate only — no status write')
    .option('--no-git', 'Skip automatic Git commit and push after approval')
    .action((changeSlug, taskId, opts) => handleApprove(changeSlug, taskId, opts));

  program.command('start')
    .description('Create/checkout branch, mark in-implementation, and print context packet → JSON')
    .argument('<change>')
    .argument('<task>')
    .action(handleStart);

  program.command('complete')
    .description('Mark in-implementation task as implemented (ready for verification)')
    .argument('<change>')
    .argument('<task>')
    .action(handleComplete);

  program.command('verify')
    .description('Mark implemented task as verified (task complete)')
    .argument('<change>')
    .argument('<task>')
    .option('--check', 'Report the verification gate only — no status write')
    .option('--no-git', 'Skip automatic Git commit and push after verification')
    .action((changeSlug, taskId, opts) => handleVerify(changeSlug, taskId, opts));

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

  program.command('pull-request-add')
    .description('Record a durable, provider-neutral pull request reference on an active or archived change (D1)')
    .argument('<change>', 'Specification slug (active or archived)')
    .requiredOption('--number <number>', 'Pull request number')
    .option('--provider <provider>', 'Provider ID (default: github)', 'github')
    .option('--base-url <url>', 'Provider base URL (default: https://github.com for github)')
    .requiredOption('--repository <owner/repo>', 'Repository path, e.g. owner/repo')
    .action((changeSlug, opts) => handlePullRequestAdd(changeSlug, opts));

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

  const agentSession = program.command('agent-session')
    .description('AI agent session management');

  agentSession.command('attach')
    .description('Attach an external AI agent session to a specification and optional task')
    .requiredOption('--spec <slug-or-id>', 'Specification slug or canonical spec_id UUID')
    .option('--task <id>', 'Optional task ID')
    .requiredOption('--provider <provider>', 'Provider ID (e.g. claude, antigravity, mock)')
    .requiredOption('--session-id, --provider-session-id <providerSessionId>', 'Provider session ID')
    .option('--purpose <purpose>', 'Binding purpose', 'attached')
    .action(opts => handleAgentSessionAttach(opts));

  return program;
}

async function runCli() {
  const program = buildProgram();
  if (process.argv.slice(2).length === 0) {
    program.outputHelp({ error: true });
    process.exitCode = 1;
    return;
  }
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('commander.')) {
      process.exitCode = typeof error.exitCode === 'number' ? error.exitCode : 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof RecoveryError) {
      console.error(JSON.stringify({ code: error.code, recovery: error.recovery }));
    }
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await runCli();
}
