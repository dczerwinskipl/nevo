import { join } from 'node:path';

import {
  requireChange,
  requireTask,
  loadBatchIntent,
  writeBatchIntent,
  clearBatchIntent,
  ROOT,
} from '../store.mjs';
import {
  selectBatch,
  validateBatchCheckpoint,
  deriveBatchProgress,
  detectRiskSignals,
  requiresFullReview,
  batchValidationBlocks,
  staleEvidenceTasks,
  attributeTouchedPaths,
  detectBatchIntegrationFindings,
  computeBatchReviewVerdict,
  BATCH_SELECTION_MODES,
} from '../lifecycle/batch.mjs';
import { hardStopReason } from '../lifecycle-primitives.mjs';
import { computeTaskFingerprint, loadTaskFileParts } from '../fingerprint.mjs';
import { validateSpecs } from '../validation.mjs';
import { loadFollowUps } from '../follow-ups.mjs';
import { ensureDir, writeUtf8 } from '../../lib/fs.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import * as git from '../../lib/git.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import { handleStart } from './start.mjs';

export { BATCH_SELECTION_MODES };

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

  const hasValidationErrors = validateSpecs().length > 0;
  const validationBlocksContinuation = batchValidationBlocks(intent, progress.current, progress.next, hasValidationErrors);

  console.log(JSON.stringify({
    change: changeSlug, active: true, intent, progress, hardStop, riskSignals, needsFullReview,
    validationBlocksContinuation,
  }, null, 2));
}

export function handleBatchReview(changeSlug, options = {}) {
  const gitRoot = options.gitRoot || ROOT;
  const change = requireChange(changeSlug, options.activeDir);
  const intent = loadBatchIntent(change);
  if (!intent) throw new CliError(`Change '${changeSlug}' has no active batch.`);

  const orderedTasks = intent.orderedTasks || [];
  const taskSteps = orderedTasks.map(id => ({
    id: `review-task-${id}`,
    label: `Review task: ${id}`,
  }));

  const emitter = createProgressEmitter();
  emitter.operationStarted({
    type: 'batch-review',
    steps: [
      { id: 'validate-batch-readiness', label: 'Validate batch readiness and evidence' },
      ...taskSteps,
      { id: 'generate-batch-report', label: 'Generate batch report' },
    ],
  });

  emitter.stepStarted({ id: 'validate-batch-readiness', label: 'Validate batch readiness and evidence' });
  const progress = deriveBatchProgress(change, intent);
  if (progress.failed) {
    const failedTask = requireTask(change, progress.failed);
    const stop = hardStopReason(failedTask);
    const err = `Batch has a hard stop at '${progress.failed}'${stop ? ` (${stop.code}: ${stop.detail})` : ''} — ` +
      `cannot run the gating review until it's resolved. A full task-review is never a substitute for this.`;
    emitter.stepFailed({ id: 'validate-batch-readiness', error: err });
    emitter.operationFailed({ error: err });
    throw new CliError(err);
  }
  if (progress.current) {
    const err = `Task '${progress.current}' is not yet complete — the gating review runs only once every batched task is terminal.`;
    emitter.stepFailed({ id: 'validate-batch-readiness', error: err });
    emitter.operationFailed({ error: err });
    throw new CliError(err);
  }

  const currentFingerprints = {};
  for (const id of intent.orderedTasks) currentFingerprints[id] = computeTaskFingerprint(change, id);

  const changedFiles = git.getChangedFiles(gitRoot, intent.startRevision);
  const taskDeclaredPaths = {};
  for (const id of intent.orderedTasks) {
    const t = requireTask(change, id);
    const { fm } = loadTaskFileParts(change, t);
    taskDeclaredPaths[id] = [...(fm.allowed_paths || []), ...(fm.consequential_paths || [])];
  }
  const touchedPaths = attributeTouchedPaths(intent.orderedTasks, taskDeclaredPaths, changedFiles);

  const stale = staleEvidenceTasks(change, intent.orderedTasks, touchedPaths, currentFingerprints);
  if (stale.length) {
    const err = `Stale evidence for: ${stale.join(', ')}. Rerun self-check (node tools/specs.mjs self-check ${changeSlug} <task-id>) ` +
      `before the gating review — the review never proceeds past stale, unrefreshed evidence.`;
    emitter.stepFailed({ id: 'validate-batch-readiness', error: err });
    emitter.operationFailed({ error: err });
    throw new CliError(err);
  }
  emitter.stepCompleted({ id: 'validate-batch-readiness' });

  const followUps = loadFollowUps(change);
  const openBlocking = (followUps.follow_ups || []).filter(f => f.status === 'open' && f.severity === 'blocking');
  const integrationFindings = detectBatchIntegrationFindings(intent, intent.orderedTasks, touchedPaths);

  for (const id of orderedTasks) {
    emitter.stepStarted({ id: `review-task-${id}`, label: `Review task: ${id}` });
    const taskFindings = integrationFindings.filter(f => f.taskIds?.includes(id));
    if (taskFindings.length > 0) {
      emitter.stepCompleted({ id: `review-task-${id}`, detail: `${taskFindings.length} integration finding(s)` });
    } else {
      emitter.stepCompleted({ id: `review-task-${id}`, detail: 'Passed integration checks' });
    }
  }

  emitter.stepStarted({ id: 'generate-batch-report', label: 'Generate batch report' });
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
    `# Batch review: ${changeSlug} (commit ${batchId})`,
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
  emitter.stepCompleted({ id: 'generate-batch-report' });
  emitter.operationCompleted({ summary: `Batch review written (${batchId}): ${verdict}.` });
  console.log(`Batch review written: specs/active/${changeSlug}/reviews/batch-${batchId}.md`);
  console.log(`Verdict: ${verdict}`);
}
