import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontMatterFile } from '../../lib/yaml.mjs';
import { completionHardStop } from '../lifecycle-primitives.mjs';
import { pathMatchesAllowedPattern } from './recovery.mjs';

// ── Multi-task implementation review orchestration (D30, task 12) ──────────
//
// `/nevo-ai:implementation-review`'s deterministic surface: resolving
// `--all`/`--tasks` into an eligibility-checked scope, the overall verdict
// table, which tasks are eligible for the bulk-verification offer, and the
// atomic bulk status transition. The per-task review depth itself is
// `task-review`'s own flow, reused, not reimplemented here (area
// implementation-review-orchestration, requirement 3) — nothing in this
// section re-evaluates an individual task's own acceptance criteria.

// A task has something real to review only once it has entered
// implementation — `draft`/`approved` have no diff yet, `abandoned` was
// explicitly dropped. `archived` is included (a task can be individually
// archived independently of its whole change) but never needs a further
// bulk-transition hop — see computeBulkTransitionTarget below.
export const MULTI_REVIEW_ELIGIBLE_STATUSES = new Set(['in-implementation', 'implemented', 'verified', 'archived']);

// ── Scoped and incremental spec-review (D34/D35, task 17) ──────────────────

export const SPEC_REVIEW_SCOPE_MODES = new Set(['all', 'tasks', 'changed']);

/**
 * Resolve `--all`/`--tasks <spec>`/`--changed` into an ordered, deduplicated
 * list of task ids for a scoped `/nevo-ai:spec-review` run (area
 * scoped-spec-review requirement 1) — distinct from `resolveReviewScope`
 * (task 12), which filters by `MULTI_REVIEW_ELIGIBLE_STATUSES`;
 * `spec-review` reviews a task's *specification*, before it ever reaches
 * that lifecycle point, so no status filtering applies here. Exactly one of
 * `all`/`tasks`/`changed` is accepted — no flag given is the caller's job to
 * treat as `all` (the compatibility default), not this function's.
 * `changedTaskIds` (for `changed`) is supplied by the caller — computed via
 * `selectChangedTaskIds`, since fingerprint comparison needs file access this
 * pure function doesn't have.
 */
export function resolveSpecReviewScope(change, { all = false, tasks: tasksSpec, changed = false, changedTaskIds = [] } = {}) {
  const modesGiven = [all, Boolean(tasksSpec), changed].filter(Boolean).length;
  if (modesGiven !== 1) {
    return { ok: false, reason: 'Exactly one of --all/--tasks/--changed is required.' };
  }
  if (all) return { ok: true, mode: 'all', taskIds: change.tasks.map(t => t.id) };
  if (changed) return { ok: true, mode: 'changed', taskIds: [...changedTaskIds] };

  const parsed = parseTaskOrderSpec(tasksSpec);
  if (!parsed.ok) return parsed;
  const byOrder = new Map(change.tasks.map(t => [t.order, t.id]));
  const taskIds = [];
  for (const order of parsed.orders) {
    const id = byOrder.get(order);
    if (!id) return { ok: false, reason: `--tasks names order ${order}, which doesn't resolve to a real task in this change.` };
    taskIds.push(id);
  }
  return { ok: true, mode: 'tasks', taskIds: [...new Set(taskIds)] };
}

/**
 * `--changed` selection (area requirement 3) — exactly the tasks whose
 * current semantic fingerprint (D18) doesn't match what the prior review
 * recorded, or that have no recorded entry at all (a genuinely new task).
 * `evaluableTaskIds` is the set `--changed` is allowed to select from (the
 * caller excludes D32-grandfathered tasks the same way step 5a already
 * does) — this function never invents that exemption itself.
 */
export function selectChangedTaskIds(evaluableTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  const prior = priorTaskFingerprints || {};
  const current = currentTaskFingerprints || {};
  return evaluableTaskIds.filter(id => prior[id] === undefined || prior[id] !== current[id]);
}

/**
 * Names every out-of-scope task that is potentially impacted by this run
 * (area requirement 4, corrected) — an out-of-scope task's own current
 * `computeTaskFingerprint` no longer matching the baseline recorded for it in
 * `reviews/spec.md`'s `task_fingerprints` map. This is exactly
 * `scopedReviewBaselineValid`'s own `invalidTaskIds` computation, exposed
 * under this name for the reporting step (as distinct from the verdict-gate
 * use of the same check) — one deterministic signal, two consumers, never two
 * divergent computations.
 *
 * Reading or referencing an older, out-of-scope task as a
 * `semantic_references.dependency_contracts` entry of a selected task is
 * never, by itself, evidence of impact — a prior version of this function
 * used that direction as its signal, which is backwards: a new task
 * depending on an older one means the older task is context/dependency
 * input for the new one, not something the new task's existence can
 * invalidate. That direction-based check has been removed; `depIds`/`refs`
 * about the *selected* scope are not inputs to this function at all. Any
 * real cross-contract impact the deterministic fingerprint comparison
 * doesn't represent is a model-inspection judgment made at review time
 * (area requirement 4), reported separately in the review body — never
 * inferred by an automated function from a dependency reference alone.
 */
export function findPotentiallyImpactedOutOfScopeTasks(outOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  return scopedReviewBaselineValid(outOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints).invalidTaskIds;
}

/**
 * The scoped-verdict guard (area requirement 5) — a scoped review cannot
 * claim `ready-for-approval`/`approved-for-implementation` for the whole
 * change unless every task *outside* the selected scope still has a
 * fingerprint matching what the last review recorded for it.
 * `checkableOutOfScopeTaskIds` is the out-of-scope subset this check applies
 * to (the caller excludes D32-grandfathered tasks, same exemption step 5a
 * already uses) — a task with no prior recorded fingerprint at all is
 * treated as invalid (nothing to trust), not silently skipped.
 */
export function scopedReviewBaselineValid(checkableOutOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  const prior = priorTaskFingerprints || {};
  const current = currentTaskFingerprints || {};
  const invalidTaskIds = checkableOutOfScopeTaskIds.filter(id => prior[id] === undefined || prior[id] !== current[id]);
  return { valid: invalidTaskIds.length === 0, invalidTaskIds };
}

/**
 * Adapts task 14's compact-checklist rendering shape (`renderCompactReviewChecklist`)
 * to a scoped `spec-review` run's own five-value verdict vocabulary (area
 * requirement 6) — reused, not a second, divergent renderer. Only for the
 * fully-passing case (`ready-for-approval`/`approved-for-implementation`,
 * zero unresolved findings of any kind) — a review with any unresolved
 * finding keeps the full report shape, unchanged.
 */
export function renderScopedSpecReviewBody({
  status, unresolvedRequiredFixes = 0, unresolvedOwnerDecisions = 0, unresolvedNeedsClarification = 0,
} = {}, { title } = {}) {
  const passing = (status === 'ready-for-approval' || status === 'approved-for-implementation')
    && unresolvedRequiredFixes === 0 && unresolvedOwnerDecisions === 0 && unresolvedNeedsClarification === 0;
  if (!passing) {
    throw new Error('renderScopedSpecReviewBody is only for a fully-passing scoped review result.');
  }
  const lines = [
    '- [x] No unresolved required fix',
    '- [x] No unresolved owner decision',
    '- [x] No unresolved clarification request',
    `- [x] Verdict: ${status}`,
  ];
  return `# ${title}\n\n${lines.join('\n')}`;
}

/**
 * Parse a `--tasks` spec into the requested `order` numbers — a dash range
 * (`01-03`, inclusive, both bounds required and non-decreasing) or a
 * comma-separated list (`01,03,07`, deduplicated) — never both forms mixed
 * in one spec. Returns `{ ok: true, orders: [number, ...] }` or
 * `{ ok: false, reason }`.
 */
export function parseTaskOrderSpec(spec) {
  const trimmed = String(spec ?? '').trim();
  if (/^\d+-\d+$/.test(trimmed)) {
    const [start, end] = trimmed.split('-').map(Number);
    if (start > end) {
      return { ok: false, reason: `Invalid range '${trimmed}' — start (${start}) is after end (${end}).` };
    }
    const orders = [];
    for (let o = start; o <= end; o++) orders.push(o);
    return { ok: true, orders };
  }
  if (/^\d+(,\d+)*$/.test(trimmed)) {
    return { ok: true, orders: [...new Set(trimmed.split(',').map(Number))] };
  }
  return {
    ok: false,
    reason: `Invalid --tasks spec '${trimmed}' — expected a dash range (e.g. '01-03') or a comma list (e.g. '01,03,07').`,
  };
}

/**
 * Resolve `--all`/`--tasks` into an ordered, deduplicated, eligibility-
 * checked task id list (area implementation-review-orchestration,
 * requirement 2) — deterministic, CLI-backed, never agent-parsed. Exactly
 * one of `all`/`tasks` is required (no default, same "no implicit default"
 * principle as batch selection, D20). Order numbers are resolved against
 * each task's own `order` field. Rejects, naming the specific problem: an
 * order number that doesn't resolve to a real task; an invalid `--tasks`
 * spec; or any resolved task whose `status` isn't in
 * `MULTI_REVIEW_ELIGIBLE_STATUSES`.
 */
export function resolveReviewScope(change, { all = false, tasks: tasksSpec } = {}) {
  if (Boolean(all) === Boolean(tasksSpec)) {
    return { ok: false, reason: 'Exactly one of --all or --tasks is required.' };
  }

  let orderedIds;
  if (all) {
    orderedIds = [...change.tasks]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(t => t.id);
  } else {
    const parsed = parseTaskOrderSpec(tasksSpec);
    if (!parsed.ok) return parsed;

    const byOrder = new Map(change.tasks.map(t => [t.order, t]));
    const unresolved = parsed.orders.filter(o => !byOrder.has(o));
    if (unresolved.length) {
      return { ok: false, reason: `Order number(s) not found in this change: ${unresolved.join(', ')}.` };
    }
    orderedIds = [...parsed.orders].sort((a, b) => a - b).map(o => byOrder.get(o).id);
  }

  const ineligible = orderedIds
    .map(id => change.tasks.find(t => t.id === id))
    .filter(t => !MULTI_REVIEW_ELIGIBLE_STATUSES.has(t.status));
  if (ineligible.length) {
    return {
      ok: false,
      reason: `Task(s) not eligible for review (status must be one of ${[...MULTI_REVIEW_ELIGIBLE_STATUSES].join('/')}): ` +
        ineligible.map(t => `'${t.id}' (${t.status})`).join(', '),
    };
  }

  return { ok: true, orderedTasks: orderedIds };
}

export const MULTI_TASK_REVIEW_VERDICTS = new Set(['pass', 'changes-required', 'owner-decision-required', 'blocked']);

/**
 * Deterministic consistency guard between an aggregate `implementation-review`
 * and the per-task canonical review artifacts (`reviews/<task-id>.md`) it
 * summarizes — the exact class of contradiction a 2026-08-06 reconciliation
 * pass found by hand (an aggregate report claiming `pass` for a task whose own
 * `reviews/<task-id>.md` frontmatter still said `changes-required`). The
 * aggregate must never override or invent a per-task verdict in prose; this
 * function is what enforces that mechanically instead of relying on the
 * writer to remember. `perTaskReviews` is `{[taskId]: ReviewFrontmatter |
 * null}` — `null` (or absent) means the review file is missing/unreadable,
 * gathered by the caller (I/O). `ReviewFrontmatter` is `{ verdict,
 * unresolvedRequiredFixes, unresolvedOwnerDecisions,
 * unresolvedNeedsClarification }`, read verbatim from that file's frontmatter.
 * `aggregateRow` is `{[taskId]: verdict}`, the aggregate's own per-task
 * `Verdict` column as written. Returns `{ ok: true }` or `{ ok: false, reason
 * }` naming the first disagreement found, evaluated in `Object.keys(aggregateRow)`
 * order. Does not itself compare task fingerprints — no per-task review
 * currently persists one in its own frontmatter (unlike `spec-review`'s
 * `task_fingerprints` map); adding that is separate, larger work, not folded
 * in here silently.
 */
export function validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow) {
  for (const taskId of Object.keys(aggregateRow)) {
    const review = perTaskReviews[taskId];
    if (!review) {
      return { ok: false, reason: `'${taskId}': no canonical review artifact found (reviews/${taskId}.md missing or unreadable).` };
    }
    const unresolvedCount = (review.unresolvedRequiredFixes ?? 0) + (review.unresolvedOwnerDecisions ?? 0) + (review.unresolvedNeedsClarification ?? 0);
    if (review.verdict === 'pass' && unresolvedCount > 0) {
      return {
        ok: false,
        reason: `'${taskId}': canonical review (reviews/${taskId}.md) verdict is 'pass' but records ${unresolvedCount} unresolved finding(s) — internally inconsistent artifact, fix the review file first.`,
      };
    }
    if (review.verdict !== 'pass' && unresolvedCount === 0) {
      return {
        ok: false,
        reason: `'${taskId}': canonical review (reviews/${taskId}.md) verdict is '${review.verdict}' but records zero unresolved findings — internally inconsistent artifact, fix the review file first.`,
      };
    }
    if (aggregateRow[taskId] !== review.verdict) {
      return {
        ok: false,
        reason: `'${taskId}': aggregate row claims '${aggregateRow[taskId]}' but its canonical review (reviews/${taskId}.md) says '${review.verdict}'.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Overall verdict for `/nevo-ai:implementation-review` (D30, task 12,
 * area implementation-review-orchestration requirement 10) — computed from
 * an explicit table, never composed as prose, same convention as every other
 * verdict in this workflow. `taskVerdicts` are each selected task's own
 * `task-review`-equivalent verdict (`pass`/`changes-required`/`blocked`),
 * gathered by the caller — this function never re-evaluates any individual
 * task's own acceptance criteria itself. `ownerDecisionFindings`/
 * `autoFixFindings` count unresolved findings at either the per-task or the
 * cross-task-integration level, already merged by the caller.
 * `NON_BLOCKING`/`INFORMATIONAL` findings never participate, by construction
 * (the caller never passes them in).
 */
export function computeMultiTaskReviewVerdict({
  validationFailed = false,
  taskVerdicts = [],
  ownerDecisionFindings = 0,
  autoFixFindings = 0,
} = {}) {
  if (validationFailed) return 'blocked';
  if (taskVerdicts.includes('blocked')) return 'blocked';
  if (ownerDecisionFindings > 0) return 'owner-decision-required';
  if (taskVerdicts.includes('changes-required') || autoFixFindings > 0) return 'changes-required';
  return 'pass';
}

/**
 * Tasks eligible for the bulk-verification offer (area
 * implementation-review-orchestration, requirement 9): a task's own verdict
 * is `pass` **and** it carries zero unresolved blocking findings at either
 * the per-task or the cross-task-integration level. Every other selected
 * task must remain unchanged, regardless of which bulk-confirmation option
 * is chosen — this is a hard rule, not a per-run judgment call.
 * `taskResults` is `[{ id, verdict, blockingFindings }]`, gathered by the
 * caller from each task's own review and the cross-task integration pass.
 */
export function selectEligibleForVerification(taskResults) {
  return (taskResults || [])
    .filter(t => t.verdict === 'pass' && (t.blockingFindings || 0) === 0)
    .map(t => t.id);
}

export const MULTI_REVIEW_OUTCOMES = new Set(['self-verified', 'verified']);

/**
 * Compute one task's target status under a chosen bulk-transition outcome
 * (area implementation-review-orchestration, requirement 12). `self-verified`
 * never goes past `implemented`; `verified` always ends at `verified`,
 * hopping through `implemented` first for a task still `in-implementation`.
 * Never regresses an already-`verified` (or `archived`) task — those are
 * always a no-op regardless of outcome. Returns `{ ok: true, to, noop }` or
 * `{ ok: false, reason }` — the caller (`validateBulkTransition`) must
 * validate every selected task this way *before* writing any of them
 * (all-or-nothing).
 */
export function computeBulkTransitionTarget(currentStatus, outcome) {
  if (!MULTI_REVIEW_OUTCOMES.has(outcome)) {
    return { ok: false, reason: `Unknown outcome '${outcome}' — must be one of ${[...MULTI_REVIEW_OUTCOMES].join('/')}.` };
  }
  if (currentStatus === 'archived') return { ok: true, to: 'archived', noop: true };

  if (outcome === 'self-verified') {
    if (currentStatus === 'in-implementation') return { ok: true, to: 'implemented', noop: false };
    if (currentStatus === 'implemented' || currentStatus === 'verified') return { ok: true, to: currentStatus, noop: true };
    return { ok: false, reason: `Cannot apply outcome 'self-verified' to a task with status '${currentStatus}'.` };
  }

  // outcome === 'verified'
  if (currentStatus === 'in-implementation' || currentStatus === 'implemented') return { ok: true, to: 'verified', noop: false };
  if (currentStatus === 'verified') return { ok: true, to: 'verified', noop: true };
  return { ok: false, reason: `Cannot apply outcome 'verified' to a task with status '${currentStatus}'.` };
}

/**
 * Validate every eligible task's computed bulk-transition target *before*
 * anything is written (area implementation-review-orchestration, requirement
 * 12) — all-or-nothing: the first invalid task rejects the whole operation,
 * naming it. A task hopping through `implemented` (currentStatus ===
 * 'in-implementation' and the target isn't a no-op) is also checked against
 * the same hard-stop `complete` already performs standalone
 * (`completionHardStop` with `inActiveBatch: false` — this bulk operation is
 * not part of the D10/D20 batch-intent mechanism, so only an *existing,
 * failed* self-check blocks it, matching `complete`'s own out-of-batch
 * behavior). Returns `{ ok: true, transitions: [{ id, from, to, noop }] }` or
 * `{ ok: false, reason }`.
 */
export function validateBulkTransition(change, taskIds, outcome) {
  const transitions = [];
  for (const id of taskIds) {
    const task = change.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: `Task '${id}' not found.` };

    const target = computeBulkTransitionTarget(task.status, outcome);
    if (!target.ok) return { ok: false, reason: `'${id}': ${target.reason}` };

    if (task.status === 'in-implementation' && !target.noop) {
      const stop = completionHardStop(task, { inActiveBatch: false });
      if (stop) {
        return {
          ok: false,
          reason: `'${id}' has a hard-stopped self-check (${stop.code}: ${stop.detail}) — correct the ` +
            `implementation and rerun its self-check before it can be marked complete.`,
        };
      }
    }

    transitions.push({ id, from: task.status, to: target.to, noop: target.noop });
  }
  return { ok: true, transitions };
}

// ── Review report compaction and scope exceptions (D31, task 13) ───────────

export const TASK_REVIEW_CHECKLIST_ITEMS = [
  'ac-coverage', 'verification', 'scope', 'forbidden-path', 'docs', 'blocking-findings', 'owner-decision',
];

export const TASK_REVIEW_VERDICTS = new Set(['pass', 'changes-required', 'blocked']);

/**
 * Deterministic verdict-consistency guard (area requirement 5) — computed from
 * the seven checklist items, never composed as prose.
 */
export function computeTaskReviewChecklist({
  acCoverageComplete,
  missingRequiredAutomatedTest = false,
  verificationPassed,
  scopeStatus,
  forbiddenPathClean,
  docsConsistent,
  unresolvedBlockingCount = 0,
  unresolvedOwnerDecisionCount = 0,
} = {}) {
  if (!['compliant', 'accepted-exception', 'unresolved'].includes(scopeStatus)) {
    throw new Error(`Unknown scope status '${scopeStatus}' — must be one of compliant/accepted-exception/unresolved.`);
  }

  const unresolvedItems = [];

  if (!acCoverageComplete) {
    unresolvedItems.push({
      item: 'ac-coverage', category: 'OWNER_DECISION',
      reason: 'Not every acceptance criterion is met, partially met, tested, or unquestionable.',
    });
  }
  if (missingRequiredAutomatedTest) {
    unresolvedItems.push({
      item: 'ac-coverage', category: 'AUTO_FIX',
      reason: 'An explicitly required automated test is missing — a passing verification command alone does not cover it.',
    });
  }
  if (!verificationPassed) {
    unresolvedItems.push({ item: 'verification', category: 'AUTO_FIX', reason: 'Required automated verification did not pass.' });
  }
  if (scopeStatus === 'unresolved') {
    unresolvedItems.push({
      item: 'scope', category: 'OWNER_DECISION',
      reason: 'A scope violation outside allowed_paths has no valid, recorded owner-approved exception.',
    });
  }
  if (!forbiddenPathClean) {
    unresolvedItems.push({
      item: 'forbidden-path', category: 'AUTO_FIX',
      reason: 'A forbidden_paths violation remains — revert or re-attribute it; it is never resolvable via scope_exceptions.',
    });
  }
  if (!docsConsistent) {
    unresolvedItems.push({ item: 'docs', category: 'AUTO_FIX', reason: 'Architecture/documentation is not consistent with the change.' });
  }
  if (unresolvedBlockingCount > 0) {
    unresolvedItems.push({
      item: 'blocking-findings', category: 'AUTO_FIX',
      reason: `${unresolvedBlockingCount} unresolved blocking finding(s) remain.`,
    });
  }
  if (unresolvedOwnerDecisionCount > 0) {
    unresolvedItems.push({
      item: 'owner-decision', category: 'OWNER_DECISION',
      reason: `${unresolvedOwnerDecisionCount} unresolved owner decision(s) remain.`,
    });
  }

  return { verdict: unresolvedItems.length ? 'changes-required' : 'pass', unresolvedItems };
}

const TASK_REVIEW_CHECKLIST_LABELS = {
  'ac-coverage': 'All acceptance criteria covered',
  'verification': 'Required automated verification passed',
  'scope': 'Scope check resolved',
  'forbidden-path': 'No forbidden-path violation remains unresolved',
  'docs': 'Architecture and documentation remain consistent',
  'blocking-findings': 'No unresolved blocking findings',
  'owner-decision': 'No unresolved owner decision',
};

export function renderCompactReviewChecklist({ unresolvedItems = [] } = {}, { scopeExceptionCount = 0 } = {}) {
  const failuresByItem = new Map();
  for (const u of unresolvedItems) {
    if (!failuresByItem.has(u.item)) failuresByItem.set(u.item, []);
    failuresByItem.get(u.item).push(u.reason);
  }
  const lines = [];
  for (const item of TASK_REVIEW_CHECKLIST_ITEMS) {
    const failures = failuresByItem.get(item);
    if (failures) {
      lines.push(`- [ ] ${TASK_REVIEW_CHECKLIST_LABELS[item]}`);
      for (const reason of failures) lines.push(`  - ${reason}`);
    } else {
      lines.push(`- [x] ${TASK_REVIEW_CHECKLIST_LABELS[item]}`);
      if (item === 'scope' && scopeExceptionCount > 0) {
        lines.push(`  - ${scopeExceptionCount} owner-approved exception${scopeExceptionCount === 1 ? '' : 's'} recorded`);
      }
    }
  }
  return lines.join('\n');
}

export function renderNormalPassingReportBody(checklistResult, { title, totalAcceptanceCriteria, scopeExceptionCount = 0 } = {}) {
  if (!checklistResult || checklistResult.verdict !== 'pass') {
    throw new Error('renderNormalPassingReportBody is only for a passing checklist result — a failing/exception-bearing report uses the expanded shape instead.');
  }
  if (!Number.isInteger(totalAcceptanceCriteria) || totalAcceptanceCriteria < 1) {
    throw new Error('renderNormalPassingReportBody requires totalAcceptanceCriteria (a positive integer) to render the acceptance-criteria coverage line.');
  }
  const scopeLine = scopeExceptionCount > 0
    ? `- [x] Scope: resolved\n  - ${scopeExceptionCount} owner-approved exception${scopeExceptionCount === 1 ? '' : 's'} recorded`
    : '- [x] Scope: compliant';
  const lines = [
    `- [x] Acceptance criteria: ${totalAcceptanceCriteria}/${totalAcceptanceCriteria}`,
    scopeLine,
    '- [x] Findings: none unresolved',
  ];
  return `# ${title}\n\n${lines.join('\n')}`;
}

export function checkReportSectionUniqueness(reportBody) {
  const markers = {
    'ac-coverage': [/All acceptance criteria covered/gi, /## Acceptance-criteria coverage/gi, /Acceptance criteria: \d+\/\d+/gi],
    'scope': [/Scope check resolved/gi, /## Scope compliance/gi, /- \[x\] Scope: (compliant|resolved)/gi],
    'findings': [/## Findings/gi, /- \[x\] Findings: (none unresolved|\d+)/gi],
  };
  const duplicates = [];
  for (const [section, patterns] of Object.entries(markers)) {
    const count = patterns.reduce((sum, re) => sum + (reportBody.match(re) || []).length, 0);
    if (count > 1) duplicates.push({ section, count });
  }
  return { ok: duplicates.length === 0, duplicates };
}

export function classifyScopeFinding(path, { allowedPaths = [], forbiddenPaths = [] } = {}) {
  if (forbiddenPaths.some(p => pathMatchesAllowedPattern(path, p))) return 'forbidden';
  if (allowedPaths.some(p => pathMatchesAllowedPattern(path, p))) return 'compliant';
  return 'outside-allowed';
}

export function resolveScopeCheckPaths(task, liveDiffPaths) {
  const persisted = task?.implementation?.changed_paths || [];
  const live = liveDiffPaths || [];
  return [...new Set([...persisted, ...live])].sort();
}

export function isScopeExceptionValid(exception, { path, taskFingerprint }) {
  if (!exception) return false;
  return exception.path === path && exception.task_fingerprint === taskFingerprint;
}

export function selectSemanticIntegrationPairs(orderedTaskIds, taskSemanticRefs, fileOverlapPairs = []) {
  const pairs = new Map();
  const key = (a, b) => [a, b].sort().join(' ');
  for (const [a, b] of fileOverlapPairs) pairs.set(key(a, b), [a, b].sort());

  const refs = taskSemanticRefs || {};
  for (let i = 0; i < orderedTaskIds.length; i++) {
    for (let j = i + 1; j < orderedTaskIds.length; j++) {
      const a = orderedTaskIds[i];
      const b = orderedTaskIds[j];
      const ra = refs[a] || {};
      const rb = refs[b] || {};
      const dependencyRelated = (ra.dependencyContracts || []).includes(b) || (rb.dependencyContracts || []).includes(a);
      const sharedDecision = (ra.decisions || []).some(d => (rb.decisions || []).includes(d));
      if (dependencyRelated || sharedDecision) pairs.set(key(a, b), [a, b].sort());
    }
  }
  return [...pairs.values()];
}

export const PER_TASK_REVIEW_FIELDS = [
  'taskId', 'verdict', 'acCovered', 'acTotal', 'scopeStatus', 'blockingFindings',
  'pendingOwnerDecisions', 'pendingScopeDecisions', 'clarificationRequests',
  'followUpCandidates', 'reviewArtifact', 'implementationFingerprint',
];

export function validatePerTaskReviewRecord(record) {
  const missing = PER_TASK_REVIEW_FIELDS.filter(f => !(f in (record || {})));
  if (missing.length) {
    throw new Error(`Per-task review record for '${record?.taskId || '?'}' is missing required field(s): ${missing.join(', ')}`);
  }
  return true;
}

export function buildConsolidatedDecisionStage(records) {
  const ownerDecisions = [];
  const scopeDecisionsOutsideAllowed = [];
  const scopeDecisionsForbidden = [];
  const clarificationRequests = [];
  const followUpCandidates = [];

  for (const record of records || []) {
    for (const d of record.pendingOwnerDecisions || []) ownerDecisions.push({ taskId: record.taskId, ...d });
    for (const s of record.pendingScopeDecisions || []) {
      const bucket = s.classification === 'forbidden' ? scopeDecisionsForbidden : scopeDecisionsOutsideAllowed;
      bucket.push({ taskId: record.taskId, ...s });
    }
    for (const c of record.clarificationRequests || []) clarificationRequests.push({ taskId: record.taskId, ...c });
    for (const f of record.followUpCandidates || []) followUpCandidates.push({ taskId: record.taskId, ...f });
  }

  return {
    ownerDecisions,
    scopeDecisions: { outsideAllowed: scopeDecisionsOutsideAllowed, forbidden: scopeDecisionsForbidden },
    clarificationRequests,
    followUpCandidates,
    eligibleForBulkTransition: selectEligibleForVerification(
      (records || []).map(r => ({ id: r.taskId, verdict: r.verdict, blockingFindings: r.blockingFindings })),
    ),
  };
}

// ── Review loading ─────────────────────────────────────────────────────────

export function loadReview(change) {
  const file = join(change._dir, 'reviews', 'spec.md');
  if (!existsSync(file)) return null;
  return parseFrontMatterFile(file);
}

