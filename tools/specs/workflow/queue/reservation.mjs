// Durable batch group reservation and canonical action barrier (Task 02, D5, D6, D18, D19, D20, D31, D36, D37, D38).
// Pure workflow domain logic: zero dashboard imports.
// Storage: dedicated `.nevo-ai-local/batch-reservations/<changeSlug>.json` file, owned
// entirely by this module (no dependency on the plain-queue store, which this change
// removes — batch-execution-generalization, task 01).

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { WorkflowError } from '../errors.mjs';
import { evaluateBaseExecutionReadiness } from '../readiness-policy.mjs';
import { resolveIncomingExecution } from '../resolve-incoming-execution.mjs';
import { withWorkspaceControlLock } from '../workspace-writer.mjs';
import { findInFlightOperationRecord } from '../operation-record.mjs';
import { findInFlightStartOperation } from '../start-operation.mjs';
import { requireChange, requireTask } from '../../store.mjs';
import { resolveTaskScope, resolveWorkflowOwnedPaths } from '../step-context.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import * as git from '../../../lib/git.mjs';

function getReservationDir(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'batch-reservations');
}

function getReservationFilePath(repoRoot, changeSlug) {
  return path.join(getReservationDir(repoRoot), `${changeSlug}.json`);
}

function loadReservationRecord(repoRoot, changeSlug) {
  if (!repoRoot || !changeSlug) {
    throw new WorkflowError('loadReservationRecord requires repoRoot and changeSlug');
  }
  const filePath = getReservationFilePath(repoRoot, changeSlug);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.groupReservations)) {
      parsed.groupReservations = [];
    }
    return parsed;
  } catch (err) {
    throw new WorkflowError(`Failed to load batch reservation record from ${filePath}: ${err.message}`, {
      code: 'BATCH_RESERVATION_LOAD_FAILED',
      cause: err,
    });
  }
}

function saveReservationRecord(repoRoot, changeSlug, record) {
  if (!repoRoot || !changeSlug) {
    throw new WorkflowError('saveReservationRecord requires repoRoot and changeSlug');
  }

  const dir = getReservationDir(repoRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const toPersist = {
    changeSlug,
    groupReservations: Array.isArray(record?.groupReservations) ? record.groupReservations : [],
    updatedAt: new Date().toISOString(),
  };

  const targetPath = getReservationFilePath(repoRoot, changeSlug);
  const tempPath = path.join(dir, `${changeSlug}.${randomUUID()}.tmp`);

  fs.writeFileSync(tempPath, JSON.stringify(toPersist, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    // Windows atomic replacement fallback
    if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EBUSY') {
      try {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);
      } catch (retryErr) {
        try { fs.unlinkSync(tempPath); } catch {}
        throw retryErr;
      }
    } else {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  return toPersist;
}

function matchesFilePattern(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (normalizedPattern === '*' || normalizedPattern === '**') return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalized.startsWith(`${prefix}/`) && !normalized.slice(prefix.length + 1).includes('/');
  }
  return normalized === normalizedPattern;
}

function expandDirtyPaths(repoRoot, paths) {
  const result = [];
  for (const p of paths) {
    const full = path.join(repoRoot, p);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const child = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(child);
            } else {
              result.push(path.relative(repoRoot, child).replace(/\\/g, '/'));
            }
          }
        };
        walk(full);
      } else {
        result.push(p.replace(/\\/g, '/'));
      }
    } catch {
      result.push(p.replace(/\\/g, '/'));
    }
  }
  return result;
}

/**
 * Validates batch compatibility across a candidate set of tasks (D5, D6, D20).
 *
 * Strict compatibility criteria:
 * 1. Set size >= 2
 * 2. Same change (spec_id / slug)
 * 3. Same target workflow step (e.g. 'review')
 * 4. Same authoritative incoming-transition role (executor: 'agent', role e.g. 'reviewer')
 * 5. All members individually eligible and runnable (no unsatisfied dependencies or gate suspensions)
 * 6. All members require 'session: fresh' semantics in v1
 *
 * @param {object} params
 * @param {object} params.change
 * @param {object[]} [params.tasks]
 * @param {string[]} params.taskIds
 * @param {object} [params.definition]
 * @param {string} [params.repoRoot]
 * @returns {{ compatible: boolean, reason?: string, incompatibleTaskId?: string, targetStepId?: string, role?: string, session?: string, taskIds?: string[] }}
 */
export function validateBatchCompatibility(params = {}) {
  const { change, tasks = change?.tasks || [], taskIds = [], definition, repoRoot } = params;

  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    return {
      compatible: false,
      reason: `Batch selection requires at least 2 tasks (got ${Array.isArray(taskIds) ? taskIds.length : 0})`,
    };
  }

  if (!change) {
    return {
      compatible: false,
      reason: 'Change specification is required for batch compatibility validation',
    };
  }

  let targetStepId = null;
  let targetRole = null;
  let targetRoleEstablished = false;

  for (const taskId of taskIds) {
    const task = tasks.find((t) => t.id === taskId || t.file?.endsWith(`/${taskId}.md`) || t.file?.endsWith(`\\${taskId}.md`));
    if (!task) {
      return {
        compatible: false,
        reason: `Task '${taskId}' not found in change '${change.id || change._slug}'`,
        incompatibleTaskId: taskId,
      };
    }

    // 4. Individually eligible and runnable per base readiness — with the in-batch-
    // dependency exception (batch-execution-generalization, task 02, Gap 1): a member
    // blocked only by another member of this same candidate batch is a same-batch
    // ordering constraint, not a compatibility failure. A dependency unsatisfied by a
    // task outside the batch still fails exactly as before.
    const readiness = evaluateBaseExecutionReadiness(task, change, 'agent', { definition, repoRoot });
    const blockedOnlyByBatchMembers = !readiness.ready
      && readiness.code === 'DEPENDENCY_UNSATISFIED'
      && Array.isArray(readiness.blockedBy)
      && readiness.blockedBy.length > 0
      && readiness.blockedBy.every((depId) => taskIds.includes(depId));

    if (!readiness.ready && !blockedOnlyByBatchMembers) {
      return {
        compatible: false,
        reason: `Task '${taskId}' is not eligible: ${readiness.reason}`,
        incompatibleTaskId: taskId,
        readiness,
      };
    }

    // A dependency-blocked task's canonical next step is populated identically whether
    // or not it is currently blocked (task-projection.mjs) — use it directly when the
    // ordinary readiness result carries no targetStep of its own.
    const stepId = readiness.targetStep?.id || readiness.projection?.nextStep?.id || readiness.projection?.currentStep;
    if (!targetStepId) {
      targetStepId = stepId;
    } else if (targetStepId !== stepId) {
      return {
        compatible: false,
        reason: `Target step mismatch: task '${taskId}' targets '${stepId}', but previous tasks target '${targetStepId}'`,
        incompatibleTaskId: taskId,
      };
    }

    // Target step must define executor: 'agent'
    const executor = readiness.targetStep?.executor || readiness.projection?.nextStep?.executor || 'agent';
    if (executor !== 'agent') {
      return {
        compatible: false,
        reason: `Target step '${stepId}' executor is '${executor}', not 'agent'`,
        incompatibleTaskId: taskId,
      };
    }

    // 3 & 5. Incoming transition resolution via shared resolver (D20)
    if (definition) {
      const history = task?.workflow_progress?.history || [];
      const incoming = resolveIncomingExecution(task, definition, stepId);
      let role;

      if (!incoming.transition) {
        // An entry-step member (no workflow history at all) has no incoming transition
        // to resolve, by construction — a normal fresh-task case, not a failure. It
        // starts fresh, by construction `session: fresh`, with no declared role to
        // match against (batch-execution-generalization, task 02, Gap 1).
        if (!(incoming.error === 'NO_INCOMING_TRANSITION' && history.length === 0)) {
          return {
            compatible: false,
            reason: `No matching incoming transition found for task '${taskId}' to step '${stepId}' (${incoming.error || incoming.reason})`,
            incompatibleTaskId: taskId,
          };
        }
        role = null;
      } else {
        if (incoming.session !== 'fresh') {
          return {
            compatible: false,
            reason: `Task '${taskId}' incoming transition requires session '${incoming.session}'; batch execution requires session: fresh`,
            incompatibleTaskId: taskId,
          };
        }

        role = incoming.role;
        if (!role) {
          return {
            compatible: false,
            reason: `Authoritative incoming transition for task '${taskId}' does not declare an agent role`,
            incompatibleTaskId: taskId,
          };
        }
      }

      if (!targetRoleEstablished) {
        targetRole = role;
        targetRoleEstablished = true;
      } else if (targetRole !== role) {
        return {
          compatible: false,
          reason: `Incoming role mismatch: task '${taskId}' requires role '${role ?? 'null'}', but previous tasks require '${targetRole ?? 'null'}'`,
          incompatibleTaskId: taskId,
        };
      }
    }
  }

  return {
    compatible: true,
    targetStepId,
    role: targetRole,
    session: 'fresh',
    taskIds: [...taskIds],
  };
}

/**
 * Creates a durable group reservation for a compatible set of tasks (D18, D38).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string[]} params.taskIds
 * @param {object} params.executionConfigSnapshot
 * @param {string} [params.batchExecutionId]
 * @returns {Promise<object>} The created reservation record
 */
export async function createGroupReservation(params = {}) {
  const {
    repoRoot,
    changeSlug,
    taskIds,
    executionConfigSnapshot,
    batchExecutionId = randomUUID(),
  } = params;

  if (!repoRoot || !changeSlug) {
    throw new WorkflowError('createGroupReservation requires repoRoot and changeSlug');
  }

  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    throw new WorkflowError(`createGroupReservation requires at least 2 task IDs (got ${taskIds?.length ?? 0})`);
  }

  const mutate = async () => {
    const record = loadReservationRecord(repoRoot, changeSlug) || {
      changeSlug,
      groupReservations: [],
    };

    record.groupReservations = record.groupReservations || [];

    // Check contention: no member task may already be reserved
    for (const r of record.groupReservations) {
      if (r.status === 'reserved') {
        for (const t of taskIds) {
          if (r.taskIds.includes(t)) {
            throw new WorkflowError(
              `Task '${t}' is already reserved in active batch execution '${r.batchExecutionId}'`,
              { code: 'TASK_ALREADY_RESERVED', taskId: t, batchExecutionId: r.batchExecutionId }
            );
          }
        }
      }
    }

    const reservation = {
      batchExecutionId,
      taskIds: [...taskIds],
      status: 'reserved',
      createdAt: new Date().toISOString(),
      executionConfigSnapshot: {
        provider: executionConfigSnapshot?.provider,
        model: executionConfigSnapshot?.model,
        mode: executionConfigSnapshot?.mode || 'edit',
        contextCapacity: executionConfigSnapshot?.contextCapacity
          ? { ...executionConfigSnapshot.contextCapacity }
          : { status: 'unknown', reason: 'unspecified' },
      },
    };

    record.groupReservations.push(reservation);
    saveReservationRecord(repoRoot, changeSlug, record);
    return reservation;
  };

  if (repoRoot) {
    return await withWorkspaceControlLock(mutate, { repoRoot });
  }

  return await mutate();
}

/**
 * Releases a group reservation (D35).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string} [params.reason]
 * @returns {Promise<{ released: boolean, batchExecutionId: string, reason?: string }>}
 */
export async function releaseGroupReservation(params = {}) {
  const { repoRoot, changeSlug, batchExecutionId, reason } = params;

  if (!repoRoot || !changeSlug || !batchExecutionId) {
    throw new WorkflowError('releaseGroupReservation requires repoRoot, changeSlug, and batchExecutionId');
  }

  const mutate = async () => {
    const record = loadReservationRecord(repoRoot, changeSlug);
    if (!record || !Array.isArray(record.groupReservations)) {
      return { released: false, batchExecutionId, reason: 'RESERVATION_NOT_FOUND' };
    }

    const reservation = record.groupReservations.find(
      (r) => r.batchExecutionId === batchExecutionId && r.status === 'reserved'
    );

    if (!reservation) {
      return { released: false, batchExecutionId, reason: 'RESERVATION_NOT_FOUND' };
    }

    reservation.status = 'released';
    reservation.releasedAt = new Date().toISOString();
    if (reason) {
      reservation.releaseReason = reason;
    }

    saveReservationRecord(repoRoot, changeSlug, record);
    return { released: true, batchExecutionId };
  };

  if (repoRoot) {
    return await withWorkspaceControlLock(mutate, { repoRoot });
  }

  return await mutate();
}

/**
 * Synchronous rollback helper if admission/session creation fails after reservation (D19).
 */
export async function rollbackReservationSynchronously(params = {}) {
  const { repoRoot, changeSlug, batchExecutionId, error } = params;
  return await releaseGroupReservation({
    repoRoot,
    changeSlug,
    batchExecutionId,
    reason: error?.message || 'admission-failed-synchronous-rollback',
  });
}

/**
 * Lists group reservations for a change.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {object} [options]
 * @param {'reserved'|'released'|'all'} [options.status='reserved']
 * @returns {object[]}
 */
export function listGroupReservations(repoRoot, changeSlug, options = {}) {
  if (!repoRoot || !changeSlug) return [];
  const record = loadReservationRecord(repoRoot, changeSlug);
  if (!record || !Array.isArray(record.groupReservations)) return [];
  const statusFilter = options.status || 'reserved';
  if (statusFilter === 'all') {
    return [...record.groupReservations];
  }
  return record.groupReservations.filter((r) => r.status === statusFilter);
}

/**
 * Gets a specific group reservation by ID.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @returns {object|null}
 */
export function getGroupReservation(repoRoot, changeSlug, batchExecutionId) {
  if (!repoRoot || !changeSlug || !batchExecutionId) return null;
  const record = loadReservationRecord(repoRoot, changeSlug);
  if (!record || !Array.isArray(record.groupReservations)) return null;
  return record.groupReservations.find((r) => r.batchExecutionId === batchExecutionId) || null;
}

/**
 * Checks whether a task is barriered by an active group reservation (D31, D37).
 *
 * @param {object|string} changeOrSlug
 * @param {string} taskId
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {object} [options.queueRecord] - Optional pre-loaded reservation record (back-compat field name retained for callers)
 * @returns {boolean}
 */
export function isTaskBarriered(changeOrSlug, taskId, options = {}) {
  if (!changeOrSlug || !taskId) return false;
  const changeSlug = typeof changeOrSlug === 'string' ? changeOrSlug : (changeOrSlug.id || changeOrSlug._slug);
  const repoRoot = options.repoRoot || process.cwd();

  const reservations = options.queueRecord?.groupReservations
    ? options.queueRecord.groupReservations.filter((r) => r.status === 'reserved')
    : listGroupReservations(repoRoot, changeSlug, { status: 'reserved' });

  return reservations.some((r) => Array.isArray(r.taskIds) && r.taskIds.includes(taskId));
}

/**
 * Gets the active reservation holding a barriered task.
 *
 * @param {object|string} changeOrSlug
 * @param {string} taskId
 * @param {object} [options]
 * @returns {object|null}
 */
export function getTaskReservation(changeOrSlug, taskId, options = {}) {
  if (!changeOrSlug || !taskId) return null;
  const changeSlug = typeof changeOrSlug === 'string' ? changeOrSlug : (changeOrSlug.id || changeOrSlug._slug);
  const repoRoot = options.repoRoot || process.cwd();

  const reservations = options.queueRecord?.groupReservations
    ? options.queueRecord.groupReservations.filter((r) => r.status === 'reserved')
    : listGroupReservations(repoRoot, changeSlug, { status: 'reserved' });

  return reservations.find((r) => Array.isArray(r.taskIds) && r.taskIds.includes(taskId)) || null;
}

/**
 * Assesses whether a batch reservation has safely settled across all its member tasks (D19).
 * Scope-aware crash recovery check: verifies every member task rather than trusting any single representative.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string} [params.activeDir]
 * @returns {Promise<{ settled: boolean, reason?: string, details?: any }>}
 */
export async function assessBatchReservationSettlement({ repoRoot, changeSlug, batchExecutionId, activeDir }) {
  if (!repoRoot || !changeSlug || !batchExecutionId) {
    return { settled: false, reason: 'missing-parameters' };
  }

  const reservation = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
  if (!reservation) {
    return { settled: false, reason: 'RESERVATION_NOT_FOUND' };
  }

  const resolvedActiveDir = activeDir || path.join(repoRoot, 'specs', 'active');
  let change;
  try {
    change = requireChange(changeSlug, resolvedActiveDir);
  } catch (err) {
    return { settled: false, reason: `Failed to load change '${changeSlug}': ${err.message}` };
  }

  // Check all member tasks for settlement
  for (const taskId of reservation.taskIds) {
    // 1. In-flight start operation on any member
    const inFlightStart = findInFlightStartOperation(repoRoot, changeSlug, taskId);
    if (inFlightStart) {
      return {
        settled: false,
        reason: 'in-flight-start-operation',
        details: { taskId, startOperation: inFlightStart },
      };
    }

    // 2. In-flight finish operation on any member
    const inFlightFinish = findInFlightOperationRecord(repoRoot, changeSlug, taskId);
    if (inFlightFinish) {
      return {
        settled: false,
        reason: 'in-flight-finish-operation',
        details: { taskId, finishOperation: inFlightFinish },
      };
    }

    // 3. Task workflow progress state active on any member
    let task;
    try {
      task = requireTask(change, taskId);
    } catch (err) {
      return { settled: false, reason: `Failed to load task '${taskId}': ${err.message}` };
    }

    const wp = task.workflow_progress;
    if (wp?.state === 'active') {
      return {
        settled: false,
        reason: 'task-active',
        details: { taskId, step: wp.current_step, attempt: wp.current_attempt },
      };
    }

    // 4. Dirty tracked files in member scope
    let sourceControlEnabled = true;
    if (change.workflow?.definition) {
      try {
        const def = loadWorkflowDefinition(change.workflow.definition, { repoRoot });
        if (def?.sourceControl && def.sourceControl.enabled === false) {
          sourceControlEnabled = false;
        }
      } catch {}
    }

    if (sourceControlEnabled) {
      const rawDirty = git.getDirtyPaths(repoRoot).filter((p) => !p.startsWith('.nevo-ai-local/') && p !== '.nevo-ai-local');
      const dirtyPaths = expandDirtyPaths(repoRoot, rawDirty);
      if (dirtyPaths.length > 0) {
        const { allowedPaths } = resolveTaskScope(change, task, { repoRoot, activeDir: resolvedActiveDir });
        const workflowOwnedPaths = resolveWorkflowOwnedPaths({ repoRoot, changeSlug, activeDir: resolvedActiveDir });
        const ownedScope = [...(allowedPaths || []), ...(workflowOwnedPaths || [])];
        const inScopeDirty = dirtyPaths.filter((p) => ownedScope.some((pat) => matchesFilePattern(p, pat)));
        if (inScopeDirty.length > 0) {
          return {
            settled: false,
            reason: 'dirty-in-scope-files',
            details: { taskId, dirtyPaths: inScopeDirty },
          };
        }
      }
    }
  }

  return { settled: true, batchExecutionId, memberCount: reservation.taskIds.length };
}

/**
 * Reconciles a crashed reservation using the scope-aware settlement check (D19).
 * Never clears without proven settlement across all members.
 */
export async function reconcileCrashedReservation({ repoRoot, changeSlug, batchExecutionId, activeDir }) {
  const settlement = await assessBatchReservationSettlement({ repoRoot, changeSlug, batchExecutionId, activeDir });
  if (settlement.settled) {
    const rel = await releaseGroupReservation({
      repoRoot,
      changeSlug,
      batchExecutionId,
      reason: 'crashed-execution-settled-reconciliation',
    });
    return { reconciled: true, released: rel.released, batchExecutionId };
  }

  return {
    reconciled: false,
    released: false,
    reason: settlement.reason,
    details: settlement.details,
  };
}
