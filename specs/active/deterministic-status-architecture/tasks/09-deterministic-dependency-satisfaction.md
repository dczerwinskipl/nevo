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

Provide a dependency-satisfaction check for deterministic tasks that requires the
dependency task's workflow to have reached a terminal step whose definition-level
`outcome` is explicitly `success` (D9) — never legacy `DEPENDENCY_SATISFYING_STATUSES`, and
never inferred from a step's name.

## Dependencies

`workflow-definition-schema-extensions` — this task reads the terminal `outcome` field that
task adds.

## Implementation constraints

- New, small, pure module (e.g. `tools/specs/workflow/dependency-satisfaction.mjs`) —
  do not modify `tools/specs/lifecycle-primitives.mjs`'s existing `depsSatisfied`/
  `DEPENDENCY_SATISFYING_STATUSES` (legacy semantics stay exactly as they are;
  `forbidden_paths` enforces this).
- Derive satisfaction from the dependency task's own `workflow_progress` + its workflow
  definition: resolve its current/terminal step, and check that step's `outcome` field is
  `success` — a task at a terminal step with `outcome: failure`, or not yet at any terminal
  step (including implemented-but-awaiting-review or awaiting a human decision), is
  unsatisfied.
- This function takes a task and its change as input and returns a boolean plus (when
  false) the specific blocking reason — the canonical projection task
  (`deterministic-task-projection`) composes this rather than reimplementing it.

## Acceptance criteria

- A downstream task depending on a task whose workflow reached a terminal step with
  `outcome: success` is reported satisfied.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task at a terminal step with `outcome: failure` is
  reported unsatisfied. `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task that is implemented but still awaiting/under review,
  or awaiting a human decision, is reported unsatisfied (brief regression test #11).
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
the one `outcome` field (D9). The canonical task projection that composes this function
(task `deterministic-task-projection`).
