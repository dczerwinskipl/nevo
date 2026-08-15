---
id: development.messaging-pipeline
type: development
title: Messaging pipeline
status: current
read_when:
  - modifying message processing
  - adding middleware
  - changing handler resolution
  - adding a new processing strategy
summary: >
  Describes message dispatch, middleware chain execution, processing strategy resolution,
  and handler invocation. Entry point: IMessageProcessor.
related:
  - development.processing-model
  - development.message-context
---

# Messaging pipeline

## Entry point

`IMessageProcessor` — defined in `src/NEvo.Messaging/Handling/IMessageProcessor.cs`.

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
  │    UserContextMiddleware<TId,TUser,TRoleDataScope> ← optional, if configured (message-level auth)
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
  │    ValidatePermissionMiddleware<TId,TUser>     ← per-handler auth, if configured (handler-level only)
  │
  └─ IMessageHandler.HandleAsync(message, context, ct)
       → Either<Exception, Unit / TResult>
```

For whether this registration order is a guaranteed contract or an artifact of default
configuration, see `docs/development/failure-semantics.md`.

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

Handler adapters, built on the shared `MessageHandlerAdapter`
(`src/NEvo.Messaging/Handling/MessageHandlerAdapter.cs`), normalize different handler
interface signatures into `IMessageHandler`. The contract a third-party handler-type
author must implement is documented in `docs/development/extension-points.md`.

## Stable guarantees

- All operations return `Either<Exception, T>`. Exceptions are not thrown through the
  pipeline; they are captured as `Left<Exception>`. Callers must handle both cases.
- `LanguageExt.Core` is a required dependency of `NEvo.Core` and `NEvo.Messaging`. This is
  a deliberate architectural choice, not incidental.

## Telemetry

`TelemetryMessageProcessingMiddleware` creates OpenTelemetry spans:
- Activity source name: `MessageProcessingSource`
- Handler-level: `MessageProcessingHandlerSource`
