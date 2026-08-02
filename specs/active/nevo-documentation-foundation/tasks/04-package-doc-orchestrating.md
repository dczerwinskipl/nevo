---
id: nevo-documentation-foundation.package-doc-orchestrating
status: draft
change: nevo-documentation-foundation
context:
  required:
    - specs/active/nevo-documentation-foundation/areas/03-edge-package-pilot.md
    - ../../../docs/templates/package-doc-template.md
    - ../../../docs/architecture/orchestration.md
    - ../../../docs/architecture/package-boundaries.md
allowed_paths:
  - docs/packages/NEvo.Orchestrating.md
  - docs/templates/package-doc-template.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package doc — NEvo.Orchestrating

## Goal

Write `docs/packages/NEvo.Orchestrating.md`, the first of the two edge-package pilot
docs (D5), validating the `package` template against a small, `experimental`,
messaging-independent package.

## Dependencies

`architecture-corrections` (must use the corrected dependency facts).

## Implementation constraints

- Cover: purpose, responsibilities, dependencies (only `NEvo.Core` per corrected
  `package-boundaries.md`), public concepts/APIs (orchestrator/step/runner interfaces,
  `OrchestratorState[<T>]`, `OrchestratorStatus`, `PersistentStepExecutor`),
  configuration, basic usage, advanced usage, limitations, related packages (link to
  `NEvo.Orchestrating.EntityFramework`, documented in a later task), relevant
  examples/tests (`tests/NEvo.Orchestrating.Tests/`).
- Carry the `experimental` status from `docs/architecture/orchestration.md`'s front
  matter — do not present this package as more stable than that.
- If any section of `docs/templates/package-doc-template.md` doesn't fit this package
  well, fix the template itself (allowed_paths permits it) rather than deviating ad hoc —
  every later package-doc task reuses this template unmodified unless it also needs a
  fix.

## Acceptance criteria

- `docs/packages/NEvo.Orchestrating.md` passes `node tools/docs.mjs validate` under the
  `package` type.
- Every dependency claim matches the corrected `package-boundaries.md`.
- Status is `experimental`, consistent with `docs/architecture/orchestration.md`.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

`NEvo.Orchestrating.EntityFramework` (documented in task
`package-docs-web-and-experimental`).
