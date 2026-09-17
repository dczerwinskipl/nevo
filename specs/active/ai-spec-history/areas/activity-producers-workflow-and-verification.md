# Area: Activity producers — workflow and verification

## Responsibility

Wire the three first-slice activity producers into their existing authoritative execution
boundaries, without breaking the workflow's resumability/idempotency guarantees, and with
correct actor attribution for both agent-driven and direct-human execution paths.

## Current state

- `handleWorkflowStepStart`/`handleWorkflowStepFinish` (`tools/specs/workflow/cli.mjs`)
  are the CLI entry points. Both call `autoBindAgentSession(...)` (`tools/specs.mjs`),
  which resolves an `AgentExecutionContext` (via `readAgentExecutionContext`, environment
  variables) and calls `AgentSessionBindingService.bindSessionSync(...)` — but currently
  discards `bindSessionSync`'s return value and returns nothing itself. Critically,
  `readAgentExecutionContext()` can legitimately resolve only `{provider,
  providerSessionId}` with **no** canonical `sessionId`; it is `bindSessionSync()` that
  generates or looks up the canonical `sessionId` (`effectiveSessionId = sessionId ||
  randomUUID()`, or an existing session's `sessionId` if one already matches this
  `provider`+`providerSessionId`) and returns it in its result. There is currently no way
  for a caller to obtain either value (review round 2, Blocking).
- `finishStep` (`tools/specs/workflow/finish-operation.mjs`) drives a fixed, resumable
  stage sequence (`verify-gates -> update-task -> commit -> push -> transition`) against a
  durable per-attempt operation record (`tools/specs/workflow/operation-record.mjs`), in a
  `try` block that calls each stage in order (`await ensureUpdateTask(record, ...)` is the
  `update-task` call, immediately followed by `await ensureCommit(...)`). `ensureUpdateTask`
  computes the transition target and writes `task.workflow_progress.history[]`. It has its
  own internal recovery branch: if `setTaskWorkflowState` already wrote the history entry
  in a prior, crashed attempt but the operation record's `update-task` stage was never
  marked `completed`, the resumed call detects the write already happened, sets
  `stage.status = 'completed'` (and `stage.result`), and returns *without* re-executing
  anything else. `ensureTransition` (the later `transition` stage) is explicitly
  runtime-only and settles after `commit`/`push` — it does not write
  `workflow_progress.history[]`.
- `handleWorkflowVerifyHuman` (`cli.mjs`) has **two** distinct decision paths that both end
  a `human-verification` step, and only one of them is agent-adjacent:
  - `--confirm`: calls `FileHumanVerificationStore.confirm()`
    (`tools/specs/workflow/human-verification-store.mjs`), which persists a sign-off with
    only a `role` string, no real actor identity, and does not know `spec_id` — only repo
    root, change slug, task, attempt, gate data.
  - `--approve` / `--request-changes`: calls `finishStep({...})` **directly** — the same
    function `handleWorkflowStepFinish` uses — without ever calling
    `autoBindAgentSession`. This is the primary path for a human decision (not the legacy
    `--confirm` one), and today it carries no actor information into `finishStep` at all
    (review round 2, Major).

## Requirements

- **Session actor contract (corrected — review round 2, Blocking):** `autoBindAgentSession`
  (`tools/specs.mjs`) is changed to **return `bindSessionSync()`'s own result** (which
  always includes a resolved canonical `sessionId`) on a successful bind, and `null` on
  every early-return/no-op/error branch (no context, no valid `specId`, or a thrown
  error). It must **not** return the raw pre-bind `AgentExecutionContext` — that object can
  legitimately lack a canonical `sessionId`, which would misclassify a validly-bound,
  provider-native-only session as `SYSTEM_ACTOR`. Both call sites in `cli.mjs`
  (`handleWorkflowStepStart`, `handleWorkflowStepFinish`) capture this return value (call
  it `binding`) and use `binding?.sessionId` to resolve the `agent-session` actor, falling
  back to `SYSTEM_ACTOR` when `binding` is `null`.
- `workflow.step.started`: emitted from `handleWorkflowStepStart`, actor = resolved
  agent-session actor from `binding?.sessionId` (or `SYSTEM_ACTOR`), `data` includes `step`
  and `attempt`. Id: `` `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` ``
  — deterministic per attempt, so repeated `step start` calls (intentionally allowed while
  a step is active) dedup to one logical activity on read (overview.md § Idempotency).
- **`workflow.step.completed` (corrected emission point — review round 2, Blocking):**
  `finishStep` gains a new optional `actor` parameter (a pre-resolved `ActorRef`,
  defaulting to `SYSTEM_ACTOR` when omitted). Emission happens in `finishStep`'s own stage
  sequence in `finish-operation.mjs` — **immediately after `await ensureUpdateTask(record,
  ...)` returns**, not from inside `ensureUpdateTask` itself, and unconditionally on every
  successful call (whether `ensureUpdateTask` took its fresh-write path or its
  "write-already-happened" recovery path). This is what actually closes the missing-event
  crash window: gating emission on which internal branch of `ensureUpdateTask` ran (the
  round-1 approach) meant the recovery branch — which by design skips re-doing the write —
  also silently skipped emission forever. At this call site, `record`'s `update-task`
  stage already has its `.result` (transition target) populated by either branch, and
  `record.resolvedInputs` (`result`/`artifacts`/`feedback`) is already on the in-memory
  operation record — no re-read from disk needed. `data` includes `result`, `attempt`,
  `transitioned_to`, `artifacts`, `feedback`, and — only when already present at this
  boundary — a `findings` list with per-finding `author` (D6; do not add new capture
  machinery to the review command itself to populate this). Id: ``
  `workflow.step.completed:${specId}:${taskId}:${step}:${attempt}` ``.
- **Actor propagation into `finishStep` (review round 2, Major):**
  - `handleWorkflowStepFinish` resolves the agent-session actor (as above) and passes it
    as `finishStep`'s `actor` argument.
  - `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch resolves
    `resolveUserActor()` (task 03) and passes it as `finishStep`'s `actor` argument — this
    is what makes a direct human decision show up with a `user` actor on its
    `workflow.step.completed` activity instead of falling back to `SYSTEM_ACTOR`. No new
    activity type is introduced for this path; it reuses `workflow.step.completed` with
    the correct actor.
- **`human.verification.confirmed`:** emitted from `handleWorkflowVerifyHuman`'s legacy
  `--confirm` branch only, immediately after a successful
  `FileHumanVerificationStore.confirm()` call returns — not from inside the store, which
  has neither `spec_id` nor any business resolving git identity or Activity concerns.
  Actor = resolved `user` actor (git config). `data` includes `scope`, `targetId`, `role`,
  `gateId`. Id: `` `human.verification.confirmed:${specId}:${taskId}:${step}:${attempt}:
  ${gateId}` `` (gate-qualified, since one step/attempt can have more than one gate).
  `--approve`/`--request-changes` never produce this type — see above.
- All ids above are the deterministic-id / read-side-dedup scheme defined in overview.md §
  Idempotency for resumable operations — combined with the corrected emission call site,
  this is what actually closes both the duplicate-event and missing-event gaps.

## Constraints

- Must not alter `finishStep`'s stage sequence itself, `ensureUpdateTask`'s own state-write
  guard (`if (stage.status === 'completed') return;`, which still governs the state write,
  just no longer gates activity emission), or `operation-record.mjs`'s existing record
  shape — activity recording is additive at the stage sequence's own call site, not a new
  stage with its own failure semantics that could block a finish.
- `finishStep`'s new `actor` parameter must be optional and additive — every existing
  caller that doesn't pass it must keep working exactly as before (falling back to
  `SYSTEM_ACTOR` for activity purposes only; it has no effect on `finishStep`'s actual
  workflow behavior).
- Must not add new capture logic to the review command to manufacture `findings` data that
  doesn't already exist at the finish boundary (D6 / overview.md § Out of scope).
- Must not change `FileHumanVerificationStore`'s persisted record shape or make it aware
  of `spec_id`/Activity/git identity — those concerns stay in the CLI caller.

## Interfaces and boundaries

Consumes: `recordActivity()`, the actor resolvers, and the `Activity` type from
`areas/activity-model-and-store.md`.

Exposes: `finishStep`'s new `actor` parameter (consumed by both `handleWorkflowStepFinish`
and `handleWorkflowVerifyHuman`) and `autoBindAgentSession`'s new return value (consumed by
both `handleWorkflowStepStart` and `handleWorkflowStepFinish`).

## Area-specific acceptance criteria

- A normal (non-resumed) step start + finish produces exactly one queryable
  `workflow.step.started` and one queryable `workflow.step.completed` activity, with
  `attempt` and `result` matching what was written to `workflow_progress.history[]`.
- Simulating the crash window (workflow history already persisted, operation record's
  `update-task` stage still `pending`, no activity recorded) and resuming `finishStep`
  yields exactly **one** queryable `workflow.step.completed` activity — proves the
  missing-event gap is closed.
- Simulating a resumed finish operation where the `update-task` stage is already
  `completed` (a second, independent resume) does not surface a duplicate
  `workflow.step.completed` activity when queried — proves the duplicate-event gap stays
  closed.
- Calling `handleWorkflowStepStart` twice for the same active attempt surfaces exactly one
  queryable `workflow.step.started` activity.
- `autoBindAgentSession` returns `bindSessionSync()`'s result (with a resolved
  `sessionId`) even when the input execution context contained only `provider` +
  `providerSessionId` and no canonical `sessionId` — proves the corrected contract
  actually classifies such a session as `agent-session`, not `SYSTEM_ACTOR`.
- Completing a `human-verification` step via `--approve` produces a
  `workflow.step.completed` activity with a `user`-type actor; the same is proven for
  `--request-changes`.
- A human-verification confirmation (`--confirm`) produces exactly one
  `human.verification.confirmed` activity with a resolved `user` actor, and the store
  never needs to know `spec_id` to produce it.
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
- A dedicated "human decision" activity type distinct from `workflow.step.completed` — the
  chosen approach reuses the existing type with correct actor propagation instead.
