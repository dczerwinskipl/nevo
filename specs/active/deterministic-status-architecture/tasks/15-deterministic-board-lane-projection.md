---
id: deterministic-status-architecture.deterministic-board-lane-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ui-dashboard-board-split.md
allowed_paths:
  - tools/dashboard/server/specs/status-stages.mjs
  - tools/dashboard/server/specs/data.mjs
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ deterministic-task-projection ]
---

# Task: Deterministic board lane projection

## Goal

Give deterministic specs a board/lane derivation based on the canonical task projection
instead of legacy `stageForStatus()`, while leaving every legacy spec's lane derivation
completely unchanged.

## Dependencies

`deterministic-task-projection` — this task's lane mapping reads that projection's state.

## Implementation constraints

- In `tools/dashboard/server/specs/data.mjs`, branch the `stage`/lane assignment on
  `resolveWorkflowMode()` (or the already-resolved `workflowMode` the route has available):
  legacy specs keep calling `stageForStatus(task.status)` unchanged; deterministic specs
  call a new lane-derivation function reading the canonical projection's state instead.
- Do not modify `stageForStatus()` itself or its legacy call sites — add the new
  deterministic path alongside it in the same file (or a small new sibling module) rather
  than branching inside `stageForStatus()`.
- Map the projection's states (`draft`, `blocked`, `ready`, `active`,
  `waiting-for-step-start`, `human-interaction`, `terminal`) onto the existing 6-lane set
  (`new/design/ready/implementation/review/done` from `lane-presentation.ts`) unless a
  state genuinely needs a lane none of the six represent — prefer reuse.

## Acceptance criteria

- A deterministic task whose `status` is still the `approved` compatibility value but whose
  `workflow_progress.current_step` is `review` renders in a review-appropriate lane, not a
  `stageForStatus('approved')`-derived lane (brief regression test #13's board half).
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- A legacy spec's lane assignment is unchanged — regression-tested against existing fixture
  data. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- No deterministic task's lane is computed via `stageForStatus()` or `isTaskReady()`.
  `inspection: confirm the deterministic lane path never calls stageForStatus/isTaskReady`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

Board/lane configurability as project config (D1, out of scope for the whole change).
`TaskCard`'s own rendering (task `task-card-lifecycle-split`).
