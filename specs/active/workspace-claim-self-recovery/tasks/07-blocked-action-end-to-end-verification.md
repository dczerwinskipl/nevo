---
id: blocked-action-end-to-end-verification
status: draft
change: workspace-claim-self-recovery
depends_on: [ acquire-self-heal-on-contention, human-step-error-visibility, stale-human-submit-operation-recovery ]
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
    - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/specs/human-step-transport.mjs
allowed_paths:
  - tools/dashboard/tests/blocked-action-end-to-end.test.mjs
  - tools/dashboard/tests/blocked-action-end-to-end.test.tsx
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
forbidden_paths:
  - src/**
  - tools/specs/**
semantic_references:
  decisions: [D5]
  dependency_contracts: [acquire-self-heal-on-contention, human-step-error-visibility, stale-human-submit-operation-recovery]
---

# Task: Blocked-action end-to-end verification

## Dependencies

Tasks 02, 04, and 06: this task verifies their combined behavior and fixes only the
agent-start error path that none of them covers.

## Goal

Prove, as a standing regression suite, that a dashboard action blocked by the workspace
writer is **visible, leaves no stuck pending state, and works when retried** — for both
human decisions (approve / request changes) and agent step starts (implementation /
review, single and batch). Observed 2026-10-11: starting a review gave no feedback at all.

## Observed behavior

- For agent step starts, `startStep` in `specification-detail-content.tsx` catches
  failures and stores them in page-level `workflowError`, rendered at the top of the
  detail page. When the start is triggered from the task dialog (`task-dialog.tsx`,
  `Start` / `Uruchom z...`), the modal stays open on top and has no error element for
  this path, so the error is likely hidden behind it. **Unconfirmed**; step 1 below
  reproduces it before any fix.
- A blocked start may leave durable pending state (a pending handover group or
  workspace request) that keeps blocking later attempts. Which records are left behind,
  if any, is confirmed by the test, not assumed.

## Requirements

1. Reproduce first: add the failing cases below before changing anything, and record the
   confirmed cause (hidden error, missing error, or leftover pending state) in the task
   notes.
2. Fix the agent-start error visibility if confirmed: a failed start initiated from the
   task dialog shows its error inside the dialog (or closes the dialog so the page-level
   error is visible), never silently.
3. If a blocked agent start leaves durable pending state that blocks retries, it is
   resolved by the same principle as task 06 (resume or supersede on identical retry,
   nothing left `pending` after a blocked attempt). If that requires changes outside this
   task's allowed paths, stop and report instead of widening scope.

## Verification cases (each is an automated test)

- **VC1 — blocked human approve:** a `recovery-required` agent claim that cannot be
  recovered; click Approve. The error naming the holder is visible, no operation is left
  `pending`, the dialog stays open. After the claim is cleared, the same click executes
  and the task advances.
- **VC2 — blocked review start (single):** same blocked claim; start the review step from
  the task dialog. The error is visible, nothing is left pending, and after clearing the
  claim the same click starts the review.
- **VC3 — blocked review start (batch):** same, for `Review together` with several
  tasks selected.
- **VC4 — settled stale claim:** a `recovery-required` claim whose task is settled does
  not block any of VC1–VC3 (self-healed, task 02).
- **VC5 — in-progress operation:** a genuinely running human submit returns an in-progress
  state, not success, and a second click does not start a second execution.

## Acceptance criteria

- VC1–VC5 pass. `automated: node --test tools/dashboard/tests/blocked-action-end-to-end.test.mjs`
- UI-visible assertions for VC1–VC3 pass.
  `automated: node --test tools/dashboard/tests/blocked-action-end-to-end.test.tsx`
- Each case fails on the pre-fix code for its identified cause.
  `inspection: confirm each case was red before the corresponding fix and note it in the review`

## Verification

```bash
node --test tools/dashboard/tests/blocked-action-end-to-end.test.mjs
node --test tools/dashboard/tests/blocked-action-end-to-end.test.tsx
node tools/specs.mjs validate
```

## Out of scope

Server-side recovery logic (tasks 01, 02, 06), the error rendering for human decisions
(task 04), and session reuse or batch-review session choice (separate change,
`session-continuity-choice`).
