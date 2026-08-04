---
id: nevo-documentation-architecture.development-testing-strategy-and-contributing
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/development/testing.md
    - docs/development/coding-conventions.md
    - docs/development/commit-conventions.md
    - docs/development/git-workflow.md
    - docs/development/local-setup.md
    - docs/development/pull-requests.md
    - specs/active/nevo-documentation-architecture/areas/02-maintainer-documentation.md
allowed_paths:
  - docs/development/testing.md
  - docs/development/testing-strategy.md
  - docs/development/contributing.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/guides/**
  - docs/adr/**
  - docs/ai/**
  - docs/architecture/**
  - docs/development/coding-conventions.md
  - docs/development/commit-conventions.md
  - docs/development/git-workflow.md
  - docs/development/local-setup.md
  - docs/development/pull-requests.md
  - AGENTS.md
  - README.md
---

# Task: Development docs — testing strategy and contributing entry point

## Goal

Rename `docs/development/testing.md` → `testing-strategy.md`, augmenting it with
which tests are required when changing each subsystem covered by this area's other
tasks, and create `docs/development/contributing.md` as a thin entry point linking the
5 unchanged process docs.

## Implementation constraints

- `testing-strategy.md`: keep `testing.md`'s existing content (test stack, project
  structure, coverage expectations) and add a per-subsystem "required tests" pointer
  for at least: messaging pipeline/dispatch, authorization, inbox/outbox, persistence,
  orchestration, event sourcing — matching the subsystems covered by
  `docs/development/*` docs created in this area's other tasks.
- `contributing.md`: a short page linking `coding-conventions.md`,
  `commit-conventions.md`, `git-workflow.md`, `local-setup.md`, `pull-requests.md`, and
  `testing-strategy.md` with a one-line description each (read those 5 files for their
  existing one-line summaries — do not edit them, they are outside this task's
  `allowed_paths` and already reported as maintainer-ready as-is by discovery).

## Acceptance criteria

- `docs/development/testing.md` no longer exists; `docs/development/testing-strategy.md`
  exists with the per-subsystem test pointers.
- `docs/development/contributing.md` exists and links all 6 files listed above.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

Editing `coding-conventions.md`, `commit-conventions.md`, `git-workflow.md`,
`local-setup.md`, `pull-requests.md` — their content is already maintainer-ready per
discovery and stays as-is.
