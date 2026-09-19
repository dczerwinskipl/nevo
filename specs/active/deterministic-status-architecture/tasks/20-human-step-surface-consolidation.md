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
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-step-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ dashboard-deterministic-action-projection, dashboard-human-step-transport, task-card-lifecycle-split ]
semantic_references:
  decisions: [D7, D11]
---

# Task: Human step surface consolidation

## Goal

Build one reusable `HumanStepSurface` (D11 — generic naming, not `human-review-surface`),
driven by the corrected action DTO's tier-1/tier-2 descriptors, and render it directly from
both `TaskDialog` and the existing chat surface — replacing chat's current separate
Approve/Request-changes implementation, per D7 (shared component, not a chat→dialog
redirect) — calling the generic `workflow/human-step` transport (D14,
`dashboard-human-step-transport`'s client hook) for its two actions, never the legacy
`/workflow/human-decision` route.

## Dependencies

`dashboard-deterministic-action-projection` — this task's rendering reads the corrected
action DTO (tier-1/tier-2 descriptors, generic `availableActions`).
`dashboard-human-step-transport` — provides the client hook this surface calls to reach
`startHumanStep`/`submitHumanStepResult`; the UI cannot call those server-side functions
directly, only through that hook's HTTP requests. `task-card-lifecycle-split` — reuse its
deterministic action sub-component(s) where the action set genuinely overlaps.

## Implementation constraints

- Build `HumanStepSurface` as its own component (`human-step-surface.tsx`): for a step still
  `waiting-for-step-start`, renders the generic tier-1 descriptor (`purpose`/`expectedWork`)
  and a "Start human step" action calling the transport hook with `{action: 'start'}`; once
  active, renders one button/control per `actions` entry (`label`/`feedbackRequired`,
  `result` present only when the step's transitions are conditional — D16, item 7) and
  submits via the transport hook with `{action: 'submit', result?, feedback?, artifacts?}`
  — omitting `result` entirely for a single unconditional transition, never fabricating a
  placeholder value.
- Render this component **directly** from both `TaskDialog` and the chat surface
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) — do not navigate/redirect chat to
  open `TaskDialog` (D7). Remove chat's existing separate Approve/Request-changes
  implementation and replace its call site with this shared component.
- The surface's render condition in both call sites is the human-step projection's non-null
  result (either descriptor tier) — never `currentStep === 'human-verification'` or any
  other literal step-name/id check.
- Product-facing labels ("Review," "Approve," "Request changes") come entirely from the
  action DTO's `action.label` metadata — the component itself never hardcodes
  review-specific wording (D11); its own name and props stay generic (`HumanStepSurface`,
  a `start`/`submit` action shape, not `ReviewSurface`/`approve`/`requestChanges`).
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
  call sites importing the same module.
  `inspection: confirm task-dialog.tsx and the chat surface both import human-step-surface.tsx`
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  step (agent or human) not yet started shows "Ready for review"/"[Start review]" (or the
  agent-step equivalent), never a fabricated active-review state.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged (brief regression test #14's dialog half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting a result from either `TaskDialog` or chat POSTs the same
  `{action: 'submit', ...}` body through the same transport hook; activating from either
  entry point POSTs the same `{action: 'start'}` body identically — no divergent behavior
  between the two call sites, and neither ever calls `/workflow/human-decision`.
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
```

## Out of scope

Wiring `HumanStepSurface` from the task board or chat/timeline entry points beyond
`TaskDialog` and chat (future work). Full human-gate engine redesign. Any artifact/handover
attachment rendering.
