# Area: UI task details and human review

## Responsibility

Give `TaskDialog` (the existing closest match to "TaskDetails") deterministic projection
awareness and a reusable human-review surface, so deterministic human review is not
hardcoded to a literal step name and is not confined to the kanban card's action footer.

## Current state

`TaskDialog` (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`) has no
`isDeterministic` prop and always renders the legacy-only `TaskActionFooter`
(`actionGate.action`, single action) — unlike `TaskCard`, which already renders the full
deterministic multi-action footer. This is a real, confirmed gap between the two
"task detail" surfaces, not a naming difference.

## Requirements

- `TaskDialog` gains deterministic projection awareness (the same canonical projection
  `areas/deterministic-projection-and-human-interaction.md` provides): current step,
  `waiting-for-step-start` state shown honestly (not as "active"), blocking dependencies,
  available actions, and — when present — the pending human interaction.
- A reusable human-review surface component (Confirm / Approve / Request changes / feedback
  input as applicable, per the human-interaction projection's `kind`) is built once and
  rendered from `TaskDialog`, not duplicated per entry point. When a human decision is
  pending, this surface becomes prominent/default within the dialog.
- The human-review surface's rendering condition is the projection's non-null pending
  interaction — never `currentStep === 'human-verification'` or any other literal step-name
  check.
- Desktop/mobile layout differences (if any are introduced) must not change human-review
  semantics — the same surface renders regardless of layout container.

## Constraints

- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged for
  legacy specs.
- Reuse `TaskCard`'s existing deterministic action-footer sub-component(s) from
  `areas/ui-dashboard-board-split.md` where the action set genuinely overlaps, rather than
  reimplementing deterministic action rendering a third time.

## Interfaces and boundaries

Exposes: the human-review surface component, reusable from other entry points (task board,
chat) in future work without duplicating approval logic — this change only wires it from
`TaskDialog`.

Consumed by: `TaskDialog` in this change; documented as reusable for future entry points
(not built here).

## Area-specific acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step other
  than one literally named `human-verification` still renders the review surface correctly
  — proving the rendering condition is projection-driven, not name-driven.
- `TaskDialog` opened on a deterministic task with implementation finished and review not
  yet started shows "Ready for review" / "Start review," never a fabricated active-review
  state.
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged.
- The human-review surface component has exactly one implementation reused by `TaskDialog`
  — no second, divergent approve/request-changes UI is introduced elsewhere in this change.

## Dependencies

`areas/deterministic-projection-and-human-interaction.md`,
`areas/ui-dashboard-board-split.md` (for action-footer sub-component reuse where it
genuinely overlaps).

## Out of scope

Wiring the human-review surface from the task board or chat/timeline entry points (future
work — this area only requires the surface be built reusably, not that every entry point
uses it yet). Full human-gate engine redesign.
