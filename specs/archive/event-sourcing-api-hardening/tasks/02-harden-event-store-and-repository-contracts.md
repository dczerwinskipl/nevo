---
id: event-sourcing-api-hardening.harden-event-store-and-repository-contracts
status: draft
change: event-sourcing-api-hardening
depends_on:
  - characterize-event-sourcing-baseline
semantic_references:
  decisions: [D6, D13, D17, D19, D20, D21, D29]
  dependency_contracts: [characterize-event-sourcing-baseline]
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
projection-loading responsibility from the aggregate repository, introduce a
dedicated `AggregateConcurrencyException` for expected-version mismatches (D6, D13),
and replace the magic `expectedVersion = 0` create convention with an explicit
`NoStream`/`Exact(version)` expected-stream-state concept (D29) — while keeping the
contracts agnostic to *how* a caller produces the next aggregate state (D17). **Do not
design a persisted event envelope of any kind, minimal or otherwise (D20-D22)** — this
task's scope on that front is to preserve today's separation (domain event payload vs.
out-of-band stream version), not to extend it.

## Dependencies

- `characterize-event-sourcing-baseline` (task 01) — this task's changes land on top of
  the characterized baseline (D15: no folder reorganization precedes this task; D19:
  the baseline is the branch's current green build, not a build this task fixes).

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
- **Do not add any envelope, correlation/causation field, or persistence-metadata type
  (D20-D22, closed — not an open implementation choice).** Stream version stays exactly
  where it is today: an out-of-band `int` parameter/return value on the store/
  repository contracts, never a field on any type. `Message.Id` remains the only event
  identity; do not add a second one. If this task's implementation finds a concrete
  reason an envelope is unavoidable, stop and report it as new evidence contradicting
  D20-D22 — do not silently add one.
- Keep the domain event payload (e.g. `DocumentApproved`, a concrete `IAggregateEvent<
  TAggregate,TId>` implementation) exactly as it is today — `Event : Message` plus
  `StreamId`, nothing added. This task must not touch `IAggregateEvent<TAggregate,TId>`
  or any concrete domain event type to add storage-metadata fields.
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
- **Replace `int expectedVersion` with an explicit expected-stream-state concept (D29):**
  a `NoStream` case (valid only if the stream does not yet exist) and an `Exact(version)`
  case (valid only if the stream is at exactly that version). Exact type/case naming is
  this task's judgment call (e.g. `ExpectedStreamState.NoStream`/
  `ExpectedStreamState.Exact(int version)`) — ground it in existing NEvo naming
  conventions. Update `DeciderCommandHandler`'s (or its task-03 successor's) call sites
  so the creation path (`Option<TAggregate>.None`) passes `NoStream` and the mutation
  path (`Option<TAggregate>.Some`) passes `Exact(loaded.Version)` — no call site may
  construct this from a bare integer literal `0` to mean "create." **Do not add an
  `Any`/`IgnoreVersion`/unconditional-append case, and do not add retry/rebase
  semantics** — both explicitly rejected by D29.
- **Make the stream read result preserve existence (D29):** `LoadEventsStreamAsync` (or
  its refined equivalent) must let the caller distinguish "this stream has never been
  appended to" from "this stream exists with N events" — do not collapse both into
  `(events: [], version: 0)`. Use the smallest coherent shape (e.g. wrapping the current
  tuple in an `Option<...>`, or an equivalent explicit result) — do not build a general
  provider event-envelope/storage-record type to achieve this (D20-D22 still apply).
- **Fix `FakeEventStore`'s read-creates-a-stream side effect (D29):**
  `LoadEventsStreamAsync`'s current `_store.GetOrAdd(streamId, _ => [])` implicitly
  creates an empty stream entry merely by being read. After this task, reading a stream
  that has never been appended to must return the explicit "missing" result without
  mutating `FakeEventStore`'s backing dictionary — verify with a test that reads the
  same nonexistent stream twice and then asserts a subsequent `NoStream` append still
  succeeds (proving the second read didn't silently "create" it).

## Acceptance criteria

1. A stream-persistence interface exists with no rehydration or projection member; the
   aggregate-repository interface has no projection-loading member (automated:
   `dotnet build` plus inspection that the removed member is gone).
2. `AggregateConcurrencyException` is **returned** as `Either<Exception, Unit>.Left` on
   an expected-version mismatch (never thrown), proven by a unit test against the
   updated `FakeEventStore` (automated).
3. Every existing characterization test from task 01 covering append/load still passes,
   with its *assertions* unchanged — call sites necessarily adapt to the new
   `NoStream`/`Exact(version)` parameter type in place of a bare `int` (D29), but no
   test's expected outcome changes (automated).
4. No global position/checkpoint field or subscription-related type is introduced
   (inspection).
5. Neither `IEventStreamStore` nor `IAggregateRepository`'s public members reference or
   require any specific aggregate-state modeling style (e.g. no member typed in terms
   of "an object with an `Evolve` method") — inspection, per D17.
6. No event envelope, correlation/causation field, or other persistence-metadata type
   exists anywhere in this task's diff (inspection, per D20-D22).
7. A read of a stream that has never been appended to returns an explicit "missing"
   result (automated).
8. That same read does not create a backing-store entry as a side effect — proven by
   reading a nonexistent stream, then successfully appending to it with `NoStream`
   (automated; a prior side-effect creation would make this fail with a concurrency
   conflict instead).
9. A `NoStream` append succeeds when the stream does not exist, and fails with
   `AggregateConcurrencyException` (returned, never thrown) when it already exists
   (automated).
10. An `Exact(version)` append succeeds at the observed version and fails with
    `AggregateConcurrencyException` after another writer has advanced the stream
    (automated — this is the existing optimistic-concurrency behavior, now expressed
    through the explicit case instead of a bare integer).
11. No `Any`/`IgnoreVersion`/unconditional-append case and no automatic retry/rebase
    logic exists anywhere in this task's diff (inspection, per D29).
12. No call site constructs the expected-stream-state value from a bare integer literal
    `0` to mean "create" (inspection).

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
- Any event envelope, correlation/causation field, or persistence-metadata type
  (D20-D22) — this is not deferred to a later task in this change, it is not designed
  at all here.
- Any folder/namespace reorganization, and wiring `ICreateAggregateCommand` into any
  resolution logic — both out of scope for the whole change (D15, D16).
