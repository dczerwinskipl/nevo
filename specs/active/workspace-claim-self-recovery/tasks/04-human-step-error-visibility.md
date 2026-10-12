---
id: human-step-error-visibility
status: draft
change: workspace-claim-self-recovery
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - tools/dashboard/ui/shared/lib/human-step-request.ts
    - tools/dashboard/ui/shared/workflow/human-step-surface.tsx
    - tools/dashboard/ui/features/specifications/tasks/human-step-mutations.ts
    - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
    - tools/dashboard/server/specs/human-step-transport.mjs
allowed_paths:
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - tools/dashboard/ui/shared/workflow/human-step-surface.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-step-mutations.ts
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/human-step-mutations.ts
  - tools/dashboard/tests/human-step-error-visibility.test.tsx
forbidden_paths:
  - src/**
  - tools/specs/**
---

# Task: Human-step error visibility

## Goal

Make a failed human-step submit (for example approve blocked by the workspace writer)
visibly report its error in the dashboard. On 2026-10-11 the owner saw no message at all.

## Requirements

- First, reproduce: write a failing test that mounts the task dialog with a
  human-step submit that the server rejects (HTTP 400 with `{ error, code }`), and assert
  what the user can see. The cause is not established from reading the code — the mutation
  hook sets `error` state and `HumanStepSurface` renders it, but the hook rethrows and the
  surface calls `onSubmit` with `void`, so an unhandled rejection is a candidate. Record the
  actual cause in the task's commit/review notes.
- Fix the actual cause. The error text from the server (`error`, plus the `code` when
  useful) must be visible in the dialog until the next attempt or dismissal, and a failed
  submit must not close the dialog or refresh as if it had succeeded.
- Handle the same path in `agent-sessions/human-step-mutations.ts` if it shares the defect.
- A second silent-failure path (observed 2026-10-11): the server can answer HTTP 200 with
  `{ ok: true, status: 'pending', idempotent: true }` for a human decision that was
  recorded but not executed (see task 06). The UI currently treats any 200 as success,
  refreshes, and closes the dialog. After task 06 the response states completed,
  in-progress, or failed explicitly; the UI must show an in-progress message and keep the
  dialog open for in-progress, show the error for failed, and close only on completed.
  Until task 06 lands, treat `status: 'pending'` as not-completed.

## Acceptance criteria

- A rejected submit renders the server error text in an element with `role="alert"` and
  leaves the dialog open. `automated: node --test tools/dashboard/tests/human-step-error-visibility.test.tsx`
- A rejected submit produces no unhandled promise rejection.
  `automated: node --test tools/dashboard/tests/human-step-error-visibility.test.tsx`
- A 200 response with `status: 'pending'` shows an in-progress message, keeps the dialog
  open, and does not refresh as if completed.
  `automated: node --test tools/dashboard/tests/human-step-error-visibility.test.tsx`
- A successful submit behaves as before (refresh, close).
  `automated: node --test tools/dashboard/tests/human-step-error-visibility.test.tsx`
- The test failed before the fix for the identified cause.
  `inspection: confirm the test was red on the pre-fix code and note the cause in the review`

## Verification

```bash
node --test tools/dashboard/tests/human-step-error-visibility.test.tsx
node tools/specs.mjs validate
```

## Out of scope

Server-side error content (task 02), the server-side operation recovery and explicit
response states (task 06), and redesigning the human-step surface.
