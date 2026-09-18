---
id: deterministic-status-architecture.task-dialog-deterministic-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ui-task-details-human-review.md
allowed_paths:
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-review-surface.tsx
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ deterministic-task-projection, human-interaction-projection ]
---

# Task: `TaskDialog` deterministic projection and human review

## Goal

Give `TaskDialog` deterministic projection awareness (currently absent) and a reusable
human-review surface, rendered from the human-interaction projection rather than any
literal step-name check.

## Dependencies

`deterministic-task-projection`, `human-interaction-projection` — this task's rendering
reads both, surfaced through the server's existing task-action projection response.

## Implementation constraints

- Add an `isDeterministic` prop to `TaskDialog`, mirroring the pattern already established
  in `TaskCard`/`AgentSessionWorkflowBar` — when true, render current step,
  `waiting-for-step-start` honestly (e.g. "Ready for review" / "[Start review]", never a
  fabricated active state), blocking dependencies, and available actions from the
  projection; when false, the existing legacy `TaskActionFooter` path is unchanged.
- Build the human-review surface as its own component (e.g.
  `human-review-surface.tsx`) rendered from `TaskDialog` — reuse `TaskCard`'s existing
  deterministic action sub-component(s) (from `task-card-lifecycle-split`) where the action
  set genuinely overlaps (e.g. `approve`/`request-changes` buttons), rather than
  reimplementing them.
- The human-review surface's render condition is the human-interaction projection's
  non-null result — never `currentStep === 'human-verification'` or any other literal
  step-name string.
- When a human decision is pending, the review section becomes the dialog's prominent/
  default content.

## Acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the review surface correctly (brief
  regression test #19's UI half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog` opened on a deterministic task with implementation finished and review not
  started shows "Ready for review"/"[Start review]," never a fabricated active-review state.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged (brief regression test #14's dialog half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Exactly one human-review surface component exists and is reused, not duplicated.
  `inspection: confirm no second approve/request-changes UI is introduced elsewhere in this task's scope`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

Wiring the human-review surface from the task board or chat/timeline entry points (future
work — the surface only needs to be reusable, not wired everywhere yet). Full human-gate
engine redesign.
