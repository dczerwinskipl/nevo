---
id: spec.event-sourcing-api-hardening
type: change
title: Event Sourcing API hardening and persistence readiness
status: draft
change: event-sourcing-api-hardening
---

# Event Sourcing API hardening and persistence readiness

## Context

NEvo has an experimental Event Sourcing model (`NEvo.Ddd.EventSourcing`,
`docs/development/event-sourcing.md`: `status: experimental`) on branch
`feature/event-sourcing` (PR #10, `main` already merged in) that already provides an
attractive developer experience: commands discovered on concrete aggregate-state types,
event replay/evolution, and hidden load→decide→append plumbing. Before real persistence
providers, projections, checkpoints, or stronger inbox/outbox integration are built on
top of it, this change hardens the current API — command-handling levels, handler
registration semantics, authorization integration, the Event Store/repository boundary,
and the HTTP Query endpoint surface — so the next persistence specification does not
need to redesign public aggregate/command APIs again.

This is deliberately a middle step, not a production-grade Event Sourcing stack. The
recently added Query support and handler-registration hardening
(`specs/archive/query-support-and-handler-registration-hardening/`, merged to `main`)
must be preserved and integrated with this work, not replaced.

## Current architecture

Grounded in repository discovery (file:line citations; four parallel read-only research
passes plus a live `dotnet build`):

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
`DeciderCommandHandler.HandleAsync` (`Handling/DeciderCommandHandler.cs:14-34`) does
load → decide → append; it does not itself re-evolve state after append.

**Persistence boundary.** `IAggregateRepository` (`IAggregateRepository.cs:5-18`) already
mixes stream append/load, aggregate rehydration, **and** `LoadProjectionAsync` (the real
implementation throws `NotImplementedException`, lines 72-75). `IEventStore` is the
lower-level stream abstraction; only implementation is in-memory `FakeEventStore`.
Optimistic concurrency is an `int expectedVersion` parameter; a mismatch returns a plain
`Exception` (`ServiceCollectionExtensions.cs:20-22`), not a dedicated type. The event
envelope carries only `Id`/`CreatedAt` (from `Message`) plus `StreamId` — no
correlation/causation/global-position field on the event itself, but
`IMessageContext.Headers.CorrelationId`/`CausationId`
(`Context/MessageContextHeaders.cs:19-56`) already exist as an obvious source if needed.
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
aggregate/resource-aware authorization extension point exist anywhere today. No
"flush"/`SaveChanges` primitive exists anywhere in the repository; synchronous dispatch
re-enters `IMessageProcessor.ProcessMessageAsync` under the same ambient
`TransactionScope` (`InternalSyncProcessDispatchStrategy.cs:8-9`).

**HTTP/Query.** `MapCommandEndpoint<TCommand>` (`RoutesExtensions.cs:46-65`) returns
`RouteHandlerBuilder`, binds via implicit body, uniformly maps `Left` → `Results.Problem(
..., 500)`, and contains two leftover `Console.WriteLine` calls (lines 54-55) alongside
the `ILogger<T>` convention used elsewhere. `Query<TResult> : Message<TResult>` carries
only inherited `Id`/`CreatedAt`. TFM is `net9.0` repo-wide
(`Directory.Build.props:3`); `[AsParameters]`/`BindAsync`/`IBindableFromHttpContext` are
available but unused anywhere today. `GetDocumentQuery` is hand-wired via
`IQueryDispatcher` in `Routes.cs:20-27` and branches `DocumentNotFoundException` → 404 —
a distinction a generic `MapQueryEndpoint` will not reproduce by default.

**ExampleApp.** The Document example lives inside `ServiceA.Api` but its types are
declared in namespace `NEvo.Ddd.EventSourcing.Tests.Mocks`
(`ExampleDomain/Documents/Document.cs:3`) — the example currently borrows
test-fixture-shaped code rather than owning its own domain namespace. Only two states
exist (`EditableDocument`/`ApprovedDocument`, no `ReturnedDocument`). No permission
metadata and no tests exist on any Document command/handler/query.

**Critical fact: the branch does not currently build.** `dotnet build NEvo.sln` fails
with 5 errors: `InMemoryDocumentEventStore` does not implement the current
`IEventStore.AppendEventsAsync`/`LoadEventsStreamAsync` (CS0535) — confirming it is
already stale against the versioned interface, consistent with its own header comment
calling it a workaround pending PR #10; and three test files
(`AggregateEvolverTests.cs:14,35`, `AggregateDeciderEvolverIntegrationTests.cs:21`) fail
with CS9174 — `new AggregateEvolver([typeof(Document)])` cannot construct
`IOptions<AggregateExtractorConfiguration>` from a collection expression, since
`AggregateEvolver`'s only constructor takes `IOptions<AggregateExtractorConfiguration>`
directly (`AggregateEvolver.cs:15`) — these tests predate a constructor-signature change
and were never fixed.

## Problem

The current Event Sourcing implementation cannot safely host a real persistence provider
yet: handler registration cannot distinguish an intentional convention fallback from an
accidental duplicate handler; authorization silently does not run for the convention
route; the repository mixes stream persistence with rehydration and (unfinished)
projection loading; there is no options surface to disable the convention route; and
there is no ergonomic HTTP Query mapping to match the existing Command mapping. The
branch also does not currently compile.

## Constraints

- `docs/development/package-boundaries.md`: dependencies flow downward only;
  `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Cqrs` is an explicitly flagged unresolved
  question this change addresses at the folder level only (D10) — no project-reference
  change.
- `docs/development/coding-conventions.md`: `Either<Exception, T>` for fallible
  operations; `TryAdd*`/`TryAddEnumerable` for idempotent DI registration, matching the
  precedent already set by the archived query-support change.
- `docs/development/testing-strategy.md`: characterization tests before changing existing
  behavior (task 01 is a hard prerequisite for every other task).
- `docs/development/event-sourcing.md`: `status: experimental` — "should not drive
  refactoring of other modules"; this change treats it as the thing being hardened, not
  as an established pattern to propagate elsewhere.
- No production PostgreSQL/Marten/Kurrent provider, no persisted projections, no
  subscription/checkpoint machinery, no snapshotting, no event upcasting, no distributed
  transaction coordination, no inbox/outbox redesign, no new permission DSL, no universal
  HTTP error-mapping framework — see "Out of scope".

## Affected modules

- `src/NEvo.Ddd.EventSourcing/` (reorganized into core/integration folders; hardened
  repository/store contracts; shared ES executor; explicit handler; Primary/Fallback
  registration; options)
- `src/NEvo.Messaging.Authorization/` (message-level permission attribute placement,
  requirement composition, aggregate-aware authorization extension point)
- `src/NEvo.Messaging.Web/` (`MapQueryEndpoint`, `RoutesExtensions` cleanup)
- `src/NEvo.Messaging/Handling/` (`MessageHandlerDescription` role metadata, if the
  chosen design requires a field there rather than a wrapping concept — task 06
  determines the smallest coherent change)
- `examples/ExampleApp/NEvo.ExampleApp.Documents.Api/` (new project)
- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/` (Document domain removed)
- `tests/NEvo.Ddd.EventSourcing.Tests/` (characterization + new coverage)
- `docs/development/event-sourcing.md`, `docs/development/messaging-pipeline.md` (also
  has pre-existing stale content found during discovery — see task 12),
  `docs/development/package-boundaries.md`, `docs/usage/`, relevant
  `docs/reference/packages/*.md`

## Options and trade-offs

The command-handling model, registration semantics, persistence boundary, authorization
integration, and HTTP mapping approach are owner-supplied direction (D1-D9,
`owner-decisions.md`) from the originating specification brief, not independently
re-derived options in this document. Genuine options were presented and resolved
interactively for the four gaps the brief did not cover — package-dependency handling
(D10), the unused `ICreateAggregateCommand` marker (D11), the example service's test
strategy (D12), and the concurrency-conflict error shape (D13) — plus one tooling
conflict, branch targeting (D14). See `owner-decisions.md` for the full options
considered and rationale for each.

## Owner decisions

See `owner-decisions.md` (D1-D14).

## Proposed architecture

1. **Characterize, then reorganize.** Task 01 fixes the branch's current 5 compile
   errors and writes characterization tests for today's decider/evolver/repository/
   registration behavior. Task 02 reorganizes `NEvo.Ddd.EventSourcing` into core
   (evolving/deciding/aggregate model) vs. integration (Cqrs-facing adapter/provider/
   registration) folders (D10) and wires `ICreateAggregateCommand<TAggregate,TId>` into
   create-vs-mutate resolution (D11) — both protected by task 01's safety net.
2. **Persistence boundary.** Task 03 separates stream persistence
   (`IEventStreamStore`) from aggregate rehydration (`IAggregateRepository`, projection
   loading removed), adds the minimum event envelope fields, introduces a dedicated
   `AggregateConcurrencyException` (D13), and documents transaction/commit-ownership
   constraints (D6).
3. **Shared ES execution + explicit handler.** Task 04 extracts the shared
   load→authorize→decide→append→publish executor with the full ordering semantics (D1,
   D2, D7) and the deterministic most-specific-state-wins resolution (D2). Task 05 adds
   the explicit `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` (Level 2, D1),
   reusing task 04's executor and Level 1's own decision-method discovery.
4. **Registration semantics.** Task 06 adds Primary/Fallback role metadata and the
   configuration-error rules (D3). Task 07 adds `AddEventSourcing(options => {...})`
   with the aggregate-method-convention-as-fallback toggle, enabled by default (D4), and
   fixes the non-idempotent `AddSingleton` registration found in discovery.
5. **Authorization.** Task 08 fixes `ValidatePermissionMiddleware`'s
   `HandlerDescription.Method`-only assumption for the ES fallback route, adds
   message-level permission-attribute placement with AND composition against
   handler-specific requirements, and adds the new aggregate-aware authorization
   extension point (D5).
6. **HTTP Query mapping.** Task 09 adds `MapQueryEndpoint<TQuery, TResult>` using
   existing ASP.NET Core Minimal API binding mechanisms, and cleans up the leftover
   `Console.WriteLine` calls found in `RoutesExtensions` (D8).
7. **Documents example service.** Task 10 creates `NEvo.ExampleApp.Documents.Api`,
   moves the Document domain into its own namespace, and removes
   `InMemoryDocumentEventStore`. Task 11 wires Level 1 + Level 2 handling, permission
   metadata, aggregate-aware authorization, and both HTTP mappings into the new service,
   verified manually (D9, D12).
8. **Documentation.** Task 12 updates durable framework docs per the brief's
   documentation scope, and corrects the stale `messaging-pipeline.md` content found
   during discovery (non-existent `AuthorizationMiddleware`/`AuthorizationHandlerMiddleware`
   class names, wrong `IMessageProcessor` path, obsolete `MessageHandlerAdapterBase`
   reference).

## Compatibility and migration

`NEvo.Ddd.EventSourcing` is documented `status: experimental` and has not reached `main`
— this change treats its public surface as not yet compatibility-sensitive. Expected
breaking changes within this still-unreleased package: `AddEventSourcing`'s signature
(D4), `IAggregateRepository`/`IEventStore` member shape (D6), a new
`AggregateConcurrencyException` replacing a plain `Exception` for concurrency conflicts
(D13), and `MessageHandlerDescription`'s shape if task 06 requires a new field (D3). None
of these affect `NEvo.Messaging`/`NEvo.Messaging.Cqrs`'s existing public surface, which
this change does not alter outside the new message-level permission-attribute placement
and `MapQueryEndpoint` addition (both additive).

Scope reduction from the originating brief: Scope 10's acceptance-criteria list asked for
example-service behavior to be covered "at least in tests"; D12 narrows this to manual
walkthrough for the example service itself, with version/concurrency behavior covered by
`tests/NEvo.Ddd.EventSourcing.Tests` unit tests instead. A follow-up specification is
expected to add example-service integration tests.

## Areas

- `areas/characterization-and-reorganization.md` — fix the current build, characterize
  existing behavior, reorganize into core/integration folders (tasks 01-02).
- `areas/persistence-boundary.md` — Event Store/repository contract hardening,
  concurrency exception, event envelope (task 03).
- `areas/shared-es-execution-and-explicit-handler.md` — the shared executor, ambiguity
  resolution, and the explicit Level 2 handler (tasks 04-05).
- `areas/handler-registration-and-options.md` — Primary/Fallback roles and ES
  registration options (tasks 06-07).
- `areas/authorization-integration.md` — message-level, handler-specific, and
  aggregate-aware authorization (task 08).
- `areas/http-query-endpoint.md` — `MapQueryEndpoint` and GET binding (task 09).
- `areas/documents-example-service.md` — the dedicated example service (tasks 10-11).
- `areas/documentation.md` — durable documentation updates (task 12).

## Change-wide acceptance criteria

1. `dotnet build` succeeds across the whole solution (it does not today).
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
6. A stream-version mismatch on append surfaces as `AggregateConcurrencyException`
   through the existing `Either<Exception, T>` convention.
7. The source event is appended/persisted before a synchronous domain-event handler
   triggered by the same command runs; that handler reloading the aggregate sees the new
   state.
8. Message-level permission is enforced for a command handled through the convention
   fallback route (it is not enforced today).
9. Handler-specific authorization requirements compose as AND with message-level
   requirements, never as a silent override.
10. Aggregate-aware authorization runs after rehydration and before the decision; a
    denial prevents the decision/append from happening.
11. `MapQueryEndpoint<TQuery, TResult>` binds a representative query from route and
    query-string values, without requiring a GET body, and without `Id`/`CreatedAt`
    becoming required parameters; it returns a `RouteHandlerBuilder` chainable with
    `.RequireAuthorization()`.
12. The Documents example service demonstrates create/change/approve/query end to end,
    reload-after-write reconstructing the correct concrete state, and both HTTP mappings
    — verified manually per D12.
13. `node tools/specs.mjs validate` and `node tools/docs.mjs validate` pass.

## Verification strategy

`dotnet build` across the solution after every task; `dotnet test` across
`tests/NEvo.Ddd.EventSourcing.Tests` (and any other test project a task's own
"Verification" section names) after every task touching it; `node tools/specs.mjs
validate`; `node tools/docs.mjs validate` for tasks touching docs; manual walkthrough of
the Documents example service (task 11, per D12) covering create → change → approve →
query and a version-conflict scenario.

## Out of scope

Everything the originating specification brief marked non-goal: a production
PostgreSQL/Marten/Kurrent Event Store provider, persisted projections, an asynchronous
projection daemon, global event-log subscriptions, projection checkpoints/rebuilds,
multi-stream projections, aggregate snapshots, event upcasting/schema migration,
distributed transaction coordination, cross-store exactly-once guarantees, inbox/outbox
persistence redesign (beyond a strictly-required minimal compatibility touch, flagged if
found), saga/process-manager redesign, a complete permission DSL, a complete new
validation framework, and a universal REST/HTTP error-mapping framework. Also out of
scope per D12: a dedicated test project for the Documents example service.
