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
  - aggregate-decision-method-parameter-injection
  - current-user-capability-and-documents-integration
  - typed-authorization-failure-and-403-mapping
  - query-either-ergonomics-cleanup
semantic_references:
  decisions: [D13, D17, D20, D21, D22, D23, D24, D25, D26, D29, D30, D34, D35, D36, D37, D38, D39, D42, D43, D44]
  dependency_contracts:
    - harden-event-store-and-repository-contracts
    - es-command-executor-and-ambiguity-resolution
    - explicit-event-sourced-command-handler
    - primary-fallback-handler-roles
    - event-sourcing-registration-options
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
    - documents-example-es-and-auth-demo
    - aggregate-decision-method-parameter-injection
    - current-user-capability-and-documents-integration
    - typed-authorization-failure-and-403-mapping
    - query-either-ergonomics-cleanup
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

Every functional task in this change (02-07, 09-10, 13-16) — this document describes
their shipped, final shape. Sequenced last alongside task 11.

## Implementation constraints

**Write the document as system documentation, not as a record of this change.** Describe
current behavior and contracts directly, grounded in `src/**/*.cs` file:line citations —
never by citing an owner-decision ID (`D<N>`), a task number, or phrases like "this
specification"/"this change"/"after the API-hardening change". A maintainer reading this
document six months from now, with no access to spec history, must be able to fully
understand the contract from the prose and code citations alone. Where a constraint
below names a decision ID for *this task's own traceability* (so the implementer can
find the source of truth in `owner-decisions.md` if the summary here is ambiguous), that
ID is for the implementer, not something to reproduce in the shipped document.

- `docs/development/event-sourcing.md`: rewrite to cover, for a maintainer audience —
  the Event Sourced command executor's lifecycle and ordering, convention discovery
  internals and most-specific-wins resolution, **decision-method parameter injection
  internals** — the `IDecisionMethodParameterResolver` seam, DI-backed per-invocation
  resolution reading the current invocation's scope (not the root/startup container) via
  `IMessageContextAccessor`/`IMessageContext.ServiceProvider` or an equivalent
  mechanism, why it stays inside `AggregateDeciderExtractor`/`AggregateDecider`/
  `AggregateDeciderProvider` rather than the shared executor — state plainly that
  `IAggregateMethodDecider`'s public contract is unchanged by this mechanism, and state
  the supported-use contract distinguishing contextual facts/pure policies (suitable for
  the aggregate-method convention) from orchestration/external I/O (which belongs to the
  explicit `IEventSourcedCommandHandler<...>` instead); the **required-contextual-
  dependency invariant**: a required contextual decision-method dependency must be
  successfully resolved *and validated* during DI resolution/activation, before the
  aggregate decision method is invoked — a dependency that resolves successfully as a
  type but only reports unavailability once the decision method starts running is an
  invocation/application failure, not a parameter-resolution failure; Primary/Fallback
  registration internals, the `IEventStreamStore`/`IAggregateRepository` boundary,
  concurrency flow (`AggregateConcurrencyException` **returned** via `Either`, never
  thrown); the authorization ownership split — normal message/handler-level checks
  entirely in `NEvo.Messaging.Authorization`'s pipeline, the executor invoking only the
  **one** aggregate-aware hook, no `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization`
  project reference; **the current-user/authorization boundary** — `ICurrentUser<TId,
  TUser>` (`NEvo.Messaging.Authorization`) adapts `UserContext<TId, TUser>` internally
  and is resolved into decision methods purely by DI `Type`; its required user is
  obtained and validated during `CurrentUser<TId, TUser>`'s own construction, not lazily
  from the `User` getter — so a missing current user fails while the capability is being
  activated and becomes a decision-method parameter-resolution failure, never a value
  the aggregate must itself check for absence; **the typed authorization-failure/HTTP-
  mapping boundary** — `PermissionDeniedException` (`NEvo.Messaging.Authorization`)
  recognized in `NEvo.Messaging.Web` via its `UnauthorizedAccessException` base type,
  zero new project reference in either direction; the explicit `Option<TAggregate>`
  Some/None semantics shared by the explicit `IEventSourcedCommandHandler<...>` and the
  aggregate-aware hook — `Some` for an existing aggregate, `None` for the creation path,
  never `null`; the append/flush/commit storage-contract guarantee, expressed
  provider-agnostically (not "the executor calls EF `SaveChanges`"); the
  persistence-metadata three-layer distinction — domain event payload (`Event :
  Message`, unchanged), runtime message-processing context (`IMessageContext`), and a
  future provider's own persisted representation, with **no envelope type existing in
  this version** and an explicit statement that the low-level store SPI is not frozen;
  the final query/Either ergonomics helper, `RequireSome` (`NEvo.Core`), replacing
  `EitherExtensions.MapAsync`; and the extension points/compatibility constraints for
  future persistence providers and modeling styles — the exact constraint wording from
  `overview.md` § "Architectural principles," translated into plain contract language (not
  copied verbatim with its decision-ID citations) so a maintainer implementing a future
  provider or modeling style finds the constraint stated as a property of the code, not
  as a historical decision. Do not make a maintainer reverse-engineer any of this from
  source or from user-facing documentation. Use the stable names `the aggregate-method
  convention`, `the explicit IEventSourcedCommandHandler<...>` (or "the explicit Event
  Sourced handler"), and `an ordinary ICommandHandler<T>` throughout — never "Level 1"/
  "Level 2"/"Level 3" (the working names used during this specification's own
  discussions are not the document's vocabulary).
- Document two additional guardrails, both framed as protecting future work from
  requiring a lifecycle rewrite — not as describing a capability that exists today:
  (1) the explicit `NoStream`/`Exact(version)` expected-stream-state concept replacing
  the old bare-`0` create convention, and the read contract's existence-preserving
  guarantee; (2) the separation between the executor's lifecycle-orchestration
  responsibility and the aggregate-method convention's own reflection/state-method-
  discovery responsibility (`AggregateDecider`/`AggregateEvolver`) — the executor
  depends on/invokes `IDecider`/`IEvolver` without itself performing reflection, so a
  future non-reflection-based modeling style could in principle supply its own
  `IDecider`/`IEvolver` implementation without requiring changes to the executor's
  lifecycle code. State plainly that no such alternative modeling style exists today —
  this is a documented compatibility property of the boundary, not an announced
  feature.
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
  `UserContextMiddleware<TId,TUser,TRoleDataScope>` (message-level) and
  `ValidatePermissionMiddleware<TId,TUser>` (handler-level only); (2) fix `IMessageProcessor`'s
  documented location to `src/NEvo.Messaging/Handling/IMessageProcessor.cs`; (3) remove
  the obsolete `MessageHandlerAdapterBase` reference, replacing with the actual shared
  `MessageHandlerAdapter`. Do not otherwise rewrite this document — these three
  corrections are pre-existing staleness unrelated to this change's own scope, not an
  invitation to a broader edit.

## Acceptance criteria

1. `docs/development/event-sourcing.md` accurately describes the post-hardening
   executor, repository/store split, Primary/Fallback semantics,
   `AddEventSourcing(options => {...})`, and the compatibility constraint that no
   modeling style is baked into the hardened contracts as the only possible one
   (inspection, cross-checked against the actual final code).
2. The document does not present a generic multi-modeling-style strategy abstraction as
   implemented — it documents the OO-immutable convention as current, and the
   modeling-style compatibility constraint as a documented property of the *contracts*,
   not a new abstraction (inspection).
3. `docs/development/messaging-pipeline.md`'s three stale statements (identified above)
   are corrected, and nothing else in that document is rewritten (inspection).
4. `node tools/docs.mjs validate` passes (automated).
5. The Documents example is referenced as the maintainer-facing reference
   implementation from at least one section (inspection).
6. The document does not describe any persisted Event Envelope type as existing or
   planned "soon" — it states plainly that domain event, runtime context, and future
   persisted representation are three distinct, undesigned-here concerns (inspection).
7. The document states that `NEvo.Ddd.EventSourcing` has no dependency on
   `NEvo.Messaging.Authorization`, and explains why the aggregate-aware hook's
   contract is shaped to avoid needing one (inspection).
8. The document describes the explicit `IEventSourcedCommandHandler<...>`'s and the
   aggregate-aware hook's current-state parameter as explicit `Option<TAggregate>`
   (`Some`/`None`), never a bare `TAggregate` or `null` (inspection).
9. The document describes the `NoStream`/`Exact(version)` expected-stream-state concept
   and the existence-preserving read contract, replacing the old magic-`0` description
   (inspection).
10. The document describes the executor/convention separation — lifecycle orchestration
    in the executor vs. reflection/discovery in `AggregateDecider`/`AggregateEvolver` —
    and states plainly that no alternative (non-reflection-based) modeling style exists
    today, framing the separation as a compatibility property rather than an announced
    feature (inspection).
11. The document states `ICurrentUser<TId, TUser>`'s actual generic shape (`TUser User`,
    never `User<TId>`) and the required-contextual-dependency invariant plainly: a
    required decision-method dependency must be resolved *and validated* during DI
    resolution/activation, before the decision method runs — for `ICurrentUser<TId,
    TUser>` this means `CurrentUser<TId, TUser>` validates user availability during its
    own construction, not lazily from the `User` getter, so a missing current user
    becomes a decision-method parameter-resolution failure and the aggregate is never
    invoked (inspection).
12. Neither `docs/development/event-sourcing.md` nor
    `docs/reference/packages/NEvo.Ddd.EventSourcing.md` cites an owner-decision ID
    (`D<N>`), a task number, or frames content as being about "this specification"/
    "this change"/"the API-hardening change" — a search for `D[0-9]`, `this
    specification`, `this change`, and `specs/active`/`specs/archive` paths in either
    file returns nothing beyond a single, clearly-labeled pointer to the active
    specification's location for someone who wants the historical record, if any such
    pointer exists at all (inspection). Neither document uses "Level 1"/"Level 2"/
    "Level 3" — both use the stable names `the aggregate-method convention`, `the
    explicit IEventSourcedCommandHandler<...>`, and `an ordinary ICommandHandler<T>`
    (inspection).

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
