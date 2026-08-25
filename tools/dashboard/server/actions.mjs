import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import * as git from '../../lib/git.mjs';
import { parseProgressLine, createProgressEmitter } from '../../lib/operation-progress.mjs';
import { evaluateGate, evaluateTaskGate } from '../../specs/gates.mjs';
import { ACTIVE_DIR, loadChange, loadFollowUps } from '../../specs/service.mjs';
import { handleApprove, handleVerify, handleFinalize } from '../../specs.mjs';
import { REPOSITORY_ROOT } from './data.mjs';

const execFileAsync = promisify(execFile);

const ACTIONABLE_TASK_STATUSES = new Map([
  ['draft', 'approve'],
  ['implemented', 'verify'],
]);

export class SpecificationActionError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'SpecificationActionError';
    this.status = status;
  }
}

export function defaultSpecsSpawner(root, args) {
  const script = resolve(root, 'tools', 'specs.mjs');
  return spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function parseReport(output, label) {
  const nonProgress = String(output || '')
    .split(/\r?\n/)
    .filter(line => !line.startsWith('@@nevo:progress@@'))
    .join('\n')
    .trim();
  try {
    return JSON.parse(nonProgress);
  } catch {
    throw new Error(`Unable to parse ${label} report.`);
  }
}

export function taskGate(changeOrRunSpecs, taskOrRoot, slugOrOptions, maybeTask) {
  if (typeof changeOrRunSpecs === 'function') {
    const runSpecs = changeOrRunSpecs;
    const root = taskOrRoot;
    const slug = slugOrOptions;
    const task = maybeTask;
    const action = ACTIONABLE_TASK_STATUSES.get(task?.status);
    if (!action) return null;
    try {
      const report = parseReport(runSpecs(root, [action, slug, task.id, '--check']), `${action} check`);
      return {
        action,
        enabled: Boolean(report.result?.ok && !report.result?.idempotent),
        reason: report.result?.ok ? null : (report.result?.reason || `The ${action} gate did not pass.`),
      };
    } catch {
      return { action, enabled: false, reason: `Nie udało się sprawdzić bramki ${action}.` };
    }
  }

  const change = changeOrRunSpecs;
  const task = taskOrRoot;
  const options = slugOrOptions || {};
  if (options.taskGateEvaluator) {
    return options.taskGateEvaluator(change, task);
  }
  if (options.runSpecs) {
    const action = ACTIONABLE_TASK_STATUSES.get(task?.status);
    if (!action) return null;
    try {
      const report = parseReport(options.runSpecs(options.root, [action, options.slug, task.id, '--check']), `${action} check`);
      return {
        action,
        enabled: Boolean(report.result?.ok && !report.result?.idempotent),
        reason: report.result?.ok ? null : (report.result?.reason || `The ${action} gate did not pass.`),
      };
    } catch {
      return { action, enabled: false, reason: `Nie udało się sprawdzić bramki ${action}.` };
    }
  }
  return evaluateTaskGate(change, task, options);
}

export function finalizeGate(first, second, third) {
  if (typeof first === 'function') {
    try {
      const report = parseReport(first(second, ['finalize', third, '--check']), 'finalize check');
      return {
        enabled: Boolean(report.result?.ok),
        reason: report.result?.ok ? null : (report.result?.reason || 'The finalize gate did not pass.'),
        checks: report.facts?.verification || [],
        pullRequest: report.facts?.pr || null,
        branch: report.facts?.branch || { hasUpstream: false, ahead: null, behind: null },
      };
    } catch {
      return {
        enabled: false,
        reason: 'Nie udało się sprawdzić bramki finalizacji.',
        checks: [],
        pullRequest: null,
        branch: { hasUpstream: false, ahead: null, behind: null },
      };
    }
  }

  const change = first;
  const facts = second || {};
  const result = evaluateGate('finalize', { change, ...facts }, { mode: 'full' });
  return {
    enabled: Boolean(result.ok),
    reason: result.ok ? null : (result.reason || 'The finalize gate did not pass.'),
    checks: facts?.verification || [],
    pullRequest: facts?.pr || null,
    branch: facts?.branch || { hasUpstream: false, ahead: null, behind: null },
  };
}

function requireActiveChange(slug, activeDir) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new SpecificationActionError('Active specification not found.', 404);
  }
  const change = loadChange(slug, activeDir);
  if (!change) throw new SpecificationActionError('Active specification not found.', 404);
  return change;
}

export async function getLocalBranchTracking(root) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
    return {
      hasUpstream: true,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return { hasUpstream: false, ahead: null, behind: null };
  }
}

export async function loadSpecificationActions({
  slug,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  taskGateEvaluator,
  runSpecs,
  worktreeLoader = git.getWorkingTreeSummary,
  branchLoader = git.getCurrentBranch,
  trackingLoader = getLocalBranchTracking,
} = {}) {
  const change = requireActiveChange(slug, activeDir);
  const worktree = await worktreeLoader(root);
  const branch = await branchLoader(root);
  const tracking = await trackingLoader(root, branch);

  let openBlockingFollowUps = [];
  try {
    const followUps = loadFollowUps(change);
    openBlockingFollowUps = (followUps.follow_ups || [])
      .filter(f => f.status === 'open' && f.severity === 'blocking')
      .map(f => ({ id: f.id, reason: f.reason }));
  } catch {}

  const gateResult = evaluateGate('finalize', {
    change,
    worktree,
    branch: { ...tracking, branch },
    openBlockingFollowUps,
  }, { mode: 'fast' });

  const tasks = {};
  for (const task of change.tasks) {
    const gate = await taskGate(change, task, { taskGateEvaluator, runSpecs, root, slug });
    if (gate) {
      tasks[task.id] = gate;
    }
  }

  return {
    id: change.id || change._slug,
    slug: change._slug,
    source: 'active',
    generatedAt: new Date().toISOString(),
    worktree: {
      ...worktree,
      branch,
      ...tracking,
    },
    tasks,
    finalize: {
      enabled: gateResult.status === 'allowed' || gateResult.status === 'needs-full-check',
      status: gateResult.status,
      reason: gateResult.status === 'blocked' ? gateResult.reason : null,
      checks: [],
      pullRequest: null,
    },
  };
}

export function executeSpecificationAction({
  slug,
  action,
  taskId,
  confirmed = false,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  runSpecs,
  spawnSpecs = defaultSpecsSpawner,
  operationRuntime,
  onFinished,
} = {}) {
  const change = requireActiveChange(slug, activeDir);

  let args;
  let operationType;
  if (action === 'approve' || action === 'verify') {
    const task = change.tasks.find(candidate => candidate.id === taskId);
    if (!task) throw new SpecificationActionError('Task not found.', 404);
    args = [action, slug, task.id];
    operationType = `spec-action-${action}`;
  } else if (action === 'finalize') {
    if (!confirmed) throw new SpecificationActionError('Finalization requires explicit confirmation.', 400);
    args = ['finalize', slug];
    operationType = 'spec-action-finalize';
  } else {
    throw new SpecificationActionError('Unknown specification action.', 400);
  }

  let finished = false;
  function markFinished() {
    if (finished) return;
    finished = true;
    if (typeof onFinished === 'function') {
      try { onFinished(); } catch {}
    }
  }

  // When custom mock runSpecs is supplied in tests:
  if (typeof runSpecs === 'function' && (!spawnSpecs || spawnSpecs === defaultSpecsSpawner)) {
    try {
      const output = runSpecs(root, args);
      let parsed = null;
      try { parsed = JSON.parse(output); } catch {}
      const operationId = operationRuntime
        ? operationRuntime.createOperation({ type: operationType })
        : `op-${Date.now()}`;
      if (operationRuntime) {
        operationRuntime.completeOperation(operationId, parsed || { ok: true });
      }
      return {
        ok: true,
        operationId,
        action,
        ...(taskId ? { taskId } : {}),
        message: action === 'approve'
          ? 'Zadanie zostało zatwierdzone.'
          : (action === 'verify' ? 'Implementacja została zaakceptowana.' : 'Specyfikacja została sfinalizowana.'),
      };
    } finally {
      markFinished();
    }
  }

  // When no custom mock spawner is supplied, execute in-process directly:
  if (!spawnSpecs || spawnSpecs === defaultSpecsSpawner) {
    const operationId = operationRuntime
      ? operationRuntime.createOperation({ type: operationType })
      : `op-${Date.now()}`;

    queueMicrotask(() => {
      try {
        const emitter = createProgressEmitter({
          out: null,
          onEvent: (event) => {
            if (operationRuntime && event.type !== 'operation.started') {
              operationRuntime.recordEvent(operationId, event);
            }
          },
        });

        if (action === 'approve') {
          handleApprove(slug, taskId, { activeDir, gitRoot: root, emitter });
        } else if (action === 'verify') {
          handleVerify(slug, taskId, { activeDir, gitRoot: root, emitter });
        } else if (action === 'finalize') {
          handleFinalize(slug, { gitRoot: root, emitter });
        }

        if (operationRuntime) {
          operationRuntime.completeOperation(operationId, {
            ok: true,
            action,
            ...(taskId ? { taskId } : {}),
          });
        }
      } catch (error) {
        if (operationRuntime) {
          operationRuntime.failOperation(operationId, {
            message: error?.message || 'Operation failed',
            code: error?.code,
          });
        }
      } finally {
        markFinished();
      }
    });

    return {
      ok: true,
      operationId,
      action,
      ...(taskId ? { taskId } : {}),
      message: action === 'approve'
        ? 'Zadanie zostało zatwierdzone.'
        : (action === 'verify' ? 'Implementacja została zaakceptowana.' : 'Specyfikacja została sfinalizowana.'),
    };
  }

  const operationId = operationRuntime
    ? operationRuntime.createOperation({ type: operationType })
    : `op-${Date.now()}`;

  const child = spawnSpecs(root, args);

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let lastJsonReport = null;

  function processLine(line) {
    if (!line) return;
    const progressEvent = parseProgressLine(line);
    if (progressEvent && operationRuntime) {
      operationRuntime.recordEvent(operationId, progressEvent);
    } else {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed && typeof parsed === 'object') {
          lastJsonReport = parsed;
        }
      } catch {
        // ignore plain lines
      }
    }
  }

  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      let newlineIdx;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx).replace(/\r$/, '');
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        processLine(line);
      }
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderrBuffer += chunk;
    });
  }

  child.on('error', err => {
    if (operationRuntime) {
      operationRuntime.failOperation(operationId, err.message || 'Process error');
    }
    markFinished();
  });

  child.on('close', (code, signal) => {
    try {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer.trim().replace(/\r$/, ''));
      }
      if (code === 0) {
        if (operationRuntime) {
          operationRuntime.completeOperation(operationId, lastJsonReport || { ok: true });
        }
      } else {
        const errorMsg = stderrBuffer.trim() || lastJsonReport?.error?.message || `Process exited with code ${code}${signal ? ` (${signal})` : ''}`;
        if (operationRuntime) {
          operationRuntime.failOperation(operationId, { message: errorMsg, code: lastJsonReport?.code });
        }
      }
    } finally {
      markFinished();
    }
  });

  return {
    ok: true,
    operationId,
    action,
    ...(taskId ? { taskId } : {}),
    message: action === 'approve'
      ? 'Zadanie zostało zatwierdzone.'
      : (action === 'verify' ? 'Implementacja została zaakceptowana.' : 'Specyfikacja została sfinalizowana.'),
  };
}
