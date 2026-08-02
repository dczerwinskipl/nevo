---
id: nevo-documentation-foundation.package-doc-web-authorization
status: draft
change: nevo-documentation-foundation
context:
  required:
    - specs/active/nevo-documentation-foundation/areas/03-edge-package-pilot.md
    - ../../../docs/templates/package-doc-template.md
    - ../../../docs/architecture/package-boundaries.md
allowed_paths:
  - docs/packages/NEvo.Web.Authorization.md
  - docs/templates/package-doc-template.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package doc — NEvo.Web.Authorization

## Goal

Write `docs/packages/NEvo.Web.Authorization.md`, the second edge-package pilot doc (D5),
validating the `package` template against a minimal, single-file package.

## Dependencies

`architecture-corrections` (must use the corrected dependency facts — this package's
only real dependency is `NEvo.Authorization`, not `NEvo.Web`).

## Implementation constraints

- Cover: purpose, responsibilities, dependencies (`NEvo.Authorization` only),
  public concepts/APIs (`ServiceCollectionExtensions.cs` — the claims-based auth
  middleware wiring it registers), configuration, basic usage, advanced usage,
  limitations (single-file package — note what it does *not* provide, e.g. no routing
  helpers), related packages (`NEvo.Authorization`, `NEvo.Web` — clarify it does *not*
  depend on `NEvo.Web` despite the name similarity), relevant tests
  (`tests/NEvo.Web.Authorization.Tests/`).
- If this package's minimal shape reveals a template section that's awkward for small
  packages (e.g. "advanced usage" with nothing to say), fix the template
  (`docs/templates/package-doc-template.md`) to mark that section optional rather than
  padding with placeholder text.

## Acceptance criteria

- `docs/packages/NEvo.Web.Authorization.md` passes `node tools/docs.mjs validate` under
  the `package` type.
- The doc explicitly states this package does not depend on `NEvo.Web`.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

`NEvo.Authorization`'s own package doc (task `package-docs-auth-and-persistence`).
