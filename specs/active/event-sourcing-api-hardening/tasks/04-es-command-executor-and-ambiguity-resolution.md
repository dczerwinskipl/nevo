---
id: event-sourcing-api-hardening.es-command-executor-and-ambiguity-resolution
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
semantic_references:
  decisions: [D1, D2, D7]
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
Level 1 (convention) and Level 2 (explicit handler, task 05), with deterministic
most-specific-state-method resolution replacing today's first-match behavior (D2), and
correct ordering so the source event is appended/persisted before any synchronous
downstream handler runs (D7).

## Dependencies

- `harden-event-store-and-repository-contracts` (task 03) — the executor targets the
  new `IEventStreamStore`/repository split and `AggregateConcurrencyException`.

## Implementation constraints

- The executor owns: load and rehydrate; invoke the two authorization hook points as
  extension points it calls out to (task 08 implements the actual logic — this task
  only defines *where* the calls happen and passes what they need: the command, the
  rehydrated aggregate/state, and the message context); execute the decision; append
  using expected version; ensure downstream synchronous handlers observe the appended
  state (do not add a new "flush" primitive — task 04's job is ordering against the
  existing pipeline re-entrancy documented in `InternalSyncProcessDispatchStrategy`, not
  inventing a new mechanism).
- State-method resolution algorithm: collect every candidate decider/evolver method
  whose declaring type `IsAssignableFrom` the current runtime aggregate type; if exactly
  one candidate has no more-specific candidate among the others (i.e. no other
  candidate's declaring type is itself assignable to it), that one wins; if two or more
  remain tied at the most-specific level, fail with a deterministic
  configuration/runtime error naming the command/event and the tied candidate types —
  never rely on enumeration order or `.First()`/`.ToOption()`-style first-match
  behavior.
- Both the convention route (this task, invoked by whatever DI wiring task 06/07 use)
  and the explicit Level 2 handler (task 05) call into this one executor — no duplicated
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
   `Either<AggregateConcurrencyException, _>.Left` (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by task 12.

## Out of scope

- The actual authorization logic behind the two hook points (task 08) — this task only
  defines where they're called and what's passed to them.
- The explicit Level 2 handler type itself (task 05).
- Handler registration/role metadata (task 06).
