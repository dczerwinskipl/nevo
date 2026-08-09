---
id: spec.query-support-and-handler-registration-hardening
type: change
title: Query support and handler-registration hardening
status: draft
change: query-support-and-handler-registration-hardening
---

# Query support and handler-registration hardening

## Context

NEvo's CQRS support (`NEvo.Messaging.Cqrs`) implements only the command side today —
`Command`, `ICommandHandler<TMessage>`, `ICommandDispatcher`. Query/read-side dispatch is
explicitly documented as absent (`docs/reference/packages/NEvo.Messaging.Cqrs.md` §
Limitations; the `.csproj` carries an empty `<Folder Include="Queries\" />` placeholder).
This change adds first-class Query support and the small set of handler-registration
corrections it genuinely exposes, without redesigning the messaging framework.

## Current architecture

Grounded in repository research (file:line citations on request; summarized here):

- **Pipeline.** `IMessageProcessor.ProcessMessageAsync` (non-generic, returns
  `Either<Exception, Unit>`) and `ProcessMessageAsync<TResult>` (generic, returns
  `Either<Exception, TResult>`) both exist. The generic overload's downstream chain —
  `IMessageProcessingStrategyWithResult` (generic methods `ShouldApply<TResult>`/
  `ProcessMessageWithResultAsync<TResult>`) and `IMessageDispatchStrategy.DispatchAsync<TResult>`
  — is fully wired and unit-tested, but **no concrete `IMessageProcessingStrategyWithResult`
  implementation exists anywhere in `src/`**. Calling the generic path today throws
  `InvalidOperationException` (empty strategy set).
- **Handler contract.** `IMessageHandler.HandleAsync` already returns boxed
  `Task<Either<Exception, object>>` — it is not itself `Unit`-hardcoded. The real
  hardcoding lives one layer down: `MessageHandlerAdapterBase<TMessageGroup>`'s abstract
  `InternalHandleAsync<TMessage>` returns `Task<Either<Exception, Unit>>`, and both
  `CommandHandlerAdapterFactory`/`EventHandlerAdapterFactory` hardcode
  `ReturnType: typeof(Unit)` in the `MessageHandlerDescription` they produce.
  `MessageHandlerDescription` also carries a `Method` field (the actual handler-interface
  `MethodInfo`, from `GetInterfaceMap`) that both factories populate but neither adapter
  currently uses.
- **Discovery/registration.** `MessageHandlerExtractor` indexes `IMessageHandlerFactory`
  instances by `ForInterface` and is already generic over handler-type kind — adding a
  kind requires adding a factory, not editing the extractor. Registration is explicit
  (`MessageHandlerExtractorConfiguration.Handlers`, populated per handler type by the
  consumer) — no `AppDomain`/assembly scanning exists anywhere.
- **Registration API.** `AddMessages()` (`NEvo.Messaging`) registers the shared core
  (registry, extractor, processor, middleware, dispatch/publish infra) using
  `TryAddSingleton`/`TryAddScoped` for the singleton/scoped pieces. `AddCommands()`
  (`NEvo.Messaging.Cqrs`) and `AddEvents()` (`NEvo.Messaging`) each register their own
  disjoint set of services using plain `Add*` — consistent with each other in shape, but
  neither is safe to call twice (a duplicate `IMessageHandlerFactory.ForInterface` throws
  in `MessageHandlerExtractor`'s `ToDictionary`). Neither calls `AddMessages()`
  internally — a consumer calls both explicitly today.
- **Duplicate-handler detection.** `IMessageHandlerRegistry.GetMessageHandler` (singular)
  already throws `MoreThanOneHandlerFoundException` generically for any message type with
  more than one registered handler — this is not Command-specific and needs no new logic
  for Query.
- **Test coverage.** `tests/NEvo.Messaging.Tests/` covers the shared pipeline
  extensively. **Zero tests exist anywhere for `CommandHandlerAdapter`,
  `CommandHandlerAdapterFactory`, `CommandProcessingStrategy`, `CommandDispatcher`, or
  `AddCommands()`'s DI wiring** — no `NEvo.Messaging.Cqrs.Tests` project exists, and
  `NEvo.Messaging.Tests` has no reference to `NEvo.Messaging.Cqrs`.

## Problem

Query cannot be added today without either (a) special-casing it at a layer that assumes
`Unit`, or (b) duplicating the Command/Event adapter boilerplate a third time via the same
inheritance-based pattern the owner does not want extended further.

## Constraints

- `docs/development/package-boundaries.md`: dependencies flow downward only; a consumer
  must be able to take `NEvo.Messaging.Cqrs` (Command or Query) without EF/web/auth. No
  new project reference or external package is introduced by this change.
- `docs/development/coding-conventions.md`: `Either<Exception, T>` for all fallible
  operations; DI registration as a `static ServiceCollectionExtensions` class in the
  `Microsoft.Extensions.DependencyInjection` namespace with an `AddXxx(this
  IServiceCollection)` entry point; `TryAddScoped`/`TryAddSingleton` for defaults.
- `docs/development/testing-strategy.md`: characterization tests before changing existing
  behavior; one test project per `src/` package convention.
- No Query notifications, no multi-handler Query semantics, no distributed/RPC dispatch —
  Query is local in-process CQRS, matching Command.

## Affected modules

- `src/NEvo.Messaging/Handling/` (shared adapter, factory contract — `IMessageHandler`/
  `IMessageHandlerFactory`/`IMessageHandlerRegistry`/`MessageHandlerDescription` are
  unchanged; `MessageHandlerAdapterBase<TMessageGroup>` is removed and replaced by a new
  public `MessageHandlerAdapter` — a public breaking change, see D6)
- `src/NEvo.Messaging/Events/` (registration idempotency)
- `src/NEvo.Messaging.Cqrs/Commands/` (registration idempotency; adapter now delegates to
  the shared component)
- `src/NEvo.Messaging.Cqrs/Queries/` (new)
- `tests/NEvo.Messaging.Cqrs.Tests/` (new)
- `examples/ExampleApp/` (Query example)
- `docs/usage/`, `docs/reference/packages/NEvo.Messaging.Cqrs.md`,
  `docs/reference/packages/NEvo.Messaging.md` (public-surface/breaking-change note, D6),
  `docs/development/architecture-overview.md`, `docs/development/testing-strategy.md`

## Options and trade-offs

Full option analysis (sizes, evaluated dimensions, rejection reasons) was presented in
conversation and resolved by owner decisions D1–D5 in `owner-decisions.md`. Summary:

- **Query adapter shape** — rejected a Query-only adapter parallel to Command/Event
  (would leave the disliked inheritance pattern in place and add a third copy of the same
  boilerplate) and rejected redesigning `IMessageHandler` to be generic (XL,
  repository-wide, unjustified — the existing object-boxing pattern already supports
  typed results, proven by Command/Event's own working use of it). Selected: one shared,
  composed `MessageHandlerAdapter` used by Command/Event/Query, replacing
  `MessageHandlerAdapterBase<TMessageGroup>` and its two subclasses (D1) — all three
  removed types are public, so this is a public breaking change; the replacement is
  itself public rather than internal, since it is constructed cross-assembly and no
  `InternalsVisibleTo` is introduced (D6).
- **Registration idempotency** — rejected scoping the fix to `AddQueries()` alone.
  Selected: retrofit `AddCommands()`/`AddEvents()` too, for one consistent idempotency
  story across all three (D2).
- **Registration composition** — rejected introducing a new `AddMessages`-named composing
  helper (the name is already taken by the existing core-registration method). Selected:
  no new composing method; `AddQueries()` follows the exact existing
  `AddMessages()`+`AddCommands()` convention (D3).
- **Query base type** — rejected a bare `IQuery<TResult>` interface (no precedent;
  `Command` has no interface equivalent). Selected: `Query<TResult> : Message<TResult>`,
  a concrete abstract record mirroring `Command` (D4).
- **Test project** — rejected adding a project reference from `NEvo.Messaging.Tests` to
  `NEvo.Messaging.Cqrs`. Selected: new `tests/NEvo.Messaging.Cqrs.Tests`, matching the
  existing one-project-per-package convention (D5).

## Owner decisions

See `owner-decisions.md` (D1–D6).

## Proposed architecture

1. **Shared handler-invocation adapter** (D1). Delete `MessageHandlerAdapterBase<TMessageGroup>`,
   `CommandHandlerAdapter`, `EventHandlerAdapter`. Add one concrete, non-generic
   `MessageHandlerAdapter : IMessageHandler` (composition, not inheritance) that resolves
   the handler instance via `ActivatorUtilities.CreateInstance(context.ServiceProvider,
   HandlerDescription.HandlerType)` and invokes `HandlerDescription.Method` reflectively,
   adapting whatever `Either<Exception, TResult>` it returns into the
   `Either<Exception, object>` shape `IMessageHandler.HandleAsync` already contracts for.
   `CommandHandlerAdapterFactory`/`EventHandlerAdapterFactory`/the new
   `QueryHandlerAdapterFactory` keep their own kind-specific `ForInterface`/
   `GetMessageHandlerDescriptions`, but all construct this one shared adapter in
   `Create()`. Protected by characterization tests written first (task 01) proving
   current Command/Event behavior is unchanged after the refactor (task 02).

2. **Query abstractions** (D4). `Query<TResult> : Message<TResult>` (abstract record,
   `NEvo.Messaging.Cqrs.Queries` namespace), `IQueryHandler<TQuery, TResult> where TQuery
   : Query<TResult>`, and `QueryHandlerAdapterFactory : IMessageHandlerFactory` whose
   `GetMessageHandlerDescriptions` reflects the actual closed `TResult` per query type
   (never hardcodes `Unit`). Discovery requires zero changes to
   `MessageHandlerExtractor` — it is already generic over registered factories.

3. **Query dispatch and pipeline**. A concrete `QueryProcessingStrategy` implementing
   `IMessageProcessingStrategyWithResult` — the first production implementation of this
   currently-unused interface — resolving exactly one handler via
   `IMessageHandlerRegistry.GetMessageHandler` (the same method Command already uses,
   which already throws `NoHandlerFoundException`/`MoreThanOneHandlerFoundException`
   deterministically). `IQueryDispatcher` mirrors `ICommandDispatcher`'s shape
   (`Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult> query,
   CancellationToken)`), resolving/creating `IMessageContext` the same way
   `CommandDispatcher` does and delegating to `IMessageProcessor.ProcessMessageAsync<TResult>`.
   Message-level middleware (correlation/causation/authorization/transaction/inbox/
   logging/telemetry) and handler-level middleware are already kind-agnostic
   (`IMessage`/boxed `object`-based) — Query reuses both chains unchanged, no middleware
   duplication.

4. **Registration** (D2, D3). `AddQueries()` (new, `NEvo.Messaging.Cqrs`) follows the
   exact shape of `AddCommands()`, using `TryAdd*`/`TryAddEnumerable` throughout.
   `AddCommands()`/`AddEvents()` are retrofitted to the same idempotent shape. No new
   composing method is introduced — a consumer calls
   `services.AddMessages().AddQueries()`, mirroring `AddMessages().AddCommands()` today.

## Compatibility and migration

**This change contains a public breaking change (D6) — corrected here after spec review
found the original wording ("additive", "no migration steps required") factually wrong.**

- **Breaking:** `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and
  `EventHandlerAdapter` are `public` types today and are deleted (task 02). A new
  `public` `MessageHandlerAdapter` (`NEvo.Messaging.Handling`) replaces all three. Any
  consumer referencing the three deleted types directly (rather than through
  `ICommandHandler<T>`/`IEventHandler<T>`/`IMessageHandlerFactory`, the documented
  extension points) will not compile against the new version. No compatibility shims or
  deprecated forwarding types are provided (D6, owner's explicit choice — this is our own
  framework and the removed types were never a documented extension point).
- **Non-breaking:** `Command`/`ICommandHandler`/`ICommandDispatcher`,
  `Event`/`IEventHandler`, and `AddCommands()`/`AddEvents()`'s single-call behavior are
  unchanged from the public API perspective. `AddCommands()`/`AddEvents()` becoming safe
  to call twice (previously could throw) can only ever make previously-failing code
  succeed, not the reverse — not a breaking change on its own.
- No data/schema migration is required — this is a source/binary compatibility break for
  direct references to the three deleted types only, not a runtime behavior or persistence
  change.

## Areas

- `areas/shared-handler-invocation.md` — the composed adapter refactor and its
  characterization-test safety net (tasks 01–02).
- `areas/registration-hardening.md` — idempotency retrofit for
  `AddCommands`/`AddEvents`/`AddQueries` (task 03).
- `areas/query-cqrs-support.md` — Query abstractions, discovery, dispatch, and pipeline
  integration (tasks 04–05).
- `areas/documentation-and-example.md` — docs and the ExampleApp Query walkthrough (task
  06).

## Change-wide acceptance criteria

1. A Query with exactly one handler returns the expected typed result through
   `IQueryDispatcher`.
2. The Query handler is resolved through DI (`ActivatorUtilities`/`IServiceProvider`
   scope), not constructed manually.
3. A Query type with no registered handler fails deterministically
   (`NoHandlerFoundException`, matching Command's existing failure shape).
4. A Query type with more than one registered handler fails deterministically at
   resolution (`MoreThanOneHandlerFoundException`).
5. Multiple Query types with different `TResult` values work simultaneously against one
   shared `QueryProcessingStrategy` instance.
6. `AddCommands()`'s single-call registration behavior is unchanged (proven by
   characterization tests from task 01, still passing after task 02/03).
7. `AddEvents()`'s single-call registration behavior is unchanged (same).
8. `AddMessages()+AddCommands()+AddQueries()+AddEvents()` compose without duplicate
   infrastructure registration.
9. `AddCommands()`, `AddEvents()`, and `AddQueries()` are each idempotent under a repeated
   call.
10. Marker-type/explicit registration discovers only the intended handlers — no
    assembly-wide scan is introduced for Query.
11. Message-level and handler-level middleware execute around Query handlers in the same
    order/shape as Command.
12. Cancellation propagates through `IQueryDispatcher` → `IMessageProcessor` → handler,
    matching Command's existing behavior.
13. `dotnet build` and `dotnet test` (all test projects, including the new
    `NEvo.Messaging.Cqrs.Tests`) pass.

## Verification strategy

`dotnet build` across the solution; `dotnet test` across all test projects
(`tests/NEvo.Core.Tests`, `tests/NEvo.Messaging.Tests`, the new
`tests/NEvo.Messaging.Cqrs.Tests`, and the unaffected remaining test projects as a
regression check); `node tools/specs.mjs validate`; `node tools/docs.mjs validate` (docs
are touched). Manual verification of the ExampleApp Query walkthrough per task 06.

## Out of scope

- Query notifications or multi-handler Query semantics.
- Saga/orchestration, Event Sourcing redesign, new messaging transports, distributed
  Query/RPC dispatch over any transport.
- Repository-wide DI cleanup beyond the `AddCommands`/`AddEvents`/`AddQueries`
  idempotency retrofit named in D2.
- Fixing `AddMessages()`'s own internal `AddMessageProcessingMiddleware` double-registration-of-config-wrapper
  risk (a pre-existing, separate gap this change's own `AddCommands`/`AddEvents`/`AddQueries`
  scope does not require touching — noted as a candidate follow-up, not fixed here).
- Typed (generic-over-`TResult`) middleware — Query reuses the existing untyped
  middleware chain unchanged; a typed middleware contract is a possible future
  enhancement, not required for Query to work.
- Moving the fixed `examples/ExampleApp/.../ExampleDomain/Documents/*.cs` namespace
  mismatch (`NEvo.Ddd.EventSourcing.Tests.Mocks`) found during discovery — unrelated
  pre-existing issue, out of scope for this change.
