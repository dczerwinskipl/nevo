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
depends_on: [ deterministic-task-projection ]
---

# Task: `TaskCard` lifecycle split

## Goal

Separate `TaskCard`'s legacy and deterministic action-footer responsibility into clearly
distinct sub-components sharing the card shell, without duplicating the shared, unbranched
parts (order badge, status label, dependency badges, title), and drive deterministic action
availability from the projection/readiness policy rather than ad hoc re-derivation.

## Dependencies

`deterministic-task-projection` — the deterministic sub-component reads this projection's
available-actions field (surfaced through the existing `actionGate` server projection).

## Implementation constraints

- Extract `TaskCard`'s two branches (currently inline in `status-board.tsx`, lines ~84–160)
  into two small sub-components (e.g. `LegacyTaskCardActions`/
  `DeterministicTaskCardActions`) — keep the shared card shell (order badge, status label
  via `formatTaskStatus`/`taskStatusTone`, dependsOn/blockedBy badges, title button) as one
  component both render inside.
- `StatusBoard`'s own `isDeterministic` branch (hiding the legacy batch-approve button) is
  unaffected by this task — do not fold it into the card split.
- Deterministic action availability continues to come from the existing
  `actionGate.availableActions` server projection (now backed by
  `deterministic-readiness-policy`/`deterministic-task-projection` server-side) — no new
  client-side readiness logic.

## Acceptance criteria

- `TaskCard`'s legacy rendering output (a legacy spec's card) is byte-for-byte unchanged
  after the split (brief regression test #14).
  `automated: node --test tools/dashboard/tests/ux-improvements-regression.test.mjs`
- `TaskCard`'s deterministic rendering output (a deterministic spec's card) is unchanged in
  behavior, now sourced from a distinct sub-component rather than an inline conditional.
  `inspection: confirm DeterministicTaskCardActions renders the same action set status-board.tsx's prior inline branch did`
- No component in this task's scope calls `stageForStatus()` or `isTaskReady()` for a
  deterministic task (brief regression test #13's card half).
  `inspection: confirm neither sub-component imports stageForStatus or isTaskReady`

## Verification

```bash
node --test tools/dashboard/tests/ux-improvements-regression.test.mjs
```

## Out of scope

The server-side lane projection (task `deterministic-board-lane-projection`). `TaskDialog`
(task `task-dialog-deterministic-projection`).
