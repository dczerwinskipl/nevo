---
id: nevo-ai-process-continuity-and-hardening.resume-and-continue-controller
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/recovery-and-resume.md
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
  optional:
    - tools/tests/task-lifecycle.test.mjs
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/tests/task-lifecycle.test.mjs
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/**
  - .claude/commands/**
  - .claude/skills/**
---

# Task: Resume and continue controller

## Goal

Turn `deriveStage` into the single shared "what's next" entry point every conversational
command and the batch controller call, instead of each command independently deciding.
No new computation logic is introduced beyond what `deriveStage` already does — this task
is about making it the one call site, and wiring the repair-retry-continue rule from task
02 to call it after every recovery.

## Dependencies

`recovery-classification-and-machine-readable-errors` — the repair-retry-continue rule
this task wires in.

## Implementation constraints

- Do not duplicate `deriveStage`'s logic anywhere else in `tools/specs.mjs`; expose it
  (or a thin wrapper with the same contract) so that a future command-file change (task
  04) can call one function instead of re-deriving state.
- The repair-retry-continue rule (task 02) calls this controller after every resolved
  recovery, before deciding whether to stop or continue.
- This task does not change any command's *conversational* behavior (menus, inline
  offers) — that is task 04. It only makes the deterministic computation callable as a
  shared entry point and wires the retry rule to it.

## Acceptance criteria

1. `deriveStage` (or its wrapper) is called from exactly one place per command that needs
   "what's next," verifiable by inspection — no command file computes an equivalent
   result independently (inspection).
2. After a resolved recovery, the repair-retry-continue rule calls the controller before
   the operation reports success or failure to the caller (automated: `node --test
   tools/tests/task-lifecycle.test.mjs`).

## Verification

```
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

None in this task — consolidated in task 10.

## Out of scope

- Any change to what `deriveStage` reports (`stage`/`detail`/`nextCommand` values are
  unchanged by this task).
- Command-file conversational changes (task 04).
