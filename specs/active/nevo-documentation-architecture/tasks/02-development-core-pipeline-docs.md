---
id: nevo-documentation-architecture.development-core-pipeline-docs
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/architecture/overview.md
    - docs/architecture/package-boundaries.md
    - docs/architecture/messaging-pipeline.md
    - docs/architecture/processing-model.md
    - docs/architecture/message-context.md
    - docs/templates/maintainer-doc-template.md
    - specs/active/nevo-documentation-architecture/owner-decisions.md
    - specs/active/nevo-documentation-architecture/areas/02-maintainer-documentation.md
  optional:
    - docs/packages/NEvo.Messaging.Cqrs.md
    - docs/packages/NEvo.Web.md
allowed_paths:
  - docs/architecture/overview.md
  - docs/architecture/package-boundaries.md
  - docs/architecture/messaging-pipeline.md
  - docs/architecture/processing-model.md
  - docs/architecture/message-context.md
  - docs/development/architecture-overview.md
  - docs/development/package-boundaries.md
  - docs/development/messaging-pipeline.md
  - docs/development/processing-model.md
  - docs/development/message-context.md
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

# Task: Development docs — core pipeline

## Goal

Migrate `docs/architecture/overview.md`, `package-boundaries.md`, `messaging-pipeline.md`,
`processing-model.md`, `message-context.md` into `docs/development/` (same filenames,
`overview.md` → `architecture-overview.md`), tightened to the maintainer-doc template,
and fix 4 of the 5 D4 inconsistencies that live in this content.

## Implementation constraints

- Migrate via `git mv` where content is unchanged; where content changes, remove the old
  file and write the new one (both are in `allowed_paths`).
- Fix (D4): `overview.md`'s "CQRS commands and queries" claim for `NEvo.Messaging.Cqrs`
  → state query-side is unimplemented (ground in `docs/packages/NEvo.Messaging.Cqrs.md:98-104`,
  read-only reference — do not edit that file here, area `package-reference` owns it).
  `processing-model.md:48`'s `ICommand`/`ICommand<TResult>` reference → correct to the
  real `Command` record type. `overview.md:49-51`'s "In progress" maturity label →
  align with the `experimental` vocabulary used in package front matter. `overview.md:46`'s
  "ASP.NET Core integration" description of `NEvo.Web` → correct to "outbound HTTP
  client library."
- Apply the maintainer-doc template's sections to each file where they add real
  information beyond what's already there; do not force a section that has nothing to
  say — state "not applicable" rather than padding.
- `package-boundaries.md`, `messaging-pipeline.md`, `processing-model.md`,
  `message-context.md` stay as 4 separate files (not merged into one) — each covers a
  distinct, independently-referenced concern; forcing a merge would lose that
  granularity without a stated benefit.

## Acceptance criteria

- `docs/architecture/overview.md`, `package-boundaries.md`, `messaging-pipeline.md`,
  `processing-model.md`, `message-context.md` no longer exist.
- `docs/development/architecture-overview.md`, `package-boundaries.md`,
  `messaging-pipeline.md`, `processing-model.md`, `message-context.md` exist and pass
  `tools/docs.mjs validate`.
- The 4 D4 fixes listed above are each verifiable in the new files.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type development --format json
```

## Out of scope

`transaction-model.md`, `failure-semantics.md`, `extension-points.md`,
`transport-development.md`, `persistence-development.md`, `inbox-outbox.md`,
`event-sourcing.md`, `orchestration.md`, `testing-strategy.md`, `contributing.md`
(other tasks in this area). Editing any `docs/packages/**` file (area
`package-reference`).
