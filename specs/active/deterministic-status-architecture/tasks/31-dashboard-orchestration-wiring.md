---
id: deterministic-status-architecture.dashboard-orchestration-wiring
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/areas/deterministic-batch-orchestrator.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/dashboard/ui/features/specifications/detail/status-board.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/tests/dashboard-orchestration-wiring.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - src/**
depends_on: [ execution-policy-and-mode-selection, automatic-workflow-continuation, deterministic-batch-orchestrator ]
semantic_references:
  decisions: []
---

# Task: Dashboard orchestration wiring

## Goal

Wire the execution-policy selection (task 25), automatic continuation (task 27), and batch
orchestrator (task 29) into the real UI entry points: `start-step` opens the selection UI
only when actually needed (not on every click), a completed step's UI reflects an automatic
continuation without requiring the user to notice and click "Start" again, a human step
auto-activated by the orchestrator shows `HumanStepSurface` directly, and the batch-selection
surface (task 29) is reachable from the board.

## Implementation constraints

- `specification-detail-content.tsx`'s `startStep` calls task 25's execution-policy check
  first; only when unresolved does it show the selection UI, otherwise it proceeds exactly as
  today.
- After a turn/finish completes, if `automatic-workflow-continuation` (task 27) has already
  moved the task forward (new session created, or a human step auto-activated), the UI must
  reflect that state directly — no card/dialog should still offer a "Start" control for a
  step that already auto-continued.
- Add the batch-selection entry point (task 29's scheduler) to `specification-overview.tsx` —
  reachable without leaving the dashboard.
- No `switch`/`if`/lookup-object keyed on a literal step id introduced anywhere in this
  wiring (same invariant as D15/D19, extended here).

## Acceptance criteria

- Clicking `start-step` for a task/provider needing mode selection shows the selection UI;
  for one that doesn't, or that already has a resolved policy, it proceeds directly — proven
  for both cases.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- After an `implementation → review` auto-continuation (task 27), the board/dialog shows the
  task already `active` in `review` with the fresh reviewer session — never a stale "Start"
  control for a step that already started.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- A human step auto-activated by the orchestrator renders `HumanStepSurface`'s real
  interaction immediately in both the board/dialog path and chat.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- The batch-selection surface is reachable from `specification-overview.tsx` and can start a
  named subset of ready tasks end to end.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id.

## Verification

```bash
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The orchestrator/scheduler logic itself (tasks 25/27/29 — this task only wires their results
into the UI). Any new visual redesign beyond what's needed to reflect the new states.
