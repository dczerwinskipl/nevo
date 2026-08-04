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
  guards against *current* state, run `start` only if they pass, and on a `start`
  failure report it without touching the `approved` status (no rollback, no silent
  re-approval) — per D3 exactly.
- The re-guard-check must call `handleStart`'s existing guard logic (working-tree-clean,
  transition validity, `depsSatisfied`) — no parallel guard implementation.
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
   status at `approved` (automated, extends task 02/03's test coverage).
3. `spec-review` reaching `ready-for-approval` offers inline approval without skipping
   `spec-approve`'s own CLI-enforced gate (manual trace: review exists, verdict ready,
   fingerprint current, still checked by the CLI, not assumed by the command file).
4. `task-review`'s batch-continuation offer never appears when no active batch record
   exists (inspection, until task 08 lands; re-verified as part of task 08's own
   acceptance criteria once the record is real).

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
