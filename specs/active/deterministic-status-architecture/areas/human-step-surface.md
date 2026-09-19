# Area: Human step surface

## Responsibility

Build one reusable, **feature-neutral** `HumanStepSurface` (D11 — generic naming, not
"review"-specific; D17 — lives in `shared/`, not in either consuming feature), driven by
the human-step projection's tier-1/tier-2 descriptors via props, rendered directly by both
`TaskDialog` (`features/specifications/`) and the existing chat surface
(`features/agent-sessions/`) — replacing chat's current separate Approve/Request-changes
implementation rather than leaving a second, divergent one — and wired, through one neutral
shared transport function plus a thin per-feature adapter each, to call
`startHumanStep`/`submitHumanStepResult` through the generic transport route
(`POST .../workflow/human-step`, D14, `areas/dashboard-server-actions-wiring.md`) — never
through the legacy `/workflow/human-decision` route, which stays only for its existing
CLI-compatibility caller.

## Current state

`TaskDialog` (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`) has no
`isDeterministic` prop and always renders the legacy-only `TaskActionFooter`. Chat
(`AgentSessionChatSurface`/`AgentSessionWorkflowBar`, `features/agent-sessions/`) already
renders its own, separate Approve/Request-changes UI for deterministic sessions,
independent of whatever `TaskDialog` would build — a confirmed, live divergence, not a
hypothetical one. **Grounded fact (D17, 2026-09-19):** the repository enforces
`tools/dashboard/tests/architecture-boundaries.test.mjs`, whose test 1 asserts zero
sibling-feature imports (`features/A` must never import `features/B`) and whose test 2
asserts `shared/**` never imports `features/**`/`screens/**`/`routes/**`/`app/**` in
return — a shared component both `features/specifications/` and `features/agent-sessions/`
must render **has** to live under `shared/`, and its transport cannot be a single hook
owned by one feature that the other imports directly. `shared/ui/` (presentational
primitives) and `shared/lib/` (pure utilities) already exist and are already imported by
both features today — this area's component fits the same existing pattern, not a new one.

## Requirements

- One reusable, presentational `HumanStepSurface` component at
  `tools/dashboard/ui/shared/workflow/human-step-surface.tsx` — driven **entirely by
  props** (conceptually `{ stepDescriptor, interaction, loading, error, onStart, onSubmit
  }`), sourced by each caller from the corrected action DTO
  (`DashboardActionProjection`, `areas/dashboard-server-actions-wiring.md`): shows
  `purpose`/`expectedWork` from `stepDescriptor` (tier-1, always available once waiting)
  and, once `interaction` is non-null, renders its `actions` (`label`/`feedbackRequired`,
  `result` present only for a conditional step's actions — D16, item 7) as the available
  outcomes, calling `onSubmit(result?, feedback?, artifacts?)` for the chosen one — omitting
  `result` entirely for a single unconditional transition, never fabricating a placeholder
  value. For a step still `waiting-for-step-start` (`interaction` null, `stepDescriptor`
  present), it shows the generic descriptor and a "Start human step" control calling
  `onStart()`. It must **not**: import from `features/specifications` or
  `features/agent-sessions`; fetch directly; know the route URL; know `'approve'`/
  `'request-changes'`; or know a literal workflow step id — every one of these stays the
  caller's responsibility, passed in as props/callbacks.
- One neutral, feature-agnostic transport function,
  `tools/dashboard/ui/shared/lib/human-step-request.ts` (owned by
  `dashboard-human-step-transport`, D14's task, alongside the server route it calls) —
  the one place that actually knows the `POST .../workflow/human-step` URL and request
  shape, exposing a plain async function with no React/query-cache concerns of its own.
- Two thin, independently owned per-feature adapter hooks — one in
  `features/specifications/tasks/human-step-mutations.ts`, one in
  `features/agent-sessions/human-step-mutations.ts` (owned by
  `human-step-surface-consolidation`) — each wrapping the same shared transport function in
  that feature's own `useMutation`/cache-invalidation concerns, and each passing
  `onStart`/`onSubmit` into the shared component from its own feature's `TaskDialog`/chat
  call site. Neither feature imports the other's hook file.
- Per D7: `HumanStepSurface` is rendered **directly** by both `TaskDialog` and the chat
  surface — chat is not redirected/navigated to `TaskDialog` to show it. Chat's existing
  separate Approve/Request-changes implementation is replaced by this shared component, not
  kept as a second implementation alongside it.
- The surface's render condition (in each feature's own wrapper) is the human-step
  projection's non-null result (either tier) — never `currentStep === 'human-verification'`
  or any other literal step-name/id check.
- `TaskDialog` also gains general deterministic projection awareness (current step,
  executor, `waiting-for-step-start` shown honestly — e.g. "Ready for review"/"[Start
  review]," never a fabricated active state — blocking dependencies, available actions from
  `DashboardActionProjection`), with `HumanStepSurface` rendered prominently/as default
  content when a human decision is pending or awaiting activation.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Constraints

- Exactly one implementation of `HumanStepSurface` exists after this area — no second,
  independent approve/request-changes UI remains anywhere in scope.
- `HumanStepSurface` itself never imports `features/**`, never fetches, never knows a route
  URL — verified by `tools/dashboard/tests/architecture-boundaries.test.mjs` (test 1 and
  test 2) passing, in addition to any area-specific test.
- Reuse `TaskCard`'s existing deterministic action sub-component(s)
  (`areas/ui-dashboard-board-split.md`) where the action set genuinely overlaps, rather than
  a third implementation of the same buttons — those stay feature-local (`TaskCard` is
  itself feature-local to `features/specifications`), reused only within that feature, not
  imported into `shared/`.
- Product-facing labels ("Review," "Approve," "Request changes") come entirely from
  workflow-definition `action.label` metadata (D6) — the component itself never hardcodes
  review-specific wording (D11).
- Desktop/mobile layout differences (if any) must not change human-step semantics — the
  same surface renders regardless of layout container.

## Interfaces and boundaries

Exposes: `HumanStepSurface` (props-driven, `shared/workflow/`), documented as reusable for
future entry points (task board, timeline/notifications) beyond this change's two wired
call sites; the neutral `human-step-request.ts` transport function (`shared/lib/`).

Consumed by: `TaskDialog`/`features/specifications/tasks/human-step-mutations.ts` and the
chat surface/`features/agent-sessions/human-step-mutations.ts` — each feature owns its own
adapter, neither imports the other.

## Area-specific acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly.
- Chat, for the same task/session, renders the identical shared component — proven by both
  call sites importing `shared/workflow/human-step-surface.tsx`, never each other.
- `node --test tools/dashboard/tests/architecture-boundaries.test.mjs` passes — in
  particular, no `features/specifications` file imports anything from
  `features/agent-sessions` (or vice versa), and no `shared/**` file imports from any
  feature/screen/route/app.
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  (human or agent) step not yet started shows "Ready for review"/"[Start review]" (or the
  equivalent for an agent next step), never a fabricated active state.
- `TaskDialog`'s legacy rendering path is byte-for-byte unchanged.
- Submitting a result through the surface from either entry point calls the generic
  `workflow/human-step` transport (via that feature's own adapter hook, both ultimately
  calling the same shared `human-step-request.ts` function) with the same request shape —
  no divergent behavior between the two call sites, and never a call to the legacy
  `/workflow/human-decision` route. Activating a waiting human step from either entry point
  posts `{ action: 'start' }` to the same route identically.
- Submitting from a human step with a single unconditional transition omits `result`
  entirely — the surface never fabricates a placeholder value.
- Exactly one `HumanStepSurface` implementation exists after this task — chat's prior
  separate implementation is removed, not left as a second one.

## Dependencies

`areas/deterministic-projection-and-human-step.md`, `areas/dashboard-server-actions-wiring.md`
(the DTO's tier-1/tier-2 descriptors and the generic transport route, D14),
`areas/ui-dashboard-board-split.md` (for action sub-component reuse where it overlaps,
within `features/specifications` only).

## Out of scope

Wiring `HumanStepSurface` into the task board or timeline/notification entry points (future
work). Full human-gate engine redesign. Any artifact/handover attachment rendering. A
general-purpose shared API client covering routes beyond this one (the neutral transport
function is scoped to the human-step endpoint only, not a project-wide fetch abstraction).
