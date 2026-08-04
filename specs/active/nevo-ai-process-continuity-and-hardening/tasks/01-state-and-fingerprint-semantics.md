---
id: nevo-ai-process-continuity-and-hardening.state-and-fingerprint-semantics
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/state-and-fingerprint-semantics.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs/service.mjs
  optional:
    - tools/specs/validation.mjs
    - tools/tests/fingerprint.test.mjs
    - tools/tests/task-lifecycle.test.mjs
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
  - tools/specs/validation.mjs
  - tools/tests/fingerprint.test.mjs
  - tools/tests/task-lifecycle.test.mjs
  - docs/ai/specification-workflow.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - .claude/commands/**
  - .claude/skills/**
---

# Task: State and fingerprint semantics

## Goal

Fix the confirmed cross-task fingerprint-invalidation defect (D1) by excluding `status`
from `computeSpecFingerprint`'s hashed input; correct `depsSatisfied` so `abandoned` no
longer satisfies a dependency; resolve `superseded` from inert to either fully-defined or
removed. This is the foundation every other task in this change depends on.

## Dependencies

None — first task in the change.

## Implementation constraints

- `computeSpecFingerprint` must exclude exactly `status` (change-level and per-task) —
  every other field (title, `depends_on`, `context`, `allowed_paths`, `forbidden_paths`,
  body text, owner decisions, area/task file content) stays included. State explicitly,
  in the implementation, whether the fingerprint remains one hash over the whole change
  or becomes finer-grained — either is acceptable, but the acceptance criteria and tests
  below must match whichever granularity is actually built.
- `depsSatisfied` (`lifecycle.mjs:11-17`) must exclude `abandoned` from the statuses that
  satisfy a dependency; `implemented`/`verified`/`archived` keep satisfying it.
- Resolve `superseded`: either wire it into a real, non-dependency-satisfying terminal
  state with a documented "point the dependent at the superseding task" convention, or
  remove it from `service.mjs`'s `STATUS_ORDER`. Do not leave it inert.
- Do not modify `TRANSITIONS` (`lifecycle.mjs:29-34`) — this task changes what statuses
  mean for dependency/fingerprint purposes, not how a task moves between them.
- Update `docs/ai/specification-workflow.md` to state that `blocked`/`needs-decision` are
  real (if currently-unreachable) statuses excluded from dependency satisfaction, and to
  describe the corrected fingerprint scope.

## Acceptance criteria

1. A task's status change does not affect the fingerprint input associated with a
   different, unrelated task in the same change (automated: `node --test
   tools/tests/fingerprint.test.mjs`).
2. A task depending on an `abandoned` task is never reported `next`-ready (automated:
   `node --test tools/tests/task-lifecycle.test.mjs`).
3. `superseded` has either full, real semantics (terminal, non-dependency-satisfying,
   documented) or no longer appears anywhere in `tools/specs/` (automated: `node
   tools/specs.mjs validate` plus a grep-backed manual check).
4. `docs/ai/specification-workflow.md` accurately describes the new fingerprint scope and
   `blocked`/`needs-decision`/`superseded` semantics (inspection).

## Verification

```
node --test tools/tests/fingerprint.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`docs/ai/specification-workflow.md` — fingerprint scope and status-vocabulary sections.

## Out of scope

- Adding recovery-driven writers for `blocked`/`needs-decision` (task 02).
- Any change to `TRANSITIONS` or the four existing lifecycle commands' behavior.
