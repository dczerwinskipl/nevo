---
id: deterministic-status-architecture.human-step-surface-consolidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/human-step-surface.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/shared/workflow/human-step-surface.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-step-mutations.ts
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts
  - tools/dashboard/ui/features/agent-sessions/human-step-mutations.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - src/**
depends_on: [ dashboard-deterministic-action-projection, dashboard-human-step-transport, task-card-lifecycle-split ]
semantic_references:
  decisions: [D7, D11, D17]
---

# Task: Human step surface consolidation

## Goal

Build one reusable, **feature-neutral** `HumanStepSurface` (D11 — generic naming, not
`human-review-surface`; D17 — lives in `shared/workflow/`, prop-driven, not in either
consuming feature), and render it directly from both `TaskDialog`
(`features/specifications`) and the existing chat surface (`features/agent-sessions`) —
replacing chat's current separate Approve/Request-changes implementation, per D7 (shared
component, not a chat→dialog redirect) — with each feature owning its own thin adapter hook
that calls the shared transport function (D14/D17) for the surface's two actions, never the
legacy `/workflow/human-decision` route.

## Dependencies

`dashboard-deterministic-action-projection` — this task's rendering reads the corrected
action DTO (tier-1/tier-2 descriptors, generic `availableActions`).
`dashboard-human-step-transport` — provides the neutral `shared/lib/human-step-request.ts`
function each feature's own adapter hook (built by this task) calls to reach
`startHumanStep`/`submitHumanStepResult`; the UI cannot call those server-side functions
directly, only through that shared function's HTTP requests. `task-card-lifecycle-split` —
reuse its deterministic action sub-component(s) where the action set genuinely overlaps
(within `features/specifications` only — that sub-component is feature-local, not moved to
`shared/`).

## Implementation constraints

- Build `HumanStepSurface` at `tools/dashboard/ui/shared/workflow/human-step-surface.tsx` —
  **purely presentational, driven entirely by props**
  (`{ stepDescriptor, interaction, loading, error, onStart, onSubmit }`): for a step still
  `waiting-for-step-start` (`interaction` null), renders `stepDescriptor`'s `purpose`/
  `expectedWork` and a "Start human step" control calling `onStart()`; once `interaction` is
  non-null, renders one button/control per `interaction.actions` entry (`label`/
  `feedbackRequired`, `result` present only when conditional — D16, item 7) and calls
  `onSubmit(result?, feedback?, artifacts?)` for the chosen one — omitting `result` entirely
  for a single unconditional transition, never fabricating a placeholder value. It imports
  only from `shared/ui`/`shared/lib` — **never** `features/specifications`,
  `features/agent-sessions`, `screens/**`, or `routes/**`; it never fetches, never
  constructs a route URL, and never hardcodes `'approve'`/`'request-changes'` or a literal
  step id.
- Build two thin, feature-local adapter hooks — `features/specifications/tasks/human-step-mutations.ts`
  and `features/agent-sessions/human-step-mutations.ts` — each wrapping the shared
  `human-step-request.ts` function (`dashboard-human-step-transport`) in that feature's own
  `useMutation` (cache invalidation, loading/error state), each providing the `onStart`/
  `onSubmit` callbacks its own feature's `TaskDialog`/chat call site passes into the shared
  component. Neither hook file imports the other feature's hook or components.
- Render `HumanStepSurface` **directly** from both `TaskDialog` and the chat surface
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`), each via its own feature-local
  adapter hook — do not navigate/redirect chat to open `TaskDialog` (D7). Remove chat's
  existing separate Approve/Request-changes implementation and replace its call site with
  the shared component plus its feature-local adapter.
- The surface's render condition in both call sites (decided by each feature's own wrapper,
  not by the shared component itself) is the human-step projection's non-null result
  (either descriptor tier) — never `currentStep === 'human-verification'` or any other
  literal step-name/id check.
- Product-facing labels ("Review," "Approve," "Request changes") come entirely from the
  action DTO's `action.label` metadata, passed through as `label` on each `interaction.actions`
  entry — the component itself never hardcodes review-specific wording (D11); its own name,
  props, and file location stay generic (`HumanStepSurface`, `shared/workflow/`, a
  `start`/`submit` action shape, not `ReviewSurface`/`approve`/`requestChanges`).
- `TaskDialog` also gains general deterministic projection awareness (current step,
  executor, `waiting-for-step-start` shown honestly — e.g. "Ready for review"/"[Start
  review]," never a fabricated active state — blocking dependencies, available actions),
  with `HumanStepSurface` rendered prominently/as default content when a human decision is
  pending or awaiting activation.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly (brief regression test
  #19's UI half). `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Chat, for the same task/session, renders the identical shared component — proven by both
  call sites importing `shared/workflow/human-step-surface.tsx`.
  `inspection: confirm task-dialog.tsx and the chat surface both import shared/workflow/human-step-surface.tsx, never each other`
- `node --test tools/dashboard/tests/architecture-boundaries.test.mjs` passes — no file
  under `features/specifications` imports from `features/agent-sessions` (or vice versa),
  and `shared/workflow/human-step-surface.tsx` imports nothing from either feature, any
  screen, or any route. `automated: node --test tools/dashboard/tests/architecture-boundaries.test.mjs`
- `HumanStepSurface`'s own source contains no `fetch(`, no route-URL string literal, and no
  `'approve'`/`'request-changes'` literal — every one of those lives in the feature-local
  adapter hooks or the shared transport function, not the component.
  `inspection: confirm shared/workflow/human-step-surface.tsx contains none of these`
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  step (agent or human) not yet started shows "Ready for review"/"[Start review]" (or the
  agent-step equivalent), never a fabricated active-review state.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged (brief regression test #14's dialog half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting a result from either `TaskDialog` or chat POSTs the same
  `{action: 'submit', ...}` body through their own feature-local adapter hook, both
  ultimately calling the same shared `human-step-request.ts` function; activating from
  either entry point POSTs the same `{action: 'start'}` body identically — no divergent
  behavior between the two call sites, and neither ever calls `/workflow/human-decision`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting from a human step with a single unconditional transition omits `result`
  entirely from the request body.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Exactly one `HumanStepSurface` component exists after this task — chat's prior separate
  implementation is removed, not left as a second one.
  `inspection: confirm chat's prior standalone Approve/Request-changes markup is gone`
- No component/operation name in this task's scope hardcodes "review"/"approve" as its own
  identifier (props/exports use `result`/`label` generically, per D11).
  `inspection: confirm HumanStepSurface's own props/exports are generic, not review-specific`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
node --test tools/dashboard/tests/architecture-boundaries.test.mjs
```

## Out of scope

Wiring `HumanStepSurface` from the task board or chat/timeline entry points beyond
`TaskDialog` and chat (future work). Full human-gate engine redesign. Any artifact/handover
attachment rendering.
