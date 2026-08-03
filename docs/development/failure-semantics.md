---
id: development.failure-semantics
type: development
title: Failure and partial-failure semantics
status: current
read_when:
  - modifying event dispatch
  - adding or reordering middleware
  - working with outbox partitioning
summary: >
  Event fan-out partial-failure behavior, whether middleware ordering is a guaranteed
  contract, and outbox partition-assignment semantics.
related:
  - development.transaction-model
  - development.messaging-pipeline
---

# Failure and partial-failure semantics

## Event fan-out partial-failure behavior

**Answered**, grounded in `src/NEvo.Messaging/Events/EventProcessingStrategyBase.cs` and
its two subclasses (`SequentialEventProcessingStrategy`, `ParallelEventProcessingStrategy`):

- Every handler for an event runs, regardless of whether an earlier (sequential) or
  concurrently-running (parallel) handler already failed — there is no short-circuit on
  first failure, for either strategy.
- After all handlers complete, `EventProcessingStrategyBase.ProcessMessageAsync`
  aggregates the results: if **any** handler returned `Left`, the overall result is
  `Left(AggregateException(failures))`; only if **every** handler returned `Right` does
  the overall result become `Right`.
- Because `TransactionScopeMessageProcessingMiddleware` wraps the whole strategy
  invocation in one ambient `System.Transactions.TransactionScope` and only calls
  `Complete()` on an overall `Right`, **one failing handler rolls back the ambient
  transaction on dispose — including the writes of handlers that individually
  succeeded**, provided those writes went through a connection enlisted in the same
  ambient transaction. See `docs/development/transaction-model.md` question 5 for the
  full trace.
- What this means in practice: NEvo's event fan-out is "all handlers run, but partial
  success is not partially persisted" when the transaction-scope middleware is active —
  a successfully-handled event can still have its side effects rolled back by a sibling
  handler's failure. This is a structural consequence of the current middleware
  composition, not a documented design guarantee stated anywhere else in the codebase.

## Is middleware registration order a guaranteed contract?

**Answered: it is an artifact of registration order, not a framework-enforced
contract.** `MiddlewareHandler<TInput, TResult>` (`src/NEvo.Core/MiddlewareHandler.cs`)
builds its execution chain purely from the order of the `MiddlewareConfig` sequence it
receives — first-registered middleware executes outermost (first), last-registered
executes innermost (closest to the handler). `AddMessages()`
(`src/NEvo.Messaging/ServiceCollectionExtensions.cs`) registers
`CorrelationIdMessageProcessingMiddleware`, `CausationIdMessageProcessingMiddleware`, and
`TelemetryMessageProcessingMiddleware` via `AddMessageProcessingMiddleware<T>()` calls in
that literal call order; authorization, transaction-scope, and inbox middleware are
registered by their own extension methods, wherever the consumer's startup code calls
them. Nothing in the framework pins or validates a required order — the pipeline order
described in `docs/development/messaging-pipeline.md` (`Correlation → Causation →
Authorization → TransactionScope → Inbox → Logging → Telemetry`) reflects NEvo's own
convention for how it wires itself up, not a guarantee enforced against a consumer who
registers their own middleware in a different order. A consumer's own
`AddMessageProcessingMiddleware<T>()` call could register, for example, an authorization
middleware before `TransactionScopeMessageProcessingMiddleware`, changing which
operations run inside the ambient transaction — the framework does not detect or prevent
this.

## Outbox partition-assignment semantics

**Still open — not yet formally specified**, consistent with the original
`docs/architecture/inbox-outbox.md`'s own framing. `EntityFrameworkMessageOutbox.SaveMessageAsync`
(`src/NEvo.Messaging.EntityFramework/EntityFrameworkMessageOutbox.cs`) carries a
`//TODO partitioning` comment and does not assign or use a partition value when saving a
message; `GetMessagesToPublishAsync`'s `partition` parameter is honored for filtering
when supplied by the caller, but nothing in the outbox itself decides which partition a
new message belongs to. Do not assume any partition-assignment strategy (round-robin,
hash-based, or otherwise) is implemented — none is, as of this change.
