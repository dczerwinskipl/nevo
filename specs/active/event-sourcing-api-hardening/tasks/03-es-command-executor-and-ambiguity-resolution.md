---
id: event-sourcing-api-hardening.es-command-executor-and-ambiguity-resolution
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
semantic_references:
  decisions: [D1, D2, D7, D17]
  dependency_contracts: [harden-event-store-and-repository-contracts]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/shared-es-execution-and-explicit-handler.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Evolving/AggregateEvolver.cs
    - src/NEvo.Messaging/Handling/Middleware/TransactionScopeMessageProcessingMiddleware.cs
    - src/NEvo.Messaging/Dispatching/Internal/InternalSyncProcessDispatchStrategy.cs
  optional:
    - docs/development/transaction-model.md
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - examples/**
---

# Task: Shared ES command executor and deterministic ambiguity resolution

## Goal

Extract the shared load → authorize → decide → append → publish executor used by both
Level 1 (convention) and Level 2 (explicit handler, task 04), with deterministic
most-specific-state-method resolution replacing today's first-match behavior (D2), and
correct ordering so the source event is appended/persisted (and, for a future
`DbContext`-backed store, saved) before any synchronous downstream handler runs (D7).

## Dependencies

- `harden-event-store-and-repository-contracts` (task 02) — the executor targets the
  new `IEventStreamStore`/repository split and `AggregateConcurrencyException`.

## Implementation constraints

- The executor owns: load and rehydrate; invoke the two authorization hook points as
  extension points it calls out to (task 07 implements the actual logic — this task
  only defines *where* the calls happen and passes what they need: the command, the
  rehydrated aggregate/state, and the message context); execute the decision; append
  using expected version; ensure downstream synchronous handlers observe the appended
  state.
- On the flush/visibility point (D7, corrected): do not invent a new "flush" mechanism.
  `DbContext.SaveChangesAsync()` is already the repository's established flush
  primitive — `EntityFrameworkMessageInbox.RegisterProcessedAsync`/
  `EntityFrameworkMessageOutbox.SaveMessageAsync` already call it inline, enlisting in
  the ambient `TransactionScope` without committing it. For a future EF-backed
  `IEventStreamStore` implementation, the append path follows that exact same pattern
  (call `SaveChangesAsync()` before returning). For the current `FakeEventStore`
  (in-memory, no `DbContext`), the append is synchronous and already immediately
  visible — no explicit call is needed there. Either way, this task's job is *ordering*
  the executor's append step before the re-entrant synchronous dispatch documented in
  `InternalSyncProcessDispatchStrategy`, not building a new cross-cutting primitive.
- Nothing in the executor's own public shape may require the aggregate's next state to
  be produced by an instance method on an immutable state object (D17) — the executor
  coordinates load/authorize/decide/append/publish around *whatever* decision mechanism
  Level 1/Level 2 use; today that mechanism is the OO-immutable convention, and this
  task implements exactly that, but the executor's load/append/version-handling/publish
  responsibilities themselves must stay expressible in terms of events and streams, not
  in terms of "calling `.Evolve()` on an object." This is the same constraint task 02
  applies to the repository/store — this task carries it through to the executor that
  consumes those contracts.
- State-method resolution algorithm: collect every candidate decider/evolver method
  whose declaring type `IsAssignableFrom` the current runtime aggregate type; if exactly
  one candidate has no more-specific candidate among the others (i.e. no other
  candidate's declaring type is itself assignable to it), that one wins; if two or more
  remain tied at the most-specific level, fail with a deterministic
  configuration/runtime error naming the command/event and the tied candidate types —
  never rely on enumeration order or `.First()`/`.ToOption()`-style first-match
  behavior.
- Both the convention route (this task, invoked by whatever DI wiring task 05/06 use)
  and the explicit Level 2 handler (task 04) call into this one executor — no duplicated
  load/decide/append logic between them.
- Keep decision/evolver methods synchronous — do not introduce an async decision-method
  path.

## Acceptance criteria

1. A command handled purely through the convention route succeeds via this executor,
   proven by an integration test (automated).
2. A command supported by two aggregate state types where one is more specific resolves
   to the more specific one, proven by a test with `EditableDocument`/`ApprovedDocument`
   -shaped fixtures (automated).
3. Two equally-specific candidates fail deterministically with a clear error naming both
   candidate types, proven by a test (automated) — this supersedes task 01's
   characterization of the old first-match behavior; that old test is deleted or
   explicitly marked superseded in this task's diff.
4. The append happens before a synchronous domain-event handler triggered by the same
   command runs; a test in which that handler reloads the aggregate observes the newly
   appended state (automated).
5. A concurrency conflict during append surfaces through the executor as
   `Either<Exception, _>.Left` containing an `AggregateConcurrencyException` instance —
   never a thrown exception propagating out of the executor (automated).
6. Neither the executor's public entry point(s) nor its internal contracts require the
   aggregate's next state to come from an instance method on an immutable state object
   — inspection, per D17 (this task's Level 1/Level 2 implementation happens to use
   that mechanism; the constraint is that the executor's own load/append/publish
   responsibilities don't hard-code it).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- The actual authorization logic behind the two hook points (task 07) — this task only
  defines where they're called and what's passed to them.
- The explicit Level 2 handler type itself (task 04).
- Handler registration/role metadata (task 05).
- Any folder/namespace reorganization, and wiring `ICreateAggregateCommand` into any
  resolution logic — both out of scope for the whole change (D15, D16).
