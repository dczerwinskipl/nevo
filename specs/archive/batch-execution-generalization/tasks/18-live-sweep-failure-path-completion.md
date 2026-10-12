---
id: live-sweep-failure-path-completion
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/specs/routes.mjs
    - specs/active/batch-execution-generalization/tasks/16-worktree-wide-pending-handover-sweep.md
    - specs/active/batch-execution-generalization/tasks/17-settlement-serialization-and-live-sweep-completion.md
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/tests/task-publish-transport.test.mjs
  - specs/active/batch-execution-generalization/tasks/16-worktree-wide-pending-handover-sweep.md
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/batch-hook3-restart-recovery.test.mjs
depends_on: [settlement-serialization-and-live-sweep-completion]
---

# Task: Complete the live sweep to the failure path, correct task 16's superseded scope-boundary text

## Goal

Sixth-round corrective task from `overview.md` § "Sixth-round review correction". A
sixth review round confirmed task 17's mutex fix and provenance correction are both
correct, but found two remaining issues.

1. **BLOCKER — the `handleHumanStep`/`handlePublishTask` live sweep (task 17) only
   runs on the success path.** Both call sites place the sweep call right after their
   own `await` resolves successfully, inside the `try` block, before `reply.send(...)`.
   But `publishTask` and `executeHumanStepAction` can each resolve their own
   workspace-request/claim lifecycle to a terminal state (request moved to `'failed'`,
   claim released or recovery-marked) and *then* throw — a try-only sweep silently
   misses exactly that case. `handleBatchPublish` already got this right (task 16
   placed its own sweep in a `finally` block); `handleHumanStep`/`handlePublishTask`
   did not. Task 18 fixes this by moving both sweep calls into a `finally` block, so
   they fire on success and failure alike — the same shape `handleBatchPublish`
   already uses.
2. **MAJOR — task 16's own file still contradicts task 17's claimed fix.** Task 17
   added the live sweep to `handleHumanStep`/`handlePublishTask` and said it would
   "correct the 'Explicit, honest scope boundary' framing in task 16's own file," but
   never actually edited task 16's text — task 16's "Explicit, honest scope boundary"
   and "Out of scope" sections still claim live-sweeping those two paths would require
   touching `tools/specs/workflow/**`, directly contradicting what tasks 17-18 actually
   did. Task 18 adds a dated "Superseded by tasks 17/18" note directly above those
   sections in task 16's own file — without rewriting or deleting the original text,
   which remains as a historical record of task 16's own original (incorrect)
   reasoning.

## Requirements

### Failure-path sweep completion (finding 1)

- In `tools/dashboard/server/specs/routes.mjs`, restructure both `handleHumanStep` and
  `handlePublishTask` so the `sweepAllPendingHandovers` call moves from inside the
  `try` block's success path into a `finally` block wrapping the existing
  `try`/`catch` — firing once per request, after either the success reply or the
  error reply has already been sent, regardless of which branch ran.
- Add a dedicated test for each handler proving a real failure that occurs *after*
  the underlying operation's own workspace-request/claim lifecycle has resolved still
  triggers the sweep: a real git push failure (no remote configured, consistent with
  this test file's existing fixture) after the operation's own commit/transition
  succeeds.
- For `handlePublishTask`, `publishTask`'s own structure unconditionally releases its
  claim in a `finally` on any exception — assert the unrelated pending handover is
  fully resumed as a direct result.
- For `handleHumanStep`, the equivalent real failure (an interrupted push) is
  classified by `human-step/operations.mjs` as a resumable, not-yet-settled finish
  operation, which fails closed to a recovery-marked (not released) claim by design —
  the physically-held claim correctly prevents any admission attempt from succeeding
  regardless of the sweep fix. Assert what is actually true and provable here: the
  sweep still runs (observable as a fresh write to the unrelated settlement's own
  record, proving the attempt happened) even though the unit correctly remains
  pending — do not assert full resumption for a case where the underlying claim is
  not actually released; that would misrepresent what was proven.

### Task 16 scope-boundary correction (finding 2)

- Add a dated note directly above task 16's own "Explicit, honest scope boundary" and
  "Out of scope" sections stating they are superseded by tasks 17-18, exactly as
  specified in the sixth-round review. Do not delete or rewrite the original text.

## Implementation constraints

- Do not modify `batch-completion-settlement.mjs`, `admission.mjs`, or
  `reconciliation.mjs` — this task is confined to `routes.mjs`'s own two handlers and
  task 16's own documentation.
- Do not modify `tools/specs/workflow/**`.
- Preserve every existing passing acceptance criterion from tasks 11/13/15/16/17 —
  additive only.
- This task's own implementation must be committed and pushed only *after* its own
  `approve`/`start` transitions land, matching the ordering discipline task 17 itself
  established in response to its own provenance finding.

## Acceptance criteria

- Both `handleHumanStep` and `handlePublishTask` invoke the sweep from a `finally`
  block, firing on both success and failure.
  `inspection: both handlers in routes.mjs wrap their existing try/catch in a finally that calls sweepAllPendingHandovers`
- A real single-task-publish failure (push fails after commit succeeds) still sweeps
  and fully resumes an unrelated spec's durably pending handover.
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
- A real human-step failure (push fails after commit succeeds, classified resumable by
  operations.mjs) still invokes the sweep — proven via an observable settlement write
  — without falsely asserting resumption of a unit whose blocking claim is correctly
  still held.
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
- Task 16's own file carries a dated note directly above its "Explicit, honest scope
  boundary" and "Out of scope" sections stating they are superseded by tasks 17-18,
  without deleting the original text.
  `inspection: task 16's own .md file has a dated superseded-by note above both sections, original text intact`
- Every existing test in `tools/dashboard/tests/task-publish-transport.test.mjs`,
  `tools/tests/batch-completion-orchestration.test.mjs`,
  `tools/tests/batch-hook3-restart-recovery.test.mjs`, and
  `tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs` still passes.
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
  `automated: node --test tools/tests/batch-hook3-restart-recovery.test.mjs`
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/task-publish-transport.test.mjs
node --test tools/tests/batch-completion-orchestration.test.mjs
node --test tools/tests/batch-hook3-restart-recovery.test.mjs
node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
node --test tools/tests/
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Changing `human-step/operations.mjs`'s own settlement classification (fail-closed to
recovery-required on an interrupted push is correct, intentional behavior, not a bug
to fix here). Any new scheduler or cross-spec work selection.
