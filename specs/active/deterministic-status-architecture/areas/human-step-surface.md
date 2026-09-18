# Area: Human step surface

## Responsibility

Build one reusable `HumanStepSurface` (D11 — generic naming, not "review"-specific), driven
by the human-step projection's tier-2 actions descriptor, rendered directly by both
`TaskDialog` and the existing chat surface (D7) — replacing chat's current separate
Approve/Request-changes implementation rather than leaving a second, divergent one — and
wired to call `startHumanStep`/`submitHumanStepResult` (`areas/step-executor-model.md`).

## Current state

`TaskDialog` (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`) has no
`isDeterministic` prop and always renders the legacy-only `TaskActionFooter`. Chat
(`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) already renders its own, separate
Approve/Request-changes UI for deterministic sessions, independent of whatever `TaskDialog`
would build — a confirmed, live divergence, not a hypothetical one.

## Requirements

- One reusable `HumanStepSurface` component, rendered from the human-step projection's
  tier-2 descriptor (via `DashboardActionProjection`, `areas/dashboard-server-actions-wiring.md`):
  shows `purpose`/`expectedWork` (tier-1, always available once waiting) and, once active,
  renders the projection's `actions` (result/label/feedback-required) as the available
  outcomes, submitting the chosen result via `submitHumanStepResult`.
  For a step still `waiting-for-step-start`, the surface (or its container) shows the
  generic tier-1 descriptor and a "Start human step" action calling `startHumanStep` —
  never auto-activating.
- Per D7: this component is rendered **directly** by both `TaskDialog` and the chat surface
  — chat is not redirected/navigated to `TaskDialog` to show it. Chat's existing separate
  Approve/Request-changes implementation is replaced by this shared component, not kept as
  a second implementation alongside it.
- The surface's render condition is the human-step projection's non-null result (either
  tier) — never `currentStep === 'human-verification'` or any other literal step-name/id
  check.
- `TaskDialog` also gains general deterministic projection awareness (current step,
  executor, `waiting-for-step-start` shown honestly — e.g. "Ready for review"/"[Start
  review]," never a fabricated active state — blocking dependencies, available actions from
  `DashboardActionProjection`), with `HumanStepSurface` rendered prominently/as default
  content when a human decision is pending or awaiting activation.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Constraints

- Exactly one implementation of `HumanStepSurface` exists after this area — no second,
  independent approve/request-changes UI remains anywhere in scope.
- Reuse `TaskCard`'s existing deterministic action sub-component(s)
  (`areas/ui-dashboard-board-split.md`) where the action set genuinely overlaps, rather than
  a third implementation of the same buttons.
- Product-facing labels ("Review," "Approve," "Request changes") come entirely from
  workflow-definition `action.label` metadata (D6) — the component itself never hardcodes
  review-specific wording (D11).
- Desktop/mobile layout differences (if any) must not change human-step semantics — the
  same surface renders regardless of layout container.

## Interfaces and boundaries

Exposes: `HumanStepSurface`, documented as reusable for future entry points (task board,
timeline/notifications) beyond this change's two wired call sites.

Consumed by: `TaskDialog` and the chat surface (`AgentSessionChatSurface`/
`AgentSessionWorkflowBar`) in this change.

## Area-specific acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly.
- Chat, for the same task/session, renders the identical shared component — proven by both
  call sites importing the same component/module.
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  (human or agent) step not yet started shows "Ready for review"/"[Start review]" (or the
  equivalent for an agent next step), never a fabricated active state.
- `TaskDialog`'s legacy rendering path is byte-for-byte unchanged.
- Submitting a result through the surface from either entry point calls
  `submitHumanStepResult` with the same request shape — no divergent behavior between the
  two call sites. Activating a waiting human step from either entry point calls
  `startHumanStep` identically.
- Exactly one `HumanStepSurface` implementation exists after this task — chat's prior
  separate implementation is removed, not left as a second one.

## Dependencies

`areas/deterministic-projection-and-human-step.md`, `areas/dashboard-server-actions-wiring.md`,
`areas/step-executor-model.md` (`startHumanStep`/`submitHumanStepResult`),
`areas/ui-dashboard-board-split.md` (for action sub-component reuse where it overlaps).

## Out of scope

Wiring `HumanStepSurface` into the task board or timeline/notification entry points (future
work). Full human-gate engine redesign. Any artifact/handover attachment rendering.
