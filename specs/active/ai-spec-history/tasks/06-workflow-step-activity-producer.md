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
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
allowed_paths:
  - tools/specs/activity/producers/workflow.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/activity-workflow-producer.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  decisions: [D6]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Workflow step activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit `workflow.step.started` and `workflow.step.completed` activities from the existing
authoritative workflow execution boundaries, without altering `finishStep`'s resumability
guarantees, and without duplicating activity on a resumed operation.

## Requirements

- `tools/specs/activity/producers/workflow.mjs`: owns the two type constants
  (`workflow.step.started`, `workflow.step.completed`) and each event's `data` contract
  (a small validator for the fields listed below) — this module is the "producer contract"
  referenced in overview.md § Extensibility; it is additive and does not change
  `tools/specs/activity/model.mjs`.
- `workflow.step.started`: called from `handleWorkflowStepStart` (`cli.mjs`), actor =
  resolved agent-session actor (or `SYSTEM_ACTOR` if none is bound), `scope` = the
  change/task, `data` = `{ step, attempt }`.
- `workflow.step.completed`: called from `finishStep`'s transition stage
  (`finish-operation.mjs`), at the same point/guard already used to write
  `task.workflow_progress.history[]`, so a resumed operation that skips an
  already-completed stage also skips re-emitting this activity. `data` = `{ result,
  attempt, transitioned_to, artifacts, feedback }`, plus a `findings` array **only** when
  the resolved inputs already carry per-finding authorship at this boundary — do not add
  new capture logic to any review command to manufacture this (D6).
- Activity ids for both events are derived deterministically from stable identifiers
  (e.g. a hash of `operationId` + event type, or `operationId` + stage for the completed
  event) rather than freshly randomized, as defense in depth for idempotency.
- If `recordActivity` throws (e.g. a disk error), the workflow operation must still
  succeed — wrap the call so a failure to record activity never fails or rolls back
  `finishStep` or `handleWorkflowStepStart`.

## Implementation constraints

Do not change `finishStep`'s stage sequence, `operation-record.mjs`'s record shape, or any
existing test's expectations of `workflow_progress.history[]` — this is additive
instrumentation at an existing point, not a new stage.

## Acceptance criteria

- A normal step start + finish produces one `workflow.step.started` and one
  `workflow.step.completed` activity, with `attempt`/`result`/`transitioned_to` matching
  `workflow_progress.history[]`'s corresponding entry.
  `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
- Simulating a resumed finish operation (operation record with the transition stage
  already marked completed) does not produce a second `workflow.step.completed` activity
  for that attempt/stage. `automated: node --test tools/tests/activity-workflow-producer.test.mjs`
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
than the two workflow step events.
