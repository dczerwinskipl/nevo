# Area: Persistence boundary

## Responsibility

Separate raw event-stream persistence from aggregate rehydration, remove the
unfinished projection-loading responsibility from the aggregate repository, introduce a
dedicated concurrency-conflict exception type, and add the minimum event envelope
fields needed to avoid painting future real providers into a corner — without
implementing a real provider.

## Current state

`IAggregateRepository` (`IAggregateRepository.cs:5-18`) declares
`AppendEventsAsync<TAggregate,TId>(TId, events, int expectedVersion, ct)`,
`LoadAggregateAsync<TAggregate,TId>(TId, ct) -> EitherAsync<Exception, Option<(TAggregate,
int Version)>>`, **and** `LoadProjectionAsync<TProjection,TId>(TProjection, ct) ->
OptionAsync<TProjection>` — mixing stream persistence, rehydration, and projection
loading in one interface. The real `AggregateRepository.LoadProjectionAsync` throws
`NotImplementedException` (`IAggregateRepository.cs:75`). `IEventStore`
(`IAggregateRepository.cs:20-29`) is the lower-level abstraction:
`AppendEventsAsync` (same signature) and `LoadEventsStreamAsync<TAggregate,TId>(TId, ct)
-> EitherAsync<Exception, (IEnumerable<IAggregateEvent<TAggregate,TId>>, int Version)>`.
`AggregateRepository : IAggregateRepository` composes `IEventStore` + `IEvolverRegistry`,
folding events via `evolver.Evolve` (`IAggregateRepository.cs:53-69`). The only
`IEventStore` implementation is in-memory `FakeEventStore`
(`ServiceCollectionExtensions.cs:11-35`), whose `AppendEventsAsync` compares
`expectedVersion != stream.Count` and returns a plain `new Exception(...)` on mismatch
(lines 20-22) — no dedicated type.

The event envelope: concrete events derive from `Event : Message`
(`src/NEvo.Messaging/Events/Event.cs:6-10`), and `Message(Guid Id, DateTime CreatedAt)`
(`src/NEvo.Messaging/Message.cs:6-9`) supplies only `Id`/`CreatedAt`. `IAggregateEvent<
TAggregate,TId>` adds only `StreamId` (`IAggregateEvent.cs:3-6`). No correlation/
causation/global-position field exists on the event itself. `IMessageContext.Headers.
CorrelationId`/`CausationId` (`Context/MessageContextHeaders.cs:19-56`) already exist as
a per-message-processing-context source, populated by `CorrelationIdMessageProcessing
Middleware`/`CausationIdMessageProcessingMiddleware`.

## Requirements

- Split the stream-persistence contract (append/load-stream/expected-version — an
  `IEventStreamStore` or equivalently named interface) from the aggregate-rehydration
  contract (`IAggregateRepository` or its refined equivalent: obtain stream, rehydrate/
  evolve, return current state + version). `LoadProjectionAsync` is removed from the
  aggregate repository (D6) — it is not replaced by a projection mechanism in this
  change (persisted projections are out of scope entirely).
- Introduce `AggregateConcurrencyException` (or an owner-naming-convention-consistent
  equivalent) thrown by `IEventStreamStore`'s append implementation(s) on an
  expected-version mismatch, surfaced through the existing `Either<Exception, T>`
  convention (D13). Update `FakeEventStore` (the only current implementation) to throw
  it.
- Add only the minimum event envelope fields genuinely needed: a stable event id
  (already available via `Message.Id`; confirm this is sufficient rather than adding a
  second id), stream/aggregate identity (already `StreamId`), stream version/revision
  (already tracked out-of-band as `expectedVersion`/return `Version` — decide whether to
  keep it out-of-band or add it to the envelope), and correlation/causation metadata
  sourced from `IMessageContext.Headers` at append time if the executor (task 04) has
  context access there. Do not add a global position/checkpoint field.
- Document the transaction/commit-ownership constraint (D6, D7): `AppendAsync`
  (or equivalent) must not be assumed to own the final application transaction commit;
  this must remain compatible with the four future persistence shapes the input
  specification names (single-transaction Event Store+inbox+outbox; EF/Marten sharing
  one physical transaction; external Event Store with no shared ACID transaction;
  modular monolith with per-module persistence).

## Constraints

- Do not implement a PostgreSQL/Marten/Kurrent provider — `FakeEventStore` remains the
  only implementation this change ships.
- Do not add global subscription position/checkpoint machinery.
- Preserve `docs/development/event-sourcing.md`'s "known unresolved decisions" list
  (concurrency control, snapshots, event schema versioning, projection rebuild, EF store
  intent) as still-open beyond what this change explicitly resolves (concurrency control
  is resolved here; the rest remain open for later specs).

## Interfaces and boundaries

- Consumes: task 01/02's fixed, reorganized baseline.
- Exposes to task 04 (shared ES executor): the new `IEventStreamStore`/repository split,
  `AggregateConcurrencyException`, and whatever envelope fields the executor needs at
  append time.
- Exposes to task 10/11 (Documents example): the contracts a real repository consumer
  implements against.

## Area-specific acceptance criteria

1. A dedicated stream-persistence interface and a dedicated rehydration interface exist,
   with no member requiring projection/read-model loading on either.
2. An expected-version mismatch on append throws/returns `AggregateConcurrencyException`
   (not a plain `Exception`), proven by a unit test against `FakeEventStore`.
3. `docs/development/event-sourcing.md` and the change's own persistence-boundary
   documentation explicitly state that append/flush and final transaction commit are
   distinct, and that this core does not require Event Store/inbox/outbox to share one
   physical transaction.
4. No new global position/checkpoint/subscription field or type is introduced.

## Dependencies

- `characterization-and-reorganization` (tasks 01-02) — this area's task (03) starts
  from the fixed, reorganized baseline.

## Out of scope

- A real persistence provider.
- Persisted projections, checkpoints, subscriptions (see `overview.md` § Out of scope).
- Cross-resource transaction coordination.
