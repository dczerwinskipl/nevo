---
id: deterministic-status-architecture.task-card-lifecycle-split
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ui-dashboard-board-split.md
allowed_paths:
  - tools/dashboard/ui/features/specifications/detail/status-board.tsx
  - tools/dashboard/ui/features/specifications/detail/lane-presentation.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ dashboard-deterministic-action-projection ]
---

# Task: `TaskCard` lifecycle split

## Goal

Separate `TaskCard`'s legacy and deterministic responsibility into clearly distinct
sub-components sharing the card shell, covering the card's **full visible state** — status
label/tone, blockedBy, and actions, not only the action footer — and stop a deterministic
card's status label from reading `formatTaskStatus(task.status)`/`taskStatusTone(task.status)`
once a workflow has started.

## Dependencies

`dashboard-deterministic-action-projection` — the deterministic sub-component reads the
corrected action DTO (`state`, `availableActions`, etc.), not the raw `TaskProjection`
directly, since the UI has never talked to backend projection modules directly and
`availableActions` specifically only exists on the composed DTO (D10).

## Implementation constraints

- Extract `TaskCard`'s two branches (currently inline in `status-board.tsx`, lines ~84–160,
  action-footer only) into two small sub-components (e.g. `LegacyTaskCard`/
  `DeterministicTaskCard`) that each own their **entire** visible state — status label/tone,
  blockedBy, and action footer — not just the footer. Keep only the genuinely identical
  parts (order badge, title button) in a common card shell both render inside.
- For a deterministic task, the status label/tone must be derived from the action DTO's
  `state`/`currentStep`, never from `formatTaskStatus(task.status)`/
  `taskStatusTone(task.status)` — this is the concrete correction from the original design
  (corrective-pass-1 item 8).
- `StatusBoard`'s own `isDeterministic` branch (hiding the legacy batch-approve button) is
  unaffected by this task — do not fold it into the card split.
- Deterministic action availability continues to come from the action DTO's
  `availableActions` (now backed by `ExecutionReadiness`/`TaskProjection` server-side) — no
  new client-side readiness logic.

## Acceptance criteria

- `TaskCard`'s legacy rendering output (a legacy spec's card) is byte-for-byte unchanged
  after the split (brief regression test #14).
  `automated: node --test tools/dashboard/tests/ux-improvements-regression.test.mjs`
- A deterministic card whose task's `status` is still `approved` (compatibility value) but
  whose current step is `review` shows a review-appropriate status label/tone, not
  "Approved" or any other `formatTaskStatus(task.status)`-derived label.
  `inspection: confirm DeterministicTaskCard's status label reads the action DTO's state, not formatTaskStatus(task.status)`
- `TaskCard`'s deterministic action-footer output is unchanged in behavior, now sourced from
  a distinct sub-component rather than an inline conditional.
  `inspection: confirm DeterministicTaskCard's actions render the same set status-board.tsx's prior inline branch did`
- No component in this task's scope calls `stageForStatus()`, `isTaskReady()`,
  `formatTaskStatus()`, or `taskStatusTone()` for a deterministic task (brief regression
  test #13's card half). `inspection: confirm neither sub-component calls these for a deterministic task`

## Verification

```bash
node --test tools/dashboard/tests/ux-improvements-regression.test.mjs
```

## Out of scope

The server-side lane projection (task `deterministic-board-lane-projection`). The action DTO
itself (task `dashboard-deterministic-action-projection`). `TaskDialog`/chat (task
`human-step-surface-consolidation`).
