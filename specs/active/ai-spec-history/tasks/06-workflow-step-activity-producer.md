---
id: ai-spec-history.workflow-step-activity-producer
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
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/dashboard/server/ai/sessions/binding-service.mjs
allowed_paths:
  - tools/specs/activity/producers/workflow.mjs
  - tools/specs.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/activity-workflow-producer.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  decisions: [D6, D10, D11, D14, D15]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Workflow step activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit `workflow.step.started` and `workflow.step.completed` activities from the correct
existing authoritative workflow execution boundaries, with a session-actor contract that
can't misclassify a validly-bound session, and with an emission call site that survives
both the duplicate-on-resume and missing-on-resume crash windows (2026-09-16 and
2026-09-17 PR review rounds — see `areas/activity-producers-workflow-and-verification.md`
for the full corrected reasoning).

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
  Update both call sites in `cli.mjs` (`handleWorkflowStepStart` at line ~255,
  `handleWorkflowStepFinish` at line ~269) to capture the returned binding (call it
  `binding`) and use `binding?.sessionId` when resolving the `agent-session` actor for
  this task's producer calls.
- `tools/specs/activity/producers/workflow.mjs`: owns the two type constants
  (`workflow.step.started`, `workflow.step.completed`) and each event's `data` contract
  (a small validator for the fields listed below) — this module is the "producer contract"
  referenced in overview.md § Extensibility; it is additive and does not change
  `tools/specs/activity/model.mjs`.
- `workflow.step.started`: called from `handleWorkflowStepStart` (`cli.mjs`), actor =
  resolved agent-session actor from `binding?.sessionId` (or `SYSTEM_ACTOR` if `binding`
  is null), `scope` = the change/task, `data` = `{ step, attempt }`. `id`: ``
  `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` ``.
- **`workflow.step.completed` — emission call site (round 2, Blocking):** add the emission
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
  so no disk re-read is needed. `id`: ``
  `workflow.step.completed:${specId}:${taskId}:${step}:${attempt}` ``.
- **`finishStep`'s new `actor` parameter (round 2, Major):** add an optional `actor`
  field to `finishStep`'s options object (an already-resolved `ActorRef`), used for the
  `workflow.step.completed` emission above, defaulting to `SYSTEM_ACTOR` when omitted.
  `handleWorkflowStepFinish` passes the agent-session actor (from `binding?.sessionId`,
  same as `workflow.step.started`'s resolution) as this argument. (Task 07 is responsible
  for `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch passing a `user`
  actor through this same parameter — this task only needs to define and honor it.)
- Both `workflow.step.*` ids are deterministic (not `crypto.randomUUID()`), passed
  explicitly as `fields.id` to `recordActivity`. Correctness against the crash window
  between the Activity append and the operation-record stage-status update comes from
  `store.mjs`'s read-side dedup by `id` (task 02) *combined with* the corrected emission
  call site above — neither alone is sufficient (D10, D15 / overview.md § Idempotency).
- If `recordActivity` throws (e.g. a disk error), the workflow operation must still
  succeed — wrap the call so a failure to record activity never fails or rolls back
  `finishStep` or `handleWorkflowStepStart`.

## Implementation constraints

Do not change `finishStep`'s stage sequence, `operation-record.mjs`'s record shape, or any
existing test's expectations of `workflow_progress.history[]` — this is additive
instrumentation at an existing call site, not a new stage. Do not touch `ensureTransition`.
`finishStep`'s new `actor` parameter must have zero effect on workflow behavior — it only
affects what gets passed to activity emission.

## Acceptance criteria

- A normal step start + finish produces one queryable `workflow.step.started` and one
  queryable `workflow.step.completed` activity, with `attempt`/`result`/`transitioned_to`
  matching `workflow_progress.history[]`'s corresponding entry.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating the crash window (workflow history already persisted via
  `setTaskWorkflowState`, the operation record's `update-task` stage still `pending`, no
  activity recorded) and resuming `finishStep`: exactly one queryable
  `workflow.step.completed` activity results. `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a second, independent resume where the `update-task` stage is already
  `completed`: no duplicate `workflow.step.completed` activity is surfaced when queried.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Calling `handleWorkflowStepStart` twice for the same active attempt surfaces exactly one
  queryable `workflow.step.started` activity.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- `autoBindAgentSession` returns `bindSessionSync()`'s result — including a resolved
  `sessionId` — for an execution context containing only `provider` + `providerSessionId`
  (no canonical `sessionId` supplied). `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- `autoBindAgentSession` returns `null` (not a partial object) when there is no execution
  context, no valid `specId`, or binding throws.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Passing an explicit `actor` into `finishStep` results in that exact actor on the
  resulting `workflow.step.completed` activity.
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
than the two workflow step events; touching `ensureTransition`/the `transition` stage;
wiring `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` actor resolution
itself (task 07 passes the `user` actor through the `actor` parameter defined here).
