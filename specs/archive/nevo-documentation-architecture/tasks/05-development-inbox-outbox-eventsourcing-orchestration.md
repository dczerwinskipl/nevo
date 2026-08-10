---
id: nevo-documentation-architecture.development-inbox-outbox-eventsourcing-orchestration
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/architecture/inbox-outbox.md
    - docs/architecture/event-sourcing.md
    - docs/architecture/orchestration.md
    - docs/templates/maintainer-doc-template.md
    - specs/active/nevo-documentation-architecture/owner-decisions.md
    - specs/active/nevo-documentation-architecture/areas/02-maintainer-documentation.md
  optional:
    - docs/packages/NEvo.Orchestrating.EntityFramework.md
allowed_paths:
  - docs/architecture/inbox-outbox.md
  - docs/architecture/event-sourcing.md
  - docs/architecture/orchestration.md
  - docs/development/inbox-outbox.md
  - docs/development/event-sourcing.md
  - docs/development/orchestration.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/guides/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Development docs — inbox/outbox, event sourcing, orchestration

## Goal

Migrate `docs/architecture/inbox-outbox.md`, `event-sourcing.md`, `orchestration.md`
into `docs/development/` (same filenames), tightened to the maintainer-doc template,
and fix the orchestration-persistence D4 inconsistency.

## Implementation constraints

- Migrate via `git mv` where content is unchanged; remove/rewrite where content changes.
- Fix (D4): `orchestration.md:98-101`'s claim that `IOrchestratorStateRepository` is
  implemented "using Entity Framework Core / SQL Server" → correct to state no
  implementation exists anywhere in the repository (ground in
  `docs/packages/NEvo.Orchestrating.EntityFramework.md:92-99`, read-only reference —
  that file itself is owned by area `package-reference`).
- Preserve the `experimental` status marking for `event-sourcing.md` and
  `orchestration.md` — do not present either as more stable than the code supports.
- `inbox-outbox.md` here is the maintainer-level doc (idempotency/outbox mechanism
  internals); it is distinct from the consumer-level `docs/usage/inbox-outbox.md` that
  task `usage-cross-service-and-inbox-outbox` creates separately — do not merge them.

## Acceptance criteria

- `docs/architecture/inbox-outbox.md`, `event-sourcing.md`, `orchestration.md` no
  longer exist.
- `docs/development/inbox-outbox.md`, `event-sourcing.md`, `orchestration.md` exist,
  pass `tools/docs.mjs validate`, and both experimental docs keep `status: experimental`.
- `orchestration.md`'s persistence claim is corrected.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

The consumer-level `docs/usage/inbox-outbox.md` (area `usage-guides`). Editing
`docs/packages/NEvo.Orchestrating.EntityFramework.md` (area `package-reference`).
