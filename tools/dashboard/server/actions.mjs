import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

import * as git from '../../lib/git.mjs';
import { parseProgressLine } from '../../lib/operation-progress.mjs';
import { evaluateGate } from '../../specs/gates.mjs';
import { ACTIVE_DIR, loadChange, loadFollowUps } from '../../specs/service.mjs';
import { REPOSITORY_ROOT } from './data.mjs';

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

function defaultSpecsRunner(root, args) {
  const script = resolve(root, 'tools', 'specs.mjs');
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

export function defaultSpecsSpawner(root, args) {
  const script = resolve(root, 'tools', 'specs.mjs');
  return spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseReport(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Unable to parse ${label} report.`);
  }
}

function taskGate(runSpecs, root, slug, task) {
  const action = ACTIONABLE_TASK_STATUSES.get(task.status);
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

function finalizeGate(runSpecs, root, slug) {
  try {
    const report = parseReport(runSpecs(root, ['finalize', slug, '--check']), 'finalize check');
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

function requireActiveChange(slug, activeDir) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new SpecificationActionError('Active specification not found.', 404);
  }
  const change = loadChange(slug, activeDir);
  if (!change) throw new SpecificationActionError('Active specification not found.', 404);
  return change;
}

function getLocalBranchTracking(root) {
  try {
    const raw = execFileSync('git', ['-C', root, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const [behind, ahead] = raw.split(/\s+/).map(Number);
    return { hasUpstream: true, ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
  } catch {
    return { hasUpstream: false, ahead: null, behind: null };
  }
}

export function loadSpecificationActions({
  slug,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  runSpecs = defaultSpecsRunner,
  worktreeLoader = git.getWorkingTreeSummary,
  branchLoader = git.getCurrentBranch,
  trackingLoader = getLocalBranchTracking,
} = {}) {
  const change = requireActiveChange(slug, activeDir);
  const worktree = worktreeLoader(root);
  const branch = branchLoader(root);
  const tracking = trackingLoader(root, branch);

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
    tasks: Object.fromEntries(change.tasks
      .map(task => [task.id, taskGate(runSpecs, root, slug, task)])
      .filter(([, gate]) => gate)),
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

  // D11: Triggering verify/approve/finalize spawns exactly ONE child process — no pre-flight --check spawn
  if (typeof runSpecs === 'function' && spawnSpecs === defaultSpecsSpawner) {
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

export { taskGate, finalizeGate };
