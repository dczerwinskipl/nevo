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

> Refined 2026-08-04 — `deriveStage` is now suspension-aware (D8): a task with an active
> `execution.suspension` reports that instead of its stage's usual `nextCommand`. The
> retry rule this task wires in now follows the
> `completed`/`safe_to_retry`/`partially_completed`/`not_retryable` postcondition model
> from task 02, not a bare "recovered, so continue" boolean.

## Goal

Turn `deriveStage` into the single shared, suspension-aware "what's next" entry point
every conversational command and the batch controller call, instead of each command
independently deciding. Wire task 02's postcondition-based recovery so it calls this
controller after every resolved recovery, and enforce the expansive-continuation
boundary from `overview.md` § "Proposed architecture" → "Interaction model" (stop
immediately at scope expansion, an architectural/behavioral decision, an unsafe-manual
recovery, unrelated dirty files, a failed acceptance criterion, an unexpected
public-contract impact, unresolved high-risk evidence, or the end of the authorized
scope).

## Dependencies

`recovery-classification-and-machine-readable-errors` — the postcondition-based recovery
model and `execution.suspension` writer this task wires in.

## Implementation constraints

- Do not duplicate `deriveStage`'s logic anywhere else in `tools/specs.mjs`; expose it
  (or a thin wrapper with the same contract) so that a future command-file change (task
  04) can call one function instead of re-deriving state.
- `deriveStage`'s wrapper checks each task's `execution.suspension` before falling back
  to its existing stage logic — a suspended task's report names the suspension's
  `kind`/`code` and, for `confirm-required`, what confirmation is still needed.
- After a `completed`/`safe_to_retry` recovery (task 02), the controller is called before
  deciding whether to stop or continue; a `partially_completed` or `not_retryable`
  outcome always stops (never auto-continues past an unresolved suspension).
- Implement the authorized-scope tracking (one named task / a selected batch / all ready
  tasks / until a named checkpoint) as an explicit parameter the controller is always
  given — "continue" is never ambiguous about how far it's allowed to go.
- This task does not change any command's *conversational* behavior (menus, inline
  offers) — that is task 04. It only makes the deterministic computation callable as a
  shared entry point and wires the retry rule to it.

## Acceptance criteria

1. `deriveStage` (or its wrapper) is called from exactly one place per command that needs
   "what's next," verifiable by inspection — no command file computes an equivalent
   result independently (inspection).
2. A task with an active `execution.suspension` is reported via its suspension, not its
   stage's default `nextCommand` (automated: `node --test
   tools/tests/task-lifecycle.test.mjs`).
3. After a `completed`/`safe_to_retry` recovery, the controller is called before the
   operation reports success; a `partially_completed`/`not_retryable` outcome always
   stops (automated, same suite).
4. The controller never continues past an explicitly authorized scope's boundary
   (automated — construct a batch/single-task scope and assert continuation stops at its
   edge).

## Verification

```
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

None in this task — consolidated in task 11.

## Out of scope

- Any change to what `deriveStage` reports (`stage`/`detail`/`nextCommand` values are
  unchanged by this task).
- Command-file conversational changes (task 04).
