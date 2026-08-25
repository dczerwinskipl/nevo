import { TERMINAL_STATUSES, completionHardStop, validateTransition, validateApproval } from './lifecycle-primitives.mjs';
import { computeMechanicalExemption } from './validation.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from './fingerprint.mjs';
import { loadReview } from './lifecycle/reviews.mjs';

/**
 * Registry of validator building blocks.
 * Maps validator ID -> { id: string, cost: 'cheap' | 'expensive', validate: (context) => ValidatorResult }
 */
export const validatorRegistry = new Map();

/**
 * Register a validator building block.
 */
export function registerValidator(id, { cost = 'cheap', validate }) {
  if (typeof id !== 'string' || !id) throw new TypeError('Validator id must be a non-empty string.');
  if (cost !== 'cheap' && cost !== 'expensive') throw new TypeError(`Invalid validator cost '${cost}': must be 'cheap' or 'expensive'.`);
  if (typeof validate !== 'function') throw new TypeError('Validator validate must be a function.');
  validatorRegistry.set(id, { id, cost, validate });
}

// ── Register core finalize validators ────────────────────────────────────────

registerValidator('tasks-terminal', {
  cost: 'cheap',
  validate(context) {
    const tasks = context.change?.tasks || [];
    const notTerminal = tasks.filter(t => !TERMINAL_STATUSES.has(t.status));
    if (notTerminal.length) {
      return {
        ok: false,
        reason: `Task(s) not in a terminal status: ${notTerminal.map(t => t.id).join(', ')}. Every task must be implemented/verified before finalizing.`,
      };
    }
    if (tasks.length === 0) {
      return { ok: false, reason: 'Specification has no tasks.' };
    }
    return { ok: true };
  },
});

registerValidator('follow-ups-blocking', {
  cost: 'cheap',
  validate(context) {
    const followUps = context.openBlockingFollowUps || context.facts?.openBlockingFollowUps || [];
    if (followUps.length) {
      return {
        ok: false,
        reason: `Open blocking follow-up(s): ${followUps.map(f => f.id).join(', ')}. Resolve, or dismiss with a recorded owner decision, before finalizing.`,
      };
    }
    return { ok: true };
  },
});

registerValidator('working-tree-clean', {
  cost: 'cheap',
  validate(context) {
    const isClean = context.gitClean !== undefined
      ? context.gitClean
      : (context.worktree?.clean !== undefined ? context.worktree.clean : context.facts?.gitClean);
    if (isClean === undefined) {
      return { ok: false, reason: 'Working tree status is unknown.' };
    }
    if (!isClean) {
      return { ok: false, reason: 'Working tree has uncommitted changes. Commit or discard them first.' };
    }
    return { ok: true };
  },
});

registerValidator('branch-not-behind', {
  cost: 'cheap',
  validate(context) {
    const branch = context.branch || context.facts?.branch || {};
    if (branch.behind > 0) {
      return {
        ok: false,
        reason: `Local branch is ${branch.behind} commit(s) behind its remote — pull/rebase first.`,
      };
    }
    return { ok: true };
  },
});

registerValidator('branch-pushed', {
  cost: 'cheap',
  validate(context) {
    const branch = context.branch || context.facts?.branch || {};
    if (!branch.hasUpstream || branch.ahead > 0) {
      return { ok: false, reason: 'Branch has commits not yet pushed to origin. Push before finalizing.' };
    }
    return { ok: true };
  },
});

registerValidator('gh-available', {
  cost: 'expensive',
  validate(context) {
    const ghAvailable = context.ghAvailable !== undefined
      ? context.ghAvailable
      : context.facts?.ghAvailable;
    if (ghAvailable === undefined) {
      return { ok: false, reason: 'gh CLI availability was not checked.' };
    }
    if (ghAvailable === false) {
      return { ok: false, reason: 'gh CLI is not available — cannot verify PR/review-thread state. Install/authenticate gh and retry.' };
    }
    return { ok: true };
  },
});

registerValidator('pr-exists', {
  cost: 'expensive',
  validate(context) {
    const pr = context.pr !== undefined ? context.pr : context.facts?.pr;
    if (!pr) {
      return { ok: false, reason: 'No pull request found for this branch. Open one before finalizing.' };
    }
    return { ok: true };
  },
});

registerValidator('pr-merged-or-open', {
  cost: 'expensive',
  validate(context) {
    const pr = context.pr !== undefined ? context.pr : context.facts?.pr;
    if (!pr) return { ok: false, reason: 'No pull request found.' };
    if (pr.state === 'MERGED') {
      return { ok: true, idempotent: true };
    }
    if (pr.state !== 'OPEN') {
      return { ok: false, reason: `PR #${pr.number} has state '${pr.state}', expected 'OPEN' or 'MERGED'.` };
    }
    return { ok: true };
  },
});

registerValidator('pr-not-draft', {
  cost: 'expensive',
  validate(context) {
    const pr = context.pr !== undefined ? context.pr : context.facts?.pr;
    if (!pr) return { ok: false, reason: 'No pull request found.' };
    if (pr.isDraft) {
      return { ok: false, reason: `PR #${pr.number} is still a draft. Mark it ready for review before finalizing.` };
    }
    return { ok: true };
  },
});

registerValidator('pr-threads-resolved', {
  cost: 'expensive',
  validate(context) {
    const pr = context.pr !== undefined ? context.pr : context.facts?.pr;
    if (!pr) return { ok: false, reason: 'No pull request found.' };
    if (pr.unresolvedThreads > 0) {
      return {
        ok: false,
        reason: `PR #${pr.number} has ${pr.unresolvedThreads} unresolved review thread(s). Resolve all threads before finalizing.`,
      };
    }
    return { ok: true };
  },
});

registerValidator('verification-checks-passed', {
  cost: 'expensive',
  validate(context) {
    const verification = context.verification || context.facts?.verification || [];
    const failedChecks = verification.filter(v => !v.passed);
    if (failedChecks.length) {
      return {
        ok: false,
        reason: `Verification check '${failedChecks[0].name}' failed: ${failedChecks[0].detail || 'see details above'}. Every check must pass before finalizing.`,
      };
    }
    return { ok: true };
  },
});

// ── Register Task gate validators ──────────────────────────────────────────

registerValidator('task-in-implementation', {
  cost: 'cheap',
  validate(context) {
    const task = context.task;
    if (!task) return { ok: false, reason: 'Task context is required.' };
    const transition = validateTransition('complete', task.status);
    if (!transition.ok) return transition;
    return { ok: true, idempotent: transition.idempotent };
  },
});

registerValidator('task-self-check-not-failing', {
  cost: 'cheap',
  validate(context) {
    const task = context.task;
    if (!task) return { ok: false, reason: 'Task context is required.' };
    const hardStop = completionHardStop(task, { inActiveBatch: Boolean(context.inActiveBatch) });
    if (hardStop) {
      return {
        ok: false,
        reason: `Task '${task.id}' has a hard-stopped self-check (${hardStop.code}: ${hardStop.detail}). Cannot complete.`,
      };
    }
    return { ok: true };
  },
});

registerValidator('task-in-implemented', {
  cost: 'cheap',
  validate(context) {
    const task = context.task;
    if (!task) return { ok: false, reason: 'Task context is required.' };
    const transition = validateTransition('verify', task.status);
    if (!transition.ok) return transition;
    return { ok: true, idempotent: transition.idempotent };
  },
});

registerValidator('task-self-check-passed', {
  cost: 'cheap',
  validate(context) {
    const task = context.task;
    if (!task) return { ok: false, reason: 'Task context is required.' };
    if (task.status === 'verified') return { ok: true, idempotent: true };
    if (task.self_check) {
      if (task.self_check.status !== 'passed') {
        return {
          ok: false,
          reason: `Task '${task.id}' self-check status is '${task.self_check.status}'. Must be 'passed' to verify.`,
        };
      }
      if (task.implementation?.baseline_revision && (task.implementation?.changed_paths || []).length > 0) {
        if (task.self_check.revision === task.implementation.baseline_revision) {
          return {
            ok: false,
            reason: `Task '${task.id}' self_check.revision ('${task.self_check.revision}') matches baseline_revision and predates task implementation. Re-run self-check against the implementation state.`,
          };
        }
      }
    }
    return { ok: true };
  },
});

registerValidator('task-approval-valid', {
  cost: 'cheap',
  validate(context) {
    const { task, review, currentFingerprint, mechanicalExempt, taskId, currentTaskFingerprint } = context;
    if (!task) return { ok: false, reason: 'Task context is required.' };
    return validateApproval(task.status, review, currentFingerprint, {
      mechanicalExempt,
      taskId: taskId || task.id,
      currentTaskFingerprint,
    });
  },
});

// ── Declarative Gate Definitions ───────────────────────────────────────────

export const gateDefinitions = {
  finalize: {
    validators: [
      'tasks-terminal',
      'follow-ups-blocking',
      'working-tree-clean',
      'branch-not-behind',
      'branch-pushed',
      'gh-available',
      'pr-exists',
      'pr-merged-or-open',
      'pr-not-draft',
      'pr-threads-resolved',
      'verification-checks-passed',
    ],
  },
  'task.request-human-verification': {
    validators: [
      'task-in-implementation',
      'task-self-check-not-failing',
    ],
  },
  'task.verify': {
    validators: [
      'task-in-implemented',
      'task-self-check-passed',
    ],
  },
  'task.approve': {
    validators: [
      'task-approval-valid',
    ],
  },
};

// ── Declarative Action Definitions ─────────────────────────────────────────

export const actionDefinitions = {
  finalize: {
    gate: 'finalize',
    steps: [
      { id: 'validate-specs', label: 'Validate specs' },
      { id: 'check-specs-indexes', label: 'Check spec indexes' },
      { id: 'validate-docs', label: 'Validate docs' },
      { id: 'check-docs-indexes', label: 'Check docs indexes' },
      { id: 'load-pr-review', label: 'Load PR and review state' },
      { id: 'evaluate-finalize-gate', label: 'Evaluate finalize gate' },
      { id: 'archive-change', label: 'Archive specification' },
      { id: 'push-and-merge', label: 'Push and merge' },
      { id: 'post-merge-check', label: 'Post-merge check' },
    ],
  },
  approve: {
    gate: 'task.approve',
    steps: [
      { id: 'validate-approval', label: 'Validate approval' },
      { id: 'approve-task', label: 'Approve task' },
      { id: 'rebuild-metadata', label: 'Rebuild spec metadata' },
      { id: 'commit-approval', label: 'Commit approval' },
      { id: 'push-approval', label: 'Push approval' },
    ],
  },
  verify: {
    gate: 'task.verify',
    steps: [
      { id: 'validate-transition', label: 'Validate transition' },
      { id: 'verify-task', label: 'Verify task' },
      { id: 'rebuild-metadata', label: 'Rebuild spec metadata' },
      { id: 'commit-verification', label: 'Commit verification' },
      { id: 'push-verification', label: 'Push verification' },
    ],
  },
  complete: {
    gate: 'task.request-human-verification',
    steps: [
      { id: 'validate-transition', label: 'Validate transition' },
      { id: 'check-self-check', label: 'Check self-check status' },
      { id: 'mark-implemented', label: 'Mark task implemented' },
    ],
  },
};

/**
 * Generic gate evaluator.
 *
 * @param {string} gateId - ID of gate in gateDefinitions
 * @param {object} context - Validation context data
 * @param {object} [options] - Evaluation options
 * @param {'fast'|'full'} [options.mode='full'] - Mode: 'fast' skips expensive checks, 'full' runs all
 * @returns {GateEvaluationResult}
 */
export function evaluateGate(gateId, context = {}, { mode = 'full' } = {}) {
  const definition = gateDefinitions[gateId];
  if (!definition) {
    throw new Error(`Gate '${gateId}' is not defined.`);
  }

  const validations = [];
  let hadSkipped = false;
  let isIdempotent = false;

  for (const validatorId of definition.validators) {
    const validator = validatorRegistry.get(validatorId);
    if (!validator) {
      throw new Error(`Validator '${validatorId}' is not registered in validatorRegistry.`);
    }

    if (mode === 'fast' && validator.cost === 'expensive') {
      validations.push({
        id: validatorId,
        status: 'skipped',
        reason: 'expensive',
      });
      hadSkipped = true;
      continue;
    }

    const result = validator.validate(context);
    if (!result || typeof result !== 'object') {
      throw new Error(`Validator '${validatorId}' returned an invalid result.`);
    }

    if (!result.ok) {
      const validationEntry = {
        id: validatorId,
        status: 'failed',
        reason: result.reason,
        ...(result.code ? { code: result.code } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      };
      validations.push(validationEntry);

      return {
        gateId,
        status: 'blocked',
        ok: false,
        reason: result.reason,
        code: result.code,
        idempotent: false,
        validations,
      };
    }

    if (result.idempotent) {
      isIdempotent = true;
    }

    validations.push({
      id: validatorId,
      status: 'passed',
      ...(result.idempotent ? { idempotent: true } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
    });
  }

  if (hadSkipped) {
    return {
      gateId,
      status: 'needs-full-check',
      ok: false,
      reason: 'Some expensive validators were skipped in fast mode.',
      idempotent: isIdempotent,
      validations,
    };
  }

  return {
    gateId,
    status: 'allowed',
    ok: true,
    idempotent: isIdempotent,
    validations,
  };
}

const ACTIONABLE_TASK_STATUSES = new Map([
  ['draft', 'approve'],
  ['implemented', 'verify'],
]);

/**
 * Evaluates the gate for an actionable task directly in-process.
 *
 * @param {object} change - Specification change object
 * @param {object} task - Task object within the change
 * @param {object} [options]
 * @returns {{ action: string, enabled: boolean, reason: string | null } | null}
 */
export function evaluateTaskGate(change, task, options = {}) {
  const action = ACTIONABLE_TASK_STATUSES.get(task?.status);
  if (!action) return null;

  try {
    if (action === 'approve') {
      let mechanicalExempt = false;
      try {
        const exemptResult = computeMechanicalExemption(change, task);
        mechanicalExempt = Boolean(exemptResult?.eligible);
      } catch {}

      let review = null;
      try {
        review = loadReview(change);
      } catch {}

      let currentFingerprint = null;
      try {
        currentFingerprint = computeChangeFingerprint(change);
      } catch {}

      let currentTaskFingerprint = null;
      try {
        currentTaskFingerprint = computeTaskFingerprint(change, task.id);
      } catch {}

      const gateResult = evaluateGate('task.approve', {
        task,
        review,
        currentFingerprint,
        mechanicalExempt,
        taskId: task.id,
        currentTaskFingerprint,
      }, { mode: 'full' });

      return {
        action,
        enabled: Boolean(gateResult.ok && !gateResult.idempotent),
        reason: gateResult.ok ? null : (gateResult.reason || 'The approve gate did not pass.'),
      };
    }

    if (action === 'verify') {
      const gateResult = evaluateGate('task.verify', { task, change }, { mode: 'full' });
      return {
        action,
        enabled: Boolean(gateResult.ok && !gateResult.idempotent),
        reason: gateResult.ok ? null : (gateResult.reason || 'The verify gate did not pass.'),
      };
    }
  } catch {
    return { action, enabled: false, reason: `Nie udało się sprawdzić bramki ${action}.` };
  }

  return null;
}
