---
id: deterministic-status-architecture.human-review-surface-consolidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/human-review-surface.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-review-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ deterministic-task-projection, human-step-projection, task-card-lifecycle-split ]
semantic_references:
  decisions: [D7]
---

# Task: Human review surface consolidation

## Goal

Build one reusable human-step interaction surface, driven by the human-step projection, and
render it directly from both `TaskDialog` and the existing chat surface — replacing chat's
current separate Approve/Request-changes implementation, per D7 (shared component, not a
chat→dialog redirect).

## Dependencies

`deterministic-task-projection`, `human-step-projection` — this task's rendering reads both,
surfaced through the server's corrected action DTO. `task-card-lifecycle-split` — reuse its
deterministic action sub-component(s) where the action set genuinely overlaps.

## Implementation constraints

- Build the surface as its own component (e.g. `human-review-surface.tsx`): renders
  `purpose`/`expectedWork` from the human-step projection, renders one button/control per
  `actions` entry (`result`/`label`/`feedbackRequired`), and submits the chosen result
  through the executor-guarded human-decision operation.
- Render this component **directly** from both `TaskDialog` and the chat surface
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) — do not navigate/redirect chat to
  open `TaskDialog` (D7). Remove chat's existing separate Approve/Request-changes
  implementation and replace its call site with this shared component.
- The surface's render condition in both call sites is the human-step projection's non-null
  result — never `currentStep === 'human-verification'` or any other literal step-name/id
  check.
- `TaskDialog` also gains general deterministic projection awareness (current step,
  executor, `waiting-for-step-start` shown honestly — e.g. "Ready for review"/"[Start
  review]," never a fabricated active state — blocking dependencies, available actions),
  with this surface rendered prominently/as default content when a human decision is
  pending.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly (brief regression test
  #19's UI half). `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Chat, for the same task/session, renders the identical shared component — proven by both
  call sites importing the same module, not two independently-behaving implementations.
  `inspection: confirm task-dialog.tsx and the chat surface both import human-review-surface.tsx`
- `TaskDialog` opened on a deterministic task with implementation finished and the next
  step (agent or human) not yet started shows "Ready for review"/"[Start review]" (or the
  agent-step equivalent), never a fabricated active-review state.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged (brief regression test #14's dialog half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting a result from either `TaskDialog` or chat calls the same executor-guarded
  human-decision operation with the same request shape — no divergent behavior between the
  two call sites. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Exactly one human-review surface component exists after this task — chat's prior separate
  implementation is removed, not left as a second one.
  `inspection: confirm chat's prior standalone Approve/Request-changes markup is gone`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

Wiring the human-review surface from the task board or chat/timeline entry points beyond
`TaskDialog` and chat (future work). Full human-gate engine redesign. Any artifact/handover
attachment rendering.
