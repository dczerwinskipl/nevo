---
id: nevo-documentation-architecture.usage-commands-and-events
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/guides/extending-nevo.md
    - docs/guides/quick-start.md
    - docs/reference/packages/NEvo.Messaging.Cqrs.md
    - docs/templates/guide-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/05-usage-guides.md
  optional:
    - docs/development/extension-points.md
allowed_paths:
  - docs/guides/extending-nevo.md
  - docs/usage/commands.md
  - docs/usage/events.md
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
  - AGENTS.md
  - README.md
---

# Task: Usage guides — commands and events

## Goal

Create `docs/usage/commands.md` and `docs/usage/events.md`, splitting out the
consumer-facing content currently mixed into `quick-start.md` and
`docs/guides/extending-nevo.md` (adding your own command/event handler using existing
extension points), then remove the now-fully-migrated `extending-nevo.md`.

## Implementation constraints

- `commands.md`: dispatching a `Command` via `ICommandDispatcher`, writing a command
  handler — grounded in `NEvo.Messaging.Cqrs.md`'s public surface and any example
  currently in `extending-nevo.md`/`quick-start.md`.
- `events.md`: publishing and handling events, sequential vs. parallel processing
  strategy selection at the consumer level (link to
  `docs/development/failure-semantics.md` for the underlying ordering/failure
  guarantees rather than restating them).
- `extending-nevo.md` should be fully empty of content once this task and task
  `development-extension-points-and-transport-persistence` (which already took the
  maintainer-facing transport/persistence content) have both run — confirm no content
  is silently dropped: everything either moved to `commands.md`/`events.md` here, to
  `transport-development.md`/`persistence-development.md` (already done), or is
  genuinely redundant with content already present elsewhere (state which, if so).
  Remove `docs/guides/extending-nevo.md` once confirmed empty of unmigrated content.

## Acceptance criteria

- `docs/usage/commands.md` and `events.md` exist, pass `tools/docs.mjs validate`, and
  each end in a stated working result.
- `docs/guides/extending-nevo.md` no longer exists.
- No content from `extending-nevo.md` is unaccounted for (each piece is named as
  migrated-to or redundant-with a specific other file).

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

`cross-service-messaging.md`, `inbox-outbox.md`, `authorization.md`,
`troubleshooting.md` (other tasks in this area).
