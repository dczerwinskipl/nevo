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

- **Lane derivation is generic, D15 (supersedes this area's own earlier "review-appropriate
  lane" wording — item 11):** a deterministic-aware lane/board projection (server-side,
  e.g. alongside `data.mjs`/`status-stages.mjs`) that derives a deterministic task's lane
  from `TaskProjection.state` alone (`draft`/`blocked`/`ready`/`waiting-for-step-start`/
  `active`/`human-interaction`/`terminal`) and, only if genuinely useful for presentation,
  `executor` — **never** from `currentStep`/`nextStep`, or any other literal step id, and
  never from `stageForStatus()`/legacy `task.status` — while leaving every legacy spec's
  lane derivation via `stageForStatus()` completely unchanged. Two deterministic tasks both
  in `state: 'active'`, with different step ids (e.g. `review` and `hardening`), land in
  the identical lane. If the legacy six lane ids (`new`/`design`/`ready`/`implementation`/
  `review`/`done`) are reused internally as compatibility/presentation buckets for
  deterministic states, document that reuse explicitly as a presentation convenience — it
  carries no workflow-step semantics, and no state is required to map onto the
  identically-named legacy lane (an `active` deterministic task may legitimately render in
  the `review`-named bucket regardless of whether its actual step is named `review`).
- `TaskCard`'s deterministic and legacy responsibilities become clearly separated (e.g. two
  small sub-components sharing the card shell) covering **all** visible state — status
  label/tone, blockedBy, and actions — not only the action footer. For a deterministic
  task, once its workflow has started, the visible status label/tone is chosen from the
  canonical projection's `state` (never from `formatTaskStatus(task.status)`/
  `taskStatusTone(task.status)`, and never by branching on `currentStep`); the card may
  still **display** the step descriptor's real `id`/`purpose` as informational text
  alongside that state — showing the true step name/purpose is encouraged (item 11's "for
  generic deterministic UI, display the real step descriptor"), *choosing* the label/tone/
  lane by comparing that id against known strings is what's forbidden. The shared, genuinely
  identical parts (order badge, title button) stay in the common card shell.
- Deterministic action availability in the UI is driven by `DashboardActionProjection`'s
  `availableActions` (`areas/dashboard-server-actions-wiring.md`, itself composing
  `TaskProjection` and `ExecutionReadiness` — D10) — one generic `"start-step"` value, never
  re-derived ad hoc in the component, and never read directly off the pure projection (which
  does not own action-availability, D10).
- **`TaskCard` never implements the `start-step` protocol itself (D19/D20).** For
  `availableActions: ["start-step"]` it renders one generic "Start" control calling an
  `onStartStep(stepDescriptor)` prop supplied by the composition layer
  (`specification-detail-content.tsx`, `areas/execution-readiness-and-session-bootstrap.md`)
  — identical for both `executor` values, `TaskCard` never branches on it. For an active
  human interaction it renders a compact indicator only ("human action required") that opens
  `TaskDialog` — it does not render the human-interaction descriptor's own `actions`/result
  buttons inline, and does not import `HumanStepSurface`, `features/agent-sessions`, or any
  human-step transport/mutation module (D20 — that full surface is `TaskDialog`/chat's
  responsibility alone, `areas/human-step-surface.md`).

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

- A deterministic spec's board lanes reflect `TaskProjection.state`, not `task.status` —
  proven by a task whose `status` is still `approved` (compatibility value) but whose
  `workflow_progress` shows `state: 'active'` rendering in the active-state lane, not a
  `stageForStatus('approved')`-derived lane.
- Two deterministic tasks in the identical `TaskProjection.state` but with different step
  ids (at minimum one pair drawn from an arbitrary, non-`implementation`/`review` fixture —
  e.g. `discovery`/`hardening`, item 15) land in the same lane — proving lane derivation
  never special-cases a particular step id.
- A legacy spec's board lanes are unchanged (regression test against existing behavior).
- `TaskCard`'s legacy rendering path is unchanged in output for legacy specs.
- A deterministic `TaskCard` whose task's `status` is still `approved` (compatibility
  value) but whose `state` is `active` shows a status label/tone chosen from `state` — not
  "Approved," and not a label that differs depending on whether the step happens to be named
  `review` versus any other agent step.
- No component in this area's scope calls `stageForStatus()`, `isTaskReady()`,
  `formatTaskStatus()`, or `taskStatusTone()` with a deterministic task's `task.status` as
  input, and no component chooses a lane, status label, or tone by comparing `currentStep`/
  `nextStep` to a literal string.
- `TaskCard`'s generic "Start" control calls `onStartStep` for both `executor` values with
  no internal branching, and its active-human-interaction rendering is the compact indicator
  only — never the interaction's own result buttons rendered inline (D19/D20).
- No file in this area's scope imports `features/agent-sessions`, `HumanStepSurface`, or any
  human-step transport/mutation module.

## Dependencies

`areas/deterministic-projection-and-human-step.md`,
`areas/dashboard-server-actions-wiring.md` (the corrected action DTO this area reads),
`areas/execution-readiness-and-session-bootstrap.md` (supplies the `onStartStep` callback
this area's `TaskCard` calls but does not implement, D19).

## Out of scope

Board/lane configurability as project config (explicitly out of scope for this whole change
— D1). The `onStartStep` callback's own implementation/executor branching (owned by
`areas/execution-readiness-and-session-bootstrap.md`, D19). `TaskDialog`/chat and
`HumanStepSurface` itself (owned by `areas/human-step-surface.md`, D20).
