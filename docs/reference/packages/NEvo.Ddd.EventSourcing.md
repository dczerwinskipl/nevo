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
  building blocks, wired into the NEvo.Messaging.Cqrs command pipeline. The default
  IEventStore registered by this package is a non-functional stub — see Limitations.
---

# NEvo.Ddd.EventSourcing

**Status: experimental and in progress.** Carried from
`docs/development/event-sourcing.md`'s front matter — this module should not drive
refactoring of other modules, and its current implementation should be protected with
characterization tests before changes.

## Purpose

`NEvo.Ddd.EventSourcing` implements a "decidable" pattern for event-sourced aggregates:
a **decider** turns a command (plus the aggregate's current state, if any) into a list
of domain events; an **evolver** folds events into aggregate state. Commands are
adapted into the standard `NEvo.Messaging` handler pipeline, so dispatch goes through
the same `ICommandDispatcher`/`IMessageProcessor` path as any other command (see
[`NEvo.Messaging.Cqrs.md`](NEvo.Messaging.Cqrs.md)).

## When to use

Experimental — only for exploratory work on event-sourced aggregates, not production
use. See `docs/development/event-sourcing.md` before starting any change here.

## When not to use

For any production or stable use case. The default event store is non-functional (see
"Limitations") and this module is explicitly not meant to drive refactoring elsewhere.

## Responsibilities

- Define the aggregate/command/event contracts: `IAggregateRoot<TId>`,
  `IAggregateCommand<TAggregate, TId>`, `ICreateAggregateCommand<TAggregate, TId>`,
  `IAggregateEvent<TAggregate, TId>`, `IProjectable<TId>`.
- Define the event-store contract (`IEventStore`) an application persists to and loads
  from.
- Discover and invoke deciders reflectively from a set of aggregate types
  (`Deciding/`: `IDecider`, `AggregateDecider`, `IDeciderRegistry`,
  `IAggregateDeciderProvider`).
- Discover and invoke evolvers reflectively (`Evolving/`: `IEvolver`,
  `AggregateEvolver`).
- Adapt decider-based command handling into `NEvo.Messaging`'s `IMessageHandler`
  pipeline (`Handling/`: `DeciderCommandHandler`, `DeciderCommandHandlerAdapter`,
  `DeciderCommandHandlerProvider`).

## Dependencies

Depends on `NEvo.Messaging.Cqrs` (and transitively `NEvo.Messaging`) — see
`src/NEvo.Ddd.EventSourcing/NEvo.Ddd.EventSourcing.csproj`'s `ProjectReference` entries.
This ties event sourcing to the CQRS/messaging layer; per
`docs/development/package-boundaries.md` § "Known unresolved decisions", whether this
dependency should be removable is an open question for a future specification, not
decided.

## Public surface

Grounded directly in `src/NEvo.Ddd.EventSourcing/**/*.cs`.

```csharp
public interface IAggregateRoot<TId> : IProjectable<TId> where TId : notnull { }
public interface IProjectable<TId> where TId : notnull { TId Id { get; } }

public interface IAggregateCommand<TAggregate, TId> where TAggregate : IAggregateRoot<TId> where TId : notnull
{ TId StreamId { get; } }

public interface IAggregateEvent<TAggregate, TId> where TAggregate : IAggregateRoot<TId> where TId : notnull
{ TId StreamId { get; } }

public interface IEventStore
{
    EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
    OptionAsync<TAggregate> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId> where TId : notnull;
    OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId> where TId : notnull;
}
```

```csharp
public interface IDecider
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
```

`AggregateDecider`/`AggregateEvolver` discover the actual decide/evolve methods on your
aggregate types via reflection (`AggregateDeciderExtractor`/`AggregateEvolverExtractor`)
— you write plain methods on your aggregate, not implementations of `IDecider`/
`IEvolver` yourself. By convention (seen in `tests/NEvo.Ddd.EventSourcing.Tests/
Fixtures/Document.cs`): a decide method takes the command and returns
`Either<Exception, IEnumerable<TEvent>>` (e.g. `Create(CreateDocument)`,
`Change(ChangeDocument)`); an evolve method takes an event and returns the new
aggregate state (e.g. `Apply(DocumentCreated)` returning a different concrete type —
evolving can change the aggregate's runtime type, not just mutate it in place).

`DeciderCommandHandler<TCommand, TAggregate, TId>.HandleAsync` is the actual
command-handling flow: load the aggregate from `IEventStore` (or `None` for a creation
command) → `IDecider.DecideAsync` → `IEventStore.AppendEventsAsync`. Note that this
handler does **not** call `IEvolver` — it appends the decided events directly; the
evolver is used separately (via `AggregateExtensions.ExecuteAsync`) when *reconstructing
current state* from a stream of events, which is `IEventStore.LoadAggregateAsync`'s job
for a real store implementation, not something this package's own handler does inline.

## Configuration

```csharp
builder.Services.AddMessages();          // NEvo.Messaging
builder.Services.AddCommands();          // NEvo.Messaging.Cqrs
builder.Services.AddEventSourcing(typeof(MyAggregate), typeof(MyOtherAggregate));
```

`AddEventSourcing(params Type[] aggregateTypes)` registers `IMessageHandlerProvider` →
`DeciderCommandHandlerProvider` (so decider-backed commands dispatch through the normal
`NEvo.Messaging` pipeline), `IDeciderRegistry`/`IDecider`/`IAggregateDeciderProvider`
(reflection-based decider discovery over `aggregateTypes`), and — **critically** — a
default `IEventStore`. See "Limitations" before relying on that default for anything
real.

**`IEvolver`/`AggregateEvolver` is not registered by `AddEventSourcing` at all.** If
your own event store implementation needs evolving (most will, to rebuild aggregate
state from a stored event stream), you must register `IEvolver` yourself.

## Limitations

- **The default `IEventStore` registered by `AddEventSourcing` is a non-functional
  stub** that silently discards every event — see `docs/project/known-issues.md` § "The
  default event store is a non-functional stub". Registered via `TryAddScoped`, so a
  consumer *can* override it, but no real implementation ships anywhere in this
  repository today.
- **`IEvolver` is not wired up by `AddEventSourcing`** — see "Configuration". The
  "decidable pattern" (decide → evolve) is not fully wired end-to-end by this package's
  own DI helper.
- **`AggregateEvolver`'s evolver map does not rebuild across instances** — see
  `docs/project/known-issues.md` § "`AggregateEvolver`'s evolver map does not rebuild
  across instances". Only construct one `AggregateEvolver` per process.
- Per `docs/development/event-sourcing.md` § "Known unresolved decisions": concurrency
  control, snapshot support, event schema versioning, projection rebuild strategy, and
  whether an EF-backed event store is even intended are all open questions this doc
  doesn't resolve.

## Related packages

- [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md), [`NEvo.Messaging`](NEvo.Messaging.md)
  — both real dependencies; decider-backed commands are `Command`s dispatched through
  the normal CQRS/messaging pipeline.

## Examples and tests

- `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs`,
  `DocumentCommands.cs`, `DocumentEvents.cs` — a decide/evolve example, used as the
  domain fixture for this package's own test suite (and reused directly by the example
  app — see `docs/usage/example-app-walkthrough.md`).
- `tests/NEvo.Ddd.EventSourcing.Tests/Deciding/AggregateDeciderTests.cs`,
  `Deciding/DeciderCommandHandlerTests.cs`, `Evolving/AggregateEvolverTests.cs`,
  `AggregateDeciderEvolverIntegrationTests.cs` — the primary coverage for this
  package's reflection-based discovery and the decide/append/evolve flow.
