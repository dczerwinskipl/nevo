---
id: development.transaction-model
type: development
title: Transaction model
status: current
read_when:
  - working with EF DbContext
  - modifying persistence behavior
  - working on transaction-related code
summary: >
  Transaction ownership and commit behavior: what is answered by the code today, and
  what remains genuinely unresolved.
related:
  - development.failure-semantics
  - development.package-boundaries
---

# Transaction model

## Current implementation

EF Core 9 with SQL Server is the only persistence backend. No generic repository abstraction
exists at the framework level — code works directly with `DbContext` subclasses.

`NEvo.EntityFramework` (`src/NEvo.EntityFramework/`) provides:
- `MigrationBackgroundService` — runs pending migrations on startup via `IHostedService`
- Polly-based resilience for connection retries

## Package structure

| Package | Role |
|---|---|
| `NEvo.EntityFramework` | Shared EF infrastructure (migrations, resilience) |
| `NEvo.Messaging.EntityFramework` | EF inbox and outbox implementations |
| `NEvo.Orchestrating.EntityFramework` | No `IOrchestratorStateRepository` implementation — provides only an EF entity shape (`OrchestratorStateEf`) and a (mismatched) table configuration; see `docs/development/orchestration.md` |

Each module owns its own EF configuration and migrations. There is no shared `DbContext`.

## Transaction ownership

The 5 questions below were entirely unresolved, "currently determined by the example
application," in this repository's pre-2026-08-03 documentation layout, in a file
(`docs/architecture/persistence.md`) that no longer exists — its content was split
between this document and `docs/development/failure-semantics.md`, not renamed 1:1.
Each of the 5 questions below is now either answered by the code's structure, or
confirmed to remain genuinely open (never invented).

1. **Who is responsible for committing the transaction?** — **Answered.**
   `TransactionScopeMessageProcessingMiddleware`
   (`src/NEvo.Messaging/Handling/Middleware/TransactionScopeMessageProcessingMiddleware.cs`)
   opens a `System.Transactions.TransactionScope` (`TransactionScopeAsyncFlowOption.Enabled`)
   around the rest of the pipeline, calls `transactionScope.Complete()` only if the
   downstream result is `Right` (success), and the transaction is actually committed or
   rolled back when the `using` block disposes the scope. Individual components (inbox,
   outbox, the handler's own persistence code) each call `SaveChangesAsync()` on their
   own `DbContext`, which enlists in — but does not itself commit — this ambient
   transaction.

2. **When does `SaveChangesAsync` run — inside the handler, inside middleware, or
   externally?** — **Answered, for inbox/outbox.** `EntityFrameworkMessageInbox.RegisterProcessedAsync`
   and `EntityFrameworkMessageOutbox.SaveMessageAsync`
   (`src/NEvo.Messaging.EntityFramework/`) each call `dbContext.SaveChangesAsync()`
   immediately, inline, once per call — there is no batched or deferred unit-of-work
   checkpoint coordinating them with the handler's own persistence code. Whether a
   handler calls `SaveChangesAsync()` on its own `DbContext` is entirely up to that
   handler's implementation; NEvo does not impose or coordinate a single save point.

3. **How does the inbox check interact with the same transaction that the handler writes
   to?** — **Answered structurally, not verified by test.** Per the middleware order
   (`Correlation → Causation → Authorization → TransactionScope → Inbox → ... → handler`,
   see `docs/development/messaging-pipeline.md`), `InboxMessageProcessingMiddleware`'s
   check and `RegisterProcessedAsync` call run inside the ambient `TransactionScope`
   opened earlier in the chain, so its `SaveChangesAsync()` enlists in the same ambient
   transaction as the handler's own writes — this follows from `TransactionScope`'s
   async-flow-enabled ambient behavior and the standard EF Core + SQL Server provider's
   auto-enlistment. No automated integration test in this repository confirms this
   end-to-end (`docs/development/testing-strategy.md`'s known coverage gap covers inbox
   idempotency specifically) — treat this as understood from code structure, not proven
   by test.

4. **Is the outbox message saved in the same transaction as the handler's state
   change?** — **Conditionally answered.** `IMessageOutbox.SaveMessageAsync` is invoked
   via `OutboxMessagePublishStrategy`
   (`src/NEvo.Messaging/Publishing/External/OutboxMessagePublishStrategy.cs`), an
   external publish strategy — it is not a step in the `MessageProcessingMiddleware`
   chain. It shares the ambient `TransactionScope` only when the publish call happens
   synchronously inside a handler that is itself running inside the
   `TransactionScope`-wrapped pipeline (the common case for a handler that publishes as
   part of its own `HandleAsync`). A message queued for outbox publishing from any other
   call site would not share that transaction. This is a real conditional answer, not a
   blanket yes.

5. **What happens when multiple handlers process the same event in the same transaction
   scope?** — **Answered.** `EventProcessingStrategyBase.ProcessMessageAsync`
   (`src/NEvo.Messaging/Events/EventProcessingStrategyBase.cs`) runs every handler for an
   event — both `SequentialEventProcessingStrategy` and `ParallelEventProcessingStrategy`
   invoke all handlers regardless of an earlier handler's failure (no short-circuit).
   Once every handler has completed, the results are aggregated: if any handler failed,
   the whole strategy returns `Left(AggregateException(failures))`; only if every handler
   succeeded does it return `Right`. Because `TransactionScopeMessageProcessingMiddleware`
   wraps the entire strategy invocation in one ambient transaction and only calls
   `Complete()` on an overall `Right`, **one failing handler causes the ambient
   transaction to roll back on dispose — including the database writes of handlers that
   individually succeeded**, provided those writes went through a connection enlisted in
   the same ambient transaction. See `docs/development/failure-semantics.md` for the
   full event fan-out partial-failure discussion this implies.

**Do not modify transaction, session, or DbContext lifetime behavior without a
specification and owner approval** (per `docs/development/package-boundaries.md`'s
"Changing a dependency" — the same owner-approval bar applies to transaction semantics
changes, see `AGENTS.md`).

## Migration strategy

Automatic migrations on startup (`MigrationBackgroundService`) are used in example
applications. This is appropriate for development but may not be suitable for production
deployment. This decision is deferred.
