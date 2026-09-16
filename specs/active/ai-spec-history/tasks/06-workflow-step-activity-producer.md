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
  decisions: [D6, D10]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Workflow step activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit `workflow.step.started` and `workflow.step.completed` activities from the correct
existing authoritative workflow execution boundaries, without altering `finishStep`'s
resumability guarantees, and with the id/dedup scheme that actually prevents a resumed or
repeated call from producing a visible duplicate (2026-09-16 PR review, Blocking 1/2/3 —
see `areas/activity-producers-workflow-and-verification.md` for the full corrected
reasoning).

## Requirements

- **Session actor contract (Blocking 3):** change `autoBindAgentSession` in
  `tools/specs.mjs` to `return context;` (the `AgentExecutionContext` it already computes
  via `readAgentExecutionContext` — currently the function falls off the end / has early
  bare `return;` statements and returns nothing). Make the early-return branches
  explicit (`return null;`) for clarity. This is additive — no existing caller inspects
  the return value today. Update both call sites in `cli.mjs`
  (`handleWorkflowStepStart` at line ~255, `handleWorkflowStepFinish` at line ~269) to
  capture the returned context and use `context?.sessionId` when resolving the
  `agent-session` actor for this task's producer calls.
- `tools/specs/activity/producers/workflow.mjs`: owns the two type constants
  (`workflow.step.started`, `workflow.step.completed`) and each event's `data` contract
  (a small validator for the fields listed below) — this module is the "producer contract"
  referenced in overview.md § Extensibility; it is additive and does not change
  `tools/specs/activity/model.mjs`.
- `workflow.step.started`: called from `handleWorkflowStepStart` (`cli.mjs`), actor =
  resolved agent-session actor from `context?.sessionId` (or `SYSTEM_ACTOR` if `context`
  is null/has no `sessionId`), `scope` = the change/task, `data` = `{ step, attempt }`.
  `id`: `` `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` `` — repeated
  `step start` calls for the same attempt (intentionally allowed while the step is active)
  produce the same `id` and dedup to one logical activity on read.
- **`workflow.step.completed` (Blocking 1 — corrected hook point):** called from
  `ensureUpdateTask` (the **`update-task` stage** in `finish-operation.mjs`), reusing its
  own existing guard (`if (stage.status === 'completed') return;`) — **not** from
  `ensureTransition`/the `transition` stage, which is a later, runtime-only stage that
  does not write `workflow_progress.history[]`. `data` = `{ result, attempt,
  transitioned_to, artifacts, feedback }`, plus a `findings` array **only** when the
  resolved inputs already carry per-finding authorship at this boundary — do not add new
  capture logic to any review command to manufacture this (D6). `id`: ``
  `workflow.step.completed:${specId}:${taskId}:${step}:${attempt}` ``.
- Both ids are deterministic (not `crypto.randomUUID()`), passed explicitly as `fields.id`
  to `recordActivity`. Correctness against the crash window between the Activity append
  and the operation-record stage-status update comes from `store.mjs`'s read-side dedup by
  `id` (task 02) — the `update-task` stage guard above is an optimization that skips the
  redundant attempt in the common case, not the source of correctness by itself (D10 /
  overview.md § Idempotency).
- If `recordActivity` throws (e.g. a disk error), the workflow operation must still
  succeed — wrap the call so a failure to record activity never fails or rolls back
  `finishStep` or `handleWorkflowStepStart`.

## Implementation constraints

Do not change `finishStep`'s stage sequence, `operation-record.mjs`'s record shape, or any
existing test's expectations of `workflow_progress.history[]` — this is additive
instrumentation at an existing point, not a new stage. Do not touch `ensureTransition`.

## Acceptance criteria

- A normal step start + finish produces one queryable `workflow.step.started` and one
  queryable `workflow.step.completed` activity, with `attempt`/`result`/`transitioned_to`
  matching `workflow_progress.history[]`'s corresponding entry.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a resumed finish operation (operation record with the **`update-task`**
  stage already marked completed) does not surface a second `workflow.step.completed`
  activity for that attempt when queried.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Calling `handleWorkflowStepStart` twice for the same active attempt surfaces exactly one
  queryable `workflow.step.started` activity.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- `autoBindAgentSession` returns the resolved `AgentExecutionContext` (or `null`), and
  existing callers that ignore the return value are unaffected.
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
than the two workflow step events; touching `ensureTransition`/the `transition` stage.
