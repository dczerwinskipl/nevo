// Non-mutating finish planning and durable, resumable finish execution behind
// `workflow step finish [--check]` (D11/D14). Fixed finalize stage order
// (`verify-gates -> update-task -> commit -> push -> transition`, D13) executed under a
// durable operation record persisted at
// `.nevo-ai-local/workflow-operations/<change>/<task>.json` — runtime execution state,
// never part of `change.yaml` (D14 correction, C17).

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { requireChange, requireTask, setTaskStatus } from '../store.mjs';
import { normalizeSourceControlConfig } from './definitions/schema.mjs';
import { defaultActionRegistry, defaultGateRegistry } from './registry.mjs';
import { defaultWorkflowEngine } from './engine.mjs';
import { resolveCurrentStepName, inspectGates, verifyGates, allGatesPassed } from './step-runner.mjs';
import { aggregateFinalizeCheck, buildFinishContract, normalizeSourceControlFacts } from './step-context.mjs';
import { WorkflowError, PreconditionError } from './errors.mjs';
import * as git from '../../lib/git.mjs';

export const FINISH_STAGE_IDS = ['verify-gates', 'update-task', 'commit', 'push', 'transition'];

// ── Durable operation record I/O ────────────────────────────────────────────
// Same on-disk convention (git-ignored local runtime directory, atomic
// temp-file-then-rename writes) established by
// `tools/dashboard/server/ai/sessions/binding-service.mjs` — reused as a pattern, not as
// a new code dependency from this module on `tools/dashboard/`.

function operationFilePath(repoRoot, changeSlug, taskId) {
  return join(repoRoot, '.nevo-ai-local', 'workflow-operations', changeSlug, `${taskId}.json`);
}

export function loadOperationRecord(repoRoot, changeSlug, taskId) {
  const file = operationFilePath(repoRoot, changeSlug, taskId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new WorkflowError(`Failed to read finish-operation record at '${file}': ${err.message}`);
  }
}

export function saveOperationRecord(repoRoot, record) {
  const file = operationFilePath(repoRoot, record.change, record.task);
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tempFile, file);
}

function createOperationRecord({ change, task, step, resolvedInputs }) {
  return {
    operationId: randomUUID(),
    change,
    task,
    step,
    status: 'running',
    resolvedInputs,
    operations: FINISH_STAGE_IDS.map(id => ({ id, status: 'pending' })),
  };
}

function findStage(record, id) {
  const stage = record.operations.find(o => o.id === id);
  if (!stage) throw new WorkflowError(`Finish-operation record missing stage '${id}'`);
  return stage;
}

// ── Resolved-inputs persistence and conflict detection (C19) ───────────────

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges caller-supplied finish inputs against an in-flight operation's already-persisted
 * `resolvedInputs`. A conflicting resupply is reported, never silently overwritten;
 * supplying the same value again is a no-op.
 *
 * @param {Record<string, any>|undefined} persisted
 * @param {Record<string, any>} supplied
 * @returns {{ resolved: Record<string, any>, conflicts: Array<{ field: string, message: string, code: string }> }}
 */
export function mergeResolvedInputs(persisted, supplied) {
  const resolved = { ...(persisted || {}) };
  const conflicts = [];
  for (const [key, value] of Object.entries(supplied || {})) {
    if (value === undefined) continue;
    if (persisted && Object.prototype.hasOwnProperty.call(persisted, key)) {
      if (!valuesEqual(persisted[key], value)) {
        conflicts.push({
          field: key,
          message: `Input '${key}' conflicts with the value already resolved for this in-flight finish operation`,
          code: 'RESOLVED_INPUT_CONFLICT',
        });
      }
    } else {
      resolved[key] = value;
    }
  }
  return { resolved, conflicts };
}

function computeMissingInputs(requiredInputsMap, resolved) {
  return Object.values(requiredInputsMap)
    .filter(schema => schema.required && (resolved[schema.name] === undefined || resolved[schema.name] === null))
    .map(schema => schema.name);
}

// ── Non-mutating finish planning (D11) ──────────────────────────────────────

/**
 * Computes the current finish plan without mutating anything: supplied inputs against the
 * aggregated finish contract, exit-gate `inspect()` results, and current source-control
 * facts. Used identically by `workflow step finish --check` and as the first phase of
 * `workflow step finish` itself (C12).
 *
 * @returns {Promise<object>} Plan payload; `status` is one of `already-complete`,
 *   `blocked`, `input-conflict`, `input-required`, `completed`, `ready`.
 */
export async function planFinish({
  change,
  task,
  definition,
  context = {},
  inputs = {},
  engine = defaultWorkflowEngine,
  gateRegistry = defaultGateRegistry,
  actionRegistry = defaultActionRegistry,
} = {}) {
  const changeSlug = change._slug || change.id;
  const existingRecord = context.repoRoot ? loadOperationRecord(context.repoRoot, changeSlug, task.id) : null;

  // An in-flight (not yet `completed`) operation record's own `step` is authoritative
  // over re-deriving the step from the task's *current* status: `update-task` may have
  // already moved the tracked status to the transition target before the operation as a
  // whole finished (the exact crash window C18 exists to recover from) — re-deriving
  // from current status alone would then wrongly conclude "already complete" and abandon
  // an operation still mid-flight (commit/push/transition stages still pending).
  const stepName = (existingRecord && existingRecord.status !== 'completed')
    ? existingRecord.step
    : resolveCurrentStepName(definition, task);

  if (!stepName) {
    if (existingRecord?.status === 'completed') {
      return {
        status: 'completed',
        stepName: existingRecord.step,
        requiredInputs: {},
        missingInputs: [],
        resolvedInputs: existingRecord.resolvedInputs || {},
        conflicts: [],
        sourceControl: null,
        plannedOperations: FINISH_STAGE_IDS,
        blockers: [],
        existingRecord,
      };
    }
    return {
      status: 'already-complete',
      stepName: null,
      requiredInputs: {},
      missingInputs: [],
      resolvedInputs: {},
      conflicts: [],
      sourceControl: null,
      plannedOperations: [],
      blockers: [],
      existingRecord: null,
    };
  }

  const step = definition.steps[stepName];
  const finalizeCheck = await aggregateFinalizeCheck(step, context, { engine, actionRegistry });
  const requiredInputs = buildFinishContract(finalizeCheck);
  const exitGateResults = await inspectGates(step.exitGates, context, { gateRegistry });
  // Only a definitively 'blocked'/'failed' gate blocks planning — a command gate's
  // 'pending' inspect status (not yet verify()'d) must not, or the finalize sequence
  // that actually runs and records it could never be reached (deadlock). Gates execute
  // deterministically: inspect() during planning, verify() only during actual finalize
  // execution (see `ensureVerifyGates` below).
  const blockers = exitGateResults.filter(g => g.status === 'blocked' || g.status === 'failed');

  const { resolved, conflicts } = mergeResolvedInputs(existingRecord?.resolvedInputs, inputs);
  const missingInputs = computeMissingInputs(requiredInputs, resolved);

  const sourceControlFacts = normalizeSourceControlFacts(finalizeCheck.actions['commit-and-push']?.context);
  const sourceControl = sourceControlFacts && context.repoRoot
    ? { ...sourceControlFacts, head: git.getCurrentRevision(context.repoRoot) }
    : sourceControlFacts;

  let status;
  if (blockers.length) {
    status = 'blocked';
  } else if (existingRecord?.status === 'completed') {
    status = 'completed';
  } else if (conflicts.length) {
    status = 'input-conflict';
  } else if (missingInputs.length) {
    status = 'input-required';
  } else {
    status = 'ready';
  }

  return {
    status,
    stepName,
    requiredInputs,
    missingInputs,
    resolvedInputs: resolved,
    conflicts,
    sourceControl,
    plannedOperations: FINISH_STAGE_IDS,
    blockers,
    existingRecord,
  };
}

function buildCompletionResult(record) {
  const commitStage = findStage(record, 'commit');
  const pushStage = findStage(record, 'push');
  const updateTaskStage = findStage(record, 'update-task');
  return {
    operationId: record.operationId,
    commit: commitStage.result ? { ...commitStage.result, status: commitStage.status } : null,
    push: pushStage.result ? { ...pushStage.result, status: pushStage.status } : null,
    taskStatus: updateTaskStage.intent?.toState,
  };
}

// ── Durable, resumable finish execution (D14) ───────────────────────────────

/** Internal control-flow signal — carries a terminal `finishStep` response out of the
 * fixed stage sequence without threading a return-or-continue flag through every stage. */
class FinishStageOutcome extends Error {
  constructor(payload) {
    super('finish-stage-outcome');
    this.payload = payload;
  }
}

async function ensureVerifyGates(record, step, context, gateRegistry, repoRoot) {
  const stage = findStage(record, 'verify-gates');
  if (stage.status === 'completed') return;

  const results = await verifyGates(step.exitGates, context, { gateRegistry });
  if (!allGatesPassed(results)) {
    stage.status = 'failed';
    stage.result = { gates: results };
    record.status = 'blocked';
    saveOperationRecord(repoRoot, record);
    throw new FinishStageOutcome({
      status: 'blocked',
      stage: 'verify-gates',
      blockers: results.filter(g => g.status !== 'passed'),
    });
  }

  stage.status = 'completed';
  stage.result = { gates: results };
  saveOperationRecord(repoRoot, record);
}

async function ensureUpdateTask(record, step, activeDir, changeSlug, taskId, repoRoot) {
  const stage = findStage(record, 'update-task');
  if (stage.status === 'completed') return;

  const toState = step.transitions[0]?.to;
  if (!toState) {
    throw new WorkflowError(`Step has no transition target for update-task`);
  }

  if (stage.status === 'running' || stage.status === 'unknown') {
    const change = requireChange(changeSlug, activeDir);
    const currentStatus = requireTask(change, taskId).status;
    if (currentStatus === stage.intent.toState) {
      stage.status = 'completed';
      stage.result = { toState: stage.intent.toState };
      saveOperationRecord(repoRoot, record);
      return;
    }
    if (currentStatus !== stage.intent.fromState) {
      stage.status = 'unknown';
      record.status = 'blocked';
      saveOperationRecord(repoRoot, record);
      throw new FinishStageOutcome({
        status: 'reconciliation-required',
        stage: 'update-task',
        details: { fromState: stage.intent.fromState, toState: stage.intent.toState, currentState: currentStatus },
      });
    }
    // currentStatus === fromState: the write never happened — safe to (re)execute below.
  }

  const change = requireChange(changeSlug, activeDir);
  const fromState = requireTask(change, taskId).status;
  stage.intent = { fromState, toState };
  stage.status = 'running';
  saveOperationRecord(repoRoot, record);

  setTaskStatus(change, taskId, toState);

  stage.status = 'completed';
  stage.result = { toState };
  saveOperationRecord(repoRoot, record);
}

async function ensureCommit(record, context, repoRoot) {
  const stage = findStage(record, 'commit');
  if (stage.status === 'completed') return;

  const sourceControl = normalizeSourceControlConfig(context.sourceControl);
  if (!sourceControl.enabled) {
    stage.status = 'completed';
    stage.result = { skipped: true };
    saveOperationRecord(repoRoot, record);
    return;
  }

  if (stage.status === 'running' || stage.status === 'unknown') {
    const currentHead = git.getCurrentRevision(repoRoot);
    if (currentHead !== stage.intent.preCommitHead) {
      const info = git.getCommitInfo(repoRoot, 'HEAD');
      const title = record.resolvedInputs['commit.title'];
      if (info.parentSha === stage.intent.preCommitHead && info.subject === title) {
        stage.status = 'completed';
        stage.result = { sha: info.sha, status: 'completed' };
        saveOperationRecord(repoRoot, record);
        return;
      }
      stage.status = 'unknown';
      record.status = 'blocked';
      saveOperationRecord(repoRoot, record);
      throw new FinishStageOutcome({
        status: 'reconciliation-required',
        stage: 'commit',
        details: { preCommitHead: stage.intent.preCommitHead, currentHead, currentHeadInfo: info },
      });
    }
    // currentHead === preCommitHead: the commit never happened — safe to (re)execute below.
  }

  const preCommitHead = git.getCurrentRevision(repoRoot);
  stage.intent = { preCommitHead };
  stage.status = 'running';
  saveOperationRecord(repoRoot, record);

  const action = defaultActionRegistry.require('commit-and-push');
  // The commit and push stages are reconciled independently (C18); force push:false here
  // regardless of the caller's real sourceControl.push so this stage only ever performs
  // the commit half — the `push` stage below performs the actual `git push` directly via
  // `tools/lib/git.mjs`, since the commit-and-push action cannot be safely re-invoked for
  // "push only" once the worktree is already clean (its `include` contract requires
  // matching dirty files).
  const actionContext = { ...context, sourceControl: { enabled: true, push: false } };
  const execResult = await action.execute(record.resolvedInputs, actionContext);

  stage.status = 'completed';
  stage.result = execResult.outputs.commit;
  saveOperationRecord(repoRoot, record);
}

async function ensurePush(record, context, repoRoot) {
  const stage = findStage(record, 'push');
  if (stage.status === 'completed') return;

  const sourceControl = normalizeSourceControlConfig(context.sourceControl);
  if (!sourceControl.enabled || !sourceControl.push) {
    stage.status = 'completed';
    stage.result = { skipped: true };
    saveOperationRecord(repoRoot, record);
    return;
  }

  if (stage.status === 'running' || stage.status === 'unknown') {
    // Recovered `running`/`unknown` push reconciles identically (C18): never blindly
    // reset to `pending`, always check whether the expected SHA already landed remotely.
    const onRemote = git.isCommitOnRemoteBranch(repoRoot, stage.result.expectedSha, stage.result.branch);
    if (onRemote) {
      stage.status = 'completed';
      stage.result = { ...stage.result, status: 'completed' };
      saveOperationRecord(repoRoot, record);
      return;
    }
    // Not on remote — retry the push below using the already-persisted expectedSha/branch.
  } else {
    const commitStage = findStage(record, 'commit');
    stage.result = {
      remote: 'origin',
      branch: git.getCurrentBranch(repoRoot),
      expectedSha: commitStage.result?.sha,
    };
  }

  stage.status = 'running';
  saveOperationRecord(repoRoot, record);

  await git.pushAsync(repoRoot, stage.result.branch);

  stage.status = 'completed';
  stage.result = { ...stage.result, status: 'completed' };
  saveOperationRecord(repoRoot, record);
}

async function ensureTransition(record, step) {
  const stage = findStage(record, 'transition');
  if (stage.status === 'completed') return;
  const updateTaskStage = findStage(record, 'update-task');
  stage.status = 'completed';
  stage.result = {
    nextStepGuidance: step.transitions[0] ? { onSuccess: step.transitions[0].to } : null,
    taskStatus: updateTaskStage.intent?.toState,
  };
}

/**
 * Executes (or resumes) the durable finish operation for the current step (D14).
 * `workflow step finish` without `--check`: plans first (never mutating on a blocked or
 * incomplete plan), then — only once every required input is resolved — creates or
 * resumes the durable operation record and drives the fixed finalize stage order.
 *
 * @param {object} params - Same shape as `planFinish`, plus:
 * @param {string} [params.activeDir] - Base directory containing `change.yaml` (defaults
 *   to `context.activeDir`) — required to reach the change manifest for `update-task`.
 * @returns {Promise<object>} `{ status, ... }` — `already-complete`, `blocked`,
 *   `input-required`, `completed`, or `reconciliation-required`.
 */
export async function finishStep({
  change,
  task,
  definition,
  context = {},
  inputs = {},
  activeDir,
  engine = defaultWorkflowEngine,
  gateRegistry = defaultGateRegistry,
  actionRegistry = defaultActionRegistry,
} = {}) {
  if (!context.repoRoot) {
    throw new WorkflowError('finishStep requires context.repoRoot');
  }
  const repoRoot = context.repoRoot;
  const changeSlug = change._slug || change.id;
  const resolvedActiveDir = activeDir || context.activeDir;

  const plan = await planFinish({ change, task, definition, context, inputs, engine, gateRegistry, actionRegistry });

  if (plan.status === 'already-complete') {
    return { status: 'already-complete' };
  }
  if (plan.status === 'blocked') {
    return {
      status: 'blocked',
      blockers: plan.blockers,
      requiredInputs: plan.requiredInputs,
      sourceControl: plan.sourceControl,
      plannedOperations: plan.plannedOperations,
    };
  }
  if (plan.status === 'input-conflict') {
    throw new PreconditionError('Conflicting finish inputs supplied for an in-flight operation', plan.conflicts, null);
  }
  if (plan.status === 'completed') {
    return { status: 'completed', result: buildCompletionResult(plan.existingRecord) };
  }
  if (plan.status === 'input-required') {
    return {
      status: 'input-required',
      requiredInputs: plan.requiredInputs,
      missingInputs: plan.missingInputs,
      sourceControl: plan.sourceControl,
      plannedOperations: plan.plannedOperations,
      blockers: [],
    };
  }

  // plan.status === 'ready'
  if (!resolvedActiveDir) {
    throw new WorkflowError('finishStep requires activeDir (or context.activeDir) to reach the change manifest');
  }

  let record = plan.existingRecord;
  if (!record) {
    record = createOperationRecord({ change: changeSlug, task: task.id, step: plan.stepName, resolvedInputs: plan.resolvedInputs });
    saveOperationRecord(repoRoot, record);
  }

  const step = definition.steps[plan.stepName];

  try {
    await ensureVerifyGates(record, step, context, gateRegistry, repoRoot);
    await ensureUpdateTask(record, step, resolvedActiveDir, changeSlug, task.id, repoRoot);
    await ensureCommit(record, context, repoRoot);
    await ensurePush(record, context, repoRoot);
    await ensureTransition(record, step);
  } catch (err) {
    if (err instanceof FinishStageOutcome) {
      return err.payload;
    }
    throw err;
  }

  record.status = 'completed';
  saveOperationRecord(repoRoot, record);

  return { status: 'completed', result: buildCompletionResult(record) };
}
