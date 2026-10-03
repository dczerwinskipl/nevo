---
id: acceptance-scenario-finish-operation-replay
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/acceptance-scenarios-a-through-d.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
depends_on:
  - non-fatal-admission-for-remediable-blockers
  - terminal-reconciliation-adopts-outcome
  - dependency-consumption-idempotent-on-resume
allowed_paths:
  - tools/tests/scenario-finish-operation-replay.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/**
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4]
  dependency_contracts: [non-fatal-admission-for-remediable-blockers, terminal-reconciliation-adopts-outcome, dependency-consumption-idempotent-on-resume]
---

# Task: Acceptance scenario — finish-operation replay across a terminated execution

## Dependencies

`non-fatal-admission-for-remediable-blockers`, `terminal-reconciliation-adopts-outcome`,
`dependency-consumption-idempotent-on-resume`.

## Goal

New orchestration-level regression test proving D2's symmetry (spec-review, this
correction): the identical replayable-vs-ambiguous rule governs both admitting a new
execution against an existing finish-operation record, and classifying a terminating
execution that left one behind. Drives the real admission/settlement/finish call chain, not
a direct unit call to a single helper.

## Acceptance criteria

- **Positive (replayable) scenario:**
  1. Agent X is admitted and enters the durable finish operation (`workflow step finish`
     creates/advances an operation record with `status: 'running'`).
  2. X's turn becomes terminal before the finish operation completes, with the record still
     provably replayable (`status: 'running'`).
  3. Terminal reconciliation classifies the outcome as `resumable`, not
     `recovery-required`.
  4. X's workspace-writer claim is released; the durable finish-operation record is left
     completely intact (byte-for-byte, verified by reading it before and after
     classification).
  5. Agent Y is admitted for the same task.
  6. Y invokes the ordinary `workflow step finish` (no special "replay" flag or code path —
     just the normal command).
  7. The finish operation completes, resuming from wherever X's record left off (verified:
     already-completed stages are not re-executed; only genuinely unfinished stages run).
  8. No duplicate workflow transition occurs (`workflow_progress.history` gains exactly one
     new entry for this step/attempt, not two), no duplicate dependency consumption occurs
     (for a `consumesDependencies: true` step), and no attempt increment occurs.
  `automated: node --test tools/tests/scenario-finish-operation-replay.test.mjs`
- **Negative (ambiguous) counterpart:**
  1. Agent X is admitted and enters the durable finish operation, but its record reaches a
     non-replayable state (`status: 'blocked'` or `'unknown'` — e.g. by driving a stage into
     its own internal reconciliation-required branch).
  2. X's turn becomes terminal.
  3. Terminal reconciliation classifies the outcome as `recovery-required`, not
     `resumable` — the claim is **not** released.
  4. A subsequent admission attempt for the same task fails (blocked by the
     `recovery-required` claim) — ordinary writable admission is never granted merely
     because the record exists.
  `automated: node --test tools/tests/scenario-finish-operation-replay.test.mjs`

## Verification

```bash
node --test tools/tests/scenario-finish-operation-replay.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Unit-level coverage of the shared replayability classifier itself (task 01's own tests), of
the readiness-side classification (task 02's own tests), or of the settlement-side
classification (task 05's own tests). Start-operation record replayability (not part of
this correction — see task 05's Out of scope).
