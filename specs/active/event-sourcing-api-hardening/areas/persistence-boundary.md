# Area: Persistence boundary

## Responsibility

Separate raw event-stream persistence from aggregate rehydration, remove the
unfinished projection-loading responsibility from the aggregate repository, and
introduce a dedicated concurrency-conflict exception type — without implementing a
real provider and **without designing a persisted event envelope** (D20-D22; see
scope note below).

**Scope note (2026-08-11, final spec-refine):** this area's original responsibility
also included "add the minimum event envelope fields." That is removed, not reduced —
no envelope type, minimal or otherwise, is introduced. Domain event payload, runtime
message-processing context (`IMessageContext`), and a future provider's own persisted
representation are three distinct, undesigned-here concerns (D20-D22,
`owner-decisions.md`; full statement in `overview.md` § "Architectural principles").

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

**The "magic `0`" problem (D29).** `DeciderCommandHandler.HandleAsync`
(`Handling/DeciderCommandHandler.cs`) calls `AppendEventsAsync(..., expectedVersion: 0,
...)` for the creation path (`Option<TAggregate>.None`) and `AppendEventsAsync(...,
expectedVersion: loaded.Version, ...)` for the mutation path
(`Option<TAggregate>.Some`) — the literal `0` is overloaded to mean both "the stream
must not already exist" and "the expected version happens to be zero," a distinction a
real provider (PostgreSQL/Marten/Kurrent-style) naturally keeps separate.
`FakeEventStore.LoadEventsStreamAsync` (`ServiceCollectionExtensions.cs`) also
side-effects a stream into existence merely by being read
(`_store.GetOrAdd(streamId, _ => [])`) — a missing stream and an existing-but-empty
stream are currently indistinguishable at the read boundary.

Domain events already derive from `Event : Message`
(`src/NEvo.Messaging/Events/Event.cs:6-10`), and `Message(Guid Id, DateTime CreatedAt)`
(`src/NEvo.Messaging/Message.cs:6-9`) supplies only `Id`/`CreatedAt`. `IAggregateEvent<
TAggregate,TId>` adds only `StreamId` (`IAggregateEvent.cs:3-6`). No correlation/
causation/global-position field exists on the event itself, and **none is added by
this area** (D20-D22) — `IMessageContext.Headers.CorrelationId`/`CausationId`
(`Context/MessageContextHeaders.cs:19-56`) already exist as runtime
message-processing-context metadata, populated by `CorrelationIdMessageProcessing
Middleware`/`CausationIdMessageProcessingMiddleware`, and stay exactly there.

## Requirements

- Split the stream-persistence contract (append/load-stream/expected-version — an
  `IEventStreamStore` or equivalently named interface) from the aggregate-rehydration
  contract (`IAggregateRepository` or its refined equivalent: obtain stream, rehydrate/
  evolve, return current state + version). `LoadProjectionAsync` is removed from the
  aggregate repository (D6) — it is not replaced by a projection mechanism in this
  change (persisted projections are out of scope entirely).
- Introduce `AggregateConcurrencyException` (or an owner-naming-convention-consistent
  equivalent) **returned** by `IEventStreamStore`'s append implementation(s) on an
  expected-version mismatch, via the existing `Either<Exception, T>` convention (D13) —
  never thrown. Update `FakeEventStore` (the only current implementation) to return it
  in place of the current plain `Exception`.
- **Do not add any event envelope, correlation/causation field, or persistence-metadata
  type (D20-D22).** Stream version stays exactly where it is today — an out-of-band
  `int` parameter/return value, not a field on any type. `Message.Id` remains the only
  event identity; do not add a second id. If population of correlation/causation into
  some future persisted representation ever becomes necessary, that is the next
  real-provider specification's decision (D22), not this area's.
- Document the transaction/commit-ownership constraint (D6, D7, D23): `AppendAsync`
  (or equivalent) must not be assumed to own the final application transaction commit;
  this must remain compatible with the four future persistence shapes the input
  specification names (single-transaction Event Store+inbox+outbox; EF/Marten sharing
  one physical transaction; external Event Store with no shared ACID transaction;
  modular monolith with per-module persistence).
- **Replace the magic `expectedVersion = 0` create convention with an explicit expected-
  stream-state concept (D29).** `IEventStreamStore`'s append contract distinguishes
  `NoStream` (valid only if the stream does not exist) from `Exact(version)` (valid only
  if the stream is at exactly that version) — exact naming not owner-fixed (e.g.
  `ExpectedStreamState`/`ExpectedStreamVersion`, each with `NoStream`/`Exact(version)`
  cases). **Do not add `Any`/`IgnoreVersion`/unconditional-append, and do not add
  automatic retry/rebase semantics** — D29 explicitly rejects both; there is no current
  use case for either.
- **The stream read contract must preserve stream existence (D29).** The low-level read
  result must let the repository distinguish "missing stream" from "existing stream at
  a particular revision" explicitly — not merely `events: [], version: 0` for both. Use
  the smallest coherent shape (e.g. an `Option<StreamData>`-style result) — do not
  introduce a full provider event-envelope/storage-record abstraction to achieve this
  (D20-D22 still apply).
- **`FakeEventStore`'s read path must not create a stream as a side effect of being
  read (D29).** A read of a nonexistent stream stays observably "no stream" until an
  append actually creates it — fix the current `GetOrAdd`-on-read behavior.

## Constraints

- Do not implement a PostgreSQL/Marten/Kurrent provider — `FakeEventStore` remains the
  only implementation this change ships.
- Do not add global subscription position/checkpoint machinery.
- Preserve `docs/development/event-sourcing.md`'s "known unresolved decisions" list
  (concurrency control, snapshots, event schema versioning, projection rebuild, EF store
  intent) as still-open beyond what this change explicitly resolves (concurrency control
  is resolved here; the rest remain open for later specs).
- D22 remains in force — introducing `NoStream`/`Exact(version)` semantics does not
  freeze the low-level provider SPI; the next real-provider specification may still
  refine the concrete storage/revision representation.

## Interfaces and boundaries

- Consumes: task 01's characterized baseline (D15/D19 — no folder reorganization or
  build-fix work precedes this area).
- Exposes to task 03 (shared ES executor): the new `IEventStreamStore`/repository split
  and `AggregateConcurrencyException`. No envelope fields are exposed because none
  exist (D20-D22).
- Exposes to task 09/10 (Documents example): the contracts a real repository consumer
  implements against.

## Area-specific acceptance criteria

1. A dedicated stream-persistence interface and a dedicated rehydration interface exist,
   with no member requiring projection/read-model loading on either.
2. An expected-version mismatch on append **returns** `AggregateConcurrencyException`
   as `Either<Exception, Unit>.Left` (not a plain `Exception`, never thrown), proven by
   a unit test against `FakeEventStore`.
3. `docs/development/event-sourcing.md` and the change's own persistence-boundary
   documentation explicitly state that append/flush and final transaction commit are
   distinct, and that this core does not require Event Store/inbox/outbox to share one
   physical transaction.
4. No new global position/checkpoint/subscription field or type is introduced.
5. No event envelope, correlation/causation field, or other persistence-metadata type
   is introduced anywhere in this area's diff (D20-D22).
6. The append contract expresses `NoStream`/`Exact(version)` distinctly — no member or
   caller relies on the numeric literal `0` to mean "create" (inspection + a unit test
   asserting a `NoStream` append against an existing stream fails with
   `AggregateConcurrencyException`, per D29).
7. A read of a stream that was never appended to returns an explicit "missing"
   result and does not create an entry in `FakeEventStore`'s backing store as a side
   effect (automated, per D29).
8. No `Any`/`IgnoreVersion`/unconditional-append mode and no automatic retry/rebase
   behavior exists anywhere in this area's diff (inspection, per D29).

## Dependencies

- `characterization-and-baseline` (task 01) — this area's task (02) starts from the
  fixed, characterized baseline (D15: no folder reorganization precedes this area).

## Out of scope

- A real persistence provider.
- Persisted projections, checkpoints, subscriptions (see `overview.md` § Out of scope).
- Cross-resource transaction coordination.
