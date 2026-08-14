---
id: packages.nevo-ddd-eventsourcing
type: package
title: NEvo.Ddd.EventSourcing
status: experimental
dependencies:
  - NEvo.Messaging.Cqrs
  - NEvo.Messaging
summary: >
  Event-sourced aggregates: decide (command -> events) and evolve (events -> state)
  building blocks, wired into the NEvo.Messaging.Cqrs command pipeline. The registered
  default IEventStreamStore (FakeEventStore) is a real, working in-memory store with
  correct optimistic-concurrency semantics — not a production-durable one. See
  Limitations.
---

# NEvo.Ddd.EventSourcing

**Status: experimental.** The command-handling, registration, and authorization API
surface is stable and safe to build on; the persistence layer stays experimental
because no real, durable `IEventStreamStore` provider ships in this repository yet. See
`docs/development/event-sourcing.md` § "Status" for the precise split before starting
any change here.

## Purpose

`NEvo.Ddd.EventSourcing` implements a decider/evolver pattern for event-sourced
aggregates: a **decider** turns a command (plus the aggregate's current state, if any)
into a list of domain events; an **evolver** folds events into aggregate state. Commands
are adapted into the standard `NEvo.Messaging` handler pipeline, so dispatch goes
through the same `ICommandDispatcher`/`IMessageProcessor` path as any other command (see
[`NEvo.Messaging.Cqrs.md`](NEvo.Messaging.Cqrs.md)).

## When to use

Modeling a domain as event-sourced aggregates behind ordinary NEvo commands/queries, in
a service that can tolerate the persistence layer's current limitations (see
"Limitations"). See [`docs/usage/event-sourcing.md`](../../usage/event-sourcing.md) for
the consumer-facing guide and `docs/development/event-sourcing.md` for maintainer-facing
architecture before changing this package itself.

## When not to use

For a real, durable production event store today — the only registered
`IEventStreamStore` is in-memory. If you need durable persistence now, this package
is not yet the right tool; a real provider is future specification work.

## Responsibilities

- Define the aggregate/command/event contracts: `IAggregateRoot<TId>`,
  `IAggregateCommand<TAggregate, TId>`, `ICreateAggregateCommand<TAggregate, TId>`
  (declared but never referenced in resolution logic), `IAggregateEvent<TAggregate,
  TId>`.
- Define the persistence boundary: `IEventStreamStore` (raw stream read/append) and
  `IAggregateRepository` (rehydration + append, composing `IEventStreamStore` with the
  evolver) — see `IAggregateRepository.cs`.
- Discover and invoke deciders/evolvers reflectively from a set of registered aggregate
  types (`Deciding/`: `IDecider`, `IAggregateMethodDecider`, `AggregateDecider`,
  `IDeciderRegistry`, `IAggregateDeciderProvider`; `Evolving/`: `IEvolver`,
  `AggregateEvolver`, `IEvolverRegistry`), including per-invocation decision-method
  parameter injection (`Deciding/IDecisionMethodParameterResolver.cs`).
- Coordinate the shared load → authorize → decide → append → publish lifecycle
  (`Executing/EventSourcedCommandExecutor.cs`) for both command-handling levels.
- Adapt both command-handling levels into `NEvo.Messaging`'s `IMessageHandler` pipeline
  (`Handling/`): the aggregate-method convention (`DeciderCommandHandler`,
  `DeciderCommandHandlerAdapter`, `DeciderCommandHandlerProvider`, registered
  `HandlerRole.Fallback`) and the explicit `IEventSourcedCommandHandler<TCommand,
  TAggregate, TId>` (`EventSourcedCommandHandlerAdapter`,
  `EventSourcedCommandHandlerAdapterFactory`).
- Define the aggregate-aware authorization extension point
  (`Executing/IAggregateAuthorization.cs`, default `AllowAllAggregateAuthorization`).

## Dependencies

Depends on `NEvo.Messaging.Cqrs` (and transitively `NEvo.Messaging`) — see
`src/NEvo.Ddd.EventSourcing/NEvo.Ddd.EventSourcing.csproj`'s `ProjectReference` entries.
**No** reference to `NEvo.Messaging.Authorization` — the aggregate-aware authorization
hook's contract lives in this package without needing one; a concrete implementation of
that hook (e.g. an application's own `IAggregateAuthorization<...>`) is free to
reference `NEvo.Messaging.Authorization` itself. See
`docs/development/package-boundaries.md`.

## Public surface

Grounded directly in `src/NEvo.Ddd.EventSourcing/**/*.cs`.

```csharp
public interface IAggregateRoot<TId> where TId : notnull { TId Id { get; } }

public interface IAggregateCommand<TAggregate, TId> where TAggregate : IAggregateRoot<TId> where TId : notnull
{ TId StreamId { get; } }

public interface IAggregateEvent<TAggregate, TId> where TAggregate : IAggregateRoot<TId> where TId : notnull
{ TId StreamId { get; } }

public interface IEventStreamStore
{
    EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(
        TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events,
        ExpectedStreamState expectedState, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;

    EitherAsync<Exception, Option<(IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)>>
        LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
}

public interface IAggregateRepository
{
    EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(
        TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events,
        ExpectedStreamState expectedState, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;

    EitherAsync<Exception, Option<(TAggregate Aggregate, int Version)>>
        LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
}

public abstract record ExpectedStreamState
{
    public sealed record NoStreamState : ExpectedStreamState;
    public sealed record ExactState(int Version) : ExpectedStreamState;
    public static ExpectedStreamState NoStream { get; }
    public static ExpectedStreamState Exact(int version);
}
```

```csharp
public interface IDecider
{
    IEnumerable<DeciderDescription> GetDeciderDescriptions();
    bool CanHandle<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(
        Option<TAggregate> aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
}

public interface IAggregateMethodDecider
{
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(
        Option<TAggregate> aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
}

public interface IEvolver
{
    Either<Exception, TAggregate> Evolve<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
}

public interface IEventSourcedCommandHandler<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId> where TId : notnull
{
    EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> HandleAsync(
        TCommand command, Option<TAggregate> aggregate, CancellationToken ct);
}

public interface IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId> where TId : notnull
{
    EitherAsync<Exception, Unit> AuthorizeAsync(
        TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken ct);
}
```

`AggregateDecider`/`AggregateEvolver` discover the actual decide/evolve methods on your
aggregate types via reflection (`AggregateDeciderExtractor`/`AggregateEvolverExtractor`)
— you write plain methods on your aggregate, not implementations of `IDecider`/
`IEvolver` yourself. By convention (seen in
`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/Document.cs`): a decide method
takes the command, optionally followed by additional framework-resolved parameters
(e.g. `ICurrentUser<Guid, TUser>`), and returns `Either<Exception, IEnumerable<TEvent>>`
(e.g. `Create(CreateDocument)`, `Approve(ApproveDocument, ICurrentUser<Guid,
DemoUser>)`); an evolve method takes an event and returns the new aggregate state (e.g.
`Apply(DocumentCreated)` — evolving can change the aggregate's runtime type, not just
mutate it in place).

`EventSourcedCommandExecutor.ExecuteAsync` is the actual shared command-handling flow
for both levels: `IAggregateRepository.LoadAggregateAsync` → `IAggregateAuthorization.
AuthorizeAsync` → a caller-supplied `decide` delegate (either `IDecider.DecideAsync` for
the convention, or an explicit `IEventSourcedCommandHandler.HandleAsync`) →
`IAggregateRepository.AppendEventsAsync` (with `ExpectedStreamState` computed from the
loaded state) → synchronous `IEventPublisher.PublishAsync` per event, append always
before publish. See `docs/development/event-sourcing.md` for the full lifecycle and
authorization-ownership details.

## Configuration

```csharp
builder.Services.AddMessages();          // NEvo.Messaging
builder.Services.AddCommands();          // NEvo.Messaging.Cqrs
builder.Services.AddEventSourcing(
    options => options.UseAggregateMethodFallback = true,   // default; additive overload
    typeof(MyAggregate), typeof(MyOtherAggregate));
```

`AddEventSourcing` registers, all via `TryAdd*` (idempotent): `IEventStreamStore` →
`FakeEventStore` (in-memory), `IAggregateRepository` → `AggregateRepository`,
`IEvolverRegistry`/`IDeciderRegistry`/`IAggregateDeciderProvider`, `IEventSourcedCommandExecutor`,
`IAggregateAuthorization<,,>` → `AllowAllAggregateAuthorization<,,>` (permit-everything
default), and — only when `EventSourcingOptions.UseAggregateMethodFallback` is `true`
(the default) — the convention route's `IMessageHandlerProvider`. The older
`AddEventSourcing(params Type[])` overload still compiles, delegating to the options
overload with defaults.

## Limitations

- **No real, durable event store ships in this package.** The registered default,
  `FakeEventStore` (`src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs`), is a
  real in-memory implementation with correct optimistic-concurrency semantics (not a
  discard-everything stub) — but it holds everything in memory for the process's
  lifetime only. A PostgreSQL/Marten/Kurrent-style provider is future specification
  work.
- No snapshot support, no event schema versioning/upcasting, no persisted-projection
  mechanism — see `docs/development/event-sourcing.md` § "Known open questions".
- `ICreateAggregateCommand<TAggregate, TId>` is declared but never referenced by any
  resolution logic — create-vs-mutate is inferred purely from `Option<TAggregate>` being
  `None`/`Some`.

## Related packages

- [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md), [`NEvo.Messaging`](NEvo.Messaging.md)
  — both real dependencies; decider-backed commands are `Command`s dispatched through
  the normal CQRS/messaging pipeline.
- `NEvo.Messaging.Authorization` — not a dependency of this package, but where
  `ICurrentUser<TId, TUser>` and `PermissionDeniedException` live; a decision method may
  request `ICurrentUser<TId, TUser>` via parameter injection without this package
  referencing that one.

## Examples and tests

- `examples/ExampleApp/NEvo.ExampleApp.Documents.Api` — the canonical, runnable
  reference implementation: aggregate-method convention handling, message-level permission,
  decision-method parameter injection, both `MapCommandEndpoint`/`MapQueryEndpoint`
  mappings. See its own `WALKTHROUGH.md`.
- `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs`,
  `DocumentCommands.cs`, `DocumentEvents.cs` — the decide/evolve fixture used by this
  package's own test suite.
- `tests/NEvo.Ddd.EventSourcing.Tests/Deciding/AggregateDeciderTests.cs`,
  `AggregateDeciderExtractorTests.cs`, `AggregateDeciderParameterInjectionTests.cs`,
  `DeciderCommandHandlerTests.cs`, `Evolving/AggregateEvolverTests.cs`,
  `AggregateDeciderEvolverIntegrationTests.cs`, `Executing/
  AllowAllAggregateAuthorizationTests.cs`, `FakeEventStoreExpectedStreamStateTests.cs` —
  the primary coverage for reflection-based discovery, parameter injection, the
  decide/append/evolve flow, and expected-stream-state/concurrency behavior.
