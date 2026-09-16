# Area: Activity producers — workflow and verification

## Responsibility

Wire the three first-slice activity producers into their existing authoritative execution
boundaries, without breaking the workflow's resumability/idempotency guarantees.

## Current state

- `handleWorkflowStepStart`/`handleWorkflowStepFinish` (`tools/specs/workflow/cli.mjs`)
  are the CLI entry points. Both call `autoBindAgentSession(...)` (`tools/specs.mjs`),
  which today computes an `AgentExecutionContext` internally (via
  `readAgentExecutionContext`) but returns nothing — there is currently no way for a
  caller to obtain the resolved `sessionId` (2026-09-16 review, Blocking 3).
- `finishStep` (`tools/specs/workflow/finish-operation.mjs`) drives a fixed, resumable
  stage sequence (`verify-gates -> update-task -> commit -> push -> transition`) against a
  durable per-attempt operation record (`tools/specs/workflow/operation-record.mjs`).
  `ensureUpdateTask` (the `update-task` stage) is what computes the transition target and
  writes `task.workflow_progress.history[]`, guarded by `if (stage.status === 'completed')
  return;`. `ensureTransition` (the later `transition` stage) is explicitly runtime-only
  and settles after `commit`/`push` — it does **not** write `workflow_progress.history[]`
  (2026-09-16 review, Blocking 1: the original spec named `transition` as the hook point,
  which was factually wrong).
- `FileHumanVerificationStore.confirm()` (`tools/specs/workflow/human-verification-store.mjs`)
  persists a sign-off with only a `role` string today, no real actor identity, and does not
  know the stable `spec_id` the Activity store keys on — only repo root, change slug, task,
  attempt, gate data (2026-09-16 review, Major 6).
- `handleWorkflowVerifyHuman`'s `--confirm` branch (`cli.mjs`) is the caller of
  `confirm()`; it already resolves the full `change` object (and therefore `spec_id`)
  for other purposes in the same function.

## Requirements

- **Session actor contract (resolves Blocking 3):** `autoBindAgentSession`
  (`tools/specs.mjs`) is changed to `return context;` (the `AgentExecutionContext` it
  already computes internally), instead of implicitly returning `undefined`. This is a
  non-breaking addition — nothing today uses the return value. Both call sites in
  `cli.mjs` (`handleWorkflowStepStart`, `handleWorkflowStepFinish`) capture this return
  value and pass `context?.sessionId` to the workflow producer, which resolves the
  `agent-session` actor from it (falling back to `SYSTEM_ACTOR` when `context` is
  null/has no `sessionId`).
- `workflow.step.started`: emitted from `handleWorkflowStepStart`, actor = resolved
  agent-session actor (via the contract above) or `SYSTEM_ACTOR`, `data` includes `step`
  and `attempt`. Id: `` `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` ``
  — deterministic per attempt, so repeated `step start` calls (intentionally allowed while
  a step is active) dedup to one logical activity on read (overview.md § Idempotency).
- **`workflow.step.completed` (resolves Blocking 1):** emitted from `ensureUpdateTask`
  (the **`update-task` stage**, not `transition`), reusing its own existing guard (`if
  (stage.status === 'completed') return;`) so a resumed operation does not attempt to
  re-emit once that stage is already complete. `data` includes `result`, `attempt`,
  `transitioned_to`, `artifacts`, `feedback` (all already known at `update-task`), and —
  only when already present at this boundary — a `findings` list with per-finding
  `author` (D6; do not add new capture machinery to the review command itself to populate
  this). Id: `` `workflow.step.completed:${specId}:${taskId}:${step}:${attempt}` ``.
- **`human.verification.confirmed` (resolves Major 6):** emitted from
  `handleWorkflowVerifyHuman`'s `--confirm` branch in `cli.mjs`, immediately after a
  successful `FileHumanVerificationStore.confirm()` call returns — not from inside the
  store, which has neither `spec_id` nor any business resolving git identity or Activity
  concerns. Actor = resolved `user` actor (git config). `data` includes `scope`,
  `targetId`, `role`, `gateId`. Id: `` `human.verification.confirmed:${specId}:${taskId}:
  ${step}:${attempt}:${gateId}` `` (gate-qualified, since one step/attempt can have more
  than one gate).
- All three ids above are the deterministic-id / read-side-dedup scheme defined in
  overview.md § Idempotency for resumable operations — this is the actual correctness
  mechanism, not defense in depth.

## Constraints

- Must not alter `finishStep`'s stage sequence, its resumability semantics, or
  `operation-record.mjs`'s existing record shape — activity recording is additive at an
  existing guarded point, not a new stage with its own failure semantics that could block
  a finish.
- Must not add new capture logic to the review command to manufacture `findings` data that
  doesn't already exist at the finish boundary (D6 / overview.md § Out of scope).
- Must not change `FileHumanVerificationStore`'s persisted record shape or make it aware
  of `spec_id`/Activity/git identity — those concerns stay in the CLI caller.

## Interfaces and boundaries

Consumes: `recordActivity()`, the actor resolvers, and the `Activity` type from
`areas/activity-model-and-store.md`.

Exposes: nothing new — this area only adds calls at existing boundaries.

## Area-specific acceptance criteria

- A normal (non-resumed) step start + finish produces exactly one queryable
  `workflow.step.started` and one queryable `workflow.step.completed` activity, with
  `attempt` and `result` matching what was written to `workflow_progress.history[]`.
- Simulating a resumed finish operation (an operation record with the `update-task` stage
  already marked completed) does not surface a duplicate `workflow.step.completed`
  activity when queried.
- Calling `handleWorkflowStepStart` twice for the same active attempt surfaces exactly one
  queryable `workflow.step.started` activity (proves the deterministic-id dedup covers
  `step start`'s intentional repeatability).
- A human-verification confirmation produces exactly one `human.verification.confirmed`
  activity with a resolved `user` actor, and the store never needs to know `spec_id` to
  produce it.
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
