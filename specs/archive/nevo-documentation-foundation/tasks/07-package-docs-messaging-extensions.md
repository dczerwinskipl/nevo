---
id: nevo-documentation-foundation.package-docs-messaging-extensions
status: draft
change: nevo-documentation-foundation
context:
  required:
    - docs/packages/NEvo.Messaging.md
    - ../../../docs/architecture/package-boundaries.md
allowed_paths:
  - docs/packages/NEvo.Messaging.Cqrs.md
  - docs/packages/NEvo.Messaging.Authorization.md
  - docs/packages/NEvo.Messaging.Web.md
  - docs/packages/NEvo.Messaging.EntityFramework.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package docs — messaging extension packages

## Goal

Write package docs for the 4 packages that extend `NEvo.Messaging`:
`NEvo.Messaging.Cqrs`, `NEvo.Messaging.Authorization`, `NEvo.Messaging.Web`,
`NEvo.Messaging.EntityFramework`.

## Dependencies

`package-docs-core-and-messaging`.

## Implementation constraints

- Each doc cross-references `docs/packages/NEvo.Messaging.md` as the package it extends.
- `NEvo.Messaging.Cqrs.md` must state, with evidence, that only the command side is
  implemented (`Commands/` folder; the `.csproj`'s `<Folder Include="Queries\" />` is an
  empty placeholder with no corresponding code) — do not describe query support as
  present.
- `NEvo.Messaging.Web.md` must document its actual dependency on `NEvo.Messaging.Cqrs`
  (per the `architecture-corrections` task), not the pre-correction "extensions don't
  depend on each other" claim.
- `NEvo.Messaging.EntityFramework.md` covers the EF-based inbox/outbox implementation
  (`EntityFrameworkMessageInbox`, `EntityFrameworkMessageOutbox`) and cross-references
  `docs/architecture/inbox-outbox.md`.

## Acceptance criteria

- All 4 docs pass `node tools/docs.mjs validate` under the `package` type.
- `NEvo.Messaging.Web.md` documents the `NEvo.Messaging.Cqrs` dependency.
- `NEvo.Messaging.Cqrs.md` does not describe query-side support as present or planned.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

`NEvo.Authorization`, `NEvo.EntityFramework` (task `package-docs-auth-and-persistence`).
