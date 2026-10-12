---
id: step-start-session-choice-ui
status: draft
change: session-continuity-choice
depends_on: [ actions-session-choice-projection ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
    - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
    - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
    - tools/dashboard/ui/features/specifications/types.ts
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/session-choice.tsx
  - tools/dashboard/tests/session-choice-ui.test.tsx
forbidden_paths:
  - src/**
  - tools/specs/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D1, D4]
  dependency_contracts: [actions-session-choice-projection]
---

# Task: Step-start session-choice UI

## Dependencies

`actions-session-choice-projection` (`sessionChoice`).

## Goal

When starting a step whose transition allows more than one session policy, ask the owner
whether to continue the existing session or start a new one.

## Requirements

- When `sessionChoice.allowed` has more than one entry, the start flow (the `Start` and
  `Uruchom z...` paths, and the request-changes follow-up start) shows a choice with the
  candidate described by its `label`, pre-selecting `sessionChoice.default`.
- Choosing continue sends `sessionPolicy: 'reuse'` (and the candidate's `sessionId` as
  confirmation) on `POST /api/agent-sessions/turns`; choosing new sends `sessionPolicy:
  'fresh'` with no `sessionId`.
- For a review step, choosing continue shows a visible warning that review independence
  is reduced. The warning does not block.
- When `sessionChoice.unavailableReason` is set, the continue option is disabled and the
  reason is shown.
- A single-policy transition shows no extra question and behaves as today.
- Errors from the start call are shown where the owner can see them; failures from
  `/turns` (including the new session errors) must not be swallowed. (The general
  blocked-action error-visibility work lives in `workspace-claim-self-recovery`; this task
  only guarantees its own new dialog displays the errors it can cause.)

## Acceptance criteria

- With `default: 'reuse'` the dialog opens with "continue" selected and shows the
  candidate label.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`
- Confirming "continue" posts `sessionPolicy: 'reuse'` with the candidate id;
  confirming "new" posts `sessionPolicy: 'fresh'` without `sessionId`.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`
- Choosing continue on a review step shows the independence warning.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`
- An unavailable reuse is disabled with its reason.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`
- A rejected start shows its error in the dialog.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`
- A single-policy transition renders no choice.
  `automated: node --test tools/dashboard/tests/session-choice-ui.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/session-choice-ui.test.tsx
node tools/specs.mjs validate
```

## Out of scope

Batch review (task 06) and server logic.
