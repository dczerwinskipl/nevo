# Area: Batch execution and gating review

## Responsibility

Own sequential multi-task execution of already-`approved` tasks, and the one gating
batch/change-integrity review that closes a batch — distinct from the existing,
deliberately non-gating `spec-audit`.

## Current state

No batch execution exists in any command. `spec-audit` never re-checks a task's own
acceptance criteria and its `changes-recommended`/`owner-decision-required`/`no-findings`
verdict never gates anything. `task-next` returns exactly one task per call. Full
citations in `overview.md` § "Review, audit, and evidence".

## Requirements

1. Batch selection, chosen once at batch start: all currently `next`-ready tasks, an
   explicit named subset, or "run until the next owner-decision checkpoint." No default
   selection — the owner always states which.
2. Ordering follows the existing `depends_on`/`next` logic exactly; a batch that would
   require running a task out of dependency order is rejected before any task starts, not
   partway through.
3. Exactly one task `in-implementation` at a time — this area introduces no concurrent
   write path to `change.yaml`. "Batch" means sequential automation of the
   existing one-task-at-a-time model (via the D2/auto-continue behavior from area
   `conversational-continuity`), not parallelism.
4. Per-task self-check: each batched task still runs its own `Verification` commands
   before `complete`; a full `task-review` is optional per task by default and required
   whenever a task is flagged risky — risky means: it declares `consequential_paths`, it
   touches `src/**`/`tests/**`, or its acceptance criteria include any
   `owner-decision`-tagged item (task 06's evidence tags feed this trigger directly).
5. Gating batch review, produced once at the end of a batch: verdict
   `changes-recommended` \| `owner-decision-required` \| `no-findings`, computed from an
   explicit table (same pattern as every other verdict in this workflow — see
   `review-policy.md`), checking the complete diff against the batch's start point, every
   batched task's acceptance criteria, cross-task integration, and any open follow-up
   entries from `follow-ups.md` (area `context-and-validation-hardening`) raised during
   the batch. This review is gating: `owner-decision-required` or an unresolved
   `changes-recommended` finding blocks the batch from being considered complete, the
   same way a task review blocks a single task.
6. Interruption and resume: an interrupted batch resumes from `deriveStage` plus a small
   persisted "active batch" record (requested task list, completed-so-far) — no new
   per-task status is introduced; a task's own status already reflects its progress.
7. Temporary inconsistency policy: a batch may declare, before it starts, that task N
   intentionally leaves the repository `validate`/`check`-inconsistent for task N+1 to
   resolve. The declaration names both tasks explicitly, is visible in the batch's
   persisted state, and `validate`/`check` is run (and must pass) only at the batch
   boundary for the declared pair — every task not part of a declared pair still leaves
   the repo consistent, unchanged from today's per-task expectation.
8. Failure behavior: a real blocker (owner-decision or unsafe-manual class, per area
   `recovery-and-resume`) during a batch stops the batch at the failing task; completed
   tasks in the batch keep their terminal status; the batch's active-batch record marks
   where it stopped so resume picks up correctly.

## Constraints

- Never make batch mode the default — every batch run is an explicit owner request
  naming its selection.
- Never let a batch's gating review substitute for a risky task's own required
  `task-review` (requirement 4) — the gating review is about the batch as a whole, not a
  replacement for task-level scrutiny where it's actually needed.
- No parallel writes to `change.yaml` under any circumstance.

## Interfaces and boundaries

Exposes: batch selection/ordering, the active-batch persisted record, the gating batch
review shape and its verdict table.

Consumes: `conversational-continuity`'s inline "continue to next batch task" offer;
`recovery-and-resume`'s classified errors for failure handling;
`context-and-validation-hardening`'s `follow-ups.md` and risk-triggering evidence tags;
`state-and-fingerprint-semantics`' corrected `depsSatisfied`.

## Area-specific acceptance criteria

- A test proves a batch runs tasks strictly in dependency order and rejects an
  unsatisfiable batch before starting any task.
- A test proves exactly one task is ever `in-implementation` during a batch run.
- A test proves a risky task (per requirement 4's trigger rule) cannot be
  batch-completed without its own `task-review` having run.
- A test proves an interrupted batch resumes to the correct next task via `deriveStage`
  plus the active-batch record.
- A test proves a declared temporary inconsistency between two named tasks does not fail
  `validate` mid-batch, but an *undeclared* inconsistency between any other pair of tasks
  still does.

## Dependencies

`conversational-continuity` (task 04) — batch execution is built on the same
inline-offer/auto-continue mechanism, not a separate execution path.
`state-and-fingerprint-semantics` (task 01) — needs correct dependency-satisfaction
semantics for ordering.

## Out of scope

- Parallel or concurrent task execution.
- Making the gating batch review replace `spec-review`/`spec-approve` for tasks entering
  the batch — every task in a batch was already individually approved before the batch
  started; this area only governs what happens after that.
