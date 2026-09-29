// Main batch-finish execution operation (Task 04, D21, D22, D23, D29, D30, D39).
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import * as git from '../../../lib/git.mjs';
import { requireChange, requireTask, ACTIVE_DIR } from '../../store.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import { getGroupReservation } from '../queue/reservation.mjs';
import { finishStep } from '../finish-operation.mjs';
import '../actions/index.mjs';
import { WorkflowError } from '../errors.mjs';
import {
  createBatchFinishRecord,
  loadBatchFinishRecord,
  saveBatchFinishRecord,
} from './record.mjs';
import { loadBatchStartRecord } from '../batch-start/record.mjs';
import { renderBatchReport } from '../../reviews/batch-report.mjs';
import { prevalidateBatchFinish } from './preflight.mjs';

/**
 * Executes the batch-finish operation as a durable, idempotent saga (D21).
 *
 * @param {object} params
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {object} params.inputs - Result payload for member tasks and report
 * @param {string} [params.sessionId]
 * @param {string} [params.repoRoot]
 * @param {string} [params.activeDir]
 * @param {boolean} [params._crashAfterReportCommit=false] Test hook for crash simulation
 * @param {string|null} [params._crashAfterMemberTaskId=null] Test hook for crash simulation
 * @returns {Promise<{ status: string, batchExecutionId: string, record: object }>}
 */
export async function executeBatchFinish(params = {}) {
  const {
    changeSlug,
    batchExecutionId,
    inputs = {},
    sessionId,
    repoRoot = process.cwd(),
    activeDir = ACTIVE_DIR,
    _crashAfterReportCommit = false,
    _crashAfterMemberTaskId = null,
  } = params;

  if (!changeSlug || !batchExecutionId) {
    throw new WorkflowError('executeBatchFinish requires changeSlug and batchExecutionId', {
      code: 'INVALID_ARGUMENTS',
    });
  }

  const change = requireChange(changeSlug, activeDir);
  const definition = loadWorkflowDefinition(change.workflow?.definition, { repoRoot });

  const reservation = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
  if (!reservation || reservation.status !== 'reserved') {
    throw new WorkflowError(
      `Batch reservation '${batchExecutionId}' not found or not in reserved state for change '${changeSlug}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', batchExecutionId, changeSlug }
    );
  }

  const taskIds = reservation.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    throw new WorkflowError(`Reservation '${batchExecutionId}' has invalid taskIds`, {
      code: 'INVALID_RESERVATION',
      taskIds,
    });
  }

  // Check existing record for resume (D30)
  let record = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (record && record.status === 'completed') {
    return {
      status: 'completed',
      batchExecutionId,
      record,
    };
  }

  const reportAlreadyCommitted = record?.stages?.reportCommit?.status === 'completed';

  // Stage 0 & Stage 1: In-memory prevalidation (D21, D23, D29, D30, D39).
  // Zero durable writes occur if this fails.
  const {
    effectiveSessionId,
    normalizedResults,
    canonicalReportPath,
    crossTaskFindings,
  } = prevalidateBatchFinish({
    repoRoot,
    activeDir,
    changeSlug,
    batchExecutionId,
    taskIds,
    inputs,
    sessionId,
    change,
    definition,
    reservation,
    skipProvenanceCheck: reportAlreadyCommitted,
  });

  // Stage 1.5: Render and write canonical batch review report (D21, D22, Item 8)
  // Strictly performed only after all read-only prevalidation has succeeded.
  const fullReportPath = path.join(repoRoot, canonicalReportPath);
  if (!fs.existsSync(fullReportPath)) {
    const startRecord = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
    const batchCtx = startRecord?.batchContext || {
      batchExecutionId,
      change: changeSlug,
      executionScope: { kind: 'task-batch', taskIds },
      crossTaskFindings,
    };
    const rendered = renderBatchReport(batchCtx, { results: normalizedResults });
    fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
    fs.writeFileSync(fullReportPath, rendered, 'utf8');
  }

  // Stage 2: Persist as 'validated' for the first time (D21).
  if (!record) {
    record = createBatchFinishRecord({
      repoRoot,
      changeSlug,
      batchExecutionId,
      taskIds,
      results: normalizedResults,
      reportPath: canonicalReportPath,
      crossTaskFindings,
      sessionId: effectiveSessionId,
    });
  }

  // Stage 3: Report commit (D22, D30)
  if (record.stages?.reportCommit?.status !== 'completed') {
    let commitSha = null;
    const isGit = fs.existsSync(path.join(repoRoot, '.git'));

    if (isGit) {
      await git.addAndCommitAsync(
        repoRoot,
        [canonicalReportPath],
        `docs(review): batch review report ${batchExecutionId}`
      );
      commitSha = git.getCurrentRevision(repoRoot);
    } else {
      commitSha = 'fixture-commit-sha';
    }

    record.stages.reportCommit = {
      status: 'completed',
      sha: commitSha,
      path: canonicalReportPath,
      committedAt: new Date().toISOString(),
    };
    saveBatchFinishRecord(repoRoot, changeSlug, record);

    if (_crashAfterReportCommit) {
      throw new Error('[test-hook] Simulated crash after report commit');
    }
  }

  // Stage 4: Apply each member task sequentially & idempotently (D21)
  if (!record.stages.memberFinishes) {
    record.stages.memberFinishes = {};
  }

  for (const taskId of taskIds) {
    if (record.stages.memberFinishes[taskId]?.status === 'completed') {
      continue; // Skip already completed member finishes
    }

    // Refresh change to capture recent transitions
    const currentChange = requireChange(changeSlug, activeDir);
    const task = requireTask(currentChange, taskId);
    const taskInputs = {
      ...(normalizedResults[taskId] || {}),
      artifacts: [canonicalReportPath],
      sessionId: effectiveSessionId,
    };

    const finishResult = await finishStep({
      change: currentChange,
      task,
      definition,
      context: {
        repoRoot,
        activeDir,
        sessionId: effectiveSessionId,
      },
      inputs: taskInputs,
      activeDir,
    });

    record.stages.memberFinishes[taskId] = {
      status: 'completed',
      operationId: finishResult.operationId,
      result: finishResult,
      completedAt: new Date().toISOString(),
    };
    saveBatchFinishRecord(repoRoot, changeSlug, record);

    if (_crashAfterMemberTaskId === taskId) {
      throw new Error(`[test-hook] Simulated crash after member task ${taskId}`);
    }
  }

  // Stage 5: Reach 'completed' (D21)
  record.status = 'completed';
  saveBatchFinishRecord(repoRoot, changeSlug, record);

  return {
    status: 'completed',
    batchExecutionId,
    record,
  };
}
