---
id: development.processing-model
type: development
title: Processing model
status: current
read_when:
  - adding a new message type
  - changing dispatch strategy
  - modifying handler resolution
summary: >
  Describes how NEvo selects a processing strategy for a given message and how handlers
  are resolved. Strategy pattern with factory, predicate-filtered selection.
related:
  - development.messaging-pipeline
---

# Processing model

## Strategy pattern

NEvo uses a strategy pattern to determine how a message is processed:

```csharp
interface IMessageProcessingStrategy
{
    bool ShouldApply(IMessage message);
    Task<Either<Exception, Unit>> ProcessAsync(IMessage, IMessageContext, CancellationToken);
}

interface IMessageProcessingStrategyWithResult<TResult>
{
    bool ShouldApply(IMessage<TResult> message);
    Task<Either<Exception, TResult>> ProcessAsync(IMessage<TResult>, IMessageContext, CancellationToken);
}
```

`IMessageProcessingStrategyFactory` is called with the message and returns the matching strategy.
The first strategy whose `ShouldApply` returns `true` is used.

## Built-in strategies

| Strategy | Applies to | Behavior |
|---|---|---|
| `CommandProcessingStrategy` | `Command` (the CQRS base record, from `NEvo.Messaging.Cqrs`) | Resolves one handler, expects one result |
| `SequentialEventProcessingStrategy` | Events (default) | Resolves all handlers, runs them in sequence |
| `ParallelEventProcessingStrategy` | Events (opt-in) | Resolves all handlers, runs them in parallel |

The parallel vs sequential choice for events is controlled by `ThreadingOptions` registered in DI.

There is no `ICommand`/`ICommand<TResult>` interface in NEvo — commands are modeled as
the concrete `Command` record type (a `Message` subclass) provided by
`NEvo.Messaging.Cqrs`, not an interface.

## Handler resolution

`IMessageHandlerRegistry` maps message types to handler instances:

```csharp
Either<Exception, IMessageHandler> GetMessageHandler(IMessage)          // single
IEnumerable<IMessageHandler> GetMessageHandlers(IMessage)               // multiple
```

Errors:
- `NoHandlerFoundException` — no handler registered for this message type
- `MoreThanOneHandlerFoundException` — multiple handlers found when only one is allowed

Handler adapters (`IMessageHandlerFactory`) create typed wrappers from registered DI types,
normalizing `ICommandHandler<T>`, `IEventHandler<T>` etc. into the common
`IMessageHandler` interface. There is no `IQueryHandler<T, R>` adapter today — query-side
dispatch is not implemented (see "Built-in strategies" above).

## Intended extension points

New strategies can be registered by implementing `IMessageProcessingStrategy` and adding
to the factory. The factory selection is ordered — strategy registration order matters.

New handler types require a corresponding `IMessageHandlerFactory` adapter — see
`docs/development/extension-points.md` for the contract a third-party handler-type
author must implement.
