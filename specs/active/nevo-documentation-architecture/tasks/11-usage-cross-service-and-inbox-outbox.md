---
id: nevo-documentation-architecture.usage-cross-service-and-inbox-outbox
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/guides/example-app-walkthrough.md
    - docs/development/inbox-outbox.md
    - docs/development/failure-semantics.md
    - docs/reference/packages/NEvo.Messaging.EntityFramework.md
    - docs/templates/guide-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/05-usage-guides.md
  optional: []
allowed_paths:
  - docs/usage/cross-service-messaging.md
  - docs/usage/inbox-outbox.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/reference/packages/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - docs/guides/example-app-walkthrough.md
  - AGENTS.md
  - README.md
---

# Task: Usage guides — cross-service messaging and inbox/outbox

## Goal

Create `docs/usage/cross-service-messaging.md` (generalized from the example app's
Scenario 4) and `docs/usage/inbox-outbox.md` (task-oriented: enabling idempotent
processing and transactional publish in a consumer's own handler).

## Implementation constraints

- `cross-service-messaging.md`: read `example-app-walkthrough.md`'s Scenario 4 for
  evidence only (do not edit that file — task
  `usage-example-app-walkthrough-migration` owns it); generalize the pattern so it
  isn't tied to `ServiceA`/`ServiceB` specifically.
- `inbox-outbox.md`: cover the manual outbox DI-wiring step called out as a gap in
  `NEvo.Messaging.EntityFramework.md:100-105` (no `AddEntityFrameworkOutbox<TDbContext>()`
  helper exists) explicitly, rather than presenting wiring as simpler than it is. Link
  to `docs/development/inbox-outbox.md` and `failure-semantics.md` for the underlying
  mechanism and outbox-partition-assignment caveat rather than restating them.

## Acceptance criteria

- `docs/usage/cross-service-messaging.md` and `inbox-outbox.md` exist, pass
  `tools/docs.mjs validate`, and each end in a stated working result.
- `inbox-outbox.md` explicitly documents the manual outbox DI-wiring step.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

`authorization.md`, `troubleshooting.md` (task `usage-authorization-and-troubleshooting`).
`docs/usage/example-app-walkthrough.md` migration itself (separate task).
