---
id: nevo-ai-process-continuity-and-hardening.conversational-approval-ergonomics
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/conversational-continuity.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/commands/nevo-ai/spec-review.md
    - .claude/commands/nevo-ai/spec-approve.md
    - .claude/commands/nevo-ai/task-review.md
  optional:
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/decision-policy.md
allowed_paths:
  - .claude/commands/nevo-ai/spec-review.md
  - .claude/commands/nevo-ai/spec-approve.md
  - .claude/commands/nevo-ai/task-review.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/decision-policy.md
  - .claude/skills/nevo-ai-spec-workflow/SKILL.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
---

# Task: Conversational approval ergonomics

> Refined 2026-08-04 — the `start` guard re-check now uses task 02's `start-task`
> postcondition contract instead of a bare boolean; a `partially_completed` `start`
> failure records an `execution.suspension` (D8) so a later retry only performs the
> missing effects, rather than only reporting the failure with nothing persisted.
>
> Refined again 2026-08-04 (second pass, see D17) — a `confirm-required` `start` failure
> inside the combined "approve and start" flow no longer just gets reported and stopped:
> it resumes the same authorized flow in place after one owner confirmation, via task
> 03's resume-in-place mechanism and task 02's resumable recovery handle. The owner is
> never asked to separately re-invoke `/nevo-ai:task-start` for a repair they already
> confirmed inside the combined flow.

## Goal

Implement the D3 combined approve+start confirmation and the inline next-transition
offers for `spec-review` and `task-review`, exactly as specified in
`areas/conversational-continuity.md` — without weakening any existing gate.

## Dependencies

`resume-and-continue-controller` — needs the shared `deriveStage`-based entry point and
the recovery classification before offering transitions inline responsibly.

## Implementation constraints

- `spec-approve.md`'s fourth outcome ("approve and start") is its own explicit menu item,
  never a default and never inferred. Selecting it: run `approve`, re-check `start`'s
  preconditions (task 02's `start-task` postcondition contract) against *current* state,
  run `start` only if they still hold, and on a `start` failure classify it per the
  five-value result vocabulary (D17) and branch:
  - **`partially_completed`** — records an `execution.suspension`
    (`previous_action: start`), reports it, and stops; `approved` status untouched.
  - **`confirm-required` (D17, second refinement pass)** — presents the recovery action
    for confirmation in the same turn; on confirmation, invokes task 03's resume-in-place
    mechanism (which calls task 02's resumable recovery handle), executes only the
    still-missing postconditions, and completes the combined flow — never a second,
    separate `/nevo-ai:task-start` invocation. A confirmation is asked at most once per
    repair; if postconditions still don't hold afterward, that's a fresh
    `not_retryable`/`unsafe_manual` result on the next branch, not a repeated prompt.
  - **`not_retryable`/`unsafe_manual`** — reports it and stops; `approved` status
    untouched; a fresh suspension is recorded if applicable.

  In every branch: no rollback of `approve`, no silent re-approval — per D3 exactly.
- The re-guard-check must call the same postcondition-inspection logic `handleStart`
  uses standalone (task 02) — no parallel guard implementation.
- `spec-review.md`'s `ready-for-approval` path offers approval inline as a closed-choice
  menu item in the same turn, but still requires an explicit owner answer — this is an
  additional entry point into the unchanged `spec-approve` gate, not a bypass.
- `task-review.md`'s existing terminal-change archive offer is preserved unchanged; a
  "continue to next batch task" inline offer is added but must only appear when an active
  batch (task 08) exists — do not add it unconditionally in this task, since batch
  execution does not exist yet at this point in the rollout. Implement the offer behind a
  check for an active-batch record that task 08 will populate; until task 08 lands, this
  check is always false and the offer never appears — implement the check first as
  forward-compatible, not the offer's visible behavior.

## Acceptance criteria

1. `spec-approve` offers exactly four outcomes total (the original three, unchanged,
   plus "approve and start"); none is pre-selected (inspection + manual trace).
2. A `start` failure after a successful `approve` in the combined path leaves the task's
   status at `approved` and, if `partially_completed`, records an `execution.suspension`
   with `previous_action: start` (automated, extends task 02/03's test coverage).
3. `spec-review` reaching `ready-for-approval` offers inline approval without skipping
   `spec-approve`'s own CLI-enforced gate (manual trace: review exists, verdict ready,
   fingerprint current, still checked by the CLI, not assumed by the command file).
4. `task-review`'s batch-continuation offer never appears when no active batch record
   exists (inspection, until task 08 lands; re-verified as part of task 08's own
   acceptance criteria once the record is real).
5. A `confirm-required` `start` failure inside the combined flow, once confirmed, resumes
   and completes `start` without a second `/nevo-ai:task-start` invocation, and `approve`
   is called exactly once (automated, extends task 02/03's coverage) (D17).
6. An `unsafe_manual` `start` failure inside the combined flow stops and reports without
   ever presenting a confirmation prompt for it (automated, same suite) (D17).
7. Approval remains persisted (`status: approved`) when a `start` failure inside the
   combined flow is `not_retryable` — the workflow stops and reports why, without
   rolling back or repeating `approve` (automated, same suite) (D17).

## Verification

```
node --test tools/tests/
node tools/specs.mjs validate
```

## Documentation impact

`.claude/skills/nevo-ai-spec-workflow/SKILL.md` § "Preventing premature implementation" —
update to describe the new fourth `spec-approve` outcome (still never starts
implementation on its own initiative — only on this explicit, separately-labeled choice).

## Out of scope

- Batch execution itself (task 08) — this task only adds the forward-compatible check.
- Any change to `spec-approve`'s original three outcomes' behavior.
