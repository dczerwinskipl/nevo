// Agent-facing `workflow step start` / `workflow step finish [--check]` (D9) and the
// distinct operator-facing `workflow verify-human --confirm` (C8) — the deterministic
// workflow engine's CLI surface, delegating to `tools/specs/workflow/` rather than
// growing large branch logic inline in `tools/specs.mjs`.
//
// Every handler accepts `{ activeDir, repoRoot }` overrides (defaulting to the real
// repository, `ACTIVE_DIR`/`ROOT` from `store.mjs`) — the same pattern
// `tools/specs/start/operation.mjs`'s `startTask` already established — so tests can
// drive these exact handlers end-to-end against a disposable fixture repository
// (`fixture-repo.test-helper.mjs`) instead of the real checked-out repository.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { requireChange, requireTask, ROOT, ACTIVE_DIR } from '../store.mjs';
import { parseVerificationCommands } from '../fingerprint.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import { resolveWorkflowMode, assertWorkflowVersionCompatible } from './compatibility.mjs';
import { loadWorkflowDefinition } from './definitions/loader.mjs';
import { compileStepContext, buildFinishContract, validateFinishInputs, aggregateFinalizeCheck, ensureStepActivated, resolveTaskScope, resolveWorkflowOwnedPaths } from './step-context.mjs';
import { planFinish, finishStep } from './finish-operation.mjs';
import { publishTask } from './publish/operation.mjs';
import { resolveActiveStepName, resolveWorkflowPosition, gateDisplayId } from './step-runner.mjs';
import { findInFlightOperationRecord } from './operation-record.mjs';
import { WorkflowError } from './errors.mjs';
import { createDefaultGateRegistry } from './registry.mjs';
import { MemoryCommandVerificationStore } from './gates/command-gate.mjs';
import { FileHumanVerificationStore } from './human-verification-store.mjs';
import { resolveHumanScopeTarget } from './gates/human-gate.mjs';
// side-effect import: registers CommitAndPushAction into defaultActionRegistry. Without
// this, `defaultActionRegistry` (registry.mjs) starts empty and `aggregateFinalizeCheck`
// would silently filter 'commit-and-push' out as "not yet registered" (step-context.mjs),
// producing an empty finish contract for every real invocation.
import './actions/index.mjs';
import { autoBindAgentSession } from '../../specs.mjs';

function resolveDefaultTask(change) {
  const candidates = change.tasks.filter(t => t.status === 'in-implementation');
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new CliError(`No task is currently in-implementation for change '${change._slug}' — specify a task id explicitly`);
  }
  throw new CliError(
    `Multiple tasks are in-implementation for change '${change._slug}' — specify a task id explicitly: ${candidates.map(t => t.id).join(', ')}`
  );
}

/**
 * Resolves the change/task/normalized-definition/runtime-context tuple shared by all
 * three `workflow` CLI commands.
 */
export function resolveWorkflowRuntime(changeSlug, taskId, { activeDir = ACTIVE_DIR, repoRoot = ROOT } = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = taskId ? requireTask(change, taskId) : resolveDefaultTask(change);
  const resolvedMode = resolveWorkflowMode(change);
  const definition = loadWorkflowDefinition(resolvedMode.definition, { repoRoot });
  assertWorkflowVersionCompatible(resolvedMode, definition);

  const scope = resolveTaskScope(change, task, { activeDir, repoRoot });
  const resolvedChangeSlug = change._slug || change.id || changeSlug;
  const workflowOwnedPaths = resolveWorkflowOwnedPaths({ activeDir, repoRoot, changeSlug: resolvedChangeSlug });

  const context = {
    repoRoot,
    activeDir,
    taskId: task.id,
    task,
    changeId: change.id,
    changeSlug: resolvedChangeSlug,
    sourceControl: definition.sourceControl,
    baseBranch: 'main',
    taskAllowedPaths: scope.allowedPaths,
    allowedPaths: scope.allowedPaths,
    workflowOwnedPaths,
  };

  return { change, task, definition, context };
}

async function executeSingleCommandWithLiveOutput(command, cwd, silent) {
  if (!silent) {
    process.stderr.write(`[workflow:gate] Executing: ${command}\n`);
  }
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!silent) process.stderr.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!silent) process.stderr.write(text);
    });

    child.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : 1;
      resolve({
        passed: exitCode === 0,
        exitCode,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      resolve({
        passed: false,
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
      });
    });
  });
}

async function runCliCommandWithLiveOutput(command, context = {}) {
  const cwd = context.repoRoot || process.cwd();
  const activeDir = context.activeDir || join(cwd, 'specs', 'active');
  const changeSlug = context.changeSlug || context.changeId || context.change?._slug || context.change?.id;
  const task = context.task;

  if (command === 'npm test' && task && changeSlug) {
    const taskFile = task.file || (task.id ? `tasks/${task.id}.md` : null);
    if (taskFile) {
      const taskPath = join(activeDir, changeSlug, taskFile);
      if (existsSync(taskPath)) {
        try {
          const body = readFileSync(taskPath, 'utf8');
          const taskCommands = parseVerificationCommands(body);
          if (taskCommands.length > 0) {
            let combinedStdout = '';
            let combinedStderr = '';
            for (const subCmd of taskCommands) {
              const res = await executeSingleCommandWithLiveOutput(subCmd, cwd, context.silent);
              combinedStdout += res.stdout + '\n';
              combinedStderr += res.stderr + '\n';
              if (!res.passed) {
                return {
                  passed: false,
                  exitCode: res.exitCode,
                  stdout: combinedStdout,
                  stderr: combinedStderr,
                };
              }
            }
            return {
              passed: true,
              exitCode: 0,
              stdout: combinedStdout,
              stderr: combinedStderr,
            };
          }
        } catch {
          // fallback to generic command
        }
      }
    }
  }

  return executeSingleCommandWithLiveOutput(command, cwd, context.silent);
}

/** A fresh gate registry per CLI invocation — the command-verification store only needs
 * to survive within one `verify()` call's own evaluation (Task 06), and the human
 * sign-off reader is file-backed so it survives across the separate `verify-human`
 * invocation (see `human-verification-store.mjs`). */
export function buildWorkflowGateRegistry(repoRoot, changeSlug, taskId, attempt) {
  const effectiveAttempt = typeof attempt === 'object' ? attempt?.workflow_progress?.current_attempt : attempt;
  return createDefaultGateRegistry({
    commandRunner: runCliCommandWithLiveOutput,
    commandVerificationStore: new MemoryCommandVerificationStore(),
    humanVerificationReader: new FileHumanVerificationStore({
      repoRoot,
      change: changeSlug,
      task: taskId,
      attempt: effectiveAttempt,
    }),
  });
}

const OBSOLETE_FLAGS = [
  'title',
  'message',
  'include',
  'exclude',
  'result',
  'artifact',
  'artifacts',
];

export function parseFinishInputs(opts = {}) {
  for (const flag of OBSOLETE_FLAGS) {
    if (opts[flag] !== undefined) {
      throw new WorkflowError(
        `Flag '--${flag}' is obsolete. Provide structured inputs via --input '<json>' or --input-file <path>.`,
        { code: 'OBSOLETE_INPUT_FLAG' }
      );
    }
  }

  const hasInput = opts.input !== undefined;
  const hasInputFile = opts.inputFile !== undefined || opts['input-file'] !== undefined;

  if (hasInput && hasInputFile) {
    throw new WorkflowError('Cannot specify both --input and --input-file; choose one', { code: 'CLI_USAGE_ERROR' });
  }

  let rawJson;
  if (hasInput) {
    rawJson = opts.input;
  } else if (hasInputFile) {
    const filePath = opts.inputFile || opts['input-file'];
    try {
      rawJson = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new WorkflowError(`Failed to read input file '${filePath}': ${err.message}`, { code: 'INPUT_FILE_READ_ERROR' });
    }
  }

  if (rawJson === undefined) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new WorkflowError(`Failed to parse finish input JSON: ${err.message}`, { code: 'INVALID_INPUT_JSON' });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorkflowError('Finish input payload must be a non-null object', { code: 'INVALID_INPUT_JSON' });
  }

  return parsed;
}

function emit(payload, opts) {
  if (!opts.silent) {
    console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
}

export async function handleWorkflowStepStart(changeSlug, taskId, opts = {}) {
  const change = requireChange(changeSlug, opts.activeDir || ACTIVE_DIR);
  const workflowMode = resolveWorkflowMode(change, opts);
  if (workflowMode.mode === 'legacy') {
    throw new CliError(
      `Cannot run deterministic command 'workflow step start' against legacy specification '${changeSlug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }
  const { task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
  const position = resolveWorkflowPosition(definition, task);
  const gateRegistry = buildWorkflowGateRegistry(context.repoRoot, change._slug, task.id, position.attempt);
  const stepContext = await compileStepContext({ change, task, definition, context, gateRegistry });
  autoBindAgentSession(change, task.id, 'execution', { step: stepContext.currentStep, attempt: stepContext.attempt, repoRoot: context.repoRoot });
  return emit(stepContext, opts);
}

export async function handleWorkflowStepFinish(changeSlug, taskId, opts = {}) {
  const change = requireChange(changeSlug, opts.activeDir || ACTIVE_DIR);
  const workflowMode = resolveWorkflowMode(change, opts);
  if (workflowMode.mode === 'legacy') {
    throw new CliError(
      `Cannot run deterministic command 'workflow step finish' against legacy specification '${changeSlug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }
  const inputs = parseFinishInputs(opts);
  const { task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
  const inFlight = context.repoRoot ? findInFlightOperationRecord(context.repoRoot, change._slug, task.id) : null;
  // Task 04 AC1: an in-flight record is authoritative over workflow_progress for choosing
  // execution identity — resolveWorkflowPosition must not even run when one exists (see
  // the identical reasoning in finish-operation.mjs's planFinish).
  const position = inFlight ? null : resolveWorkflowPosition(definition, task);
  const stepName = inFlight ? inFlight.step : position.step;
  const attempt = inFlight ? inFlight.attempt : position.attempt;
  autoBindAgentSession(change, task.id, 'finish', { step: stepName, attempt, repoRoot: context.repoRoot });
  const gateRegistry = buildWorkflowGateRegistry(context.repoRoot, change._slug, task.id, attempt);

  const step = (position?.phase === 'active' || inFlight) ? definition.steps?.[stepName] : null;
  if (step) {
    const finalizeCheck = await aggregateFinalizeCheck(step, context);
    const parameters = buildFinishContract(finalizeCheck, step);
    const effectiveInputs = inFlight?.resolvedInputs ? { ...inFlight.resolvedInputs, ...inputs } : inputs;
    validateFinishInputs(effectiveInputs, parameters, { allowMissing: Boolean(opts.check) });
  }

  if (opts.check) {
    const plan = await planFinish({ change, task, definition, context, inputs, gateRegistry });
    return emit(plan, opts);
  }

  const result = await finishStep({ change, task, definition, context, inputs, activeDir: context.activeDir, gateRegistry });
  return emit(result, opts);
}

/**
 * Resolves which human-verification gate on the task's current step `verify-human`
 * should confirm (D24/D29/D30). A step declaring exactly one human gate needs no
 * disambiguation; a step declaring more than one (each guaranteed an explicit,
 * mutually-distinct `id` by D30's schema validation) requires the caller's `--gate <id>`
 * to select one — fails closed, listing the real ids, rather than guessing.
 *
 * @param {object} definition
 * @param {object} task
 * @param {string} stepName
 * @param {string|undefined} gateIdOption - The operator's `--gate <id>` value, if given
 */
function resolveHumanGateForConfirmation(definition, task, stepName, gateIdOption) {
  const step = definition.steps[stepName];
  const humanGates = [...step.entryGates, ...step.exitGates].filter(g => g.type === 'human');
  if (humanGates.length === 0) {
    throw new CliError(`Step '${stepName}' declares no human-verification gate for task '${task.id}' — nothing to confirm`);
  }
  if (humanGates.length === 1) {
    const [gate] = humanGates;
    if (gateIdOption && gate.id && gateIdOption !== gate.id) {
      throw new CliError(`--gate '${gateIdOption}' does not match step '${stepName}''s configured gate id '${gate.id}'`);
    }
    return gate;
  }
  const ids = humanGates.map(gateDisplayId);
  if (!gateIdOption) {
    throw new CliError(
      `Step '${stepName}' declares ${humanGates.length} human-verification gates (${ids.join(', ')}) — specify --gate <id> to disambiguate which one to confirm`
    );
  }
  const match = humanGates.find(g => g.id === gateIdOption);
  if (!match) {
    throw new CliError(`--gate '${gateIdOption}' does not match any human-verification gate on step '${stepName}' (${ids.join(', ')})`);
  }
  return match;
}

export function handleWorkflowVerifyHuman(changeSlug, taskId, opts = {}) {
  const isApprove = Boolean(opts.approve);
  const isRequestChanges = Boolean(opts.requestChanges || opts.reject);

  if (isApprove || isRequestChanges) {
    return (async () => {
      if (isApprove && isRequestChanges) {
        throw new CliError('Cannot specify both --approve and --request-changes');
      }

      if (isRequestChanges && (!opts.feedback || typeof opts.feedback !== 'string' || opts.feedback.trim() === '')) {
        throw new CliError('--request-changes requires --feedback <text>');
      }
      const { change, task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
      const position = resolveWorkflowPosition(definition, task);

      let targetStep;
      if (position.phase === 'active') {
        targetStep = position.step;
      } else if (position.phase === 'completed') {
        targetStep = position.nextStep;
      } else if (position.phase === 'new') {
        targetStep = definition.entryStep;
      }

      if (targetStep !== 'human-verification') {
        throw new WorkflowError(
          `Cannot execute human decision on step '${targetStep || position.step}' — human decisions may only execute when the target step is 'human-verification'`,
          { code: 'INVALID_HUMAN_DECISION_STEP', step: targetStep || position.step }
        );
      }

      let effectiveTask = task;
      let effectivePosition = position;
      if (position.phase !== 'active') {
        const activation = ensureStepActivated(change, task, definition, context);
        effectiveTask = activation.task;
        effectivePosition = activation.position;
      }

      const stepName = effectivePosition.step;
      const step = definition.steps?.[stepName];
      if (!step) {
        throw new WorkflowError(`Step '${stepName}' not found in workflow definition`, { code: 'STEP_NOT_FOUND', step: stepName });
      }

      const finalizeCheck = await aggregateFinalizeCheck(step, context);
      const parameters = buildFinishContract(finalizeCheck, step);

      const inputs = {
        result: isApprove ? 'pass' : 'fail',
      };
      if (opts.feedback) {
        inputs.feedback = opts.feedback.trim();
      }
      if (parameters['commit.title']) {
        inputs['commit.title'] = opts['commit.title'] || (isApprove ? `verify(${task.id}): approve human verification` : `verify(${task.id}): request changes`);
      }

      const gateRegistry = buildWorkflowGateRegistry(context.repoRoot, change._slug, effectiveTask.id, effectivePosition.attempt);
      const result = await finishStep({
        change,
        task: effectiveTask,
        definition,
        context,
        inputs,
        activeDir: context.activeDir,
        gateRegistry,
      });
      return emit(result, opts);
    })();
  }

  if (!opts.confirm) {
    throw new CliError('workflow verify-human requires --approve, --request-changes, or --confirm');
  }
  const { change, task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
  // D37: a human-verification gate is one of a step's *exit* gates, evaluated during
  // `finish` — only meaningful while that step is actually active. A step whose work is
  // already done (awaiting the next `step start`) or a workflow that's fully complete
  // has nothing outstanding to confirm.
  const position = resolveWorkflowPosition(definition, task);
  if (position.phase !== 'active') {
    throw new CliError(`Task '${task.id}' has no currently active workflow step — there is nothing requiring human verification right now`);
  }
  const stepName = position.step;
  const attempt = position.attempt;
  const gateConfig = resolveHumanGateForConfirmation(definition, task, stepName, opts.gate);
  const scope = gateConfig.scope || 'task';
  const targetId = resolveHumanScopeTarget(scope, { ...context, stepId: stepName, attempt });
  if (!targetId) {
    throw new CliError(`Could not resolve identity for scope '${scope}' — verify-human cannot record a signoff without an explicit target`);
  }
  // The gate's own configured role (D29) — HumanVerificationGate.inspect() requires
  // `requiredRole = config.role || 'owner'` to match the persisted signoff's role
  // exactly; hardcoding 'owner' here would make a configured non-owner gate (e.g.
  // 'reviewer', 'architect') permanently unsatisfiable via this CLI.
  const role = gateConfig.role || 'owner';
  const store = new FileHumanVerificationStore({ repoRoot: context.repoRoot, change: change._slug, task: task.id, attempt });
  const record = store.confirm({ scope, targetId, role, stepId: stepName, attempt, gateId: gateConfig.id || null });
  return emit({ change: changeSlug, task: taskId, confirmed: true, record }, opts);
}

/**
 * CLI entry point: publish a task in a deterministic spec for execution.
 */
export async function handleWorkflowTaskPublish(changeSlug, taskId, options = {}) {
  const result = publishTask(changeSlug, taskId, options);
  if (!options.silent) {
    process.stdout.write(`Task '${result.taskId}' in change '${result.changeSlug}' published successfully.\n`);
  }
  return result;
}

