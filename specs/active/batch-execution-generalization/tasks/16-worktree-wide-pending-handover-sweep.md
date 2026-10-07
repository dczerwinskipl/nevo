---
id: worktree-wide-pending-handover-sweep
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/specs/routes.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/batch-hook3-restart-recovery.test.mjs
  - tools/dashboard/tests/task-publish-transport.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
depends_on: [resume-trigger-scope-guard-and-coverage-hardening]
---

# Task: Automatic wake-up for pending handover settlements blocked by worktree-wide transient contention

## Goal

Fourth-round corrective task from `overview.md` § "Fourth-round review correction". A
fourth review round confirmed task 15's scope guard and coverage additions are correct,
but found one remaining real blocker: for the worktree-wide transient admission reasons
(`DEFERRED_TO_PENDING_WORKSPACE_REQUEST`, `WORKSPACE_WRITER_CONTENDED`,
`WORKSPACE_WRITER_BLOCKED_BY_RECOVERY`), there is **no production mechanism** that
automatically re-triggers a durably pending handover settlement once the underlying
blocker clears. The two existing slot-freeing triggers (a sibling of the *same* spec
settling in `batch-completion-settlement.mjs`'s Stage 2, or that spec's own singleton
settling in `admission.mjs`'s Hook 1) only ever notice contention tied to *that one
spec's own* active-execution slot — never a block caused by a completely different
spec's claim or workspace request. `resumePendingHandoverForSpec`'s own doc comment
claims "Hook 3 boot reconciliation" is a natural retry path for this; in reality, Hook 3
(`reconcileBootState`) never scanned pending handover settlements at all. Previously
this class of continuation was *lost* (recorded as a terminal failure); task 13
correctly made it *durable* (left pending); this task makes it *actually resumable*
without a human manually re-triggering anything — the original requirement task 11 was
built to satisfy.

## Requirements

### Worktree-wide sweep (the core fix)

- Add a new function, `sweepAllPendingHandovers({ repoRoot, activeDir, options })`, in
  `batch-completion-settlement.mjs`, that enumerates every `changeSlug` that has ever
  had a batch-completion settlement directory (`.nevo-ai-local/batch-completion/*`) and
  calls the existing `resumePendingHandoverForSpec` for each. This remains a scan over
  already-persisted, already-determined saga state — never a new scheduler, never a
  re-ranking of unrelated work, never a selection of *which* work matters.
- Call this sweep from Hook 3 (`reconcileBootState` in `reconciliation.mjs`), after its
  existing claim and workspace-request reconciliation — actually fulfilling what
  `resumePendingHandoverForSpec`'s own doc comment already claimed happens.
- Call this sweep from the one dashboard-layer production path that resolves a
  worktree-wide-blocking workspace request outside the forbidden
  `tools/specs/workflow/**` boundary: `handleBatchPublish` in
  `tools/dashboard/server/specs/routes.mjs`, immediately after it releases its own
  workspace-writer claim (success or failure path) — giving live, event-driven
  coverage for the single most common real-world case (a `batch-publish` request
  completing), not only boot-time coverage.
- Best-effort throughout: the sweep must never throw, never block or fail the request/
  reconciliation pass that triggered it.

### Explicit, honest scope boundary (do not silently overreach)

- Do **not** modify `tools/specs/workflow/**` to add the same sweep call to
  `publish/operation.mjs`'s single-task publish path or `human-step/operations.mjs`'s
  human-submit resolution path — both are outside every task's allowed scope in this
  change, by deliberate, repeated architectural decision (01-15 all stayed out of this
  directory for this exact reason). A `DEFERRED_TO_PENDING_WORKSPACE_REQUEST` block
  caused specifically by a pending *human-submit* or single-task *publish* request (as
  opposed to a `batch-publish` request) is swept only at the next Hook 3 boot/first-
  request pass, not instantly. Document this residual gap explicitly in this task's own
  acceptance criteria and in `overview.md`'s correction section — do not claim full live
  coverage where only partial live coverage (plus full boot-time coverage) exists. This
  is an explicit owner decision point for a future task, not something to fix here by
  crossing the established boundary without permission.

## Implementation constraints

- Do not modify `admission.mjs` — the existing, already-correct per-spec slot-freeing
  triggers (task 13/15) are unchanged; this task adds a third, orthogonal, worktree-wide
  trigger alongside them, not a replacement.
- Do not modify `tools/specs/workflow/**` (see the scope boundary above).
- Preserve every existing passing acceptance criterion from tasks 11/13/15 — additive
  only.

## Acceptance criteria

- `sweepAllPendingHandovers` resumes a durably pending grouped-handover unit blocked by
  a genuine `DEFERRED_TO_PENDING_WORKSPACE_REQUEST` once the blocking request resolves —
  called directly, with no manual re-invocation of `executeBatchCompletionSettlement`
  for the parent, and no prior knowledge of which changeSlug/batchExecutionId is
  pending.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Hook 3 (`reconcileBootState`) actually sweeps and resumes a durably pending handover
  once its blocking workspace request has cleared — proven with no live workspace-
  writer claim of any kind present, isolating the new sweep step as the only thing that
  could have resumed it.
  `automated: node --test tools/tests/batch-hook3-restart-recovery.test.mjs`
- The dashboard's `handleBatchPublish` route, after completing an entirely unrelated
  spec's own batch-publish request, sweeps and resumes a different spec's durably
  pending handover as a side effect — proven through a real HTTP request via the real
  dashboard app, not a direct function call.
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
- A genuinely non-transient admission reason (`SESSION_SUBSCRIPTION_FAILED`, sourced
  from `admitAgentExecution` itself, not `validateBatchCompatibility`) is still recorded
  as an immediate terminal failure, never left pending, never retried — closing the
  second-/third-round reviews' remaining minor verification gap on this point.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- The residual scope boundary (human-submit/single-task-publish-sourced blocks get
  boot-time-only coverage, not live coverage) is explicitly documented in this task's
  own file and in `overview.md`'s correction section — not silently left unstated.
  `inspection: this task's own "Explicit, honest scope boundary" section and overview.md's Fourth-round review correction both state the residual gap`
- Every existing test in `tools/tests/batch-completion-orchestration.test.mjs`,
  `tools/tests/batch-hook3-restart-recovery.test.mjs`,
  `tools/dashboard/tests/task-publish-transport.test.mjs`, and
  `tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs` still passes.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
  `automated: node --test tools/tests/batch-hook3-restart-recovery.test.mjs`
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs
node --test tools/tests/batch-hook3-restart-recovery.test.mjs
node --test tools/dashboard/tests/task-publish-transport.test.mjs
node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
node --test tools/tests/
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Live-sweeping a human-submit- or single-task-publish-sourced block (would require
touching `tools/specs/workflow/**`, an explicit owner decision not yet granted). Any new
scheduler or cross-spec work selection.
