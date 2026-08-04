---
id: nevo-ai-process-continuity-and-hardening.recovery-classification-and-machine-readable-errors
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/recovery-and-resume.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/lib/cli-errors.mjs
    - tools/lib/git.mjs
    - tools/specs.mjs
  optional:
    - tools/tests/git.test.mjs
allowed_paths:
  - tools/lib/cli-errors.mjs
  - tools/lib/git.mjs
  - tools/specs.mjs
  - tools/specs/lifecycle.mjs
  - tools/tests/git.test.mjs
  - tools/tests/task-lifecycle.test.mjs
  - tools/tests/cli-errors.test.mjs
  - tools/tests/recovery.test.mjs
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/**
  - .claude/commands/**
  - .claude/skills/**
---

# Task: Recovery classification and machine-readable errors

> Refined 2026-08-04 (see `owner-decisions.md` D8) — the scenario count is corrected to
> nine (`REC-01`..`REC-09`), each with a canonical identifier; recovery is now defined by
> per-action postcondition contracts, not status transitions alone; this task is the
> writer/clearer for `execution.suspension` (task 01 only defined its shape).

## Goal

Implement the nine canonical `REC-01`..`REC-09` recovery scenarios with stable codes,
error classes, and per-action postcondition contracts
(`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`); write and clear
`execution.suspension`; extend `branchExists` to detect a remote-only branch (`REC-02`).

## Dependencies

`state-and-fingerprint-semantics` — needs the `execution.suspension` schema and corrected
`depsSatisfied`.

## Implementation constraints

- Implement all nine scenarios exactly as enumerated in
  `areas/recovery-and-resume.md` requirement 1, each with: error class, stable `REC-xx`
  code, recoverable?, confirmation required?, proposed recovery, suspension payload (if
  persisted), retry target (`previous_action`), stop condition, and expected `status`
  after recovery (always unchanged from before the stop).
- Implement the `start-task` postcondition contract exactly as specified in
  `overview.md` § "Recovery model", and at least one more action's contract by the same
  pattern (`approve` is the natural second candidate, since task 04 needs its
  postcondition contract for the combined approve+start path).
- `CliError` (or a new narrow subclass) gains `code` (the `REC-xx` identifier where
  applicable) and, where applicable, `recovery: {class, suggestedFix, retryCommand}`.
  Existing `message` text is preserved unchanged.
- Recovery inspects postconditions and executes only missing effects — never repeats an
  already-`completed` externally-visible effect.
- `not_retryable`: when an original action's preconditions no longer hold, create a new
  suspension describing the new situation rather than blindly retrying the stale
  `previous_action`.
- `execution.suspension` is written only when a stop must survive a session boundary
  (`confirm-required`/`owner-decision`/`unsafe-manual` still unresolved when control
  returns) — never for a same-turn `automatic` recovery.
- `branchExists` checks `origin/<name>` when the local ref is missing; `handleStart` uses
  this to check out the existing remote branch instead of creating a diverging one
  (`REC-02`'s concrete fix).
- Do not use the word "idempotent" for anything in this task's new vocabulary
  (`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`) — that term keeps
  its existing, narrower meaning in `validateTransition`.

## Acceptance criteria

1. Each of the nine `REC-xx` scenarios has a passing test asserting its class, code, and
   (for blocking classes) the correct `execution.suspension` payload (automated: `node
   --test tools/tests/recovery.test.mjs`).
2. `start` on a `REC-02` branch (remote-only) checks it out rather than creating a
   diverging one (automated: `node --test tools/tests/git.test.mjs`).
3. A `partially_completed` `start` (branch created, status not written) recovers by
   writing only the missing status, never re-creating the branch (automated).
4. A `not_retryable` case produces a new suspension rather than repeating the stale
   `previous_action` (automated).
5. An `owner-decision`-class or `unsafe-manual`-class stop persists
   `execution.suspension` with the task's `status` unchanged (automated).

## Verification

```
node --test tools/tests/recovery.test.mjs
node --test tools/tests/cli-errors.test.mjs
node --test tools/tests/git.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

None in this task — recovery-model documentation is consolidated in task 11.

## Out of scope

- The `deriveStage`-based controller entry point that consumes this classification
  (task 03).
- Any conversational/menu behavior (area `conversational-continuity`, task 04).
