---
id: batch-review-session-choice-ui
status: draft
change: session-continuity-choice
depends_on: [ step-start-session-choice-ui, batch-sequential-session-continuation ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
    - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
    - tools/dashboard/ui/features/specifications/tasks/session-choice.tsx
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/specifications/tasks/session-choice.tsx
  - tools/dashboard/tests/batch-review-session-choice-ui.test.tsx
forbidden_paths:
  - src/**
  - tools/specs/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D1, D3, D4]
  dependency_contracts: [step-start-session-choice-ui, batch-sequential-session-continuation]
---

# Task: Batch review session-choice UI

## Dependencies

`step-start-session-choice-ui`, `batch-sequential-session-continuation`.

## Goal

Make batch review discoverable and let the owner choose how it uses sessions.

## Requirements

- With two or more tasks selected, always show the batch-review control; when the existing
  eligibility check fails, show it disabled with the reason (which task is not at the
  review step or cannot start), instead of hiding it.
- On start, ask: "one new batch session" (existing `reviewTogether`) or "continue each
  task in its own session" (task 05). The second is disabled with a reason if any task has
  no candidate or a provider mismatch (from `sessionChoice`).
- The continue-each choice states that tasks run one after another, in selection order.
- Reuse the choice component from task 04, including the independence warning for review.
- Errors from the start call are displayed in the flow, not swallowed.

## Acceptance criteria

- Two selected tasks where one is not at review: the control is visible, disabled, and
  names the blocking task.
  `automated: node --test tools/dashboard/tests/batch-review-session-choice-ui.test.tsx`
- Three eligible tasks: the owner can choose new batch session or continue each; each
  choice posts the matching request.
  `automated: node --test tools/dashboard/tests/batch-review-session-choice-ui.test.tsx`
- Continue-each is disabled with a reason when a task has no candidate.
  `automated: node --test tools/dashboard/tests/batch-review-session-choice-ui.test.tsx`
- The sequential-execution note is shown for continue-each.
  `automated: node --test tools/dashboard/tests/batch-review-session-choice-ui.test.tsx`
- Existing overview behavior for non-review batches is unchanged.
  `automated: node --test tools/dashboard/tests/specification-overview-dependency-projection.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/batch-review-session-choice-ui.test.tsx
node --test tools/dashboard/tests/specification-overview-dependency-projection.test.tsx
node tools/specs.mjs validate
```

## Out of scope

Server behavior and the single-step dialog.
