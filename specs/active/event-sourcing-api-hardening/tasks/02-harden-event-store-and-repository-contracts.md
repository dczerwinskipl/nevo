---
id: event-sourcing-api-hardening.harden-event-store-and-repository-contracts
status: draft
change: event-sourcing-api-hardening
depends_on:
  - fix-build-and-characterize-baseline
semantic_references:
  decisions: [D6, D13, D17]
  dependency_contracts: [fix-build-and-characterize-baseline]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/persistence-boundary.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/IAggregateRepository.cs
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
    - src/NEvo.Messaging/Context/IMessageContext.cs
    - src/NEvo.Messaging/Context/MessageContextHeaders.cs
  optional:
    - docs/development/transaction-model.md
    - docs/development/inbox-outbox.md
    - docs/reference/packages/NEvo.Ddd.EventSourcing.md
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - examples/**
---

# Task: Harden Event Store and Aggregate Repository contracts

## Goal

Split raw stream persistence from aggregate rehydration, remove the unfinished
projection-loading responsibility from the aggregate repository, and introduce a
dedicated `AggregateConcurrencyException` for expected-version mismatches (D6, D13) —
while keeping the contracts agnostic to *how* a caller produces the next aggregate
state (D17), and keeping the domain event payload conceptually distinct from
persisted-envelope metadata.

## Dependencies

- `fix-build-and-characterize-baseline` (task 01) — this task's changes land on top of
  the fixed, characterized baseline. (Note: the folder/namespace reorganization
  previously planned as a separate task 02 was removed per D15 — this task now depends
  directly on task 01.)

## Implementation constraints

- Introduce a stream-persistence-only interface (`IEventStreamStore` or a name
  consistent with existing repository terminology) with append/load-stream/expected-
  version members only. Refine `IAggregateRepository` to obtain a stream, rehydrate/
  evolve, and return current state + version — remove `LoadProjectionAsync` entirely
  (its real implementation throws `NotImplementedException` today; removing it is not a
  behavior change for any real caller).
- Add `AggregateConcurrencyException` (public, in this package) and update
  `FakeEventStore`'s append implementation to **return** it (never throw — the current
  code already returns a plain `Exception` via implicit conversion into
  `EitherAsync<Exception, Unit>`'s `Left`, per D13's corrected wording; this task
  changes only the exception *type*, not the return-vs-throw shape) on an
  expected-version mismatch.
- Do not add a global position/checkpoint field. If a correlation/causation field is
  added to the event envelope, source it from `IMessageContext.Headers.CorrelationId`/
  `CausationId` at the point the executor (task 03) has context access — do not invent a
  new correlation mechanism. If task 03's executor doesn't yet exist to supply this at
  append time, it is acceptable for this task to add the envelope field(s) as optional/
  nullable and leave population to task 03, documenting that explicitly.
- Keep the domain event payload (e.g. `DocumentApproved`, a concrete `IAggregateEvent<
  TAggregate,TId>` implementation) conceptually and structurally separate from
  persisted-envelope/storage metadata (stream version/revision, any added correlation/
  causation fields) — a domain event class must not itself be responsible for carrying
  provider-specific storage concerns. If the current `IAggregateEvent<TAggregate,TId>`
  shape already keeps these separate (it does today — version is an out-of-band
  parameter, not a field on the event), preserve that; do not merge them while adding
  the concurrency exception or any envelope field.
- Design the new interfaces so nothing in their public shape requires the caller's next
  state to be produced by an instance method on an immutable aggregate-state object
  (D17) — load/append/version semantics are about the *event stream*, not about how the
  caller derived the events it's appending. This costs nothing extra to implement
  correctly; it only means not encoding an assumption like "the caller always calls
  `evolver.Evolve` on an object" into the interface's own signatures (which the current
  `IEventStreamStore`/`IAggregateRepository` split, being framed purely in terms of
  events/streams, already avoids — this is a constraint to preserve, not a new design
  problem to solve).
- Rename members only where doing so materially clarifies the split (e.g. `AppendEventsAsync`
  staying on both the stream store and, if still needed, the repository's pass-through)
  — do not rename for its own sake beyond what the interface split requires.

## Acceptance criteria

1. A stream-persistence interface exists with no rehydration or projection member; the
   aggregate-repository interface has no projection-loading member (automated:
   `dotnet build` plus inspection that the removed member is gone).
2. `AggregateConcurrencyException` is **returned** as `Either<Exception, Unit>.Left` on
   an expected-version mismatch (never thrown), proven by a unit test against the
   updated `FakeEventStore` (automated).
3. Every existing characterization test from task 01 covering append/load still passes
   unmodified in its assertions (automated).
4. No global position/checkpoint field or subscription-related type is introduced
   (inspection).
5. Neither `IEventStreamStore` nor `IAggregateRepository`'s public members reference or
   require any specific aggregate-state modeling style (e.g. no member typed in terms
   of "an object with an `Evolve` method") — inspection, per D17.

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — the user-facing (task 11) and internal (task 12) documentation
rewrites are sequenced after every functional task lands.

## Out of scope

- A real persistence provider.
- Persisted projections, checkpoints, subscriptions.
- Cross-resource transaction coordination.
- Populating correlation/causation fields end-to-end (task 03, if the envelope field is
  added here as optional).
- Any folder/namespace reorganization, and wiring `ICreateAggregateCommand` into any
  resolution logic — both out of scope for the whole change (D15, D16).
