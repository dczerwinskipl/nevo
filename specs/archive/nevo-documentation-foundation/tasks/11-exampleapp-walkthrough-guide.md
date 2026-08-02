---
id: nevo-documentation-foundation.exampleapp-walkthrough-guide
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../docs/architecture/event-sourcing.md
    - ../../../docs/architecture/messaging-pipeline.md
    - ../../../docs/development/local-setup.md
  optional:
    - docs/packages/NEvo.Ddd.EventSourcing.md
    - docs/packages/NEvo.Messaging.Web.md
allowed_paths:
  - docs/guides/example-app-walkthrough.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: examples/ExampleApp walkthrough guide

## Goal

Write `docs/guides/example-app-walkthrough.md`, an end-to-end guide to
`examples/ExampleApp`'s 5 projects, grounded in D4 (excludes `examples/Gdpr` entirely).

## Dependencies

`package-docs-auth-and-persistence`, `package-docs-web-and-experimental` (needs the full
package set to cross-link accurately).

## Implementation constraints

- Read (do not modify — `examples/**` is a forbidden path for edits, not for reading)
  `examples/ExampleApp/NEvo.ExampleApp.Identity.Api`,
  `.../NEvo.ExampleApp.ServiceA.Api` (event-sourcing demo, `Document` aggregate — already
  confirmed by discovery to match `docs/architecture/event-sourcing.md:80-82`),
  `.../NEvo.ExampleApp.ServiceB.Api` (cross-service external message dispatch demo), and
  the Aspire `Orchestration.AppHost`/`Orchestration.ServiceDefaults` projects.
- Cover: common scenarios (running the full Aspire-orchestrated set, the
  `Document`/event-sourcing flow, the cross-service dispatch flow), edge cases,
  troubleshooting, and expected runtime behavior.
- If a run/setup detail (SQL Server connection, Identity server seeding, Aspire
  dashboard access) cannot be verified from the repository, state it as an open question
  rather than inventing steps — this was flagged as an open question during discovery and
  is not yet resolved.
- Do not reference `examples/Gdpr` anywhere (D4).

## Acceptance criteria

- The guide passes `node tools/docs.mjs validate` under the `guide` type.
- All 5 `examples/ExampleApp` projects are named at least once, each claim citing the
  specific file inspected.
- No mention of `examples/Gdpr`.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type guide --format json
```

## Out of scope

Extension/contribution guides (task `developer-and-extension-guides`).
