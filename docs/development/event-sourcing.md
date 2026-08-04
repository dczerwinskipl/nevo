---
id: development.event-sourcing
type: development
title: Event sourcing
status: experimental
read_when:
  - working on NEvo.Ddd.EventSourcing
  - reviewing the event sourcing branch
summary: >
  Experimental event sourcing implementation. In progress. Do not use as the basis
  for refactoring other modules. Characterization tests are needed before changes.
related:
  - development.messaging-pipeline
  - development.package-boundaries
---

# Event sourcing

## Subsystem responsibility

**Status: experimental and in progress.** This module should not drive refactoring of
other modules. The current implementation should be protected with characterization tests
before any changes are made.

There is an existing branch with in-progress event sourcing changes. Review that branch
(Class E — Exploratory) before writing a specification for further work.

## Current abstractions (`NEvo.Ddd.EventSourcing`)

### Aggregate root

```csharp
interface IAggregateRoot<TId>
{
    TId Id { get; }
    // State is reconstructed from events, not stored directly
}
```

### Event store

```csharp
interface IEventStore
{
    Task<Either<Exception, Unit>> AppendEventsAsync<TAggregate, TId>(
        TId id, IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken ct);

    Task<Either<Exception, TAggregate>> LoadAggregateAsync<TAggregate, TId>(
        TId id, CancellationToken ct)
        where TAggregate : IAggregateRoot<TId>;

    Task<Either<Exception, TProjection>> LoadProjectionAsync<TProjection, TId>(
        TId id, CancellationToken ct)
        where TProjection : IProjectable<TId>;
}
```

### Command and event types

- `IAggregateCommand<TAggregate, TId>` — commands targeting a specific aggregate
- `ICreateAggregateCommand<TAggregate, TId>` — creation commands
- `IAggregateEvent<TAggregate, TId>` — domain events emitted by an aggregate

## Control and data flow

The implementation uses a decidable pattern: a command produces a list of events,
which are then folded into the aggregate state. The aggregate itself is reconstructed
from events rather than loaded from a state store.

## Package dependency

`NEvo.Ddd.EventSourcing` depends on `NEvo.Messaging.Cqrs`. This ties event sourcing
to the CQRS/messaging layer. Whether this dependency is intentional or should be removed
to allow event sourcing without messaging is an open question for the specification —
see `docs/development/package-boundaries.md` § "Known unresolved decisions".

## Example usage

`ServiceA.Api` demonstrates event sourcing with a `Document` aggregate: commands are
handled by the decidable, events are appended to the event store, and the aggregate
is reconstructed from events on load.

## Known unresolved decisions

- Concurrency control (optimistic locking / version checking)
- Snapshot support
- Event schema versioning
- Projection rebuild strategy
- Whether the EF event store is intended or a placeholder
