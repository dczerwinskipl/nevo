---
id: nevo-ai-process-continuity-and-hardening.mechanical-task-type
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/validation.mjs
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
  optional:
    - .claude/skills/nevo-ai-spec-workflow/templates/task.md
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/tests/mechanical-task.test.mjs
  - .claude/skills/nevo-ai-spec-workflow/templates/task.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/**
  - .claude/commands/**
---

# Task: Mechanical task type

## Goal

Add `type: mechanical` to the task schema with conjunctive auto-approval conditions
(derived-from-approved-task, deterministic, no public behavior change, no new design
decision, constrained to the deriving task's already-declared paths, every acceptance
criterion carries an `automated:` tag), and wire `tools/specs.mjs approve` to
auto-approve only when every condition holds — otherwise a hard, specifically-worded
`validate` error.

## Dependencies

`scope-and-follow-up-mechanisms` — needs `consequential_paths` and the per-criterion
evidence-tag syntax this task's conditions check against. `state-and-fingerprint-semantics`
— needs correct dependency-satisfaction semantics before anything is safely
auto-approved.

## Implementation constraints

- All six conditions in `areas/context-and-validation-hardening.md` requirement 12 are
  conjunctive — implement as a single validation function returning either "all
  conditions met" or a list of the specific conditions that failed; never a
  score/majority check.
- `approve`'s auto-approval path for a `type: mechanical` task skips only the
  review-file requirement (`validateApproval`'s `review`/`verdict`/`fingerprint` checks)
  — every other existing guard (`validateTransition`'s `draft`→`approved` check,
  `depsSatisfied`) still applies unchanged.
- A condition failure is a `validate` error, not a silent fallback to the normal
  review-then-approve cycle — a task author must either fix the condition or remove
  `type: mechanical` and go through the normal cycle explicitly.
- A `type: mechanical` task is otherwise ordinary: `start`/`complete`/`verify` and `next`
  behave exactly as for any other task.

## Acceptance criteria

1. A `type: mechanical` task meeting all six conditions is auto-approved by `approve`
   without an existing review file (automated: `node --test
   tools/tests/mechanical-task.test.mjs`).
2. A `type: mechanical` task missing exactly one condition fails `validate` with a
   message naming that specific condition, and is never auto-approved (automated, same
   suite — cover at least two distinct missing-condition cases).
3. A `type: mechanical` task cannot declare an `owner-decision:`-tagged acceptance
   criterion (automated).

## Verification

```
node --test tools/tests/mechanical-task.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`templates/task.md` — document `type: mechanical` and its six conditions (full
documentation consolidation happens in task 10; this task documents the schema itself).

## Out of scope

- Using `type: mechanical` for anything touching an `AGENTS.md` owner-approval gate —
  structurally prevented by the conditions, not separately enforced here.
- Batch execution's interaction with mechanical tasks beyond normal `next`/dependency
  behavior (task 08 covers batch-specific behavior).
