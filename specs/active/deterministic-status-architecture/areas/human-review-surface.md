# Area: Human review surface

## Responsibility

Build one reusable human-step interaction surface, driven by the human-step projection
(D5), rendered directly by both `TaskDialog` and the existing chat surface (D7) — replacing
chat's current separate Approve/Request-changes implementation rather than leaving a second,
divergent one.

## Current state

`TaskDialog` (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`) has no
`isDeterministic` prop and always renders the legacy-only `TaskActionFooter`. Chat
(`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) already renders its own, separate
Approve/Request-changes UI for deterministic sessions, independent of whatever `TaskDialog`
would build — a confirmed, live divergence, not a hypothetical one.

## Requirements

- One reusable human-step interaction surface component, rendered from the human-step
  projection (`areas/deterministic-projection-and-human-step.md`, via the corrected action
  DTO from `areas/dashboard-server-actions-wiring.md`): shows `purpose`/`expectedWork`,
  renders the projection's `actions` (result/label/feedback-required) as the available
  outcomes, and submits the chosen result through the executor-guarded human-decision
  operation.
- Per D7: this component is rendered **directly** by both `TaskDialog` and the chat surface
  — chat is not redirected/navigated to `TaskDialog` to show it. Chat's existing separate
  Approve/Request-changes implementation is replaced by this shared component, not kept as
  a second implementation alongside it.
- The surface's render condition is the human-step projection's non-null result — never
  `currentStep === 'human-verification'` or any other literal step-name/id check.
- `TaskDialog` gains deterministic projection awareness generally (current step, executor,
  `waiting-for-step-start` shown honestly — e.g. "Ready for review"/"[Start review]," never
  a fabricated active state — blocking dependencies, available actions), with this area's
  surface rendered prominently/as default content when a human decision is pending.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Constraints

- Exactly one implementation of the human-review surface exists after this area — no second,
  independent approve/request-changes UI remains anywhere in scope.
- Reuse `TaskCard`'s existing deterministic action sub-component(s)
  (`areas/ui-dashboard-board-split.md`) where the action set genuinely overlaps, rather than
  a third implementation of the same buttons.
- Desktop/mobile layout differences (if any) must not change human-review semantics — the
  same surface renders regardless of layout container.

## Interfaces and boundaries

Exposes: the human-review surface component, documented as reusable for future entry points
(task board, timeline/notifications) beyond this change's two wired call sites.

Consumed by: `TaskDialog` and the chat surface (`AgentSessionChatSurface`/
`AgentSessionWorkflowBar`) in this change.

## Area-specific acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly.
- Chat, for the same task/session, renders the identical shared component (not a
  second, differently-behaving implementation) — proven by both call sites importing the
  same component/module.
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  (human or agent) step not yet started shows "Ready for review"/"[Start review]" (or the
  equivalent for an agent next step), never a fabricated active state.
- `TaskDialog`'s legacy rendering path is byte-for-byte unchanged.
- Submitting a result through the surface from either entry point calls the same
  executor-guarded human-decision operation — no divergent request shape between the two
  call sites.

## Dependencies

`areas/deterministic-projection-and-human-step.md`, `areas/dashboard-server-actions-wiring.md`,
`areas/ui-dashboard-board-split.md` (for action sub-component reuse where it overlaps).

## Out of scope

Wiring this surface into the task board or timeline/notification entry points (future
work). Full human-gate engine redesign. Any artifact/handover attachment rendering (the
projection's `artifacts?` field stays unpopulated in this change).
