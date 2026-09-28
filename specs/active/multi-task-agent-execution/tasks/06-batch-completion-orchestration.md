---
id: multi-task-agent-execution.batch-completion-orchestration
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-completion-orchestration.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/ai/orchestration/batch-barrier.mjs
  - tools/specs/workflow/human-step/projection.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/deterministic-status-corrective.test.mjs
forbidden_paths:
  - src/**
  - tools/specs/workflow/batch-finish/**
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/queue/**
depends_on: [ batch-finish-operation, batch-queue-reservation ]
semantic_references:
  decisions: [D16, D17]
  constraints: [C1]
  dependency_contracts: [batch-finish-operation, batch-queue-reservation]
---

# Task: Batch completion orchestration

## Goal

Own the dashboard-orchestration side of the batch lifecycle `batch-finish-operation` explicitly
does not (D16): batch-aware Hook1 terminal-settlement observation, batch completion detection,
continuation-barrier release, and dispatching every affected task's next action once released —
while enforcing that no downstream action executes for any barriered batch member until the whole
batch reaches `completed` (D17).

## Dependencies

`batch-finish-operation` (the durable `completed` state this task observes, read-only — never a
call into workflow-core beyond reading its durable record), `batch-queue-reservation` (the
reservation this task releases on barrier release).

## Implementation constraints

- Introduce a durable batch-barrier record (keyed by `batchExecutionId`, naming member `taskIds`),
  active from reservation until the batch-finish record reaches `completed`.
- **Barrier scope covers every downstream action path (D17), not just queue dispatch**: automatic
  agent continuation, sequential queue dispatch, human-interaction submission, and any other
  workflow start/continuation touching a barriered member must all consult this record before
  acting — audit and wire the check into each of these existing call sites
  (`admission.mjs`/`reconciliation.mjs`'s continuation path, the queue evaluator's dispatch,
  `human-step/projection.mjs`'s submission path).
- A barriered member's own `workflow_progress` state remains readable/observable — the barrier
  blocks *action*, never *visibility* (D17's precise invariant).
- Release the barrier for every member **atomically** once the batch-finish record reads
  `completed` — never one member at a time, to avoid a window where some members are unblocked and
  others aren't for no durable reason.
- Reuse the existing single-task continuation-dispatch function per member — do not build a new
  dispatch mechanism; call it once per member, only after atomic barrier release.
- Release `batch-queue-reservation`'s reservation as part of barrier release — `batch-finish-operation`
  itself never touches the reservation (D16).
- This task is the one place allowed to import both the workflow-core batch-finish record (read
  only) and dashboard orchestration primitives — `batch-finish-operation` itself must remain free
  of any `tools/dashboard/**` reference; this task does not weaken that boundary from its own side
  either (it reads the durable record file/API, it does not import `tools/specs/workflow/batch-finish/**`'s
  internals to bypass the public read surface).

## Acceptance criteria

- While the barrier is active for members A/B/C, none of automatic agent continuation, queue
  dispatch, or human-interaction submission executes for any of them — proven per path
  individually. `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Once the batch-finish record reaches `completed`, the barrier releases for A/B/C atomically and
  each dispatches its own next action exactly once.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- The queue reservation is released only as part of barrier release, never independently.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A member's own `workflow_progress` history entry is readable before the barrier releases.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Existing single-task continuation/reconciliation behavior is unaffected for non-batch tasks.
  `automated: node --test tools/tests/deterministic-status-corrective.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs tools/tests/deterministic-status-corrective.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The batch-finish operation's own durable saga (`batch-finish-operation`) — this task never
performs a task's finish mutation itself. Building `BatchContext` or the report. Any UI.
