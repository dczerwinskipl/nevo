---
id: event-sourcing-api-hardening.internal-event-sourcing-architecture-docs
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
  decisions: [D17, D20, D21, D22, D23, D24, D25, D26]
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
    - specs/active/event-sourcing-api-hardening/areas/internal-documentation.md
    - specs/active/event-sourcing-api-hardening/overview.md
    - docs/development/event-sourcing.md
    - docs/development/messaging-pipeline.md
  optional:
    - docs/development/transaction-model.md
    - docs/development/extension-points.md
allowed_paths:
  - docs/development/event-sourcing.md
  - docs/development/messaging-pipeline.md
  - docs/reference/packages/NEvo.Ddd.EventSourcing.md
forbidden_paths:
  - src/**
  - examples/**
  - docs/usage/**
---

# Task: Internal Event Sourcing architecture documentation

## Goal

Rewrite `docs/development/event-sourcing.md` for NEvo maintainers/contributors —
implementation architecture, not user-facing task guidance (task 11 owns that,
separately) — and correct the three stale statements found in
`docs/development/messaging-pipeline.md` during the original discovery pass.

## Dependencies

Every functional task in this change (02-07, 09-10) — this document describes their
shipped, final shape. Sequenced last alongside task 11.

## Implementation constraints

- `docs/development/event-sourcing.md`: rewrite to cover, for a maintainer audience —
  the Event Sourced command executor's lifecycle and ordering (task 03), convention
  discovery internals and most-specific-wins resolution (task 03), Primary/Fallback
  registration internals (task 05), the `IEventStreamStore`/`IAggregateRepository`
  boundary (task 02), concurrency flow (`AggregateConcurrencyException` **returned**
  via `Either`, never thrown, D13); the authorization ownership split — normal message/
  handler-level checks entirely in `NEvo.Messaging.Authorization`'s pipeline, the
  executor invoking only the **one** aggregate-aware hook, no
  `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` project reference (D25-D26,
  task 07); the explicit `Option<TAggregate>` Some/None semantics shared by the Level 2
  handler (task 04) and the aggregate-aware hook (D24) — `Some` for an existing
  aggregate, `None` for the creation path, never `null`; the append/flush/commit
  storage-contract guarantee, expressed provider-agnostically (D23, not "the executor
  calls EF `SaveChanges`"); the persistence-metadata three-layer distinction — domain
  event payload (`Event : Message`, unchanged), runtime message-processing context
  (`IMessageContext`), and a future provider's own persisted representation, with **no
  envelope type existing in this version** (D20-D22) and an explicit statement that the
  low-level store SPI is not frozen (D22); and the extension points/compatibility
  constraints for future persistence providers and modeling styles (D17 — the exact
  constraint wording from `overview.md` § "Architectural principles," reproduced or
  directly referenced here so a maintainer implementing a future provider or modeling
  style finds it without cross-referencing the spec history). Do not make a maintainer
  reverse-engineer any of this from source or from user-facing documentation.
- Update the `status:` front-matter field from `experimental` with a one-line note on
  why (or keep it `experimental` with a note on what's now hardened vs. still open) —
  do not silently drop the status without explanation; this specification does not ship
  a real persistence provider, so `experimental` may still be the accurate status for
  the persistence layer specifically even though the command-handling/registration/
  authorization API surface is now hardened. State this distinction explicitly rather
  than picking one status for the whole document.
- `docs/development/messaging-pipeline.md`: correct exactly three items found during
  the original discovery pass — (1) remove the non-existent `AuthorizationMiddleware`/
  `AuthorizationHandlerMiddleware` class names, replacing with the real
  `UserContextMiddleware<TId,TRoleDataScope>` (message-level) and
  `ValidatePermissionMiddleware<TId>` (handler-level only); (2) fix `IMessageProcessor`'s
  documented location to `src/NEvo.Messaging/Handling/IMessageProcessor.cs`; (3) remove
  the obsolete `MessageHandlerAdapterBase` reference, replacing with the actual shared
  `MessageHandlerAdapter`. Do not otherwise rewrite this document — these three
  corrections are pre-existing staleness unrelated to this change's own scope, not an
  invitation to a broader edit.

## Acceptance criteria

1. `docs/development/event-sourcing.md` accurately describes the post-hardening
   executor, repository/store split, Primary/Fallback semantics,
   `AddEventSourcing(options => {...})`, and the D17 compatibility constraint
   (inspection, cross-checked against the actual final code).
2. The document does not present a generic multi-modeling-style strategy abstraction as
   implemented — it documents the OO-immutable convention as current, and the D17
   constraint as a documented compatibility property of the *contracts*, not a new
   abstraction (inspection).
3. `docs/development/messaging-pipeline.md`'s three stale statements (identified above)
   are corrected, and nothing else in that document is rewritten (inspection).
4. `node tools/docs.mjs validate` passes (automated).
5. The Documents example (task 10) is referenced as the maintainer-facing reference
   implementation from at least one section (inspection).
6. The document does not describe any persisted Event Envelope type as existing or
   planned "soon" — it states plainly that domain event, runtime context, and future
   persisted representation are three distinct, undesigned-here concerns (inspection,
   per D20-D22).
7. The document states that `NEvo.Ddd.EventSourcing` has no dependency on
   `NEvo.Messaging.Authorization`, and explains why the aggregate-aware hook's
   contract is shaped to avoid needing one (inspection, per D26).
8. The document describes the Level 2 handler's and aggregate-aware hook's current-
   state parameter as explicit `Option<TAggregate>` (`Some`/`None`), never a bare
   `TAggregate` or `null` (inspection, per D24).

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task is entirely documentation impact.

## Out of scope

- Any new ADR (none of this change's decisions rise to that level — see `overview.md`;
  if this task's implementation reveals otherwise, that's a flag to raise, not a
  decision to make unilaterally).
- Rewriting `messaging-pipeline.md` beyond the three identified corrections.
- User-facing task guidance (task 11).
