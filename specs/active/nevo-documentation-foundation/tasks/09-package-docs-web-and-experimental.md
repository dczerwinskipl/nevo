---
id: nevo-documentation-foundation.package-docs-web-and-experimental
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../README.md
    - ../../../docs/architecture/event-sourcing.md
    - ../../../docs/architecture/orchestration.md
    - docs/packages/NEvo.Orchestrating.md
allowed_paths:
  - docs/packages/NEvo.Web.md
  - docs/packages/NEvo.Ddd.EventSourcing.md
  - docs/packages/NEvo.Orchestrating.EntityFramework.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package docs — NEvo.Web, NEvo.Ddd.EventSourcing, NEvo.Orchestrating.EntityFramework

## Goal

Write the last 3 package docs, completing the full 13-package set.

## Dependencies

`package-docs-messaging-extensions`.

## Implementation constraints

- `NEvo.Web.md`: describe the actual contents (`Client/` folder, `NEvo.Web.Client`
  namespace — HTTP/OAuth/REST client helpers), matching the `architecture-corrections`
  task's fix to `README.md`. Do not describe middleware/routing capability.
- `NEvo.Ddd.EventSourcing.md`: cover `Handling/`, `Deciding/`, `Evolving/` (deciders,
  evolvers, `IEventStore`, `IAggregateRoot`), carry the `experimental` status from
  `docs/architecture/event-sourcing.md`'s front matter, and note the dependency on
  `NEvo.Messaging.Cqrs`/`NEvo.Messaging`.
- `NEvo.Orchestrating.EntityFramework.md`: cover the EF persistence for orchestration
  state (`OrchestratorStateEf`), carry the `experimental` status from
  `docs/architecture/orchestration.md`'s front matter, cross-reference
  `docs/packages/NEvo.Orchestrating.md` as the package it extends, and confirm (per the
  `architecture-corrections` fix) it depends only on `NEvo.Orchestrating`, not
  `NEvo.EntityFramework`.

## Acceptance criteria

- All 3 docs pass `node tools/docs.mjs validate` under the `package` type.
- After this task, `docs/packages/` contains exactly 13 documents.
- Neither experimental package is presented as production-ready.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

Any package documented in a prior task.
