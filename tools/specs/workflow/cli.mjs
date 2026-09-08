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

import { requireChange, requireTask, ROOT, ACTIVE_DIR } from '../store.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import { resolveWorkflowMode } from './compatibility.mjs';
import { loadWorkflowDefinition } from './definitions/loader.mjs';
import { compileStepContext } from './step-context.mjs';
import { planFinish, finishStep } from './finish-operation.mjs';
import { createDefaultGateRegistry } from './registry.mjs';
import { MemoryCommandVerificationStore } from './gates/command-gate.mjs';
import { FileHumanVerificationStore } from './human-verification-store.mjs';
// Side-effect import: registers CommitAndPushAction into defaultActionRegistry. Without
// this, `defaultActionRegistry` (registry.mjs) starts empty and `aggregateFinalizeCheck`
// would silently filter 'commit-and-push' out as "not yet registered" (step-context.mjs),
// producing an empty finish contract for every real invocation.
import './actions/index.mjs';

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
  const { definition: definitionName } = resolveWorkflowMode(change);
  const definition = loadWorkflowDefinition(definitionName, { repoRoot });

  const context = {
    repoRoot,
    activeDir,
    taskId: task.id,
    task,
    changeId: change.id,
    sourceControl: definition.sourceControl,
    baseBranch: 'main',
  };

  return { change, task, definition, context };
}

/** A fresh gate registry per CLI invocation — the command-verification store only needs
 * to survive within one `verify()` call's own evaluation (Task 06), and the human
 * sign-off reader is file-backed so it survives across the separate `verify-human`
 * invocation (see `human-verification-store.mjs`). */
export function buildWorkflowGateRegistry(repoRoot, changeSlug, taskId) {
  return createDefaultGateRegistry({
    commandVerificationStore: new MemoryCommandVerificationStore(),
    humanVerificationReader: new FileHumanVerificationStore({ repoRoot, change: changeSlug, task: taskId }),
  });
}

function splitList(value) {
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function buildFinishInputs(opts = {}) {
  const inputs = {};
  if (opts.title !== undefined) inputs['commit.title'] = opts.title;
  if (opts.message !== undefined) inputs['commit.message'] = opts.message;
  if (opts.include !== undefined) inputs.include = splitList(opts.include);
  if (opts.exclude !== undefined) inputs.exclude = splitList(opts.exclude);
  return inputs;
}

function emit(payload, opts) {
  if (!opts.silent) {
    console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
}

export async function handleWorkflowStepStart(changeSlug, taskId, opts = {}) {
  const { change, task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
  const gateRegistry = buildWorkflowGateRegistry(context.repoRoot, change._slug, task.id);
  const stepContext = await compileStepContext({ change, task, definition, context, gateRegistry });
  return emit(stepContext, opts);
}

export async function handleWorkflowStepFinish(changeSlug, taskId, opts = {}) {
  const { change, task, definition, context } = resolveWorkflowRuntime(changeSlug, taskId, opts);
  const gateRegistry = buildWorkflowGateRegistry(context.repoRoot, change._slug, task.id);
  const inputs = buildFinishInputs(opts);

  if (opts.check) {
    const plan = await planFinish({ change, task, definition, context, inputs, gateRegistry });
    return emit(plan, opts);
  }

  const result = await finishStep({ change, task, definition, context, inputs, activeDir: context.activeDir, gateRegistry });
  return emit(result, opts);
}

export function handleWorkflowVerifyHuman(changeSlug, taskId, opts = {}) {
  if (!opts.confirm) {
    throw new CliError('workflow verify-human requires --confirm — this command is the only path that can satisfy a human-verification gate (C8)');
  }
  const activeDir = opts.activeDir || ACTIVE_DIR;
  const repoRoot = opts.repoRoot || ROOT;
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  const store = new FileHumanVerificationStore({ repoRoot, change: change._slug, task: task.id });
  const record = store.confirm({ scope: 'task', targetId: task.id, role: 'owner' });
  return emit({ change: changeSlug, task: taskId, confirmed: true, record }, opts);
}
