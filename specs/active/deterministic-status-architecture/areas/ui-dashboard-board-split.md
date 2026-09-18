# Area: UI dashboard board split

## Responsibility

Give the dashboard's kanban board a deterministic-aware lane projection instead of routing
deterministic tasks through legacy `stageForStatus()`, and finish separating `TaskCard`'s
already-started `isDeterministic` branching into clearly separated legacy/deterministic
responsibility — covering the card's full visible state (status label/tone, lane,
blockedBy, actions), not only its action footer — without duplicating its shared parts.

## Current state

`stageForStatus()` (`tools/dashboard/server/specs/status-stages.mjs`) hardcodes a
legacy-`task.status`-to-lane map with no workflow-mode awareness, consumed by
`tools/dashboard/server/specs/data.mjs` to build every spec's `lanes`. `status-board.tsx`
consumes `specification.lanes` as given — it does not compute lanes itself. `TaskCard`
(inline, non-exported, inside `status-board.tsx`, lines ~15–163) already branches on
`isDeterministic` for its action-footer rendering (legacy: single approve/accept button;
deterministic: multi-action buttons from `actionGate.availableActions`), but its status
label still reads `formatTaskStatus(task.status)`/`taskStatusTone(task.status)` for
**both** legacy and deterministic cards — once a deterministic task's workflow has started,
this is exactly the kind of stale, `task.status`-derived visible state this whole change
exists to remove. `StatusBoard` itself also branches once more, to hide the legacy
batch-approve button in deterministic mode.

## Requirements

- A deterministic-aware lane/board projection (server-side, e.g. alongside `data.mjs`/
  `status-stages.mjs`) that derives a deterministic task's lane from the canonical
  projection, read via the corrected action DTO
  (`areas/dashboard-server-actions-wiring.md`) — never from `stageForStatus()`/legacy
  `task.status` — while leaving every legacy spec's lane derivation via `stageForStatus()`
  completely unchanged.
- `TaskCard`'s deterministic and legacy responsibilities become clearly separated (e.g. two
  small sub-components sharing the card shell) covering **all** visible state — status
  label/tone, blockedBy, and actions — not only the action footer. For a deterministic
  task, once its workflow has started, the visible status label/tone must come from the
  canonical projection's `state`/`currentStep` (via the corrected DTO), never from
  `formatTaskStatus(task.status)`/`taskStatusTone(task.status)`. The shared, genuinely
  identical parts (order badge, title button) stay in the common card shell.
- Deterministic action availability in the UI is driven by `DashboardActionProjection`'s
  `availableActions` (`areas/dashboard-server-actions-wiring.md`, itself composing
  `TaskProjection` and `ExecutionReadiness` — D10) — never re-derived ad hoc in the
  component, and never read directly off the pure projection (which does not own
  action-availability, D10).

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
- A deterministic `TaskCard` whose task's `status` is still `approved` (compatibility
  value) but whose current step is `review` shows a review-appropriate status label/tone —
  not "Approved."
- No component in this area's scope calls `stageForStatus()`, `isTaskReady()`,
  `formatTaskStatus()`, or `taskStatusTone()` with a deterministic task's `task.status` as
  input.

## Dependencies

`areas/deterministic-projection-and-human-step.md`,
`areas/dashboard-server-actions-wiring.md` (the corrected action DTO this area reads).

## Out of scope

Board/lane configurability as project config (explicitly out of scope for this whole change
— D1). `TaskDialog`/chat (owned by `areas/human-step-surface.md`).
