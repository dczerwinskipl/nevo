---
id: nevo-documentation-foundation.package-classification-and-navigation-hub
status: draft
change: nevo-documentation-foundation
context:
  required:
    - specs/active/nevo-documentation-foundation/areas/01-foundation.md
    - ../../../docs/architecture/overview.md
    - ../../../docs/architecture/package-boundaries.md
  optional:
    - ../../../docs/ai/how-to-navigate.md
    - ../../../README.md
allowed_paths:
  - docs/packages/classification.md
  - docs/README.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - tools/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
---

# Task: Package classification and navigation hub

## Goal

Produce the package-classification map and a human-facing navigation hub linking
architecture docs, package docs, guides, and ADRs by relationship.

## Dependencies

`doc-taxonomy-and-tooling` (needs `docs/packages/` to exist).

## Implementation constraints

- `docs/packages/classification.md` groups all 13 real `src/` packages (confirmed via
  `dotnet sln NEvo.sln list`, not the stale `NEvo.ExampleApp` build-artifact directory)
  into: core primitives, messaging core, messaging extensions, authorization,
  persistence, web, event sourcing (experimental), orchestration (experimental). Use the
  `package` type from the prior task.
- `docs/README.md` is the curated navigation hub — human-facing, distinct from the
  auto-generated `docs/index.generated.md`. It may use a type outside the `package`/
  `guide`/`architecture`/`development`/`adr`/`ai` set (e.g. `type: hub`); `tools/docs.mjs`
  falls back to requiring only `id, type, title, status` for unrecognized types
  (`tools/docs.mjs:154`), so this does not require another `tools/docs.mjs` change.
- The hub must link to every existing `docs/architecture/*.md` and `docs/development/*.md`
  document by title, plus a placeholder section for `docs/packages/` and `docs/guides/`
  that later tasks populate (link to `docs/packages/classification.md` as the entry
  point for packages).

## Acceptance criteria

- `docs/packages/classification.md` names all 13 real packages exactly once, each in
  exactly one group.
- `docs/README.md` links to every document currently in `docs/architecture/` and
  `docs/development/`.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

Fixing the architecture inconsistencies (task `architecture-corrections`). Writing any
individual package doc.
