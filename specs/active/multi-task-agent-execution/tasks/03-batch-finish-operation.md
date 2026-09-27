---
id: multi-task-agent-execution.batch-finish-operation
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-finish-operation.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/batch-finish/**
  - tools/specs/workflow/cli.mjs
  - tools/tests/batch-finish-operation.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - src/**
depends_on: [ execution-scope-model ]
semantic_references:
  decisions: [D3, D10]
  constraints: [C5]
  dependency_contracts: [execution-scope-model]
---

# Task: Batch-finish operation

## Goal

Implement `workflow batch finish` as one atomic/logical boundary (D3): validate every task's
submitted result before any of them becomes externally visible, persist the complete batch result
durably, apply each task's own transition idempotently, and only once every task's mutation is
durably confirmed, recompute/dispatch continuations for the whole batch together.

## Dependencies

`execution-scope-model` — a batch-finish call must be authorized against the calling session's
own `ExecutionScope`; a call naming a task outside that scope is rejected.

## Implementation constraints

- Reuse `tools/specs/workflow/finish-operation.mjs`'s existing per-task mutation stages
  (`verify-gates, update-task, commit, push, transition`) unchanged — this task adds an outer
  validate-then-persist-then-apply-then-barrier envelope, it does not reimplement per-task
  finishing.
- Reuse the existing `finishContract` validation per task — a submitted `result` is checked
  against that task's own current step's declared `transitions[].value` set; do not introduce a
  hardcoded `pass`/`fail` enum anywhere in this task's code.
- The durable batch-finish record lives at
  `.nevo-ai-local/batch-finish/<changeSlug>/<batchExecutionId>.json`, following the existing
  intent-then-derive convention (`batch.json`/`follow-ups.yaml`) — persist intent/results, derive
  per-task application status from `change.yaml` state where possible, never duplicate a
  `completed`/`current` field that could drift from that state.
- **Any single invalid result rejects the whole call before any durable write happens** (D10) — no
  task's `change.yaml` may change if even one task's result fails validation.
- Continuation dispatch for any task in the batch must not occur until every task in the record
  shows `applied` — implement this as a distinct final stage, never interleaved with per-task
  application.
- Idempotent resume: re-running against an already-`applied` task in a `validated`-or-later record
  is a no-op; a record that never reached `validated` is simply abandoned on resume, never
  re-validated against possibly-changed current task state.
- This neighborhood (`finish-operation.mjs`, `cli.mjs`) is active ground (C5) — re-read current
  file contents before editing rather than trusting this task's own citations to still be exact.

## Acceptance criteria

- Given three tasks with valid results, the record reaches `completed` and all three tasks show
  independent transition/history/feedback entries. `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Given three tasks where one result is invalid, no task's `change.yaml` entry changes, and the
  call reports the specific invalid task. `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Simulating a crash between task A reaching `applied` and task B still `pending`, then resuming,
  completes exactly B without re-touching A or re-dispatching A's continuation twice.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- No continuation for any task in the batch fires before every task in the batch shows `applied`.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Existing single-task finish behavior is unchanged. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/batch-finish-operation.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/agent-workflow-protocol.md`'s `workflow_progress`/finish-operation
description to note the batch-finish envelope and its durable record, in the same branch.

## Out of scope

The reviewer's own judgment/skill (`multi-task-review-skill`) — this task only defines the
operation a finished judgment is submitted through. The shared context/report content
(`batch-context-and-report`) — this task only accepts and stores the report reference, it does
not build the report.
