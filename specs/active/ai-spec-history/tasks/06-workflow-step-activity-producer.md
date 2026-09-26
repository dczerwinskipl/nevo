---
id: workflow-step-activity-producer
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-producers-workflow-and-verification.md
    - tools/specs/activity/store.mjs
    - tools/specs/activity/actor-resolver.mjs
    - tools/specs.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/human-step/operations.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/dashboard/server/ai/sessions/binding-service.mjs
allowed_paths:
  - tools/specs/activity/producers/workflow.mjs
  - tools/specs.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/activity-workflow-producer.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  decisions: [D6, D10, D11, D14, D15, D16, D17, D18, D19]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Workflow step activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit generic, executor-neutral `workflow.step.started` and `workflow.step.completed` activities
from the authoritative workflow execution boundaries, ensuring correct actor attribution across
both agent-driven execution and human-driven execution (CLI and dashboard HTTP transport),
with durable actor capture on resumable operations (D17), and retry-on-already-completed (D18).

## Requirements

- **Session actor contract (round 2, Blocking):** change `autoBindAgentSession` in
  `tools/specs.mjs` to capture and `return` `bindSessionSync(...)`'s own result (currently
  the call's return value is discarded and the function returns nothing). Make the
  early-return branches explicit (`return null;`) — no valid `specId`, no execution
  context, or a caught error should all return `null`. **Do not** return the raw
  `AgentExecutionContext` from `readAgentExecutionContext` — it can legitimately carry
  only `{provider, providerSessionId}` with no canonical `sessionId`, which is exactly
  what `bindSessionSync` resolves (generating a fresh UUID or reusing an existing
  session's id). This is additive — no existing caller inspects the return value today.
  Update both agent call sites in `cli.mjs` (`handleWorkflowStepStart`,
  `handleWorkflowStepFinish`) to capture the returned binding (call it `binding`) and
  use `binding?.sessionId` when resolving the `agent-session` actor for this task's
  producer calls.
- `tools/specs/activity/producers/workflow.mjs`: owns the two generic type constants
  (`workflow.step.started`, `workflow.step.completed`) and each event's `data` contract
  (a small validator for the fields listed below) — this module is the "producer contract"
  referenced in overview.md § Extensibility; it is additive and does not change
  `tools/specs/activity/model.mjs`.
- **`workflow.step.started` (executor-neutral, D19):**
  - **Agent activation:** called from `handleWorkflowStepStart` (`cli.mjs`). Actor =
    resolved agent-session actor from `binding?.sessionId` (or `SYSTEM_ACTOR` if `binding`
    is null). Scope = `{ specId, taskId }`. Data = `{ step, attempt }`.
  - **Human activation:** called from `startHumanStep` (`tools/specs/workflow/human-step/operations.mjs`).
    Actor = resolved `user` actor (from `resolveUserActor()` in `actor-resolver.mjs`).
    Scope = `{ specId, taskId }`. Data = `{ step, attempt }`. Because both CLI and dashboard
    HTTP transport pass through `startHumanStep`, instrumenting this domain boundary covers
    all human step starts without duplicating emission or relying on session binding.
  - Deterministic id: `` `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` ``.
    Repeated `step start` calls (allowed while a step is active) dedup to one logical activity
    on read.
- **`finishStep`'s new `actor` parameter (round 2, Major — D16, D19):** add an optional `actor`
  field to `finishStep`'s options object (an already-resolved `ActorRef`, defaulted to `SYSTEM_ACTOR`).
  - `handleWorkflowStepFinish` (`cli.mjs`) passes the resolved agent-session actor
    (from `binding?.sessionId`).
  - `submitHumanStepResult` (`tools/specs/workflow/human-step/operations.mjs`) resolves
    `resolveUserActor()` and passes it as `actor` into `finishStep`. Because both CLI
    (`handleWorkflowVerifyHuman --approve/--request-changes`) and HTTP transport
    (`POST /api/specs/:slug/tasks/:taskId/workflow/human-step`) call `submitHumanStepResult`,
    all human completions pass a `user` actor into `finishStep`.
- **Durable actor capture, not a per-call read (round 3, Blocking — D17):** add an `actor`
  field to `createOperationRecord({change, task, step, attempt, resolvedInputs})`'s
  returned object (local function in `finish-operation.mjs`), populated from `finishStep`'s
  `actor` parameter **only at the call site where `createOperationRecord` is invoked** (the
  `!record` branch — a brand-new operation), defaulting to `SYSTEM_ACTOR` if none was
  passed. Do **not** read `finishStep`'s `actor` parameter again anywhere else — every
  emission of `workflow.step.completed` (at the main call site below, and at the two
  already-completed short-circuits task 06 also owns) must read `record.actor` /
  `plan.existingRecord.actor` instead. This is deliberate: a resume can happen under a
  different actor (or none) than whoever started the operation, and the activity must
  still attribute the *original* actor, not the resuming call's.
- **`workflow.step.completed` — emission call site (round 2, Blocking — D15):** add the emission
  call in `finishStep`'s own stage sequence in `finish-operation.mjs`, **immediately after
  `await ensureUpdateTask(record, definition, resolvedActiveDir, changeSlug, task.id,
  repoRoot);` returns** (currently followed directly by `await ensureCommit(...)`) — not
  inside `ensureUpdateTask` itself. This must fire unconditionally every time that line is
  reached, regardless of whether `ensureUpdateTask` internally took its fresh-write path
  or its "write already happened" recovery/reconciliation path (the latter returns early
  after detecting `setTaskWorkflowState` already succeeded in a prior crashed attempt —
  gating emission on that internal branch is what caused the missing-event bug in the
  first review round's design). Build `data` from `findStage(record, 'update-task').result`
  (transition target) and `record.resolvedInputs` (`result`, `artifacts`, `feedback`) —
  both already populated on the in-memory `record` by the time `ensureUpdateTask` returns,
  so no disk re-read is needed. Actor: `record.actor` (see above). Id: ``
  `workflow.step.completed:${specId}:${taskId}:${step}:${attempt}` ``.
- **Retry past already-completed (round 3, Major — D18):** at `finishStep`'s two
  already-settled short-circuit returns — `if (plan.status === 'already-completed') {...}`
  and `if (plan.status === 'completed') {...}` (both currently just `return`
  immediately) — also (re-)attempt the same `workflow.step.completed` emission, built from
  `plan.existingRecord` (its `actor`, `step`, `attempt`, `update-task`-stage `.result`, and
  `resolvedInputs`), **before** returning. Same deterministic id as the main call site, so
  this is a harmless no-op when the activity is already recorded and an actual retry when
  the original attempt failed (e.g. a disk error, per the non-blocking-failure requirement
  below). Extract the "build envelope `data` + resolve id + call `recordActivity`" logic
  used by the main call site and these two short-circuits into one small shared helper
  (e.g. in `tools/specs/activity/producers/workflow.mjs`) rather than duplicating it three
  times.
- Both `workflow.step.*` ids are deterministic (not `crypto.randomUUID()`), passed
  explicitly as `fields.id` to `recordActivity`. Correctness against the crash window
  between the Activity append and the operation-record stage-status update comes from
  `store.mjs`'s read-side dedup by `id` (task 02) *combined with* the corrected emission
  call site and the already-completed retry above — no single one of these is sufficient
  alone (D10, D15, D18 / overview.md § Idempotency).
- If `recordActivity` throws (e.g. a disk error), the workflow operation must still
  succeed — wrap the call so a failure to record activity never fails or rolls back
  `finishStep` or `handleWorkflowStepStart` or `startHumanStep`. A failed attempt at the main
  call site gets a further retry opportunity on every later already-completed `finish` call
  (D18) — this is the accepted v1 recovery behavior; no separate failure-tracking state is
  introduced.

## Implementation constraints

Do not change `finishStep`'s stage sequence or any existing test's expectations of
`workflow_progress.history[]` — this is additive instrumentation at existing call sites,
not a new stage. Do not touch `ensureTransition`. `operation-record.mjs`'s record shape
stays stable except for the one additive `actor` field on `createOperationRecord`'s output
(no code change needed in `operation-record.mjs` itself — it persists/reads records as
opaque JSON). `finishStep`'s `actor` parameter must have zero effect on workflow
behavior — it only affects what gets captured onto a newly-created operation record.
Do not introduce step-name branching: workflow step activities observe generic step execution
for arbitrary steps.

## Acceptance criteria

- A normal agent step start + finish produces one queryable `workflow.step.started` and one
  queryable `workflow.step.completed` activity, with `attempt`/`result`/`transitioned_to`
  matching `workflow_progress.history[]`'s corresponding entry.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- A human-owned step activated via `startHumanStep` produces a queryable
  `workflow.step.started` activity with a `user`-type actor.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- A human-owned step completed via `submitHumanStepResult` produces a queryable
  `workflow.step.completed` activity with a `user`-type actor, not `SYSTEM_ACTOR`.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating the crash window (workflow history already persisted via
  `setTaskWorkflowState`, the operation record's `update-task` stage still `pending`, no
  activity recorded) and resuming `finishStep`: exactly one queryable
  `workflow.step.completed` activity results. `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a second, independent resume where the `update-task` stage is already
  `completed`: no duplicate `workflow.step.completed` activity is surfaced when queried.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Calling `handleWorkflowStepStart` or `startHumanStep` twice for the same active attempt
  surfaces exactly one queryable `workflow.step.started` activity.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- `autoBindAgentSession` returns `bindSessionSync()`'s result — including a resolved
  `sessionId` — for an execution context containing only `provider` + `providerSessionId`
  (no canonical `sessionId` supplied). `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- `autoBindAgentSession` returns `null` (not a partial object) when there is no execution
  context, no valid `specId`, or binding throws.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Passing an explicit `actor` into `finishStep` on a **brand-new** operation results in
  that exact actor on the resulting `workflow.step.completed` activity.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a resume under a *different* actor than the one that created the operation
  record (actor A creates the record and gets past the `workflow_progress` write; actor B,
  or no actor at all, resumes): the resulting `workflow.step.completed` activity's actor is
  A, not B and not `SYSTEM_ACTOR`. `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a `recordActivity` failure on a step's first successful completion (operation
  reaches `status: 'completed'` but the activity never got recorded), then calling
  `finishStep` again (an `already-completed`/`completed` short-circuit, not a stage-
  sequence resume): the previously-missed `workflow.step.completed` activity is present
  when queried afterward, with the original actor and data.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Calling `finishStep` again against an already-`completed` operation where the activity
  *was* already successfully recorded does not produce a duplicate when queried (the
  retry-on-already-completed logic is itself idempotent via the same deterministic id).
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Forcing `recordActivity` to throw does not prevent `finishStep` from completing
  successfully. `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Existing workflow tests (`tools/tests/workflow-finish-operation.test.mjs`,
  `tools/tests/workflow-cli.test.mjs`) still pass unchanged in their existing assertions.
  `automated: node --test tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs`

## Verification

```bash
node --test tools/tests/activity-workflow-producer.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any new per-finding-authorship capture in the review command itself; any producer other
than generic workflow step events; touching `ensureTransition`/the `transition` stage;
modifying dashboard HTTP transport adapters (`human-step-transport.mjs` delegates directly
to domain operations); gate signoff activities (`human.verification.confirmed` is owned
by task 07).
