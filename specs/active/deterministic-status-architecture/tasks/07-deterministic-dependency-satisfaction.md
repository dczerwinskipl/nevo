---
id: deterministic-status-architecture.deterministic-dependency-satisfaction
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-projection-and-human-interaction.md
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
---

# Task: Deterministic dependency satisfaction

## Goal

Provide a dependency-satisfaction check for deterministic tasks that requires the
dependency task to have reached a successful terminal *workflow* state — never legacy
`DEPENDENCY_SATISFYING_STATUSES` (`implemented`/`verified`/`archived`).

## Implementation constraints

- New, small, pure module (e.g. `tools/specs/workflow/dependency-satisfaction.mjs`) —
  do not modify `tools/specs/lifecycle-primitives.mjs`'s existing `depsSatisfied`/
  `DEPENDENCY_SATISFYING_STATUSES` (legacy semantics stay exactly as they are;
  `forbidden_paths` enforces this).
- Derive "successful terminal workflow state" from the dependency task's own
  `workflow_progress` + its workflow definition (via `resolveWorkflowPosition` or
  equivalent) — a task whose implementation finished but is still awaiting/under review,
  awaiting a human decision, or sent back for changes must not satisfy a dependent.
- This function takes a task and its change as input and returns a boolean plus (when
  false) the specific blocking reason — the canonical projection task
  (`deterministic-task-projection`) composes this rather than reimplementing it.

## Acceptance criteria

- A downstream task depending on a task whose workflow reached a successful terminal state
  is reported satisfied. `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task that is implemented but still awaiting/under review
  is reported unsatisfied (brief regression test #11).
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A downstream task depending on a task awaiting a human decision, or sent back for changes,
  is reported unsatisfied. `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
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

Legacy dependency semantics (unchanged). The canonical task projection that composes this
function — task `deterministic-task-projection`.
