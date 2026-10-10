---
id: settlement-serialization-and-live-sweep-completion
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/specs/routes.mjs
    - specs/active/batch-execution-generalization/tasks/16-worktree-wide-pending-handover-sweep.md
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/server/specs/routes.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/dashboard/tests/task-publish-transport.test.mjs
  - specs/active/batch-execution-generalization/change.yaml
  - specs/active/batch-execution-generalization/tasks/16-worktree-wide-pending-handover-sweep.md
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
depends_on: [worktree-wide-pending-handover-sweep]
---

# Task: Serialize settlement Stage 4, complete the live sweep, correct task 16's provenance

## Goal

Fifth-round corrective task from `overview.md` § "Fifth-round review correction". A
fifth review round confirmed task 16's worktree-wide sweep is conceptually in the right
place and that Hook 3 and the dashboard's own `batch-publish` route both genuinely call
it, but found three remaining issues.

1. **BLOCKER — concurrent resume triggers can race and silently revert a singleton
   unit from `'completed'` back to `'pending'`.** `executeBatchCompletionSettlement`
   has no mutex or CAS: it loads `settlement` into memory once, mutates it across
   several stages, and writes it back at multiple points with no version check. Task
   16's own worktree-wide sweep makes concurrent callers for the *same* settlement
   plausible for the first time (Hook 1's own slot-freeing trigger, Hook 3's boot
   sweep, and now the dashboard's own batch-publish/human-step/publish-task sweeps can
   all legitimately fire at nearly the same moment). The grouped-unit path is mostly
   protected by `createGroupReservation`'s own `TASK_ALREADY_RESERVED` check under
   `withWorkspaceControlLock`; the singleton path has no equivalent protection at all —
   a later writer's own stale in-memory snapshot (loaded before an earlier writer's
   success was persisted) can silently overwrite a just-completed admission back to
   `'pending'`, risking a second, duplicate admission attempt once the active
   execution settles again.
2. **BLOCKER — the declared residual scope boundary (human-submit/single-task-publish
   sweep requires touching `tools/specs/workflow/**`) was wrong.** `handleHumanStep`
   and `handlePublishTask` both already live in the same dashboard-layer
   `tools/dashboard/server/specs/routes.mjs` task 16 already modified for
   `handleBatchPublish`. By the time either of their own `await` calls into
   `executeHumanStepAction`/`publishTask` resolves, any workspace-request/claim
   lifecycle those calls own has already fully resolved and persisted — the exact same
   live-sweep pattern task 16 already used for `handleBatchPublish` applies directly,
   with no need to reach into `tools/specs/workflow/**` at all. Task 16's own claim
   that this residual gap required crossing that boundary was simply incorrect.
3. **MAJOR — task 16's own `change.yaml` tracking metadata is historically
   inaccurate.** Task 16's production implementation landed in commit `d8da2c73`
   *before* its own `approve` transition (`98079d65`) — an execution-ordering
   inversion. The automated approve/self-check metadata capture could not see the
   pre-existing commit and recorded `98079d65` for both `baseline_revision` and
   `review_revision`, with an empty `changed_paths`. For a change whose own stated
   purpose includes deterministic spec → approval → implementation tracking, this is
   a real correctness gap, not a cosmetic one.

## Requirements

### Settlement serialization (finding 1)

- Add an in-process, per-`(changeSlug, batchExecutionId)` mutex around
  `executeBatchCompletionSettlement`'s entire body (the same shape as `admission.mjs`'s
  own `acquireStartLock`) — serialize concurrent callers for the same settlement so
  each runs to completion against a fully consistent view before the next one starts.
- This only needs to serialize same-process callers — the same boundary
  `admission.mjs`'s own per-spec mutex already accepts; it does not need to protect
  against multiple dashboard server processes.
- Add a test that fires two concurrent calls to `executeBatchCompletionSettlement` for
  the same settlement (singleton path) and asserts: exactly one admission/session is
  created, and the unit's final status is `'completed'`, never observed or left as
  `'pending'` by either caller.

### Complete the live sweep (finding 2)

- Add the same best-effort `sweepAllPendingHandovers` call task 16 already added after
  `handleBatchPublish`'s own completion, to `handleHumanStep` (after
  `executeHumanStepAction` resolves) and `handlePublishTask` (after `publishTask`
  resolves) in `tools/dashboard/server/specs/routes.mjs` — still without importing
  anything from `tools/specs/workflow/**` into the dashboard orchestration layer, and
  still never failing the request's own response.
- Add a test for each of the two new call sites proving a durably pending handover for
  an unrelated spec is resumed as a side effect of a real HTTP request to that
  endpoint completing — same fidelity as task 16's own `handleBatchPublish` test.
- Correct the "Explicit, honest scope boundary" framing in task 16's own file to
  reflect that the sweep now covers all three dashboard-reachable completion paths;
  only a human-submit/publish resolution occurring *entirely inside*
  `tools/specs/workflow/**` with no corresponding dashboard-layer caller (if any such
  path exists) would remain boot-time-only. Do not claim more coverage than is
  actually true.

### Task 16 provenance correction (finding 3)

- Correct `change.yaml`'s `worktree-wide-pending-handover-sweep` entry: set
  `implementation.baseline_revision` to the commit immediately preceding the real
  implementation commit, `implementation.review_revision` and `self_check.revision` to
  the real implementation commit, and `implementation.changed_paths` to the files that
  commit actually changed. Add a dated `provenance_correction` note on the same block
  explaining what happened and why, and a matching dated note in task 16's own `.md`
  file. Do not rewrite git history; do not change task 16's own recorded `status`,
  self-check pass/fail result, or verification outcome — only the metadata that was
  factually wrong.

## Implementation constraints

- Do not modify `admission.mjs` or `reconciliation.mjs` — this task's own fixes are
  confined to `batch-completion-settlement.mjs`'s own serialization and
  `routes.mjs`'s own two additional call sites.
- Do not modify `tools/specs/workflow/**`.
- Preserve every existing passing acceptance criterion from tasks 11/13/15/16 —
  additive only.
- This task's own implementation must be committed and pushed only *after* its own
  `approve`/`start` transitions land — not before — so this task's own `change.yaml`
  tracking does not repeat finding 3's own mistake.

## Acceptance criteria

- Two concurrent `executeBatchCompletionSettlement` calls for the same settlement
  never produce more than one admission/session, and the settlement's final status is
  `'completed'`, never reverted to `'pending'` by a stale writer.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A real HTTP request to `handleHumanStep` and to `handlePublishTask` each sweep and
  resume an unrelated spec's durably pending handover as a side effect, proven through
  the real dashboard app.
  `automated: node --test tools/dashboard/tests/task-publish-transport.test.mjs`
- `change.yaml`'s task 16 entry carries corrected `baseline_revision`,
  `review_revision`, `changed_paths`, and a dated `provenance_correction` note; task
  16's own `.md` file carries a matching dated note. No git history is rewritten.
  `inspection: change.yaml's task 16 implementation block and task 16's own .md file both reflect the real implementation commit and changed paths`
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

Multi-process serialization (cross-dashboard-server-instance locking). Any sweep call
site genuinely inside `tools/specs/workflow/**` with no dashboard-layer caller, if one
is later found to exist — that would be a new, explicit owner decision, not silently
added here.
