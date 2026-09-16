# Area: Activity producers — workflow and verification

## Responsibility

Wire the three first-slice activity producers into their existing authoritative execution
boundaries, without breaking the workflow's resumability/idempotency guarantees.

## Current state

- `handleWorkflowStepStart`/`handleWorkflowStepFinish` (`tools/specs/workflow/cli.mjs`)
  are the CLI entry points; `finishStep` (`tools/specs/workflow/finish-operation.mjs`)
  drives a fixed, resumable stage sequence (`verify-gates -> update-task -> commit -> push
  -> transition`) against a durable per-attempt operation record
  (`tools/specs/workflow/operation-record.mjs`) that already tracks per-stage status to
  make resumed runs skip completed stages.
- `FileHumanVerificationStore.confirm()` (`tools/specs/workflow/human-verification-store.mjs`)
  persists a sign-off with only a `role` string today, no real actor identity.

## Requirements

- `workflow.step.started`: emitted from `handleWorkflowStepStart`, actor = resolved
  agent-session (or system, if none bound), `data` includes step and attempt.
- `workflow.step.completed`: emitted from `finishStep`'s transition stage, at the same
  point/guard that already writes `task.workflow_progress.history[]` — reusing the
  existing idempotent stage-status check so a resumed operation does not re-emit this
  activity for an already-completed stage. `data` includes `result`, `attempt`,
  `transitioned_to`, `artifacts`, `feedback`, and — only when already present at this
  boundary — a `findings` list with per-finding `author` (D6; do not add new capture
  machinery to the review command itself to populate this).
- `human.verification.confirmed`: emitted from `FileHumanVerificationStore.confirm()`,
  actor = resolved `user` actor (git config), `data` includes `scope`, `role`, `gateId`.
- Workflow-engine-emitted activity ids are deterministically derived from stable
  identifiers (`operationId` + stage), not freshly randomized, as defense in depth for
  idempotency (overview.md § Idempotency for resumable operations).

## Constraints

- Must not alter `finishStep`'s stage sequence, its resumability semantics, or
  `operation-record.mjs`'s existing record shape — activity recording is additive at an
  existing guarded point, not a new stage with its own failure semantics that could block
  a finish.
- Must not add new capture logic to the review command to manufacture `findings` data that
  doesn't already exist at the finish boundary (D6 / overview.md § Out of scope).

## Interfaces and boundaries

Consumes: `recordActivity()`, the actor resolvers, and the `Activity` type from
`areas/activity-model-and-store.md`.

Exposes: nothing new — this area only adds calls at existing boundaries.

## Area-specific acceptance criteria

- A normal (non-resumed) step start + finish produces exactly one
  `workflow.step.started` and one `workflow.step.completed` activity, with `attempt` and
  `result` matching what was written to `workflow_progress.history[]`.
- Simulating a resumed finish operation (an operation record with a stage already marked
  completed) does not produce a duplicate `workflow.step.completed` activity for that
  stage.
- A human-verification confirmation produces exactly one `human.verification.confirmed`
  activity with a resolved `user` actor.
- If activity recording itself fails (e.g. disk error), it must not fail or roll back the
  underlying workflow/verification operation — activity is observational, never a
  blocking dependency of the authoritative state change.

## Dependencies

Depends on `areas/activity-model-and-store.md`. Independent of
`areas/activity-query-and-api.md` (can be implemented and tested in parallel).

## Out of scope

- Any additional producers beyond the three listed (PR lifecycle, merge, handover, spec
  create/finalize, etc.) — future work per overview.md § Out of scope.
- New capture of per-finding review authorship if it doesn't already exist at the finish
  boundary.
