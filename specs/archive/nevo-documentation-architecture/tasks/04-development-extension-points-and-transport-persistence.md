---
id: nevo-documentation-architecture.development-extension-points-and-transport-persistence
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/guides/extending-nevo.md
    - docs/architecture/messaging-pipeline.md
    - docs/templates/maintainer-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/02-maintainer-documentation.md
  optional:
    - docs/packages/NEvo.Orchestrating.md
    - docs/packages/NEvo.Messaging.Authorization.md
allowed_paths:
  - docs/development/extension-points.md
  - docs/development/transport-development.md
  - docs/development/persistence-development.md
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
  - AGENTS.md
  - README.md
---

# Task: Development docs — extension points, transport, persistence

## Goal

Create 3 new maintainer docs consolidating currently-scattered extension guidance:
`extension-points.md` (the `IMessageHandlerFactory` contract and a consolidated
forbidden-approaches list), `transport-development.md` and `persistence-development.md`
(split from `docs/guides/extending-nevo.md`'s maintainer-facing content).

## Implementation constraints

- `extension-points.md`: state the contract a third-party handler-type author must
  implement (what `IMessageHandlerFactory` must return, how it's discovered/registered
  — ground in `messaging-pipeline.md`'s handler-registration section and
  `guides/quick-start.md`'s existing partial coverage, read-only here). Consolidate a
  positive "forbidden or unsafe extension approaches" list from the negative examples
  currently buried in package Limitations sections (e.g. don't rely on
  `PersistentStepExecutor` for real persistence — `NEvo.Orchestrating.md:209-215`;
  don't assume `PermissionName` is enforced — `NEvo.Messaging.Authorization.md:177-180`)
  — read those files for evidence only, do not edit them here.
- `transport-development.md` and `persistence-development.md`: split
  `docs/guides/extending-nevo.md`'s maintainer-facing content (how to add a new
  transport or persistence mechanism to NEvo itself, as distinct from using an existing
  one) into these two files. Do not delete or edit `extending-nevo.md` itself here —
  task `usage-commands-and-events` (area `usage-guides`) owns removing the now-migrated
  content from it.

## Acceptance criteria

- `docs/development/extension-points.md`, `transport-development.md`,
  `persistence-development.md` exist, pass `tools/docs.mjs validate`, and match the
  maintainer-doc template's sections.
- `extension-points.md` states the `IMessageHandlerFactory` contract explicitly and
  lists at least the 2 forbidden-approaches examples cited above (plus any others found
  during the read).

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

Editing `docs/guides/extending-nevo.md` itself (area `usage-guides` owns removing the
migrated content). Any `docs/packages/**` edit.
