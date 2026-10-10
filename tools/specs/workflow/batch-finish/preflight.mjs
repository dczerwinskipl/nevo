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
import { renderBatchReport, getCanonicalBatchReportRelativePath } from '../../reviews/batch-report.mjs';
import { verifyBatchTrustedIdentity } from '../execution-identity.mjs';
import { resolveStableSpecId } from '../../identity.mjs';
import { resolveTaskScope, loadTaskFrontMatter } from '../../context.mjs';
import { pathMatchesAllowedPattern } from '../../lifecycle/recovery.mjs';
import { normalizeSourceControlConfig } from '../definitions/schema.mjs';
export { loadPersistedSessionSync } from '../execution-identity.mjs';

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
export function computeDeltaFingerprint(repoRoot, { excludePath = null, excludePaths = [] } = {}) {
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
  const normalizedExcludes = [excludePath, ...excludePaths]
    .filter(Boolean)
    .map(p => p.replace(/\\/g, '/').replace(/^\/+/, ''));

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

    // Exclusion patterns may be exact paths (e.g. the canonical report path) or globs
    // (e.g. a member task's own `allowed_paths`/`consequential_paths`, batch-execution-
    // generalization task 03) — matched the same way the rest of this workflow matches
    // scope patterns (`pathMatchesAllowedPattern`), never a second, narrower matcher.
    if (normalizedExcludes.some(ex => pathMatchesAllowedPattern(filePath, ex))) {
      continue;
    }

    const fullPath = path.join(repoRoot, filePath);

    // If an untracked directory exists solely to hold excluded path(s), exclude it
    if (filePath.endsWith('/') || (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory())) {
      const dirPrefix = filePath.endsWith('/') ? filePath : `${filePath}/`;
      if (normalizedExcludes.some(ex => ex.startsWith(dirPrefix) || pathMatchesAllowedPattern(dirPrefix, ex))) {
        const remaining = listFilesRecursive(fullPath, repoRoot).filter(
          p => !normalizedExcludes.some(ex => pathMatchesAllowedPattern(p, ex))
        );
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
  try {
    return verifyBatchTrustedIdentity({
      ...params,
      getClaim: getWorkspaceWriterClaim,
    });
  } catch (err) {
    if (err instanceof WorkflowError) throw err;
    throw new WorkflowError(err.message, { code: err.code || 'BATCH_IDENTITY_MISMATCH', reason: err.reason });
  }
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
      extracted[taskId] = {
        ...rawVal,
        result: rawVal.result !== undefined ? rawVal.result : rawVal.value,
      };
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

  const specId = resolveStableSpecId(change);

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
  const nonTaskKeys = new Set(['tasks', 'results', 'reportPath', 'report', 'crossTaskFindings', 'sessionId', 'commit.title', 'commit.message']);
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

  // Validate each member against *its own* canonical contract — batch-execution-
  // generalization, task 03, Gap 5: `result` is required only when that member's own
  // target step is conditional (per the same `isConditional` test `buildFinishContract`
  // uses); an unconditional step (e.g. `implementation`) neither requires one nor
  // silently accepts one it doesn't expect.
  const memberTaskScopes = {};
  for (const taskId of taskIds) {
    const taskResult = normalizedResults[taskId];

    const task = requireTask(change, taskId);
    memberTaskScopes[taskId] = task;
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
      if (!taskResult || taskResult.result === undefined || taskResult.result === null) {
        throw new WorkflowError(
          `Missing result for batch member task '${taskId}'`,
          { code: 'BATCH_RESULT_INVALID', taskId }
        );
      }
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
    } else if (taskResult && taskResult.result !== undefined && taskResult.result !== null) {
      throw new WorkflowError(
        `Task '${taskId}' submitted result '${taskResult.result}' for unconditional step '${stepName}', which does not expect one`,
        { code: 'BATCH_RESULT_INVALID', taskId, submittedValue: taskResult.result }
      );
    }
  }

  // Check 2.5: Shared batch-finalize commit contract (Gap 5) — one shared
  // commit.title/commit.message for the whole batch, supplied once, never once per
  // member (batch-execution-generalization, task 03). Only required when source
  // control is actually enabled for this workflow — a disabled workflow never commits
  // anything, so requiring this would be pointless friction.
  const sourceControlConfig = normalizeSourceControlConfig(definition.sourceControl);
  if (sourceControlConfig.enabled) {
    const sharedCommitTitle = typeof inputs['commit.title'] === 'string' ? inputs['commit.title'].trim() : '';
    if (!sharedCommitTitle || sharedCommitTitle.length < 5) {
      throw new WorkflowError(
        `Missing or invalid shared commit.title for batch finish '${batchExecutionId}' (must be a non-empty string, minimum length 5)`,
        { code: 'BATCH_RESULT_INVALID' }
      );
    }
  }

  // Check 3: Authoritative canonical report relative path (Item 7)
  const canonicalReportPath = getCanonicalBatchReportRelativePath(changeSlug, batchExecutionId).replace(/\\/g, '/');

  // Check 4: Read-only Git provenance against post-bootstrap workspace baseline (D29, D39, Item 8)
  // Strictly non-mutating: zero file or directory writes before this check succeeds.
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

    // Widen the excluded set from "only the canonical review report" to every member's
    // own declared scope (allowed_paths/consequential_paths, unioned) — batch-execution-
    // generalization, task 03, Gap 2: an implementation/refinement batch's real source
    // changes, inside the scope each member already declared, must not trip this check.
    // Anything outside every member's own scope still must match the baseline exactly.
    const scopePatterns = new Set();
    for (const taskId of taskIds) {
      const task = memberTaskScopes[taskId] || requireTask(change, taskId);
      const { allowedPaths } = resolveTaskScope(change, task, { repoRoot, activeDir });
      for (const p of allowedPaths) scopePatterns.add(p);
      const taskFm = loadTaskFrontMatter(change, task, { repoRoot, activeDir });
      for (const p of (taskFm.consequential_paths || [])) scopePatterns.add(p);
    }
    const excludePatterns = [canonicalReportPath, ...scopePatterns];

    const currentFingerprint = computeDeltaFingerprint(repoRoot, {
      excludePaths: excludePatterns,
    });
    const baselineFingerprint = (startRecord.workspaceBaseline.fingerprint || []).filter(
      (entry) => !excludePatterns.some((ex) => pathMatchesAllowedPattern(entry.path, ex))
    );

    if (!fingerprintsEqual(currentFingerprint, baselineFingerprint)) {
      throw new WorkflowError(
        `Workspace delta diverged from post-bootstrap baseline outside every member's own declared scope.\nCurrent: ${JSON.stringify(currentFingerprint)}\nBaseline: ${JSON.stringify(baselineFingerprint)}`,
        { code: 'BATCH_PROVENANCE_VIOLATION', currentFingerprint, baselineFingerprint }
      );
    }
  }

  // Check 5: Validate cross-task findings (D11, Item 8)
  const rawFindings = inputs.crossTaskFindings;
  let crossTaskFindings = [];
  if (rawFindings !== undefined && rawFindings !== null) {
    if (!Array.isArray(rawFindings)) {
      throw new WorkflowError(
        'inputs.crossTaskFindings must be an array of findings',
        { code: 'BATCH_RESULT_INVALID' }
      );
    }
    crossTaskFindings = rawFindings.map((finding, idx) => {
      if (!finding || typeof finding !== 'object') {
        throw new WorkflowError(
          `Cross-task finding at index ${idx} must be an object`,
          { code: 'BATCH_RESULT_INVALID', index: idx }
        );
      }
      const rawAffected = finding.affectedTaskIds ?? finding.tasks ?? finding.taskIds;
      if (rawAffected !== undefined && rawAffected !== null) {
        if (!Array.isArray(rawAffected)) {
          throw new WorkflowError(
            `Cross-task finding at index ${idx} has invalid affectedTaskIds: must be an array of strings`,
            { code: 'BATCH_RESULT_INVALID', index: idx, finding }
          );
        }
        for (const tid of rawAffected) {
          if (typeof tid !== 'string' || !taskIds.includes(tid)) {
            throw new WorkflowError(
              `Cross-task finding at index ${idx} references task '${tid}' outside reserved batch scope [${taskIds.join(', ')}]`,
              { code: 'EXECUTION_SCOPE_MISMATCH', unexpectedTaskId: tid, validTaskIds: taskIds }
            );
          }
        }
      }
      return {
        ...finding,
        affectedTaskIds: Array.isArray(rawAffected) ? rawAffected : [],
      };
    });
  }

  return {
    effectiveSessionId,
    normalizedResults,
    canonicalReportPath,
    crossTaskFindings,
  };
}
