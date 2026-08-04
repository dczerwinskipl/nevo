---
id: nevo-ai-process-continuity-and-hardening.recovery-classification-and-machine-readable-errors
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/recovery-and-resume.md
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
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/**
  - .claude/commands/**
  - .claude/skills/**
---

# Task: Recovery classification and machine-readable errors

## Goal

Classify failures into four recovery classes (automatic / confirm-required /
owner-decision / unsafe-manual), give `CliError` a stable machine-readable `code` and
optional `recovery` payload, implement the repair-retry-continue rule, and extend
`branchExists` to detect a remote-only branch.

## Dependencies

`state-and-fingerprint-semantics` — needs the corrected `depsSatisfied` and the reachable
`blocked`/`needs-decision` statuses this task writes to.

## Implementation constraints

- Assign each of the eight example scenarios from `areas/recovery-and-resume.md`
  requirement 1 to exactly one class; do not invent a fifth class.
- `CliError` (or a new narrow subclass) gains `code` and, where applicable, `recovery:
  {class, suggestedFix, retryCommand}` — existing `message` text is preserved unchanged
  for anything already relying on it.
- The repair-retry-continue rule re-runs the *original* failed operation by its own
  command name/arguments after an automatic or confirmation-resolved recovery — never a
  different operation, never more than one re-attempt, and never a state-changing
  operation that `validateTransition` already reports as `idempotent`.
- `branchExists` checks `origin/<name>` (via `git rev-parse --verify origin/<name>`) when
  the local ref is missing; `handleStart` uses this to check out the existing remote
  branch instead of creating a diverging local one.
- Owner-decision-class and unsafe-manual-class errors write `needs-decision`/`blocked`
  respectively when they must persist across a session boundary; automatic and
  confirm-required classes never persist a blocking status.

## Acceptance criteria

1. Each of the eight example scenarios maps to exactly one recovery class with a stable
   code (automated: `node --test tools/tests/cli-errors.test.mjs`).
2. `start` on a branch that exists on `origin` but not locally checks out the remote
   branch rather than creating a new diverging one (automated: `node --test
   tools/tests/git.test.mjs`).
3. The repair-retry-continue helper does not re-apply an already-idempotent transition a
   second time (automated: `node --test tools/tests/task-lifecycle.test.mjs`).
4. An owner-decision-class error results in `needs-decision`; an unsafe-manual-class
   error results in `blocked`, when persisted (automated).

## Verification

```
node --test tools/tests/cli-errors.test.mjs
node --test tools/tests/git.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

None in this task — recovery-model documentation is consolidated in task 10.

## Out of scope

- The `deriveStage`-based controller entry point that consumes this classification
  (task 03).
- Any conversational/menu behavior (area `conversational-continuity`, task 04).
