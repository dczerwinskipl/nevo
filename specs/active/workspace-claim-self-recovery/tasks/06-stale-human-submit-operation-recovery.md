---
id: stale-human-submit-operation-recovery
status: draft
change: workspace-claim-self-recovery
depends_on: [ acquire-self-heal-on-contention ]
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - tools/specs/workflow/human-step/operations.mjs
    - tools/specs/workflow/workspace-request.mjs
    - tools/specs/workflow/workspace-claim-reconciliation.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/dashboard/server/specs/human-step-transport.mjs
allowed_paths:
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/workspace-request.mjs
  - tools/dashboard/server/specs/human-step-transport.mjs
  - tools/tests/workflow-human-submit-stale-operation.test.mjs
  - tools/dashboard/tests/human-step-transport.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D4]
  dependency_contracts: [acquire-self-heal-on-contention]
---

# Task: Stale human-submit operation recovery

## Dependencies

`acquire-self-heal-on-contention` (both tasks edit `human-step/operations.mjs`; this one
builds on its error contents and avoids concurrent edits).

## Goal

A human decision whose submit failed (for example blocked by the workspace writer) must
not leave behind a `pending` operation that turns every retry into a silent no-op.

## Observed behavior (2026-10-10/11)

Three approves for `ai-spec-history` tasks collided with a `recovery-required` claim.
Each left a `human-submit-operations/.../attempt-1.json` with `status: 'pending'`, and its
paired `workspace-requests/<id>.json` ended `blocked-by-recovery`. Every later click
reached `evaluateExistingOp` (`operations.mjs`), which returns
`{ ok: true, status: 'pending', idempotent: true }` for an identical decision. Nothing
executed, the HTTP call succeeded, and no error was shown. Boot reconciliation does not
help: it only reconciles requests in `queued`, `waiting-for-workspace`, or `running`.

## Requirements

- When a human-submit operation for the same task/step/attempt exists as `pending` and
  its paired workspace request is no longer a live attempt (status `blocked-by-recovery`,
  or missing, or owned by a claim that no longer exists), a resubmission of the **same
  decision** resumes it: it re-runs workspace acquisition and execution against that
  operation and returns the real outcome. It must not create a second operation for the
  same durable key (D90, D94, D96 idempotency stays intact).
- A `pending` operation whose request is genuinely in progress (`queued`,
  `waiting-for-workspace`, `running`) keeps the current idempotent response, but the
  response must make the state explicit so callers can tell "in progress" from "done".
- A **different** decision against a stale `pending` operation (the owner changed their
  mind) supersedes the stale operation rather than returning
  `HUMAN_DECISION_CONFLICT`. The conflict error remains for operations whose request is
  live.
- When acquisition is blocked and the operation therefore did not run, the operation
  record is moved to a state that reflects that (for example `failed`/`blocked`, whichever
  existing status fits the model) instead of staying `pending`, so the stale state is not
  created in the first place. Choose the status already defined by the operation-record
  model; do not introduce a new one unless none fits.
- Boot reconciliation behavior for live requests is unchanged.

## Implementation constraints

- Resumption goes through the same code path as a fresh submit after the operation record
  is resolved; do not fork a second execution path.
- Never resume an operation whose request is live, and never resume one when its
  decision differs from the submitted one (that is the supersede case).

## Acceptance criteria

- Resubmitting an identical decision against a stale `pending` operation with a
  `blocked-by-recovery` request executes it and returns the real result, with no duplicate
  operation record. `automated: node --test tools/tests/workflow-human-submit-stale-operation.test.mjs`
- Resubmitting against a `pending` operation with a live request returns the idempotent
  response with an explicit in-progress state and executes nothing.
  `automated: node --test tools/tests/workflow-human-submit-stale-operation.test.mjs`
- A different decision against a stale operation supersedes it; against a live one it
  still returns `HUMAN_DECISION_CONFLICT`.
  `automated: node --test tools/tests/workflow-human-submit-stale-operation.test.mjs`
- A submit blocked by the workspace writer leaves no operation in `pending`.
  `automated: node --test tools/tests/workflow-human-submit-stale-operation.test.mjs`
- The HTTP transport response distinguishes completed, in-progress, and failed outcomes.
  `automated: node --test tools/dashboard/tests/human-step-transport.test.mjs`
- Existing human-step and human-submit tests pass.
  `automated: node --test tools/tests/workflow-human-verification.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-human-submit-stale-operation.test.mjs
node --test tools/dashboard/tests/human-step-transport.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs validate
```

## Out of scope

UI rendering of the in-progress and error states (task 04), the workspace-writer claim
logic (tasks 01–02), and a cleanup command for historical stale records.
