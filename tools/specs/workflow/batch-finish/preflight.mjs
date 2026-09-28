// Non-mutating in-memory batch-finish prevalidation (Task 04, D21, D22, D23, D29, D30, D39).
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as git from '../../../lib/git.mjs';
import { WorkflowError } from '../errors.mjs';
import { getWorkspaceWriterClaim } from '../workspace-writer.mjs';
import { getGroupReservation } from '../queue/reservation.mjs';
import { loadBatchStartRecord } from '../batch-start/record.mjs';
import { requireChange, requireTask, ACTIVE_DIR } from '../../store.mjs';
import { resolveWorkflowPosition } from '../step-runner.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

function computeFileHash(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const st = fs.statSync(filePath);
      if (st.isFile()) {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
      }
    }
  } catch {}
  return null;
}

function getFileMode(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return (fs.statSync(filePath).mode & 0o777).toString(8);
    }
  } catch {}
  return null;
}

/**
 * Computes deterministic workspace delta fingerprint relative to HEAD,
 * excluding `.nevo-ai-local/**` and optionally `excludePath` (D29, D39).
 *
 * @param {string} repoRoot
 * @param {object} [options]
 * @param {string} [options.excludePath]
 * @returns {Array<{ path: string, status: string, mode: string|null, hash: string|null }>}
 */
export function computeDeltaFingerprint(repoRoot, { excludePath = null } = {}) {
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) {
    return [];
  }

  let rawStatus = '';
  try {
    rawStatus = git.getWorkingTreeStatus(repoRoot);
  } catch {
    return [];
  }

  if (!rawStatus) return [];

  const lines = rawStatus.split(/\r?\n/).filter(line => line.trim().length > 0);
  const entries = [];
  const normalizedExclude = excludePath ? excludePath.replace(/\\/g, '/').replace(/^\/+/, '') : null;

function listFilesRecursive(dir, repoRoot) {
  const files = [];
  try {
    const dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFilesRecursive(full, repoRoot));
      } else {
        files.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
      }
    }
  } catch {}
  return files;
}

  for (const line of lines) {
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ')[1].trim();
    }
    filePath = filePath.replace(/^"|"$/g, '').replace(/\\/g, '/');

    if (filePath === '.nevo-ai-local' || filePath.startsWith('.nevo-ai-local/')) {
      continue;
    }

    if (normalizedExclude && filePath === normalizedExclude) {
      continue;
    }

    const fullPath = path.join(repoRoot, filePath);

    // If an untracked directory exists solely to hold the excluded canonical report file, exclude it
    if (normalizedExclude && (filePath.endsWith('/') || (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()))) {
      const dirPrefix = filePath.endsWith('/') ? filePath : `${filePath}/`;
      if (normalizedExclude.startsWith(dirPrefix)) {
        const remaining = listFilesRecursive(fullPath, repoRoot).filter(p => p !== normalizedExclude);
        if (remaining.length === 0) {
          continue;
        }
      }
    }

    const hash = computeFileHash(fullPath);
    const mode = getFileMode(fullPath);

    entries.push({
      path: filePath,
      status: status.trim(),
      mode,
      hash,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export function fingerprintsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const entryA = a[i];
    const entryB = b[i];
    if (
      entryA.path !== entryB.path ||
      entryA.status !== entryB.status ||
      entryA.mode !== entryB.mode ||
      entryA.hash !== entryB.hash
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Loads a persisted session record from `.nevo-ai-local/sessions/<specId>.json` via pure fs.
 * Strict zero-dashboard import boundary (C2, D16).
 *
 * @param {string} repoRoot
 * @param {string} specId
 * @param {string} sessionId
 * @returns {object|null}
 */
export function loadPersistedSessionSync(repoRoot, specId, sessionId) {
  if (!repoRoot || !specId || !sessionId) return null;
  const filePath = path.join(repoRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed) ? parsed : (parsed?.sessions || []);
    return sessions.find(s => s.sessionId === sessionId || s.providerSessionId === sessionId) || null;
  } catch {
    return null;
  }
}

/**
 * Stage 0: Trusted ambient identity and authorization check (D23).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.specId
 * @param {string} params.batchExecutionId
 * @param {string} [params.sessionId]
 * @param {string[]} params.taskIds
 * @param {object} params.reservation
 * @returns {{ effectiveSessionId: string }}
 */
export function verifyTrustedIdentity(params = {}) {
  const {
    repoRoot,
    changeSlug,
    specId,
    batchExecutionId,
    sessionId: explicitSessionId,
    taskIds,
    reservation,
  } = params;

  const effectiveSessionId = explicitSessionId || process.env.NEVO_SESSION_ID?.trim() || null;
  if (!effectiveSessionId) {
    throw new WorkflowError(
      'No trusted session identity found for batch finish authorization',
      { code: 'BATCH_IDENTITY_MISMATCH' }
    );
  }

  // 1. Live workspace-writer claim verification
  const claim = getWorkspaceWriterClaim(repoRoot);
  if (!claim) {
    throw new WorkflowError(
      'No active workspace-writer claim found; cannot authorize batch finish',
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'missing-claim' }
    );
  }

  if (claim.sessionId && claim.sessionId !== effectiveSessionId) {
    throw new WorkflowError(
      `Workspace-writer claim session '${claim.sessionId}' does not match caller session '${effectiveSessionId}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'claim-session-mismatch' }
    );
  }

  if (!claim.sessionId && claim.kind === 'agent') {
    throw new WorkflowError(
      'Workspace-writer claim is missing sessionId',
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'claim-missing-session' }
    );
  }

  if (claim.scope?.kind !== 'task-batch') {
    throw new WorkflowError(
      `Workspace-writer claim scope kind is '${claim.scope?.kind}', expected 'task-batch'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'claim-scope-mismatch' }
    );
  }

  if (claim.batchExecutionId && claim.batchExecutionId !== batchExecutionId) {
    throw new WorkflowError(
      `Workspace-writer claim batchExecutionId '${claim.batchExecutionId}' does not match '${batchExecutionId}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'claim-batch-id-mismatch' }
    );
  }

  if (Array.isArray(claim.scope?.taskIds) && taskIds && !arraysEqual(claim.scope.taskIds, taskIds)) {
    throw new WorkflowError(
      'Workspace-writer claim taskIds do not match batch taskIds',
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'claim-task-ids-mismatch' }
    );
  }

  // 2. Reservation verification
  if (!reservation) {
    throw new WorkflowError(
      `Reservation '${batchExecutionId}' not found for change '${changeSlug}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'reservation-not-found' }
    );
  }

  if (reservation.status !== 'reserved') {
    throw new WorkflowError(
      `Reservation '${batchExecutionId}' is not active (status: ${reservation.status})`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'reservation-not-active' }
    );
  }

  if (reservation.batchExecutionId !== batchExecutionId) {
    throw new WorkflowError(
      `Reservation batchExecutionId '${reservation.batchExecutionId}' does not match '${batchExecutionId}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'reservation-batch-id-mismatch' }
    );
  }

  if (reservation.sessionId && reservation.sessionId !== effectiveSessionId) {
    throw new WorkflowError(
      `Reservation session '${reservation.sessionId}' does not match caller session '${effectiveSessionId}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'reservation-session-mismatch' }
    );
  }

  if (taskIds && !arraysEqual(reservation.taskIds, taskIds)) {
    throw new WorkflowError(
      'Reservation taskIds do not match batch taskIds',
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'reservation-task-ids-mismatch' }
    );
  }

  // 3. Persisted AgentSession verification
  const session = loadPersistedSessionSync(repoRoot, specId, effectiveSessionId);
  if (!session) {
    throw new WorkflowError(
      `Persisted AgentSession for '${effectiveSessionId}' not found`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'session-not-found' }
    );
  }

  if (session.batchExecutionId && session.batchExecutionId !== batchExecutionId) {
    throw new WorkflowError(
      `Persisted session batchExecutionId '${session.batchExecutionId}' does not match '${batchExecutionId}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', reason: 'session-batch-id-mismatch' }
    );
  }

  if (session.executionScope) {
    if (session.executionScope.kind !== 'task-batch') {
      throw new WorkflowError(
        `Persisted session executionScope kind is '${session.executionScope.kind}', expected 'task-batch'`,
        { code: 'BATCH_IDENTITY_MISMATCH', reason: 'session-scope-kind-mismatch' }
      );
    }
    if (session.executionScope.changeSlug && session.executionScope.changeSlug !== changeSlug) {
      throw new WorkflowError(
        `Persisted session changeSlug '${session.executionScope.changeSlug}' does not match '${changeSlug}'`,
        { code: 'BATCH_IDENTITY_MISMATCH', reason: 'session-change-slug-mismatch' }
      );
    }
    if (Array.isArray(session.executionScope.taskIds) && taskIds && !arraysEqual(session.executionScope.taskIds, taskIds)) {
      throw new WorkflowError(
        'Persisted session taskIds do not match batch taskIds',
        { code: 'BATCH_IDENTITY_MISMATCH', reason: 'session-task-ids-mismatch' }
      );
    }
  }

  return { effectiveSessionId };
}

/**
 * Extracts and normalizes per-task inputs from batch finish input payload.
 *
 * @param {object} inputs
 * @param {string[]} taskIds
 * @returns {object} Map of taskId -> { result, feedback, ... }
 */
export function extractTaskResults(inputs = {}, taskIds = []) {
  const extracted = {};
  const rawTasks = inputs.tasks || inputs.results || inputs;

  for (const taskId of taskIds) {
    const rawVal = rawTasks[taskId];
    if (rawVal === undefined) {
      continue;
    }
    if (typeof rawVal === 'string') {
      extracted[taskId] = { result: rawVal };
    } else if (rawVal && typeof rawVal === 'object') {
      extracted[taskId] = { ...rawVal };
    }
  }
  return extracted;
}

/**
 * Stage 1: Pure in-memory prevalidation (D21, D22, D29, D30, D39).
 * Zero control-plane or workflow durable writes occur if this fails.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.activeDir
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string[]} params.taskIds
 * @param {object} params.inputs
 * @param {string} [params.sessionId]
 * @param {object} params.change
 * @param {object} params.definition
 * @param {object} params.reservation
 * @param {boolean} [params.skipProvenanceCheck=false] Used on resume when report commit already landed
 * @returns {{
 *   effectiveSessionId: string,
 *   normalizedResults: object,
 *   canonicalReportPath: string,
 *   crossTaskFindings: any[]
 * }}
 */
export function prevalidateBatchFinish(params = {}) {
  const {
    repoRoot,
    activeDir = ACTIVE_DIR,
    changeSlug,
    batchExecutionId,
    taskIds = [],
    inputs = {},
    sessionId,
    change,
    definition,
    reservation,
    skipProvenanceCheck = false,
  } = params;

  const specId = change.id || change._slug || changeSlug;

  // Stage 0: Trusted Identity Verification (D23)
  const { effectiveSessionId } = verifyTrustedIdentity({
    repoRoot,
    changeSlug,
    specId,
    batchExecutionId,
    sessionId,
    taskIds,
    reservation,
  });

  // Check 1: Scope match against reservation
  if (!arraysEqual(taskIds, reservation.taskIds)) {
    throw new WorkflowError(
      `Supplied taskIds do not match reserved batch execution scope: expected [${reservation.taskIds.join(', ')}], got [${taskIds.join(', ')}]`,
      { code: 'EXECUTION_SCOPE_MISMATCH', expected: reservation.taskIds, actual: taskIds }
    );
  }

  // Check 2: Results supplied for every task and valid against finishContract
  const rawTasks = inputs.tasks || inputs.results || inputs;
  const normalizedResults = extractTaskResults(inputs, taskIds);

  // Check for foreign task submissions outside reserved scope
  const nonTaskKeys = new Set(['tasks', 'results', 'reportPath', 'report', 'crossTaskFindings', 'sessionId']);
  if (rawTasks && typeof rawTasks === 'object') {
    for (const key of Object.keys(rawTasks)) {
      if (!nonTaskKeys.has(key) && !taskIds.includes(key)) {
        throw new WorkflowError(
          `Unexpected task '${key}' in finish inputs is outside reserved batch scope`,
          { code: 'EXECUTION_SCOPE_MISMATCH', unexpectedTaskId: key }
        );
      }
    }
  }

  for (const taskId of taskIds) {
    const taskResult = normalizedResults[taskId];
    if (!taskResult || taskResult.result === undefined || taskResult.result === null) {
      throw new WorkflowError(
        `Missing result for batch member task '${taskId}'`,
        { code: 'BATCH_RESULT_INVALID', taskId }
      );
    }

    const task = requireTask(change, taskId);
    const position = resolveWorkflowPosition(definition, task);
    const stepName = position?.step || (position?.phase === 'new' ? definition.entryStep : position?.nextStep);
    const step = definition.steps?.[stepName];

    if (!step) {
      throw new WorkflowError(
        `Step '${stepName}' not found in definition for task '${taskId}'`,
        { code: 'INVALID_STEP', taskId, stepName }
      );
    }

    const transitions = step.transitions || [];
    const isConditional = transitions.length > 1 || (transitions.length === 1 && transitions[0].value !== undefined);
    if (isConditional) {
      const allowedValues = transitions.map(t => t.value);
      const matched = transitions.find(t => t.value === taskResult.result);
      if (!matched) {
        const err = new WorkflowError(
          `Task '${taskId}' submitted invalid result '${taskResult.result}'. Expected one of: [${allowedValues.join(', ')}]`,
          { code: 'BATCH_RESULT_INVALID', taskId, submittedValue: taskResult.result, allowedValues }
        );
        err.taskId = taskId;
        throw err;
      }
    }
  }

  // Check 3: Canonical report presence on disk
  const canonicalReportPath = (inputs.reportPath || inputs.report || `reviews/review-batch-${batchExecutionId}.md`)
    .replace(/\\/g, '/');
  const fullReportPath = path.join(repoRoot, canonicalReportPath);
  if (!fs.existsSync(fullReportPath)) {
    throw new WorkflowError(
      `Canonical batch review report file does not exist at '${canonicalReportPath}'`,
      { code: 'BATCH_REPORT_MISSING', reportPath: canonicalReportPath }
    );
  }

  // Check 4: Read-only Git provenance against post-bootstrap workspace baseline (D29, D39)
  if (!skipProvenanceCheck && fs.existsSync(path.join(repoRoot, '.git'))) {
    const startRecord = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
    if (!startRecord?.workspaceBaseline) {
      throw new WorkflowError(
        `Missing post-bootstrap workspace baseline for batch '${batchExecutionId}'`,
        { code: 'BATCH_BASELINE_NOT_FOUND', batchExecutionId }
      );
    }

    const currentHead = git.getCurrentRevision(repoRoot);
    const baselineRevision = startRecord.workspaceBaseline.baseRevision;
    if (baselineRevision && currentHead !== baselineRevision) {
      throw new WorkflowError(
        `Git HEAD (${currentHead}) has diverged from post-bootstrap baseline (${baselineRevision})`,
        { code: 'BATCH_PROVENANCE_VIOLATION', currentHead, baselineRevision }
      );
    }

    const currentFingerprint = computeDeltaFingerprint(repoRoot, { excludePath: canonicalReportPath });
    const baselineFingerprint = startRecord.workspaceBaseline.fingerprint || [];

    if (!fingerprintsEqual(currentFingerprint, baselineFingerprint)) {
      throw new WorkflowError(
        `Workspace delta diverged from post-bootstrap baseline outside canonical report path.\nCurrent: ${JSON.stringify(currentFingerprint)}\nBaseline: ${JSON.stringify(baselineFingerprint)}`,
        { code: 'BATCH_PROVENANCE_VIOLATION', currentFingerprint, baselineFingerprint }
      );
    }
  }

  const crossTaskFindings = Array.isArray(inputs.crossTaskFindings) ? inputs.crossTaskFindings : [];

  return {
    effectiveSessionId,
    normalizedResults,
    canonicalReportPath,
    crossTaskFindings,
  };
}
