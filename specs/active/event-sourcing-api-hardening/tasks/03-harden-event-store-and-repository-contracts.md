---
id: event-sourcing-api-hardening.harden-event-store-and-repository-contracts
status: draft
change: event-sourcing-api-hardening
depends_on:
  - separate-core-and-integration-folders
semantic_references:
  decisions: [D6, D13]
  dependency_contracts: [separate-core-and-integration-folders]
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
dedicated `AggregateConcurrencyException` for expected-version mismatches (D6, D13).

## Dependencies

- `separate-core-and-integration-folders` (task 02) — this task's new/renamed types
  land in the reorganized folder layout.

## Implementation constraints

- Introduce a stream-persistence-only interface (`IEventStreamStore` or a name
  consistent with existing repository terminology) with append/load-stream/expected-
  version members only. Refine `IAggregateRepository` to obtain a stream, rehydrate/
  evolve, and return current state + version — remove `LoadProjectionAsync` entirely
  (its real implementation throws `NotImplementedException` today; removing it is not a
  behavior change for any real caller).
- Add `AggregateConcurrencyException` (public, in this package) and update
  `FakeEventStore`'s append implementation to throw/return it (via
  `Either<Exception, T>`, per existing convention) instead of a plain `new
  Exception(...)` on an expected-version mismatch.
- Do not add a global position/checkpoint field. If a correlation/causation field is
  added to the event envelope, source it from `IMessageContext.Headers.CorrelationId`/
  `CausationId` at the point the executor (task 04) has context access — do not invent a
  new correlation mechanism. If task 04's executor doesn't yet exist to supply this at
  append time, it is acceptable for this task to add the envelope field(s) as optional/
  nullable and leave population to task 04, documenting that explicitly.
- Rename members only where doing so materially clarifies the split (e.g. `AppendEventsAsync`
  staying on both the stream store and, if still needed, the repository's pass-through)
  — do not rename for its own sake beyond what the interface split requires.

## Acceptance criteria

1. A stream-persistence interface exists with no rehydration or projection member; the
   aggregate-repository interface has no projection-loading member (automated:
   `dotnet build` plus inspection that the removed member is gone).
2. `AggregateConcurrencyException` is thrown/returned on an expected-version mismatch,
   proven by a unit test against the updated `FakeEventStore` (automated).
3. Every existing characterization test from tasks 01-02 covering append/load still
   passes, updated only for the interface rename if one occurred (automated).
4. No global position/checkpoint field or subscription-related type is introduced
   (inspection).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — `docs/development/event-sourcing.md`'s full rewrite is task 12,
sequenced after every functional task lands.

## Out of scope

- A real persistence provider.
- Persisted projections, checkpoints, subscriptions.
- Cross-resource transaction coordination.
- Populating correlation/causation fields end-to-end (task 04, if the envelope field is
  added here as optional).
