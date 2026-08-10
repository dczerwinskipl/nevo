---
id: event-sourcing-api-hardening.update-durable-documentation
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
  - es-command-executor-and-ambiguity-resolution
  - explicit-event-sourced-command-handler
  - primary-fallback-handler-roles
  - event-sourcing-registration-options
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
  - documents-example-es-and-auth-demo
semantic_references:
  dependency_contracts:
    - harden-event-store-and-repository-contracts
    - es-command-executor-and-ambiguity-resolution
    - explicit-event-sourced-command-handler
    - primary-fallback-handler-roles
    - event-sourcing-registration-options
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
    - documents-example-es-and-auth-demo
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/documentation.md
    - specs/active/event-sourcing-api-hardening/overview.md
    - docs/development/event-sourcing.md
    - docs/development/messaging-pipeline.md
  optional:
    - docs/usage/queries.md
    - docs/usage/commands.md
allowed_paths:
  - docs/development/event-sourcing.md
  - docs/development/messaging-pipeline.md
  - docs/usage/**
  - docs/reference/packages/**
forbidden_paths:
  - src/**
  - examples/**
---

# Task: Update durable documentation

## Goal

Rewrite `docs/development/event-sourcing.md` to describe the hardened design, correct
the three stale statements found in `docs/development/messaging-pipeline.md` during
discovery, and document the command-handling levels, Primary/Fallback rules,
registration, authorization model, persistence semantics, and the HTTP Query endpoint —
linking the Documents example as the canonical sample.

## Dependencies

Every functional task in this change (03, 04, 05, 06, 07, 08, 09, 11) — this task
documents their shipped shape and must be sequenced last.

## Implementation constraints

- `docs/development/event-sourcing.md`: rewrite to reflect the post-hardening
  `IEventStreamStore`/`IAggregateRepository` split, the three command-handling levels,
  Primary/Fallback semantics, `AddEventSourcing(options => {...})`, the authorization
  model (message-level static permission, additive handler-specific requirements,
  aggregate-aware policy outside the domain model), and persistence semantics
  (append/flush is not necessarily final transaction commit). Keep or update the
  `status:` front-matter field with a one-line note on why, per
  `areas/documentation.md`'s constraint — do not silently drop `experimental` without
  flagging it.
- `docs/development/messaging-pipeline.md`: correct exactly three items found during
  discovery — (1) remove the non-existent `AuthorizationMiddleware`/
  `AuthorizationHandlerMiddleware` class names, replacing with the real
  `UserContextMiddleware<TId,TRoleDataScope>` (message-level) and
  `ValidatePermissionMiddleware<TId>` (handler-level only); (2) fix `IMessageProcessor`'s
  documented location to `src/NEvo.Messaging/Handling/IMessageProcessor.cs`; (3) remove
  the obsolete `MessageHandlerAdapterBase` reference, replacing with the actual shared
  `MessageHandlerAdapter`. Do not otherwise rewrite this document.
- `docs/usage/queries.md`: update the Query HTTP example to use `MapQueryEndpoint`
  instead of the manually-wired `MapGet` pattern it currently documents.
- Link the Documents example (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/`) as
  the canonical Event Sourcing sample from `docs/development/event-sourcing.md`.

## Acceptance criteria

1. `docs/development/event-sourcing.md` accurately describes every shipped concept from
   this change (inspection, cross-checked against the actual final code).
2. The three specific `messaging-pipeline.md` corrections are made, and nothing else in
   that document is rewritten (inspection).
3. `docs/usage/queries.md` documents `MapQueryEndpoint` as the recommended pattern.
4. `node tools/docs.mjs validate` passes (automated).
5. The Documents example is linked from at least one updated document (inspection).

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task is entirely documentation impact.

## Out of scope

- Any new ADR (none of this change's decisions rise to that level — see `overview.md`).
- Rewriting `messaging-pipeline.md` beyond the three identified corrections.
- `docs/reference/packages/*.md` updates beyond what's strictly needed for accuracy
  (e.g. if `NEvo.Ddd.EventSourcing` doesn't yet have a reference doc, creating one is
  optional/best-effort, not a blocking acceptance criterion).
