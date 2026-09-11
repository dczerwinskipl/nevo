// Non-mutating finish planning and durable, resumable finish execution behind
// `workflow step finish [--check]` (D11/D14). Fixed finalize stage order
// (`verify-gates -> update-task -> commit -> push -> transition`, D13) executed under a
// durable operation record persisted at
// `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json` (D23 — step-aware
// identity, generalized from the original single-step `<change>/<task>.json`) — runtime
// execution state, never part of `change.yaml` (D14 correction, C17).

import { randomUUID } from 'node:crypto';

import { requireChange, requireTask, setTaskWorkflowState } from '../store.mjs';
import { normalizeSourceControlConfig } from './definitions/schema.mjs';
import { defaultActionRegistry, defaultGateRegistry } from './registry.mjs';
import { defaultWorkflowEngine } from './engine.mjs';
import { resolveActiveStepName, inspectGates, verifyGates, allGatesPassed } from './step-runner.mjs';
import { aggregateFinalizeCheck, buildFinishContract, normalizeSourceControlFacts } from './step-context.mjs';
import { WorkflowError, PreconditionError } from './errors.mjs';
import * as git from '../../lib/git.mjs';
// ── Durable operation record I/O (D23: step-aware identity) ─────────────────
// Extracted into `operation-record.mjs` (D37 correction) so `step-context.mjs`'s
// `step start` activation guard can read these records too, without a circular import
// between this module and `step-context.mjs`.
import { loadOperationRecord, saveOperationRecord, findInFlightOperationRecord } from './operation-record.mjs';

export const FINISH_STAGE_IDS = ['verify-gates', 'update-task', 'commit', 'push', 'transition'];

// Re-exported so every existing import path (`finish-operation.mjs` directly, or the
// `index.mjs` barrel) is unaffected by the extraction above.
export { loadOperationRecord, saveOperationRecord, findInFlightOperationRecord };

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

function isStepName(definition, name) {
  return Object.prototype.hasOwnProperty.call(definition?.steps || {}, name);
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
 *   `already-completed`, `blocked`, `input-conflict`, `input-required`, `completed`,
 *   `ready`. `already-completed` (AC7, D37 correction) is a repeated `finish` against a
 *   step whose finish operation already fully succeeded — distinct from a first-time
 *   `completed` result; never re-evaluates gates or re-runs finalize actions.
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

  // D23: an in-flight record (regardless of which step it belongs to) is authoritative
  // over re-deriving the step from the task's *current* workflow_progress — `finish`
  // never moves `current_step` itself (D37), but a crash could still leave this
  // operation's own `update-task` stage `completed` (state: 'completed' already
  // written) while `commit`/`push`/`transition` remain unfinished.
  const inFlight = context.repoRoot ? findInFlightOperationRecord(context.repoRoot, changeSlug, task.id) : null;
  const stepName = inFlight ? inFlight.step : resolveActiveStepName(definition, task);

  if (!stepName) {
    // D37: no step is currently active — the task never started (`new`), its current
    // step already finished and is awaiting the next `workflow step start`
    // (`completed`), or the workflow is fully done (`terminal`). In every case there is
    // nothing to finish; `workflow_progress.current_step` is never cleared (D28), so it
    // still names whichever step most recently ran — the same file
    // `findInFlightOperationRecord` would have scanned past (status: 'completed') is
    // exactly what an idempotent repeat (AC7: finish never re-runs a completed step's
    // finalize) needs.
    const lastStep = task?.workflow_progress?.current_step || null;
    const lastRecord = (context.repoRoot && lastStep)
      ? loadOperationRecord(context.repoRoot, changeSlug, task.id, lastStep)
      : null;
    if (lastRecord?.status === 'completed') {
      // AC7 (D37 correction): a repeated `finish` against an already-completed step
      // (no intervening `step start`) must report a status distinct from a newly
      // successful finish — `already-completed`, never `completed`. The previous
      // operation's result is still returned as factual context.
      return {
        status: 'already-completed',
        stepName: lastStep,
        requiredInputs: {},
        missingInputs: [],
        resolvedInputs: lastRecord.resolvedInputs || {},
        conflicts: [],
        sourceControl: null,
        plannedOperations: FINISH_STAGE_IDS,
        blockers: [],
        existingRecord: lastRecord,
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

  const existingRecord = inFlight || (context.repoRoot ? loadOperationRecord(context.repoRoot, changeSlug, task.id, stepName) : null);

  const step = definition.steps[stepName];
  const finalizeCheck = await aggregateFinalizeCheck(step, context, { engine, actionRegistry });
  const requiredInputs = buildFinishContract(finalizeCheck);
  // D29: gate inspection needs the resolved step identity in context so a
  // HumanVerificationGate can build its query with real stepId identity.
  const gateContext = { ...context, stepId: stepName };
  const exitGateResults = await inspectGates(step.exitGates, gateContext, { gateRegistry });
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
  // D37: `update-task`'s own result (set by `ensureUpdateTask`) already distinguishes
  // the internal (`toStep`) vs. terminal (`toState`) case — no need to also read
  // `intent.kind`, which no longer carries that distinction (see `ensureUpdateTask`).
  const result = updateTaskStage.result;
  return {
    operationId: record.operationId,
    commit: commitStage.result ? { ...commitStage.result, status: commitStage.status } : null,
    push: pushStage.result ? { ...pushStage.result, status: pushStage.status } : null,
    taskStatus: result?.toState,
    nextStep: result?.toStep,
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

  const gateContext = { ...context, stepId: record.step };
  const results = await verifyGates(step.exitGates, gateContext, { gateRegistry });
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

/**
 * Generalized `update-task` stage (D18/D19/D28/D32, internal-transition mechanics
 * corrected by D37): the record's own `step` (never re-derived) tells us which step just
 * finished; that step's one transition (D27) tells us whether this is an internal
 * step-completion or a terminal status write. Either way, `current_step` stays exactly
 * `stepName` — `finish` never advances it (D37; only the next `workflow step start`
 * does) — and the mutation is `workflow_progress.state = 'completed'` (plus, for the
 * terminal case, `task.status = to`), together with its own `history` entry, applied
 * atomically via `setTaskWorkflowState` (D32) — never a second, separate write.
 *
 * Crash reconciliation (D14/C18, corrected by D37): the persisted `intent` is now
 * uniformly `{ fromState: 'active', toState: 'completed' }` — a comparison against
 * `workflow_progress.state` *at this operation's own step*, never against `current_step`
 * values (which no longer move during `finish`, so comparing them stopped being
 * meaningful). D23's step-aware record identity already guarantees `record.step` is the
 * one step this comparison is ever about.
 */
async function ensureUpdateTask(record, definition, activeDir, changeSlug, taskId, repoRoot) {
  const stage = findStage(record, 'update-task');
  if (stage.status === 'completed') return;

  const stepName = record.step;
  const step = definition.steps[stepName];
  const to = step.transitions[0].to; // exactly one, guaranteed by D27 schema validation
  const isInternalTransition = isStepName(definition, to);

  if (stage.status === 'running' || stage.status === 'unknown') {
    const change = requireChange(changeSlug, activeDir);
    const task = requireTask(change, taskId);

    const trackedState = task.workflow_progress?.current_step === stepName
      ? task.workflow_progress?.state
      : undefined;

    if (trackedState === 'completed') {
      stage.status = 'completed';
      stage.result = isInternalTransition ? { toStep: to } : { toState: to };
      saveOperationRecord(repoRoot, record);
      return;
    }
    if (trackedState !== 'active') {
      stage.status = 'unknown';
      record.status = 'blocked';
      saveOperationRecord(repoRoot, record);
      throw new FinishStageOutcome({
        status: 'reconciliation-required',
        stage: 'update-task',
        details: {
          fromState: 'active',
          toState: 'completed',
          step: stepName,
          currentStep: task.workflow_progress?.current_step ?? null,
          currentState: task.workflow_progress?.state ?? null,
        },
      });
    }
    // trackedState === 'active': the write never happened — safe to redo below.
  }

  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  const history = Array.isArray(task.workflow_progress?.history) ? task.workflow_progress.history : [];
  // D28 (unchanged by D37): workflow_progress is never cleared, even for a terminal
  // transition — the final history entry is what preserves "which step led to
  // completion" as audit evidence.
  const newHistory = [...history, { step: stepName, completed_at: new Date().toISOString(), transitioned_to: to }];

  stage.intent = { fromState: 'active', toState: 'completed' };
  stage.status = 'running';
  saveOperationRecord(repoRoot, record);

  // D37: current_step stays `stepName` in both cases — `finish` never advances it.
  const workflowProgress = { current_step: stepName, state: 'completed', history: newHistory };
  if (isInternalTransition) {
    setTaskWorkflowState(change, taskId, { workflowProgress });
    stage.result = { toStep: to };
  } else {
    setTaskWorkflowState(change, taskId, { status: to, workflowProgress });
    stage.result = { toState: to };
  }

  stage.status = 'completed';
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

/** Runtime-only and idempotent (D13's consequence) — never writes `change.yaml` again;
 * the task/spec status change already happened and was already committed by
 * `update-task`/`commit`. Just re-derives the next-step response from the already-
 * persisted `update-task` result — its own `toStep`/`toState` already distinguishes
 * the internal vs. terminal case (D37; `nextStepGuidance` names whichever the
 * transition actually targets — the step D37 activates on the *next* `step start`, or
 * the terminal status just written). */
async function ensureTransition(record) {
  const stage = findStage(record, 'transition');
  if (stage.status === 'completed') return;

  const updateTaskStage = findStage(record, 'update-task');
  const result = updateTaskStage.result;
  const nextStepGuidance = result?.toStep
    ? { onSuccess: result.toStep }
    : result?.toState
      ? { onSuccess: result.toState }
      : null;

  stage.status = 'completed';
  stage.result = {
    nextStepGuidance,
    taskStatus: result?.toState,
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
 * @returns {Promise<object>} `{ status, ... }` — `already-complete`, `already-completed`
 *   (AC7 — a repeated finish against a step whose operation already fully succeeded),
 *   `blocked`, `input-required`, `completed`, or `reconciliation-required`.
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
  if (plan.status === 'already-completed') {
    // AC7 (D37 correction): distinct from a first-time `completed` result — no gate was
    // re-evaluated and no finalize action ran for this call; the previous operation's
    // own result is returned as factual context only.
    return { status: 'already-completed', result: buildCompletionResult(plan.existingRecord) };
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

  const step = definition.steps[record.step];

  try {
    await ensureVerifyGates(record, step, context, gateRegistry, repoRoot);
    await ensureUpdateTask(record, definition, resolvedActiveDir, changeSlug, task.id, repoRoot);
    await ensureCommit(record, context, repoRoot);
    await ensurePush(record, context, repoRoot);
    await ensureTransition(record);
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
