// Deterministic task publish operation (Task 31, D29, D30, D47, D50, D55, D64, D65, D68, D70, D72, D76, D81, D82, D83, D88, D91, D95, D96).
// Durable standalone operation with workspace-writer claim through push and git-finalize lock around mutate-then-commit.
// Registers 'publish' and 'batch-publish' reconciler checkers at module-load time (D88, D96).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireChange, requireTask, setTaskStatus, ROOT, ACTIVE_DIR } from '../../store.mjs';
import { resolveWithinBase, readUtf8 } from '../../../lib/fs.mjs';
import { parseFrontMatterFile } from '../../../lib/yaml.mjs';
import { CliError } from '../../../lib/cli-errors.mjs';
import { resolveWorkflowMode } from '../compatibility.mjs';
import { parseOwnerDecisions, parseConstraints } from '../../fingerprint.mjs';
import {
  validateSemanticReferences,
  validateContextExceptions,
  validateConsequentialPaths,
} from '../../validation.mjs';
import {
  operationFilePath,
  saveOperationRecord,
  loadOperationRecord,
  findInFlightOperationRecord,
} from '../operation-record.mjs';
import { withGitFinalizeLock } from '../git-finalize-lock.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
} from '../workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
} from '../workspace-request.mjs';
import { registerRequestKindReconciler } from '../workspace-claim-reconciliation.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import {
  addAndCommitAsync,
  pushAsync,
  getCurrentBranchAsync,
  getCurrentRevision,
  getCommitInfo,
} from '../../../lib/git.mjs';
import { WorkflowError } from '../errors.mjs';

export const PUBLISH_STAGE_IDS = ['validate', 'update-task', 'commit', 'push'];

// Register 'publish' and 'batch-publish' checkers at module-load time (D88, D96)
registerRequestKindReconciler('publish', async ({ repoRoot, operationRef }) => {
  let record = null;
  try {
    if (operationRef && existsSync(operationRef)) {
      record = JSON.parse(readFileSync(operationRef, 'utf8'));
    }
  } catch {}

  if (!record) {
    return { settled: false, reason: 'operation-record-not-found', reconciliationRequired: true };
  }

  if (record.status === 'completed') {
    const allStagesCompleted = Array.isArray(record.operations) &&
      record.operations.length > 0 &&
      record.operations.every(o => o.status === 'completed');
    if (allStagesCompleted) {
      return { settled: true, terminalStatus: 'completed' };
    }
    return { settled: false, reason: 'incomplete-stages', reconciliationRequired: true };
  }
  if (record.status === 'failed') {
    return { settled: true, terminalStatus: 'failed' };
  }

  return { settled: false, reason: 'incomplete-stages', reconciliationRequired: true };
});

registerRequestKindReconciler('batch-publish', async ({ repoRoot, operationRef }) => {
  let record = null;
  try {
    if (operationRef && existsSync(operationRef)) {
      record = JSON.parse(readFileSync(operationRef, 'utf8'));
    }
  } catch {}

  if (!record) {
    return { settled: false, reason: 'operation-record-not-found', reconciliationRequired: true };
  }

  if (record.status === 'completed') {
    const allStagesCompleted = Array.isArray(record.operations) &&
      record.operations.length > 0 &&
      record.operations.every(o => o.status === 'completed');
    if (allStagesCompleted) {
      return { settled: true, terminalStatus: 'completed' };
    }
    return { settled: false, reason: 'incomplete-stages', reconciliationRequired: true };
  }
  if (record.status === 'failed') {
    return { settled: true, terminalStatus: 'failed' };
  }

  return { settled: false, reason: 'incomplete-stages', reconciliationRequired: true };
});

/**
 * Validates a task's definition files, frontmatter, semantics, and dependencies
 * prior to publication.
 *
 * @param {object} change
 * @param {object} task
 */
export function validateTaskDefinitionForPublish(change, task) {
  if (!task.file) {
    throw new CliError(`Task '${task.id}' does not declare a 'file' property in change.yaml`);
  }

  const taskFile = resolveWithinBase(change._dir, task.file);
  if (!existsSync(taskFile)) {
    throw new CliError(`Task '${task.id}' file not found: ${task.file}`);
  }

  let fm;
  try {
    fm = parseFrontMatterFile(taskFile);
  } catch (err) {
    throw new CliError(`Task '${task.id}' has invalid front matter in ${task.file}: ${err.message}`);
  }

  if (fm.id && fm.id !== task.id) {
    throw new CliError(
      `Task file id '${fm.id}' does not match task id '${task.id}' in change.yaml`
    );
  }

  const errors = [];
  const label = `${change._file || change.id}: task '${task.id}'`;
  const ownerDecisionsFile = join(change._dir, 'owner-decisions.md');
  const overviewFile = join(change._dir, 'overview.md');
  const decisionsMap = parseOwnerDecisions(
    existsSync(ownerDecisionsFile) ? readUtf8(ownerDecisionsFile) : ''
  );
  const constraintsMap = parseConstraints(
    existsSync(overviewFile) ? readUtf8(overviewFile) : ''
  );

  validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, label);
  validateContextExceptions(fm, decisionsMap, errors, label);
  validateConsequentialPaths(fm, errors, label);

  if (fm.type !== undefined && fm.type !== 'mechanical') {
    errors.push(`${label}: unrecognized type '${fm.type}' (only 'mechanical' is defined)`);
  }

  if (errors.length > 0) {
    throw new CliError(`Task '${task.id}' definition validation failed:\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Creates a new publish operation record.
 */
function createPublishRecord(changeSlug, taskId, attempt = 1) {
  return {
    operationId: randomUUID(),
    change: changeSlug,
    task: taskId,
    step: 'publish',
    attempt,
    status: 'running',
    operations: PUBLISH_STAGE_IDS.map(id => ({
      id,
      status: id === 'validate' ? 'completed' : 'pending',
    })),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Independent deterministic operation: marks a draft, valid, dependency-clean,
 * not-yet-started task ready for execution (`task.status: approved`), with durable
 * operation record, workspace-writer arbitration, CAS execution, and source control finalization.
 *
 * @param {string} changeSlug
 * @param {string} taskId
 * @param {object} [options]
 * @param {string} [options.activeDir]
 * @param {string} [options.repoRoot]
 * @param {object} [options.sourceControl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: boolean, changeSlug: string, taskId: string, status: string }>}
 */
export function publishTask(changeSlug, taskId, options = {}) {
  const repoRoot = options.repoRoot || ROOT;
  const activeDir = options.activeDir || (options.repoRoot ? join(options.repoRoot, 'specs', 'active') : ACTIVE_DIR);

  // 1. Guard: Spec resolves to deterministic
  const change = requireChange(changeSlug, activeDir);
  const resolvedMode = resolveWorkflowMode(change, options);
  if (resolvedMode.mode !== 'deterministic') {
    throw new CliError(
      `Cannot run deterministic 'workflow task publish' against ${resolvedMode.mode} specification '${changeSlug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }

  // 2. Task exists
  const task = requireTask(change, taskId);

  // Check in-flight operation record BEFORE failing the status check
  let inFlight = null;
  try {
    inFlight = findInFlightOperationRecord(repoRoot, changeSlug, taskId);
  } catch {}
  const isResuming = inFlight && inFlight.step === 'publish' && inFlight.status !== 'failed' && inFlight.status !== 'completed';

  // 3. Task status is draft (or resuming an in-flight publish operation)
  if (!isResuming && task.status !== 'draft') {
    throw new CliError(
      `Task '${taskId}' in change '${changeSlug || change.id}' has status '${task.status}'. Only 'draft' tasks can be published.`
    );
  }

  // 4. Task definition validates
  validateTaskDefinitionForPublish(change, task);

  // 5. depends_on entries all resolve to real tasks in the same change
  const changeTaskIds = new Set(change.tasks.map(t => t.id));
  for (const dep of task.depends_on || []) {
    if (!changeTaskIds.has(dep)) {
      throw new CliError(
        `Task '${task.id}' depends_on unknown task '${dep}' in change '${changeSlug || change.id}'`
      );
    }
    if (dep === task.id) {
      throw new CliError(`Task '${task.id}' cannot depend on itself`);
    }
  }

  // 6. No workflow_progress exists yet for this task
  if (task.workflow_progress) {
    throw new CliError(
      `Task '${task.id}' has already started (workflow_progress is present). Cannot publish.`
    );
  }

  const runAsync = async () => {
    // Resolve source control configuration
    let sourceControl = { enabled: false, push: false };
    if (options.sourceControl !== undefined) {
      sourceControl = options.sourceControl;
    } else if (change.workflow?.definition) {
      try {
        const def = loadWorkflowDefinition(change.workflow.definition, { repoRoot });
        if (def?.sourceControl) {
          sourceControl = def.sourceControl;
        }
      } catch {}
    }

    // Step 1: Write durable operation record FIRST (D91)
    let record;
    let recordPath;
    let requestId;
    if (inFlight && inFlight.step === 'publish') {
      record = inFlight;
      recordPath = operationFilePath(repoRoot, changeSlug, taskId, 'publish', record.attempt);
      requestId = record.requestId || randomUUID();
      record.requestId = requestId;
    } else {
      record = createPublishRecord(changeSlug, taskId, 1);
      requestId = randomUUID();
      record.requestId = requestId;
      recordPath = operationFilePath(repoRoot, changeSlug, taskId, 'publish', 1);
      saveOperationRecord(repoRoot, record);
    }

    // Step 2: Create paired workspace-request with status: 'queued' (D72, D81, D91)
    await createWorkspaceRequest({
      repoRoot,
      requestId,
      kind: 'publish',
      specId: change.id || changeSlug,
      taskId,
      operationRef: recordPath,
    });

    // Step 3: Claim workspace-writer slot (D55, D64, D65, D82)
    let acquireRes = await acquireWorkspaceWriter({
      repoRoot,
      kind: 'publish',
      requestId,
      operationRef: recordPath,
      specId: change.id || changeSlug,
      changeSlug,
      taskId,
      timeoutMs: options.timeoutMs || 15000,
    });

    if (acquireRes.blocked) {
      await transitionWorkspaceRequest({
        repoRoot,
        requestId,
        expectedStatus: ['queued', 'waiting-for-workspace'],
        to: 'blocked-by-recovery',
      });
      return {
        ok: false,
        blockedByRecovery: true,
        reason: 'recovery-required',
        currentClaim: acquireRes.currentClaim,
      };
    }

    while (!acquireRes.acquired) {
      await transitionWorkspaceRequest({
        repoRoot,
        requestId,
        expectedStatus: ['queued', 'waiting-for-workspace'],
        to: 'waiting-for-workspace',
      });

      if (options.retry === false) break;

      acquireRes = await acquireWorkspaceWriter({
        repoRoot,
        kind: 'publish',
        requestId,
        operationRef: recordPath,
        specId: change.id || changeSlug,
        changeSlug,
        taskId,
        timeoutMs: options.timeoutMs || 15000,
      });

      if (acquireRes.blocked) {
        await transitionWorkspaceRequest({
          repoRoot,
          requestId,
          expectedStatus: ['queued', 'waiting-for-workspace'],
          to: 'blocked-by-recovery',
        });
        return {
          ok: false,
          blockedByRecovery: true,
          reason: 'recovery-required',
          currentClaim: acquireRes.currentClaim,
        };
      }
    }

    if (!acquireRes.acquired) {
      throw new WorkflowError('Failed to acquire workspace-writer slot: contended');
    }

    const workspaceOwnerId = acquireRes.ownerId;

    // Step 4: CAS promotion of request to 'running' (D83)
    const casRes = await transitionWorkspaceRequest({
      repoRoot,
      requestId,
      expectedStatus: ['queued', 'waiting-for-workspace'],
      to: 'running',
      workspaceOwnerId,
    });

    if (!casRes.transitioned) {
      // Failed CAS: release claim and do not run
      await releaseWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: workspaceOwnerId,
        expectedKind: 'publish',
        expectedRequestId: requestId,
      });
      return {
        ok: false,
        reason: 'state-conflict',
        currentStatus: casRes.currentStatus,
      };
    }

    try {
      // Step 5: Git-finalize lock around mutate-then-commit (D47, D50, D68)
      await withGitFinalizeLock(async () => {
        // Stage update-task
        const updateStage = record.operations.find(s => s.id === 'update-task');
        if (updateStage.status !== 'completed') {
          updateStage.status = 'running';
          saveOperationRecord(repoRoot, record);

          setTaskStatus(change, taskId, 'approved');
          task.status = 'approved';

          updateStage.status = 'completed';
          saveOperationRecord(repoRoot, record);
        }

        // Stage commit
        const commitStage = record.operations.find(s => s.id === 'commit');
        if (commitStage.status !== 'completed') {
          if (sourceControl.enabled) {
            commitStage.status = 'running';
            saveOperationRecord(repoRoot, record);

            const commitMessage = `chore(workflow): publish ${taskId}`;
            await addAndCommitAsync(repoRoot, [change._file], commitMessage);

            commitStage.status = 'completed';
            saveOperationRecord(repoRoot, record);
          } else {
            commitStage.status = 'completed';
            commitStage.result = { skipped: true };
            saveOperationRecord(repoRoot, record);
          }
        }
      }, { repoRoot });

      // Step 6: Push (if enabled and configured, outside git finalize lock, inside workspace-writer claim, D68)
      const pushStage = record.operations.find(s => s.id === 'push');
      if (pushStage.status !== 'completed') {
        if (sourceControl.enabled && sourceControl.push) {
          pushStage.status = 'running';
          saveOperationRecord(repoRoot, record);

          const branch = await getCurrentBranchAsync(repoRoot);
          await pushAsync(repoRoot, branch);

          pushStage.status = 'completed';
          saveOperationRecord(repoRoot, record);
        } else {
          pushStage.status = 'completed';
          pushStage.result = { skipped: true };
          saveOperationRecord(repoRoot, record);
        }
      }

      // Step 7: Mark durable record completed
      record.status = 'completed';
      saveOperationRecord(repoRoot, record);

      // Step 8: Mark workspace-request completed
      await transitionWorkspaceRequest({
        repoRoot,
        requestId,
        expectedStatus: 'running',
        to: 'completed',
      });

      return {
        ok: true,
        changeSlug: change.id || changeSlug,
        taskId: task.id,
        status: 'approved',
        requestId,
        workspaceOwnerId,
      };
    } catch (err) {
      record.status = 'failed';
      record.error = err.message;
      saveOperationRecord(repoRoot, record);

      await transitionWorkspaceRequest({
        repoRoot,
        requestId,
        expectedStatus: 'running',
        to: 'failed',
      });
      throw err;
    } finally {
      // Step 9: Ownership-conditional release of workspace-writer claim (D68, D70)
      await releaseWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: workspaceOwnerId,
        expectedKind: 'publish',
        expectedRequestId: requestId,
      });
    }
  };

  const promise = runAsync();
  promise.ok = true;
  promise.changeSlug = change.id || changeSlug;
  promise.taskId = task.id;
  promise.status = 'approved';
  return promise;
}
