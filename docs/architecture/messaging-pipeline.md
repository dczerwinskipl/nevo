---
id: architecture.messaging-pipeline
type: architecture
title: Messaging pipeline
status: current
scope:
  - messaging
  - middleware
  - handlers
  - dispatch
read_when:
  - modifying message processing
  - adding middleware
  - changing handler resolution
  - adding a new processing strategy
summary: >
  Describes message dispatch, middleware chain execution, processing strategy resolution,
  and handler invocation. Entry point: IMessageProcessor.
related:
  - architecture.processing-model
  - architecture.message-context
  - architecture.inbox-outbox
---

# Messaging pipeline

## Entry point

`IMessageProcessor` — defined in `src/NEvo.Messaging/Processing/`.

```csharp
Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage, IMessageContext, CancellationToken)
Task<Either<Exception, TResult>> ProcessMessageAsync<TResult>(IMessage<TResult>, IMessageContext, CancellationToken)
```

## Pipeline execution order

```
IMessageProcessor.ProcessMessageAsync(message, context, ct)
  │
  ├─ MessageProcessingMiddleware chain (predicate-filtered, ordered)
  │    CorrelationIdMessageProcessingMiddleware   ← adds correlation ID to context
  │    CausationIdMessageProcessingMiddleware     ← adds causation ID to context
  │    AuthorizationMiddleware                   ← optional, if configured
  │    TransactionScopeMessageProcessingMiddleware ← optional, opens ambient transaction
  │    InboxMessageProcessingMiddleware           ← optional, checks idempotency
  │    LoggingMessageProcessingMiddleware         ← structured logging
  │    TelemetryMessageProcessingMiddleware       ← OpenTelemetry ActivitySource
  │
  ├─ IMessageProcessingStrategyFactory.CreateForMessage(message)
  │    → CommandProcessingStrategy               ← single-handler, returns result
  │    → SequentialEventProcessingStrategy       ← multiple handlers, sequential
  │    → ParallelEventProcessingStrategy         ← multiple handlers, parallel
  │
  ├─ IMessageHandlerRegistry.GetMessageHandler(message)
  │    → Either<Exception, IMessageHandler>      ← single (commands)
  │    → IEnumerable<IMessageHandler>            ← multiple (events)
  │
  ├─ MessageProcessingHandlerMiddleware chain
  │    AuthorizationHandlerMiddleware            ← per-handler auth, if configured
  │
  └─ IMessageHandler.HandleAsync(message, context, ct)
       → Either<Exception, Unit / TResult>
```

## Middleware pattern

Middleware is defined in `src/NEvo.Core/Middlewares/`:

```csharp
interface IMiddleware<TInput, TResult>
{
    Task<TResult> ExecuteAsync(TInput input, Func<Task<TResult>> next, CancellationToken ct);
}
```

`MiddlewareHandler<TInput, TResult>` executes the chain with optional predicate filtering —
a middleware can declare `ShouldApply(input)` to be conditionally skipped.

There are two middleware chains in the pipeline:
- **Message-level** (`IMessageProcessingMiddleware`): cross-cutting concerns before strategy selection
- **Handler-level** (`IMessageProcessingHandlerMiddleware`): per-handler concerns (authorization)

## Handler registration

Handlers are discovered via reflection at startup through `IMessageHandlerRegistry`.

- Commands: one handler expected — `MoreThanOneHandlerFoundException` if multiple found
- Events: multiple handlers allowed — processed sequentially or in parallel per strategy

Handler adapters (`MessageHandlerAdapterBase` subclasses) normalize different handler
interface signatures into `IMessageHandler`.

## Error model

All operations return `Either<Exception, T>`. Exceptions are not thrown through the pipeline;
they are captured as `Left<Exception>`. Callers must handle both cases.

`LanguageExt.Core` is a required dependency of `NEvo.Core` and `NEvo.Messaging`. This is
a deliberate architectural choice, not incidental.

## Telemetry

`TelemetryMessageProcessingMiddleware` creates OpenTelemetry spans:
- Activity source name: `MessageProcessingSource`
- Handler-level: `MessageProcessingHandlerSource`
