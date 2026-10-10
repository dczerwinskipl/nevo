---
id: durable-grouped-handover-resume-generalization
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/batch-hook3-restart-recovery.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
depends_on: [durable-grouped-handover-dispatch]
---

# Task: Generalize the pending-handover resume trigger and fix lost-continuation failure classification

## Goal

Second-round corrective task from `overview.md` § "Second-round review correction".
Task 11 made grouped-handover dispatch durable and sequential, but a follow-up review
of task 11's own landed code (head `300593a`) found it still has two real blockers:

1. **The resume trigger only fires from a batch settlement's own Stage 2.**
   `resumePendingHandoverForSpec` is called exactly once, inside
   `batch-completion-settlement.mjs`'s `activeExecutionClear` stage, only when a BATCH's
   own settlement successfully clears the active-execution slot. If the FIRST dispatch
   unit admitted for a spec is a **singleton** (dispatched via `reconcileContinuation`,
   not through `executeBatchCompletionSettlement` at all — see Stage 4's `!unit.isGroup`
   branch), there is no equivalent trigger when that singleton's own turn settles and
   frees the slot in `admission.mjs`'s own `reconcileHook1`. A durable pending multi-
   member group left behind it is never woken up — it is stuck forever, not merely
   delayed.
2. **Only `ACTIVE_EXECUTION_EXISTS` is treated as transient.** In Stage 4's grouped
   branch, every other admission failure reason — `DEFERRED_TO_PENDING_WORKSPACE_REQUEST`,
   `WORKSPACE_WRITER_CONTENDED`, `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY`,
   `REUSE_SESSION_NOT_RESOLVED`, or an exception thrown during admission — is recorded as
   a terminal `'failed'`/`'noop'` outcome, permanently losing the continuation instead of
   retrying once the underlying contention clears. These are exactly as transient as
   `ACTIVE_EXECUTION_EXISTS` — none of them reflect a genuine, permanent inability to
   dispatch. Separately, the singleton branch (`!unit.isGroup`) has **no** transient/
   terminal classification at all: `reconcileContinuation`'s result is always consumed as
   a completed unit regardless of whether its own inner `admitAgentExecution` call
   actually admitted.

## Requirements

### Generalized resume trigger (blocker 1)

- Add a trigger for `resumePendingHandoverForSpec` that fires whenever a **singleton**
  dispatch's own active-execution slot is freed — not only when a batch settlement's own
  Stage 2 frees it. The correct place is `admission.mjs`'s `reconcileHook1`, for
  `capturedScope.kind === 'task'`, at each point it already deletes the spec's entry from
  `activeExecutions` after a turn reaches a terminal outcome (`'completed'`, `'resumable'`,
  `'recovery-required'`).
- Export `resumePendingHandoverForSpec` from `batch-completion-settlement.mjs` and call it
  from `admission.mjs` via a dynamic `import()` (the same pattern already used elsewhere
  in both files to avoid a static circular import) immediately after the slot is freed for
  a task-scoped execution. Pass `excludeBatchExecutionId: null` (a singleton has no
  batchExecutionId of its own to exclude).
- This must remain a best-effort scan over already-persisted settlement state for that
  one changeSlug — not a new scheduler, not cross-spec, not a retry of anything beyond
  the one pending unit the existing scan already finds. Do not change
  `resumePendingHandoverForSpec`'s own scanning logic beyond exporting it.
- Do not duplicate the trigger for `capturedScope.kind === 'task-batch'` — that path
  already resumes correctly via the existing Stage 2 call.

### Transient vs. terminal admission-failure classification (blocker 2)

- Introduce one shared classification (a constant set or helper) of admission failure
  reasons that must be treated as "stay pending, retry on the next natural trigger":
  `ACTIVE_EXECUTION_EXISTS`, `DEFERRED_TO_PENDING_WORKSPACE_REQUEST`,
  `WORKSPACE_WRITER_CONTENDED`, `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY`,
  `REUSE_SESSION_NOT_RESOLVED`.
- Apply it in Stage 4's grouped branch in place of the existing
  `admissionRes.reason === 'ACTIVE_EXECUTION_EXISTS'` check.
- Apply the same classification to a thrown exception during the grouped branch's own
  `admitAgentExecution` call (the existing `catch` block) — after the existing rollback,
  treat it as transient (leave the unit pending), not terminal.
- Apply an equivalent classification to the singleton (`!unit.isGroup`) branch: only
  record the unit as completed/failed and persist `settlement.stages.continuationDispatch
  .members[taskId]` when `reconcileContinuation`'s returned `admission` is either
  genuinely admitted or genuinely terminally blocked; when it is blocked for one of the
  transient reasons above, leave the unit `'pending'` untouched (no member record, no
  settlement save for this attempt) so a later pass retries it.
- A reason not in the transient set remains terminal, exactly as before — this task does
  not change what counts as a genuine, permanent failure.

## Implementation constraints

- Do not modify `tools/specs/workflow/**` or `routes.mjs` (unchanged scope from task 11).
- Do not modify `reconciliation.mjs` — `reconcileContinuation`'s own return shape already
  carries everything needed (`action`, `admission.admitted`, `admission.reason`); this
  task only changes how the *caller* in `batch-completion-settlement.mjs` interprets that
  shape, and how `admission.mjs` triggers a resume scan after a slot frees.
- Preserve every existing passing acceptance criterion from task 11 — this is an
  additive fix, not a rewrite of Stage 4's overall structure.

## Acceptance criteria

- Singleton dispatched first, a multi-member group left durably pending second: once the
  singleton's own turn settles and the slot frees (via `admission.mjs`'s own turn-
  terminal handling, not a manual `clearActiveAgentExecution` call), the pending group is
  admitted automatically, with no manual intervention and without re-processing the
  singleton.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A grouped-handover admission attempt that fails with `WORKSPACE_WRITER_CONTENDED` (or
  any other reason in the transient set) leaves its unit `'pending'`, not `'failed'`/
  `'completed'`, and a later pass (once the contention clears) successfully admits it.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A singleton dispatch whose own `admitAgentExecution` call is blocked by a transient
  reason leaves its unit `'pending'` — it is not recorded as a completed/failed member on
  that pass.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A genuinely terminal admission failure (a reason outside the transient set) is still
  recorded as `'failed'`, exactly as before — no behavior change for real permanent
  failures.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Existing hook3 restart-recovery scenarios still pass unchanged.
  `automated: node --test tools/tests/batch-hook3-restart-recovery.test.mjs`
- Every acceptance criterion already proven by task 11's own tests still passes.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs
node --test tools/tests/batch-hook3-restart-recovery.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to `reconcileContinuation`'s own return contract, to `routes.mjs`, or to
anything under `tools/specs/workflow/**`. Any new scheduler or cross-spec scan.
