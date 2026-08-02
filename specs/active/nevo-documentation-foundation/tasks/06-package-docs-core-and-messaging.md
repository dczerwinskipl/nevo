---
id: nevo-documentation-foundation.package-docs-core-and-messaging
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../docs/templates/package-doc-template.md
    - ../../../docs/architecture/messaging-pipeline.md
    - ../../../docs/architecture/message-context.md
    - ../../../docs/architecture/inbox-outbox.md
    - ../../../docs/architecture/package-boundaries.md
  optional:
    - docs/packages/NEvo.Orchestrating.md
    - docs/packages/NEvo.Web.Authorization.md
allowed_paths:
  - docs/packages/NEvo.Core.md
  - docs/packages/NEvo.Messaging.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Package docs — NEvo.Core and NEvo.Messaging

## Goal

Write `docs/packages/NEvo.Core.md` and `docs/packages/NEvo.Messaging.md`, applying the
template validated by the edge-package pilot.

## Dependencies

`package-doc-orchestrating`, `package-doc-web-authorization` (template must be validated
first).

## Implementation constraints

- `NEvo.Core.md`: cover the functional/middleware primitives (`IMiddleware`,
  `IMiddlewareHandler`, `MiddlewareHandler`, `Check`, `EitherExtensions`, `UnitExt`) and
  the `Either<Exception, T>` pattern's role as a repository-wide convention. State
  explicitly that this package has no dependencies of its own (the root of the
  dependency graph per `package-boundaries.md` rule 2).
- `NEvo.Messaging.md`: cover the message pipeline, context, dispatch/publish strategies,
  and inbox/outbox abstractions at the *package* level (purpose/usage), cross-referencing
  the existing deep-dive architecture docs (`messaging-pipeline.md`, `message-context.md`,
  `inbox-outbox.md`) rather than duplicating their content.

## Acceptance criteria

- Both docs pass `node tools/docs.mjs validate` under the `package` type.
- `NEvo.Messaging.md` cross-references all 3 existing messaging architecture docs by id.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Out of scope

The 4 `NEvo.Messaging.*` extension packages (task `package-docs-messaging-extensions`).
