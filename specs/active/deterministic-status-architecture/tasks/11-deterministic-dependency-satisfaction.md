---
id: deterministic-status-architecture.deterministic-dependency-satisfaction
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-projection-and-human-step.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
forbidden_paths:
  - tools/specs/lifecycle-primitives.mjs
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
depends_on: [ workflow-definition-schema-extensions ]
semantic_references:
  decisions: [D9]
---

# Task: Deterministic dependency satisfaction

## Goal

Provide a dependency-satisfaction check for deterministic tasks that resolves the
dependency task's *matched terminal transition* from its `workflow_progress.history` and
reads *that transition's* `outcome` field (D9) — never a "terminal step" (this engine has
none), never legacy `DEPENDENCY_SATISFYING_STATUSES`, and never inferred from a step's name
or the terminal status's own name (`verified`).

## Dependencies

`workflow-definition-schema-extensions` — this task reads the per-transition `outcome`
field that task adds.

## Implementation constraints

- New, small, pure module (e.g. `tools/specs/workflow/dependency-satisfaction.mjs`) —
  do not modify `tools/specs/lifecycle-primitives.mjs`'s existing `depsSatisfied`/
  `DEPENDENCY_SATISFYING_STATUSES` (legacy semantics stay exactly as they are;
  `forbidden_paths` enforces this).
- Resolution algorithm, given a dependency task and its change:
  1. Read `workflow_progress.history`'s last entry: `{ step, transitioned_to, result? }`.
  2. Look up that `step`'s declared `transitions` in the workflow definition.
  3. Find the transition whose `to === transitioned_to` (and, if the step's transitions are
     conditional, whose `value === result`).
  4. If that transition's `to` is not a terminal status (internal transition, or no history
     entry at all, or the step is still active/not yet finished) → unsatisfied.
  5. If found and its `to` is terminal: satisfied only when that transition's own `outcome`
     field is exactly `success`; `outcome: failure` → unsatisfied.
- This function takes a task and its change as input and returns a boolean plus (when
  false) the specific blocking reason — the canonical projection task
  (`deterministic-task-projection`) composes this rather than reimplementing it.

## Acceptance criteria

- A downstream task depending on a task whose matched terminal transition has
  `outcome: success` is reported satisfied.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task whose matched terminal transition has
  `outcome: failure` is reported unsatisfied.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task that is implemented but still awaiting/under review,
  or awaiting a human decision (no terminal transition matched yet), is reported
  unsatisfied (brief regression test #11).
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task whose last history entry names an *internal*
  transition (step-to-step) is reported unsatisfied, regardless of any `outcome` field
  (which must not even be present on an internal transition per task 07's validation).
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Legacy `depsSatisfied`/`DEPENDENCY_SATISFYING_STATUSES` in `lifecycle-primitives.mjs` are
  unchanged and legacy dependency tests continue passing unchanged.
  `automated: node --test tools/tests/status-dependency-aware.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/status-dependency-aware.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Legacy dependency semantics (unchanged). A full multi-outcome/retry terminal model beyond
the one per-transition `outcome` field (D9). The canonical task projection that composes
this function (task `deterministic-task-projection`).
