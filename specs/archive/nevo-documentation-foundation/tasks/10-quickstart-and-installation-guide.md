---
id: nevo-documentation-foundation.quickstart-and-installation-guide
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../docs/development/local-setup.md
    - docs/packages/NEvo.Core.md
    - docs/packages/NEvo.Messaging.md
  optional:
    - ../../../docs/templates/guide-doc-template.md
allowed_paths:
  - docs/guides/quick-start.md
  - docs/guides/installation.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Quick-start and installation guides

## Goal

Write `docs/guides/quick-start.md` and `docs/guides/installation.md` — the minimal path
from "nothing installed" to "a working NEvo-based service."

## Dependencies

`package-docs-core-and-messaging`.

## Implementation constraints

- Do not duplicate `docs/development/local-setup.md`'s prerequisites/build/test content —
  cross-link it instead. This guide is consumer-facing (using NEvo in a new project);
  `local-setup.md` is contributor-facing (working on NEvo itself). State that distinction
  explicitly if the two could otherwise be confused.
- Base the minimal working setup on `NEvo.Core` and `NEvo.Messaging` (the packages every
  consumer starts from, per `README.md`'s own "start with minimal infrastructure...add
  CQRS/messaging as your system grows" framing).
- If a claim about installing/referencing NEvo packages (e.g. NuGet feed, package IDs)
  cannot be verified from the repository (no `.nuspec`/publish config was found during
  discovery), state it as an open question rather than inventing a plausible-sounding
  package source.

## Acceptance criteria

- Both guides pass `node tools/docs.mjs validate` under the `guide` type.
- Every setup step is either sourced from `docs/development/local-setup.md` (cross-linked,
  not duplicated) or independently verified against repository evidence.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type guide --format json
```

## Out of scope

The `examples/ExampleApp` walkthrough (task `exampleapp-walkthrough-guide`).
