---
id: nevo-documentation-foundation.architecture-corrections
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../docs/architecture/package-boundaries.md
    - ../../../README.md
    - specs/active/nevo-documentation-foundation/owner-decisions.md
allowed_paths:
  - docs/architecture/package-boundaries.md
  - README.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/architecture/overview.md
  - tools/**
---

# Task: Architecture corrections

## Goal

Fix the two categories of doc/code inconsistency recorded in D3 (`owner-decisions.md`)
before any package doc can copy them as fact.

## Dependencies

`package-classification-and-navigation-hub` — see `change.yaml` for the authoritative
dependency graph; this section mirrors it for readability only.

## Implementation constraints

- Re-verify each `.csproj`'s `ProjectReference` entries directly (do not trust the
  existing diagram) for `NEvo.Messaging.EntityFramework`,
  `NEvo.Orchestrating.EntityFramework`, `NEvo.Web.Authorization`, and
  `NEvo.Messaging.Web`, then correct `docs/architecture/package-boundaries.md`'s
  dependency diagram to match.
- Address stated rule 4 ("messaging extension packages depend on `NEvo.Messaging` but
  not on each other") given `NEvo.Messaging.Web`'s actual dependency on
  `NEvo.Messaging.Cqrs` — correct the rule's wording or explicitly document the
  exception; do not silently leave the contradiction.
- Correct `README.md`'s one-line description of `NEvo.Web` to match its actual contents
  (`src/NEvo.Web/Client/*`, namespace `NEvo.Web.Client` — an HTTP client wrapper).
- Do not touch `docs/architecture/overview.md`'s maturity table — out of scope per D3.

## Acceptance criteria

- `docs/architecture/package-boundaries.md`'s dependency diagram matches the actual
  `ProjectReference` graph for all 13 packages.
- `README.md`'s `NEvo.Web` description matches its actual contents.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
```
Manual: diff the corrected diagram against a fresh read of each affected `.csproj`.

## Out of scope

The `README.md` vs. `docs/architecture/overview.md` maturity-table conflict (D3, deferred
as a follow-up candidate).
