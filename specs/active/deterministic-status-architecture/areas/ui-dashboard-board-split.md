# Area: UI dashboard board split

## Responsibility

Give the dashboard's kanban board a deterministic-aware lane projection instead of routing
deterministic tasks through legacy `stageForStatus()`, and finish separating `TaskCard`'s
already-started `isDeterministic` branching into clearly separated legacy/deterministic
responsibility without duplicating its shared parts.

## Current state

`stageForStatus()` (`tools/dashboard/server/specs/status-stages.mjs`) hardcodes a
legacy-`task.status`-to-lane map with no workflow-mode awareness, consumed by
`tools/dashboard/server/specs/data.mjs` to build every spec's `lanes`. `status-board.tsx`
consumes `specification.lanes` as given — it does not compute lanes itself. `TaskCard`
(inline, non-exported, inside `status-board.tsx`, lines ~15–163) already branches on
`isDeterministic` for its action-footer rendering (legacy: single approve/accept button;
deterministic: multi-action buttons from `actionGate.availableActions`); the rest of the
card (order badge, status label, dependency badges, title) is shared. `StatusBoard` itself
also branches once more, to hide the legacy batch-approve button in deterministic mode.

## Requirements

- A deterministic-aware lane/board projection (server-side, e.g. alongside `data.mjs`/
  `status-stages.mjs`) that derives a deterministic task's lane from the canonical
  projection (`areas/deterministic-projection-and-human-interaction.md`) — never from
  `stageForStatus()`/legacy `task.status` — while leaving every legacy spec's lane
  derivation via `stageForStatus()` completely unchanged.
- `TaskCard`'s deterministic and legacy action-footer responsibilities become clearly
  separated (e.g. two small sub-components sharing the card shell) rather than growing the
  existing inline `isDeterministic` conditional further — without duplicating the shared,
  unbranched parts of the card (order badge, status label, dependency badges, title).
- Deterministic action availability in the UI is driven by the readiness policy
  (`areas/execution-readiness-and-session-bootstrap.md`) via the projection's "available
  actions" — never re-derived ad hoc in the component.

## Constraints

- Legacy board/lane behavior is byte-for-byte unchanged for legacy specs.
- No change to `lane-presentation.ts`'s legacy 6-lane color mapping unless a deterministic
  lane genuinely needs a new visual identity distinct from all six existing ones — prefer
  reusing the existing lane set if the deterministic states map onto it reasonably.

## Interfaces and boundaries

Exposes: the deterministic lane-projection function/endpoint field consumed by
`status-board.tsx`.

Consumed by: `status-board.tsx`/`TaskCard` only — no other area reads this directly.

## Area-specific acceptance criteria

- A deterministic spec's board lanes reflect `workflow_progress`/the canonical projection,
  not `task.status` — proven by a task whose `status` is still `approved` (compatibility
  value) but whose `workflow_progress.current_step` is `review` rendering in a
  review-appropriate lane, not a `stageForStatus('approved')`-derived lane.
- A legacy spec's board lanes are unchanged (regression test against existing behavior).
- `TaskCard`'s legacy rendering path is unchanged in output for legacy specs.
- No component in this area's scope calls `stageForStatus()` or `isTaskReady()` for a
  deterministic task.

## Dependencies

`areas/deterministic-projection-and-human-interaction.md`.

## Out of scope

Board/lane configurability as project config (explicitly out of scope for this whole change
— D1). `TaskDialog` (owned by `areas/ui-task-details-human-review.md`).
