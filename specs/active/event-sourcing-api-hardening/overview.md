---
id: spec.event-sourcing-api-hardening
type: change
title: Event Sourcing API hardening and persistence readiness
status: draft
change: event-sourcing-api-hardening
---

# Event Sourcing API hardening and persistence readiness

**Refined three times.** 2026-08-10 against owner comments and an external review
(`nevo-event-sourcing-spec-refinement-prompt.md`, PR #20): fixed factual errors in the
original discovery, reduced incidental scope (folder reorganization,
`ICreateAggregateCommand` wiring), resolved the Query GET-binding question
empirically, and split documentation into first-class user-facing and internal
deliverables. **2026-08-11, final narrow refinement** before spec review/approval
(`nevo-event-sourcing-final-spec-refinement.md`): removed stale "branch does not
build" history now that the branch has a green baseline; replaced the "minimum event
envelope" framing with an explicit three-layer distinction (domain event / runtime
message context / future persisted representation) so this change does not design a
persistence envelope it doesn't need yet; sharpened append/flush/commit semantics into
a storage-contract guarantee; closed the remaining authorization-ownership ambiguity
(normal permission checks stay in the messaging pipeline, the Event Sourcing executor
owns only the aggregate-aware hook) and confirmed no new `NEvo.Ddd.EventSourcing` →
`NEvo.Messaging.Authorization` dependency is introduced; defined explicit Some/None
create-vs-existing semantics for the Level 2 handler and aggregate-aware authorization;
removed the manual ExampleApp concurrency-race requirement in favor of deterministic
core tests; and removed a testing-strategy mismatch that would have required new
integration-test infrastructure this repository doesn't have and the owner does not
want introduced here. **2026-08-11, narrow reference-pattern refinement** before spec
review/approval (`nevo-event-sourcing-reference-patterns-final-refine.md`): compared
the hardened design against mature .NET Event Sourcing frameworks (Eventuous, Marten/
Wolverine, Equinox) for architectural inspiration only — no dependency on or
integration with any of them is introduced — and added three cheap compatibility
guardrails so this hardening work does not create contradictions for a future
persistence/modeling specification: an explicit `NoStream`/`Exact(version)`
expected-stream-state concept replacing the magic `expectedVersion = 0` convention,
with no `Any`/`IgnoreVersion` mode and no automatic retry/rebase (D29); an explicit
separation between the shared executor's lifecycle-orchestration responsibility and
the aggregate-method convention's own reflection/state-method-discovery responsibility
(D30); and a stated single-write-target boundary for the Level 2 handler, with
multi-aggregate orchestration left to Level 3 or a future saga/process-manager
capability (D31). None of D19-D28 were reopened. See `owner-decisions.md` (D15-D31)
for the specific decisions; superseded entries (D10, D11) are kept, clearly marked,
for audit trail.

## Context

NEvo has an Event Sourcing model (`NEvo.Ddd.EventSourcing`,
`docs/development/event-sourcing.md`) on branch `feature/event-sourcing-api-hardening`
(created off `feature/event-sourcing`/PR #10, `main` already merged in) that already
provides an attractive developer experience: commands discovered on concrete
aggregate-state types, event replay/evolution, and hidden load→decide→append plumbing.
Before real persistence providers, projections, checkpoints, or stronger inbox/outbox
integration are built on top of it, this change hardens the current API — command-
handling levels, handler registration semantics, authorization integration, the Event
Store/repository boundary, and the HTTP Query endpoint surface — so the next
persistence specification does not need to redesign public aggregate/command APIs
again.

This is deliberately a middle step, not a production-grade Event Sourcing stack. The
recently added Query support and handler-registration hardening
(`specs/archive/query-support-and-handler-registration-hardening/`, merged to `main`)
must be preserved and integrated with this work, not replaced.

`dotnet build NEvo.sln` currently succeeds and `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` currently passes (10/10) — this is this
specification's baseline and regression condition, not a target any task needs to
reach. (A compile failure existed transiently during spec discovery and was fixed by
an external commit before any task in this change started; that history lives in git,
not in this document — see `owner-decisions.md` D19 if the "why" is ever needed.)

## Current architecture

Grounded in repository discovery (file:line citations; four parallel read-only research
passes, and three spec-refine re-verification passes that corrected several factual
errors and closed open design questions with empirical evidence or explicit owner
direction):

**Aggregate model & decision dispatch.** Aggregate state is already multiple concrete
types (`Document` → `EditableDocument`/`ApprovedDocument`,
`tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs:5,30,55`).
`AggregateEvolver.Evolve` (`Evolving/AggregateEvolver.cs:30-39`) is already pure `State +
Event -> NewState` with no I/O/DI. Decider/evolver method resolution is reflection-based,
matched by signature shape (`AggregateDeciderExtractor.cs:36-51`), not attributes. **Gap:**
both `AggregateDecider.GetDeciderDelegate` (`Deciding/AggregateDecider.cs:25-35`) and
`AggregateEvolver.GetEvolverDelegate` (`Evolving/AggregateEvolver.cs:41-55`) filter
candidates by `IsAssignableFrom` and take LanguageExt `.ToOption()`'s first match — no
specificity ranking, no ambiguity detection. `ICreateAggregateCommand<TAggregate,TId>`
(`ICreateAggregateCommand.cs:3-6`) is declared but never referenced in production code —
create-vs-mutate is inferred purely from `Option<TAggregate>` being `None`/`Some`.
**This specification does not change that (D16)** — the marker interface remains
untouched. `DeciderCommandHandler.HandleAsync`
(`Handling/DeciderCommandHandler.cs:14-34`) already handles both paths explicitly today:
`Option<TAggregate>.None` (creation) and `Option<TAggregate>.Some` (mutation) — this
existing Some/None model is preserved and extended to the explicit Level 2 handler and
to aggregate-aware authorization (D24, D25 — see "Architectural principles" below).

**Persistence boundary.** `IAggregateRepository` (`IAggregateRepository.cs:5-18`) already
mixes stream append/load, aggregate rehydration, **and** `LoadProjectionAsync` (the real
implementation throws `NotImplementedException`, lines 72-75). `IEventStore` is the
lower-level stream abstraction; only implementation is in-memory `FakeEventStore`.
`IAggregateRepository.AppendEventsAsync`/`IEventStore.AppendEventsAsync` already return
`EitherAsync<Exception, Unit>` (`IAggregateRepository.cs:7,22`) — an expected-version
mismatch already flows through `Either`'s `Left`, **never a thrown CLR exception**:
`FakeEventStore.AppendEventsAsync` (`ServiceCollectionExtensions.cs:20-22`) already
demonstrates this — `return new Exception(...)`, a plain `return`, not a `throw`. This
specification's hardening changes only the exception *type* used (a dedicated
`AggregateConcurrencyException`), never the return-vs-throw shape (D13).

Domain events (`DocumentApproved` and similar) already derive from `Event : Message`
and carry `Id`/`CreatedAt`; stream version is already tracked out-of-band as a plain
`int` parameter/return value, not a field on the event. This specification keeps that
shape exactly as-is — see "Architectural principles" § persistence-metadata layering
for why no envelope/correlation/causation additions are made here.

`AddEventSourcing(params Type[])` (`ServiceCollectionExtensions.cs:39-61`) wires the
convention path unconditionally, with no options object (`// TODO: add provider?` at
line 56), and registers `IMessageHandlerProvider` with plain `AddSingleton`, not `TryAdd`
— unlike `AddCommands`/`AddEvents`/`AddQueries` after the recent query-support hardening.

**Handler registration / authorization.** `MessageHandlerDescription`
(`NEvo.Messaging/Handling/IMessageHandler.cs:8`) has no role/kind/priority field.
Duplicate detection is a pure `MessageType`-keyed count in `MessageHandlerRegistry` — a
decider-based ES handler and a plain `ICommandHandler<TCommand>` registered for the same
command **already collide and throw `MoreThanOneHandlerFoundException`** today, with no
way to prefer one. `ValidatePermissionMiddleware` reads `[AllowPermission]`
**exclusively from `HandlerDescription.Method`**
(`NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:17`), which is
method-targeted only; `DeciderCommandHandlerProvider` leaves `Method` `null` — so **an ES
convention-routed command today receives zero permission enforcement**, silently. No
message-level permission attribute placement, no requirement composition, and no
aggregate/resource-aware authorization extension point exist anywhere today. Fixing this
is entirely a messaging-pipeline concern (`ValidatePermissionMiddleware` plus a new
message-level attribute placement) — see "Architectural principles" § authorization
ownership for the exact split between the pipeline and the Event Sourcing executor.

`NEvo.Ddd.EventSourcing` depends on `NEvo.Messaging.Cqrs` only
(`docs/development/package-boundaries.md`); it has **no** dependency on
`NEvo.Messaging.Authorization` today, and this specification does not add one (D26) —
`ValidatePermissionMiddleware`/`AllowPermissionAttribute`/`IDataScopeMessageValidator`
all stay in `NEvo.Messaging.Authorization`, a lateral sibling package Event Sourcing
does not reference (`package-boundaries.md`: extension packages depend on
`NEvo.Messaging` but not on each other, except the one documented `NEvo.Messaging.Web`
exception).

**Flush/visibility semantics.** Synchronous dispatch re-enters
`IMessageProcessor.ProcessMessageAsync` under the same ambient `TransactionScope`
opened by `TransactionScopeMessageProcessingMiddleware`
(`InternalSyncProcessDispatchStrategy.cs:8-9`). `DbContext.SaveChangesAsync()` is
already the repository's established flush mechanism for exactly this purpose —
`EntityFrameworkMessageInbox.RegisterProcessedAsync`/
`EntityFrameworkMessageOutbox.SaveMessageAsync` (`src/NEvo.Messaging.EntityFramework/`)
already call it inline, enlisting in the ambient `TransactionScope` without committing
it (`docs/development/transaction-model.md` § "Transaction ownership": "Whether a
handler calls `SaveChangesAsync()` on its own `DbContext` is entirely up to that
handler's implementation; NEvo does not impose or coordinate a single save point").
This specification expresses the resulting requirement as a storage-contract ordering
guarantee, not as "the executor calls EF `SaveChanges`" — see "Architectural
principles" § append/flush/commit below.

**HTTP/Query.** `MapCommandEndpoint<TCommand>` (`RoutesExtensions.cs:46-65`) returns
`RouteHandlerBuilder`, binds via implicit body, uniformly maps `Left` → `Results.Problem(
..., 500)`, and contains two leftover `Console.WriteLine` calls (lines 54-55) alongside
the `ILogger<T>` convention used elsewhere. `Query<TResult> : Message<TResult>` carries
only inherited `Id`/`CreatedAt`. TFM is `net9.0` repo-wide
(`Directory.Build.props:3`); `[AsParameters]`/`BindAsync`/`IBindableFromHttpContext` are
available but unused anywhere today. `[AsParameters]` binds a concrete Query record's
own single public constructor only; inherited `Message` properties are never part of
that constructor and are never bound or required — verified empirically (D18). **No
`Query<TResult>`/`Message<TResult>` contract change is needed.** `GetDocumentQuery` is
hand-wired via `IQueryDispatcher` in `Routes.cs:20-27` and branches
`DocumentNotFoundException` → 404 — a distinction a generic `MapQueryEndpoint` will not
reproduce by default. This repository has no `WebApplicationFactory`-based or other
ASP.NET integration-test infrastructure today, and `tests/NEvo.Messaging.Cqrs.Tests`
does not reference `NEvo.Messaging.Web` — this specification does not introduce either
(D27).

**ExampleApp.** The Document example lives inside `ServiceA.Api` but its types are
declared in namespace `NEvo.Ddd.EventSourcing.Tests.Mocks`
(`ExampleDomain/Documents/Document.cs:3`) — the example currently depends on
test-fixture-shaped code rather than owning its own domain namespace. Only two states
exist (`EditableDocument`/`ApprovedDocument`, no `ReturnedDocument`). No permission
metadata and no tests exist on any Document command/handler/query.

## Problem

The current Event Sourcing implementation cannot safely host a real persistence
provider yet: handler registration cannot distinguish an intentional convention
fallback from an accidental duplicate handler; authorization silently does not run for
the convention route; the repository mixes stream persistence with rehydration and
(unfinished) projection loading; there is no options surface to disable the convention
route; there is no ergonomic HTTP Query mapping to match the existing Command mapping;
and the current documentation neither reflects the hardened design nor gives a NEvo
user a task-oriented path to using Event Sourcing without reading framework source.

## Constraints

- `docs/development/package-boundaries.md`: dependencies flow downward only.
  `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Cqrs` is unchanged by this specification
  (D15). No new `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` dependency is
  introduced (D26).
- `docs/development/coding-conventions.md`: `Either<Exception, T>` for fallible
  operations — a concurrency conflict is always **returned**, never thrown (D13); `TryAdd*`/
  `TryAddEnumerable` for idempotent DI registration, matching the precedent already set
  by the archived query-support change.
- `docs/development/testing-strategy.md`: characterization tests before changing existing
  behavior (task 01 is a hard prerequisite for every other task). Behavior that can be
  unit/component tested at package level is tested there; this change does not
  introduce new integration/e2e test infrastructure (D27).
- `docs/development/event-sourcing.md`: this change treats it as the thing being
  hardened, not as an established pattern to propagate elsewhere.
- No production PostgreSQL/Marten/Kurrent provider, no persisted projections, no
  subscription/checkpoint machinery, no snapshotting, no event upcasting, no distributed
  transaction coordination, no inbox/outbox redesign, no new permission DSL, no universal
  HTTP error-mapping framework, no folder/namespace reorganization, no speculative
  multi-modeling-style abstraction, no persisted Event Envelope type, no
  `Any`/`IgnoreVersion` expected-stream-state mode, no automatic retry/rebase after a
  concurrency conflict, no decision-strategy/plugin hierarchy, no multi-aggregate atomic
  writes, no dependency on or integration with Eventuous/Marten/Wolverine/Equinox — see
  "Out of scope".

## Affected modules

- `src/NEvo.Ddd.EventSourcing/` (hardened repository/store contracts; shared ES
  executor; explicit handler with Some/None semantics; Primary/Fallback registration;
  options; the aggregate-aware authorization extension-point contract — **no folder
  reorganization**, D15, and **no new dependency on `NEvo.Messaging.Authorization`**,
  D26)
- `src/NEvo.Messaging.Authorization/` (fix `ValidatePermissionMiddleware`'s
  `HandlerDescription.Method`-only assumption; message-level permission attribute
  placement; requirement composition — all normal/static permission enforcement stays
  here, not in the ES executor, D25)
- `src/NEvo.Messaging.Web/` (`MapQueryEndpoint`, `RoutesExtensions` cleanup)
- `src/NEvo.Messaging/Handling/` (`MessageHandlerDescription` role metadata, if the
  chosen design requires a field there rather than a wrapping concept — task 05
  determines the smallest coherent change)
- `examples/ExampleApp/NEvo.ExampleApp.Documents.Api/` (new project)
- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/` (Document domain removed)
- `tests/NEvo.Ddd.EventSourcing.Tests/` (characterization + new coverage), possibly a
  new small `tests/NEvo.Messaging.Authorization.Tests/` (D25 — none exists today; the
  package has zero dedicated tests)
- `docs/usage/event-sourcing.md` (**new** — first-class user-facing guide, task 11),
  `docs/usage/README.md`, `docs/usage/queries.md`, `docs/usage/choosing-packages.md`,
  `docs/usage/example-app-walkthrough.md`
- `docs/development/event-sourcing.md` (internal architecture rewrite, task 12),
  `docs/development/messaging-pipeline.md` (also has pre-existing stale content found
  during discovery — see task 12)

## Options and trade-offs

The command-handling model, registration semantics, persistence boundary,
authorization integration, and HTTP mapping approach are owner-supplied direction
(D1-D9, `owner-decisions.md`) from the originating specification brief. Genuine options
were presented and resolved interactively across three refinement passes for gaps the
brief left open — package-dependency handling (D10→D15), the unused
`ICreateAggregateCommand` marker (D11→D16), the example service's test strategy (D12),
the concurrency-conflict error shape (D13), branch targeting (D14), Query GET binding
(D18), and, in the second, final-narrow pass, persistence-metadata layering (D20-D22), the
append/flush/commit storage contract (D23), authorization ownership (D25-D26), Level
2/aggregate-aware Some/None semantics (D24-D25), ExampleApp concurrency verification
(D28), test-infrastructure scope (D27), and, in the narrow reference-pattern pass,
explicit expected-stream-state semantics (D29), the executor/convention responsibility
separation (D30), and the Level 2 single-write-target boundary (D31). See
`owner-decisions.md` for full details on each.

## Owner decisions

See `owner-decisions.md` (D1-D31; D10 and D11 are superseded by D15 and D16
respectively — kept for audit trail, not deleted).

## Proposed architecture

1. **Characterize the baseline.** Task 01 (`characterize-event-sourcing-baseline`)
   writes characterization tests for today's decider/evolver/repository/registration
   behavior, against the branch's current green build — no folder reorganization and no
   `ICreateAggregateCommand` wiring follow it (D15, D16).
2. **Persistence boundary.** Task 02 separates stream persistence
   (`IEventStreamStore`) from aggregate rehydration (`IAggregateRepository`, projection
   loading removed) and introduces a dedicated `AggregateConcurrencyException`
   **returned** via `Either` (D13). It does **not** design a persisted event envelope,
   add correlation/causation fields, or add any storage-metadata type — the domain
   event payload, runtime message-processing context, and a future provider's own
   persisted representation are kept as three distinct, undesigned-here concerns
   (D20-D22). It documents the transaction/commit-ownership constraint (D6, D7) and the
   modeling-style-agnostic compatibility constraint (D17). It also replaces the magic
   `expectedVersion = 0` create convention with an explicit `NoStream`/`Exact(version)`
   expected-stream-state concept — no `Any`/`IgnoreVersion` mode, no automatic
   retry/rebase — and fixes `FakeEventStore`'s read-creates-a-stream side effect so a
   missing stream stays observably missing (D29).
3. **Shared ES execution + explicit handler.** Task 03 extracts the shared
   load→decide→append→publish executor with the full ordering semantics (D1, D2, D7)
   and the deterministic most-specific-state-wins resolution (D2), agnostic to
   aggregate modeling style (D17). The executor owns **only** the aggregate-aware
   authorization hook after rehydration/before decision — normal message-level and
   handler-level permission checks already ran upstream in the messaging pipeline
   before the executor is ever invoked (D25 — see "Architectural principles" §
   authorization ownership). The executor maps `Option<TAggregate>.None` to `NoStream`
   and loaded `Option<TAggregate>.Some` to `Exact(loaded.Version)` (D29), and its own
   class stays free of reflection/state-method-discovery logic — that responsibility
   stays with `AggregateDecider`/`AggregateEvolver`, the aggregate-method convention's
   own concern, not something the executor performs itself (D30). Task 04 adds the
   explicit `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` (Level 2, D1),
   receiving the current state as an explicit `Option<TAggregate>` (`Some` = existing
   aggregate, `None` = creation path, D24), reusing task 03's executor and Level 1's own
   decision-method discovery, and managing exactly one Event Sourced write target per
   command — multi-aggregate orchestration belongs to Level 3 or a future
   saga/process-manager capability, not this handler (D31).
4. **Registration semantics.** Task 05 adds Primary/Fallback role metadata and the
   configuration-error rules (D3), with explicit regression coverage proving Query
   resolution and Event fan-out are unaffected (review issue 6). Task 06 adds
   `AddEventSourcing(options => {...})` with the aggregate-method-convention-as-fallback
   toggle, enabled by default (D4), and fixes the non-idempotent `AddSingleton`
   registration found in discovery.
5. **Authorization.** Task 07 has two distinct parts, both in
   `NEvo.Messaging.Authorization` and `NEvo.Ddd.EventSourcing` respectively, never
   crossing the package boundary between them (D26): (a) fix
   `ValidatePermissionMiddleware`'s `HandlerDescription.Method`-only assumption for the
   ES fallback route, and add message-level permission-attribute placement with AND
   composition against handler-specific requirements — entirely in the messaging
   pipeline, before the executor runs (D25); (b) add the aggregate-aware authorization
   extension point (conceptually `IAggregateAuthorization<TCommand, TAggregate>`),
   invoked by task 03's executor after rehydration, receiving the same explicit
   `Option<TAggregate>` semantics as the Level 2 handler (D24-D25).
6. **HTTP Query mapping.** Task 08 adds `MapQueryEndpoint<TQuery, TResult>` using
   `[AsParameters]` — resolved concretely (D18) — and cleans up the leftover
   `Console.WriteLine` calls found in `RoutesExtensions` (D8). Verification is
   build/compile plus manual walkthrough; this task does not introduce a new
   `WebApplicationFactory`-based integration-test project (D27).
7. **Documents example service.** Task 09 creates `NEvo.ExampleApp.Documents.Api`,
   moves the Document domain into its own namespace, and removes
   `InMemoryDocumentEventStore`. Task 10 wires Level 1 + Level 2 handling, permission
   metadata, aggregate-aware authorization, and both HTTP mappings into the new
   service, verified manually (D9, D12) — the walkthrough demonstrates the CRUD +
   query flow; deterministic optimistic-concurrency coverage lives in Event Sourcing
   core tests (task 02/03), not as a manufactured concurrent-HTTP race in the example
   (D28).
8. **Documentation — two first-class deliverables.** Task 11 writes
   `docs/usage/event-sourcing.md`, a comprehensive user-facing guide (per the existing
   `docs/usage/*.md` flat-file convention) covering configuration, modeling, all three
   command-handling levels with explicit "when to use each" guidance, authorization,
   persistence/concurrency — using the domain-event/runtime-context/future-provider
   three-layer framing, not a persisted-envelope framing — and the Query/read side.
   Task 12 rewrites `docs/development/event-sourcing.md` for maintainers, covering the
   same three-layer distinction plus Some/None semantics and the authorization
   ownership split, and corrects the three stale `messaging-pipeline.md` statements
   found during discovery.

## Architectural principles

**Aggregate modeling style is a supported default, not the Event Sourcing core's
permanent definition (D17).** The currently implemented style — object-oriented,
immutable aggregate state, decision methods discovered on concrete state types — is the
one this specification hardens and documents. It is not, however, baked into the
hardened contracts as the *only* possible future style: `IEventStreamStore`/
`IAggregateRepository` (task 02) and the shared executor (task 03) are designed so
nothing in their public shape requires the caller's next state to come from an instance
method on an immutable object. This is a **documented compatibility constraint**, not a
new abstraction — no `IDecisionStrategy`/`IMutableAggregateStrategy`/
`IFunctionalDeciderStrategy` hierarchy is introduced in this change.

**Persistence-metadata layering — no envelope is designed now (D20-D22).** Three
concerns are distinct and must not be conflated:

1. *Domain event / runtime event message* — e.g. `DocumentApproved`. Inherits from
   `Event : Message` exactly as today (`Id`/`CreatedAt`). This specification does not
   redesign that inheritance hierarchy, does not call it a "persisted Event Envelope,"
   and does not add storage revision, provider-specific serialization metadata, or
   global log position to it. Aggregate evolution continues to consume the domain event
   itself, unchanged.
2. *Runtime message-processing context* — `IMessageContext`/`MessageContextHeaders`,
   which already carries correlation id, causation id, and headers. These stay
   infrastructure/runtime metadata; they are not promoted to domain-event business
   properties merely because a future Event Store might persist them. The Event
   Sourcing executor may access `IMessageContext` because it participates in the
   messaging lifecycle — that possibility is preserved, not exercised further here. No
   second correlation mechanism is invented.
3. *Persisted event representation* — a future real provider's own stored record,
   mapping domain event + relevant runtime metadata + provider-specific metadata into
   whatever a PostgreSQL/Marten/Kurrent implementation actually needs. This
   specification does not define a public `EventEnvelope<T>` (or equivalent) to
   anticipate that, and does not decide correlation/causation persistence, custom
   persisted headers, serializer metadata, event type/version metadata, global event
   position, or provider-specific stream-revision representation. Stream version stays
   out-of-band exactly as it is today (a plain `int`, not an envelope field) — keeping
   it out-of-band is preferable to adding a type solely for symmetry.

Compatibility statement (recorded verbatim so a future persistence specification can
cite it): *Domain event payload, runtime message-processing metadata, and
provider-specific persisted event representation are distinct concerns. A future
persistence provider may combine the first two into its own stored representation and
reconstruct the runtime/domain representation when reading, without changing aggregate
decision/evolution APIs.* And: *This specification stabilizes the user-facing
aggregate/command execution direction. It does not freeze the final persistence-
provider SPI. The next real-provider specification may refine the low-level store
contract as concrete persistence requirements become known, without redesigning
aggregate or command-handler APIs.*

**Append/flush/commit is a storage-contract ordering guarantee, not an EF-specific
implementation note (D23).** Three distinct steps: (1) append/write, (2) make the
source write visible/durable enough inside the supported current consistency boundary,
(3) final transaction commit. Required semantic: *When the Event Sourcing append
operation completes successfully, the newly appended event/state is visible to
synchronous downstream processing operating inside the same supported consistency
boundary. If a concrete provider needs an explicit flush/save to satisfy that
guarantee, that provider is responsible for performing it before its append operation
returns.* Then: *The Event Sourcing executor publishes/processes synchronous
downstream domain events only after successful append.* And: *Successful append does
not imply that Event Sourcing core owns or has completed the final application/
message-processing transaction commit.* For the in-memory `FakeEventStore`, append is
immediately visible. For a future EF/PostgreSQL-backed store, its provider
implementation may need `SaveChangesAsync()` before returning while still
participating in an ambient transaction (the same pattern `EntityFrameworkMessageInbox`/
`EntityFrameworkMessageOutbox` already use). For a future external Event Store,
persistence may be committed in that external resource and must not be described as
part of one ACID transaction with SQL inbox/outbox. This specification does not
redesign Unit of Work, inbox, outbox, or distributed transactions, and does not claim
exactly-once semantics across independent persistence resources.

**Authorization ownership is split cleanly between the messaging pipeline and the
Event Sourcing executor (D25, D26).** Normal message-level and handler-level
permission checks — the command/message's own operation permission, plus any explicit
handler's additional requirement, composed AND — are owned entirely by the normal
messaging authorization pipeline (`ValidatePermissionMiddleware` and the new
message-level attribute placement, both in `NEvo.Messaging.Authorization`). The Event
Sourcing executor **never** invokes these; it does not duplicate general messaging
authorization behavior. Conceptual order:

```
Messaging pipeline:
  normal validation
  message permission
  selected explicit-handler additional permission
Event Sourcing execution (only after the above already passed):
  load/rehydrate
  aggregate/resource-aware authorization   <- the ES executor's one hook
  decide
  append
  synchronous publish
```

The aggregate/resource-aware authorization hook is the *only* authorization concern
the Event Sourcing executor owns — it runs after load/rehydration, before the domain
decision, receives the same explicit `Option<TAggregate>` current-state semantics as
the Level 2 handler (see below), and a denial prevents decision and append. Its
contract lives with Event Sourcing (or another already-lower neutral abstraction), not
in `NEvo.Messaging.Authorization` — no new `NEvo.Ddd.EventSourcing` →
`NEvo.Messaging.Authorization` project reference is introduced (D26); a concrete
application-level implementation of the hook (e.g. inside the Documents example) is
free to reference `NEvo.Messaging.Authorization`/`NEvo.Authorization` types itself,
since that constraint applies to the core contract's own package, not to consumers
implementing it.

**Level 2 and aggregate-aware authorization both use explicit Some/None current-state
semantics, never `null`, never a second create-handler hierarchy (D24).** The existing
Event Sourcing implementation already distinguishes creation (`Option<TAggregate>.
None`) from mutation (`Option<TAggregate>.Some`) inside `DeciderCommandHandler`. The
hardened Level 2 API preserves and extends that model rather than silently assuming
every command targets an existing aggregate: the explicit Event Sourced handler
receives the current state as `Option<TAggregate>` (or a minimal execution context
exposing the equivalent explicit Some/None state) — `Some` when an existing
stream/aggregate was rehydrated, `None` on the creation path — while the framework
still owns expected-version semantics and the user still writes no repository/replay/
append plumbing. A Level 2 handler may delegate to Level 1's decision discovery,
including the existing creation decision path. The aggregate-aware authorization hook
receives the identical `Option<TAggregate>` semantics, so a policy can distinguish
"creating a new resource" from "acting on an existing resource," explicitly reject or
ignore `None` if its use case only makes sense for existing resources, and is never
silently skipped on create merely because no object exists yet. This specification
does not wire `ICreateAggregateCommand` into either path (D16 stands), does not use
`null` to represent a missing aggregate, and does not introduce a second special
create-handler hierarchy.

**Explicit expected-stream-state replaces the magic `0` (D29).** The current
`DeciderCommandHandler.HandleAsync` calls `AppendEventsAsync(..., expectedVersion: 0,
...)` on the creation path and `AppendEventsAsync(..., expectedVersion:
loaded.Version, ...)` on the mutation path — the literal `0` is overloaded to mean
both "the stream must not already exist" and "the expected version happens to be
zero," a distinction a real provider (PostgreSQL/Marten/Kurrent-style) naturally keeps
separate, referenced from the mature-framework comparison that motivated this pass
(Eventuous' `ExpectedState.New`/`Exact`, Marten/Wolverine's stream-append
overloads, Equinox's decider-load contract — cited for inspiration only, not
integrated or depended upon). This specification introduces an explicit
`NoStream`/`Exact(version)` expected-stream-state concept: `NoStream` is valid only if
the stream does not yet exist, `Exact(version)` only if the stream is at exactly that
version. **No `Any`/`IgnoreVersion`/unconditional-append mode, and no automatic
retry/rebase semantics** — both explicitly rejected; there is no current use case for
either, and both would materially change the concurrency-conflict contract this
specification otherwise keeps unchanged (D13). The low-level stream read result must
also preserve stream existence explicitly — a missing stream and an existing-but-empty
stream are no longer collapsed into the same `(events: [], version: 0)` shape — and
`FakeEventStore`'s current `GetOrAdd`-on-read side effect (which silently creates an
empty stream merely by being read) is fixed so a missing stream stays observably
missing until an actual append creates it. This is a store/executor-contract hardening,
not a new persistence-metadata type (D20-D22 still apply) and not a relaxation of D22 —
the next real-provider specification may still refine the concrete storage/revision
representation.

**The shared executor is convention-agnostic; reflection/discovery stays the
aggregate-method convention's own concern (D30).** The shared Event Sourced executor
(task 03) owns lifecycle orchestration only — load/rehydrate, invoke the aggregate-aware
authorization hook, invoke a *supplied* decision operation, append (using the D29
mapping), synchronous publish ordering, and error propagation. It does not itself
perform reflection or state-method discovery; that already lives, and continues to
live, in `AggregateDecider`/`AggregateEvolver`, with the executor depending on/invoking
only the resulting `IDecider`/`IEvolver` shape those types already implement today. This
mirrors how the mature frameworks surveyed for this pass separate a generic
command/decision-handling pipeline from a specific decision-derivation mechanism
(again, cited for inspiration only). No speculative `IDecisionStrategy`/
`IMutableAggregateStrategy`/`IFunctionalDeciderStrategy`-style plugin hierarchy is
introduced — this is a documented separation of existing responsibilities, not a new
extensibility surface.

**Level 2 manages exactly one Event Sourced write target per command (D31).** The
explicit Level 2 handler may read external data freely via injected dependencies for
orchestration, but the framework-managed write lifecycle it delegates to task 03's
executor covers exactly one aggregate stream. A use case genuinely needing coordinated,
atomic writes to two or more independently-versioned Event Sourced aggregate streams
belongs to Level 3 (an ordinary `ICommandHandler<T>`, ordinary application-level
transaction handling) or to a future dedicated saga/process-manager/workflow capability
— never designed or implemented in this specification. This keeps Level 2's contract
simple and matches every mature framework surveyed for this pass, none of which frames
a single command-handling abstraction as an atomic multi-stream write mechanism.

## Compatibility and migration

`NEvo.Ddd.EventSourcing` is documented `status: experimental` and has not reached
`main` — this change treats its public surface as not yet compatibility-sensitive.
Expected breaking changes within this still-unreleased package: `AddEventSourcing`'s
signature (D4), `IAggregateRepository`/`IEventStore` member shape (D6), a new
`AggregateConcurrencyException` replacing a plain `Exception` for concurrency conflicts
— returned via `Either`, never thrown (D13), the explicit Level 2 handler's `Option<
TAggregate>` current-state parameter (D24), the replacement of `int expectedVersion`
with an explicit `NoStream`/`Exact(version)` expected-stream-state type (D29), and
`MessageHandlerDescription`'s shape if task 05 requires a new field (D3). None of these
affect `NEvo.Messaging`/`NEvo.Messaging.Cqrs`'s existing public surface, which this
change does not alter outside the new message-level permission-attribute placement and
`MapQueryEndpoint` addition (both additive) — and, per D18, **not**
`Query<TResult>`/`Message<TResult>`, which are confirmed unchanged.

Scope reductions recorded across both refinement passes: D12 narrows the original
brief's "at least in tests" requirement to manual walkthrough for the example service
itself, with version/concurrency behavior covered by
`tests/NEvo.Ddd.EventSourcing.Tests` unit tests instead — a follow-up specification is
expected to add example-service integration tests. D15/D16 remove the folder/namespace
reorganization and `ICreateAggregateCommand` wiring that were originally in task 02's
scope. D20-D22 remove the "minimum event envelope" design work that was originally in
task 02's scope — no envelope type is introduced at all, not even a minimal one. D27
removes the `WebApplicationFactory`-based integration test that was originally in task
08's scope. D28 removes the manual concurrent-HTTP-race requirement that was originally
in task 10's scope. D29-D31 (narrow reference-pattern refinement) add compatibility
guardrails rather than reduce scope: an explicit expected-stream-state concept (D29),
an executor/convention responsibility separation (D30), and a single-write-target
boundary for Level 2 (D31) — none reopen or narrow D19-D28.

## Areas

- `areas/characterization-and-baseline.md` — characterize existing behavior against the
  current green build (task 01). No reorganization, no `ICreateAggregateCommand`
  wiring (D15, D16).
- `areas/persistence-boundary.md` — Event Store/repository contract hardening,
  concurrency exception (returned, never thrown), explicit `NoStream`/`Exact(version)`
  expected-stream-state semantics and existence-preserving reads (D29), D17/D20-D22
  constraints (task 02).
- `areas/shared-es-execution-and-explicit-handler.md` — the shared executor
  (aggregate-aware authorization hook only, D25; convention-agnostic lifecycle
  orchestration, D30), ambiguity resolution, the explicit Level 2 handler with
  Some/None semantics (D24) and single-write-target boundary (D31) (tasks 03-04).
- `areas/handler-registration-and-options.md` — Primary/Fallback roles, ES registration
  options, and explicit non-ES regression coverage (tasks 05-06).
- `areas/authorization-integration.md` — message-level/handler-level permission fix
  (messaging pipeline only) plus the aggregate-aware hook (Event Sourcing side), never
  crossing the package boundary (D26) (task 07).
- `areas/http-query-endpoint.md` — `MapQueryEndpoint` and GET binding, resolved via
  `[AsParameters]` (D18), verified without new integration-test infrastructure (D27)
  (task 08).
- `areas/documents-example-service.md` — the dedicated example service, manual
  walkthrough without a concurrency race (D28) (tasks 09-10).
- `areas/user-facing-documentation.md` — the first-class `docs/usage/event-sourcing.md`
  guide (task 11).
- `areas/internal-documentation.md` — maintainer-facing architecture documentation
  (task 12).

## Change-wide acceptance criteria

1. `dotnet build` succeeds across the whole solution (the current baseline; every task
   must preserve it).
2. A command handled only by the aggregate-method convention (no Primary registered)
   succeeds through the shared executor.
3. An explicit Event Sourced handler or an ordinary `ICommandHandler<T>` registered
   alongside the convention route for the same command is used in preference to the
   convention route; two Primary handlers for the same command fail as a configuration
   error.
4. A command supported by two aggregate state types resolves to the most-specific
   runtime type; two equally-specific candidates fail deterministically.
5. Disabling the aggregate-method convention leaves a command with only a convention
   handler unroutable (no handler found), while explicit/ordinary handlers remain
   usable.
6. A stream-version mismatch on append is **returned** as
   `Either<Exception, Unit>.Left` containing `AggregateConcurrencyException` — never
   thrown.
7. The source event is appended/persisted before a synchronous domain-event handler
   triggered by the same command runs; that handler reloading the aggregate sees the new
   state.
8. Message-level permission is enforced for a command handled through the convention
   fallback route (it is not enforced today) — enforced entirely in the messaging
   pipeline, before the Event Sourcing executor is invoked.
9. Handler-specific authorization requirements compose as AND with message-level
   requirements, never as a silent override.
10. Aggregate-aware authorization runs after rehydration and before the decision,
    receiving the current state as `Option<TAggregate>` (`Some`/`None`); a denial
    prevents append/decision side effects in either case.
11. `MapQueryEndpoint<TQuery, TResult>` binds a representative query via `[AsParameters]`
    from route and query-string values, without requiring a GET body, and without
    `Id`/`CreatedAt` becoming required parameters (D18); it returns a
    `RouteHandlerBuilder` chainable with `.RequireAuthorization()`.
12. The Documents example service demonstrates create/change/approve/query end to end,
    reload-after-write reconstructing the correct concrete state, and both HTTP mappings
    — verified manually per D12; optimistic-concurrency behavior is verified
    deterministically in Event Sourcing core tests, not as a manual HTTP race (D28).
13. Query handler resolution, Event fan-out, and every existing `AddCommands`/
    `AddEvents`/`AddQueries` idempotency guarantee are unaffected by the Primary/
    Fallback change (review issue 6).
14. Neither the hardened repository/store contracts nor the shared executor require the
    aggregate's next state to come from an instance method on an immutable object
    (D17) — a documented constraint, not a new abstraction.
15. No persisted Event Envelope type, correlation/causation envelope field, or other
    storage-metadata type is introduced anywhere in this change (D20-D22).
16. `NEvo.Ddd.EventSourcing` has no project reference to `NEvo.Messaging.Authorization`
    (D26).
17. No new `WebApplicationFactory`-based or other ASP.NET integration-test project is
    introduced (D27).
18. `docs/usage/event-sourcing.md` exists and answers every "required reader question"
    listed in task 11 without requiring framework source; `docs/development/
    event-sourcing.md` is rewritten for maintainers (task 12); neither document presents
    an unimplemented capability (mutable aggregates, functional deciders, persisted
    projections, or a persisted envelope) as available.
19. No call site anywhere in this change constructs the expected-stream-state value from
    a bare integer literal `0` to mean "create" (D29).
20. A read of a stream that has never been appended to returns an explicit "missing"
    result and does not create a backing-store entry as a side effect (D29).
21. A `NoStream` append fails with `AggregateConcurrencyException` when the stream
    already exists; an `Exact(version)` append preserves today's optimistic-concurrency
    behavior, now expressed through the explicit case instead of a bare integer (D29).
22. Both Level 1 (convention) and Level 2 (explicit handler) produce the identical
    `NoStream`/`Exact(version)` mapping from the same `Option<TAggregate>` state,
    proven by a shared test exercising both routes (D29).
23. The shared executor's own class contains no reflection/state-method-discovery code
    — that logic lives only in `AggregateDecider`/`AggregateEvolver` — and the
    aggregate-method convention (Level 1) still requires no explicit handler
    registration or extra boilerplate beyond today's aggregate-method discovery (D30).
24. No mutable-aggregate or static/functional-decider modeling style, no persisted-
    projection API or mechanism, no `Any`/`IgnoreVersion` expected-stream-state mode,
    and no multi-aggregate/multi-stream atomic-write capability is introduced anywhere
    in this change (D17, D29, D30, D31).
25. `node tools/specs.mjs validate` and `node tools/docs.mjs validate` pass.

## Verification strategy

`dotnet build` across the solution after every task; `dotnet test` across
`tests/NEvo.Ddd.EventSourcing.Tests` (and any other test project a task's own
"Verification" section names, e.g. a new small `NEvo.Messaging.Authorization.Tests`
for task 07) after every task touching it; `node tools/specs.mjs validate`; `node
tools/docs.mjs validate` for tasks touching docs; manual walkthrough of the Documents
example service (task 10, per D12) covering create → change → approve → query and
reload-after-write — no manufactured concurrent-HTTP race (D28); deterministic
optimistic-concurrency coverage instead lives in `tests/NEvo.Ddd.EventSourcing.Tests`
(tasks 02-03).

## Out of scope

Everything the originating specification brief marked non-goal: a production
PostgreSQL/Marten/Kurrent Event Store provider, persisted projections, an asynchronous
projection daemon, global event-log subscriptions, projection checkpoints/rebuilds,
multi-stream projections, aggregate snapshots, event upcasting/schema migration,
distributed transaction coordination, cross-store exactly-once guarantees, inbox/outbox
persistence redesign, saga/process-manager redesign, a complete permission DSL, a
complete new validation framework, and a universal REST/HTTP error-mapping framework.
Also out of scope: a dedicated test project for the Documents example service (D12);
any folder/namespace reorganization of `NEvo.Ddd.EventSourcing` (D15); wiring
`ICreateAggregateCommand<TAggregate,TId>` into any resolution logic (D16); a
speculative multi-modeling-style strategy abstraction (D17 is documentation-only, not
a new type); mutable-aggregate or static/functional decider implementations; any
speculative "how to implement projections" documentation; a persisted Event Envelope
type or any correlation/causation/storage-metadata addition to the domain event or
repository contracts (D20-D22); a final persistence-provider SPI design (the next
real-provider specification owns that); a `NEvo.Ddd.EventSourcing` →
`NEvo.Messaging.Authorization` project dependency (D26); new integration/e2e test
infrastructure of any kind (D27); a manufactured concurrent-HTTP-race acceptance test
in the Documents example (D28); an `ExpectedState.Any`/`IgnoreVersion`/unconditional-
append mode and any automatic retry/rebase logic after a concurrency conflict (D29); a
provider-specific stream-revision representation (left to the next real-provider
specification, D22/D29); any `IDecisionStrategy`/`IMutableAggregateStrategy`/
`IFunctionalDeciderStrategy`-style plugin/strategy hierarchy (D30); multi-stream atomic
command execution and any Eventuous-style functional `CommandService<T>` base-class
abstraction (D31); and any dependency on, or integration with, Eventuous, Marten,
Wolverine, or Equinox — each was consulted only as architectural inspiration for this
refinement pass, never as a package this change depends on or wraps.
