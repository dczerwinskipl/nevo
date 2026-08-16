import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import * as git from '../../lib/git.mjs';
import { ACTIVE_DIR, loadChange } from '../../specs/service.mjs';
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

function cheapFinalizeGate(change, worktree) {
  const allVerified = change.tasks.length > 0 && change.tasks.every(t => t.status === 'verified');
  const clean = Boolean(worktree?.clean);
  const enabled = allVerified && clean;
  let reason = null;
  if (!allVerified) {
    reason = 'Wszystkie zadania muszą być zweryfikowane.';
  } else if (!clean) {
    reason = 'Katalog roboczy zawiera niezacommitowane zmiany.';
  }
  return {
    enabled,
    reason,
    checks: [],
    pullRequest: null,
  };
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
  const finalize = cheapFinalizeGate(change, worktree);

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
      enabled: finalize.enabled,
      reason: finalize.reason,
      checks: finalize.checks,
      pullRequest: finalize.pullRequest,
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
  runSpecs = defaultSpecsRunner,
} = {}) {
  const change = requireActiveChange(slug, activeDir);

  if (action === 'approve' || action === 'verify') {
    const task = change.tasks.find(candidate => candidate.id === taskId);
    if (!task) throw new SpecificationActionError('Task not found.', 404);
    const gate = taskGate(runSpecs, root, slug, task);
    if (!gate || gate.action !== action) {
      throw new SpecificationActionError(`Action '${action}' is not available for this task.`);
    }
    if (!gate.enabled) throw new SpecificationActionError(gate.reason || `Action '${action}' is blocked.`);
    runSpecs(root, [action, slug, task.id]);
    return {
      ok: true,
      action,
      taskId: task.id,
      message: action === 'approve' ? 'Zadanie zostało zatwierdzone.' : 'Implementacja została zaakceptowana.',
    };
  }

  if (action === 'finalize') {
    if (!confirmed) throw new SpecificationActionError('Finalization requires explicit confirmation.', 400);
    const gate = finalizeGate(runSpecs, root, slug);
    if (!gate.enabled) throw new SpecificationActionError(gate.reason || 'Finalization is blocked.');
    runSpecs(root, ['finalize', slug]);
    return { ok: true, action, message: 'Specyfikacja została sfinalizowana.' };
  }

  throw new SpecificationActionError('Unknown specification action.', 400);
}
