---
id: nevo-documentation-foundation.package-docs-auth-and-persistence
status: draft
change: nevo-documentation-foundation
context:
  required:
    - docs/packages/NEvo.Web.Authorization.md
    - ../../../docs/architecture/package-boundaries.md
    - ../../../docs/architecture/persistence.md
allowed_paths:
  - docs/packages/NEvo.Authorization.md
  - docs/packages/NEvo.EntityFramework.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package docs — NEvo.Authorization and NEvo.EntityFramework

## Goal

Write `docs/packages/NEvo.Authorization.md` and `docs/packages/NEvo.EntityFramework.md`.

## Dependencies

`package-docs-messaging-extensions`.

## Implementation constraints

- `NEvo.Authorization.md`: cover `Roles/`, `Users/`, `Permissions/`, `AuthDataScope` —
  the core auth abstractions consumed by both `NEvo.Messaging.Authorization` and
  `NEvo.Web.Authorization`. Cross-reference both as related packages.
- `NEvo.EntityFramework.md`: cover the background migration service (`Migrations/`) and
  `Telemetry.cs`, cross-referencing `docs/architecture/persistence.md`. Note (per
  discovery evidence) that despite the module map implying otherwise,
  `NEvo.Messaging.EntityFramework` and `NEvo.Orchestrating.EntityFramework` do **not**
  have a `ProjectReference` to this package — state the real relationship (parallel EF
  integrations, not a dependency chain), consistent with the `architecture-corrections`
  task's fix.

## Acceptance criteria

- Both docs pass `node tools/docs.mjs validate` under the `package` type.
- `NEvo.EntityFramework.md` does not claim `NEvo.Messaging.EntityFramework` or
  `NEvo.Orchestrating.EntityFramework` depend on it.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

`NEvo.Web`, `NEvo.Ddd.EventSourcing`, `NEvo.Orchestrating.EntityFramework` (task
`package-docs-web-and-experimental`).
