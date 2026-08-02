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
[Event sourcing](../architecture/event-sourcing.md)'s (`architecture.event-sourcing`)
front matter — this module should not drive refactoring of other modules, and its
current implementation should be protected with characterization tests before changes.

## Purpose

`NEvo.Ddd.EventSourcing` implements a "decidable" pattern for event-sourced aggregates:
a **decider** turns a command (plus the aggregate's current state, if any) into a list
of domain events; an **evolver** folds events into aggregate state. Commands are
adapted into the standard `NEvo.Messaging` handler pipeline, so dispatch goes through
the same `ICommandDispatcher`/`IMessageProcessor` path as any other command (see
[`NEvo.Messaging.Cqrs.md`](NEvo.Messaging.Cqrs.md)).

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

Depends on `NEvo.Messaging.Cqrs` (and transitively `NEvo.Messaging`) — confirmed
against `src/NEvo.Ddd.EventSourcing/NEvo.Ddd.EventSourcing.csproj`'s 2
`ProjectReference` entries. This ties event sourcing to the CQRS/messaging layer; per
[Event sourcing](../architecture/event-sourcing.md), whether this dependency should
be removable is an open question for a future specification, not decided.

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

**`IEvolver`/`AggregateEvolver` is not registered by `AddEventSourcing` at all** —
source has a bare `// evolvers?` comment where that wiring would go. If your own event
store implementation needs evolving (most will, to rebuild aggregate state from a
stored event stream), you must register `IEvolver` yourself.

## Basic usage

Adapted from `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs` — a real fixture
in this repository's own test suite, not a hypothetical:

```csharp
public abstract class Document(Guid id, string data) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;
    public string Data { get; set; } = data;

    public static Either<Exception, IEnumerable<DocumentDomainEvent>> Create(CreateDocument command)
        => new[] { new DocumentCreated(command.DocumentId, command.Data) };

    public static Document Apply(DocumentCreated @event)
        => new EditableDocument(@event.DocumentId, @event.Data);
}

public class EditableDocument(Guid id, string data) : Document(id, data)
{
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Change(ChangeDocument command)
        => new[] { new DocumentChanged(Id, command.Data) };

    public Document Apply(DocumentChanged @event) => new EditableDocument(Id, @event.Data);
}
```

Note that evolving can change the aggregate's runtime type (`Document` →
`EditableDocument` on creation) — the state machine is expressed through the type
hierarchy, not just field mutation.

## Advanced usage

No advanced usage beyond the above is documented yet.

## Limitations

- **The default `IEventStore` registered by `AddEventSourcing` is a non-functional
  stub.** `ServiceCollectionExtensions.cs` defines and registers `FakeEventStore`:
  `AppendEventsAsync` does nothing and reports success; `LoadAggregateAsync` and
  `LoadProjectionAsync` always return "not found" (`None`). Nothing is actually
  persisted. This is registered via `TryAddScoped`, so a consumer *can* override it by
  registering a real `IEventStore` implementation first — but no real implementation
  ships anywhere in this repository today (confirmed: no other class implements
  `IEventStore` in `src/`). Using `AddEventSourcing()` as-is silently discards every
  event.
- **`IEvolver` is not wired up by `AddEventSourcing`** — see "Configuration". The
  "decidable pattern" (decide → evolve) described in the architecture doc is not fully
  wired end-to-end by this package's own DI helper.
- **`AggregateEvolver`'s evolver map is a `static` field**, lazily built via `??=` from
  whichever instance is constructed first with its `aggregateTypes` array. Constructing
  a second `AggregateEvolver` with a *different* set of aggregate types does **not**
  rebuild the map — it silently keeps the first instance's set (source even has a
  `// TODO: add DI with some registry?` comment acknowledging this). Only construct one
  `AggregateEvolver` per process, covering every aggregate type you need.
- Per [Event sourcing](../architecture/event-sourcing.md) § "What is not yet
  specified": concurrency control, snapshot support, event schema versioning,
  projection rebuild strategy, and whether an EF-backed event store is even intended
  are all open questions — this doc doesn't resolve them, consistent with that
  architecture doc.

## Related packages

- [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md), [`NEvo.Messaging`](NEvo.Messaging.md)
  — both real dependencies; decider-backed commands are `Command`s dispatched through
  the normal CQRS/messaging pipeline.

## Examples and tests

- `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs`,
  `DocumentCommands.cs`, `DocumentEvents.cs` — the decide/evolve example used above.
- `tests/NEvo.Ddd.EventSourcing.Tests/Deciding/AggregateDeciderTests.cs`,
  `Deciding/DeciderCommandHandlerTests.cs`, `Evolving/AggregateEvolverTests.cs`,
  `AggregateDeciderEvolverIntegrationTests.cs` — the primary coverage for this
  package's reflection-based discovery and the decide/append/evolve flow.
