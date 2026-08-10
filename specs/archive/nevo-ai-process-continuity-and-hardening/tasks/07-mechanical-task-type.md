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

> Refined 2026-08-04 (see `owner-decisions.md` D14) — renamed in spirit from
> "auto-approval" to **review-exempt deterministic approval**: `approve` still performs
> an explicit, auditable transition; only the review-file requirement is exempted, and
> only when every condition holds. A failing condition fails closed to the normal
> review-then-approve cycle, never to a silent, path-forward-less block.

## Goal

Add `type: mechanical` to the task schema with conjunctive review-exemption conditions
(derived-from-approved-task, deterministic, no public behavior change, no new design
decision, constrained to the deriving task's already-declared paths, every acceptance
criterion carries an `automated:` tag), and wire `tools/specs.mjs approve` to grant the
review-file exemption only when every condition holds — `approve` still runs as a normal,
explicit transition either way.

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
- `approve`'s review-exempt path for a `type: mechanical` task skips only the
  review-file requirement (`validateApproval`'s `review`/`verdict`/`fingerprint` checks)
  — every other existing guard (`validateTransition`'s `draft`→`approved` check,
  `depsSatisfied`) still applies unchanged, and `approve` still writes `status:
  approved` explicitly, exactly as it does for any other task — never as a side effect
  of something else.
- A condition failure is a `validate` error naming the specific failed condition — this
  is the fail-closed behavior: the task is not silently exempted, and it is not silently
  blocked either. Its author has two ways forward, both leading to the normal path: fix
  the condition, or remove `type: mechanical` and let the task go through the normal
  review-then-approve cycle.
- A `type: mechanical` task is otherwise ordinary: `start`/`complete`/`verify` and `next`
  behave exactly as for any other task, and its `approved` status is visible in
  `change.yaml`/batch/status output exactly like any other approved task.

## Acceptance criteria

1. A `type: mechanical` task meeting all six conditions receives the review-file
   exemption when `approve` runs — `approve` still performs the explicit `draft`→
   `approved` transition, it does not skip the transition itself (automated: `node
   --test tools/tests/mechanical-task.test.mjs`).
2. A `type: mechanical` task missing exactly one condition fails `validate` with a
   message naming that specific condition, and never receives the exemption (automated,
   same suite — cover at least two distinct missing-condition cases).
3. A `type: mechanical` task cannot declare an `owner-decision:`-tagged acceptance
   criterion (automated).

## Verification

```
node --test tools/tests/mechanical-task.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`templates/task.md` — document `type: mechanical`, its six conditions, and the
"review-exempt deterministic approval" terminology (full documentation consolidation
happens in task 11; this task documents the schema itself).

## Out of scope

- Using `type: mechanical` for anything touching an `AGENTS.md` owner-approval gate —
  structurally prevented by the conditions, not separately enforced here.
- Batch execution's interaction with mechanical tasks beyond normal `next`/dependency
  behavior (task 08 covers batch-specific behavior).
