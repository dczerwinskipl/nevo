---
id: packages.nevo-messaging
type: package
title: NEvo.Messaging
status: current
dependencies:
  - NEvo.Core
summary: >
  Message processing pipeline: dispatch, middleware chain, handler resolution, context
  propagation, and opt-in inbox/outbox abstractions. The foundation every
  NEvo.Messaging.* extension package builds on.
---

# NEvo.Messaging

This is a package-level overview (purpose, dependencies, registration, when to reach for
what). For the pipeline execution order, middleware chain details, and full interface
signatures, see the deep-dive maintainer docs linked throughout — this doc does not
duplicate their content. For a task-oriented "how do I dispatch a command / publish an
event" walkthrough, see `docs/usage/commands.md` and `docs/usage/events.md`.

## When to use

Whenever you need message dispatch, middleware, or the event pub/sub pattern — this is
the foundation every messaging extension package builds on. Most consumers reach it
indirectly through `NEvo.Messaging.Cqrs` (commands) rather than using it standalone.

## When not to use

If you only need the `Either<Exception, T>`/middleware primitives without any message
dispatch concept, [`NEvo.Core`](NEvo.Core.md) alone is sufficient.

## Purpose

`NEvo.Messaging` is the core message-processing pipeline: dispatching a message through
a configurable middleware chain, selecting a processing strategy (single-handler command
vs. multi-handler event, sequential or parallel), resolving handlers, and invoking them —
all through the `Either<Exception, T>` convention inherited from
[`NEvo.Core`](NEvo.Core.md). It also defines the opt-in inbox (idempotency) and outbox
(transactional publishing) abstractions used by messaging extension packages.

## Responsibilities

- Define the message contract (`IMessage`, `IMessage<TResult>`) and handler contract
  (`IMessageHandler`).
- Dispatch messages through `IMessageProcessor`, executing the middleware chain and
  invoking the resolved handler(s) — see `docs/development/messaging-pipeline.md` for
  the full execution order.
- Propagate cross-cutting context (correlation/causation IDs, ambient feature storage)
  via `IMessageContext`/`IMessageContextAccessor` — see
  `docs/development/message-context.md` for the full contract.
- Provide opt-in idempotency (`IMessageInbox`) and transactional-publish (`IMessageOutbox`)
  abstractions — see `docs/development/inbox-outbox.md` for when to use each and the
  wire format (`MessageEnvelopeDto`).
- Define the event side of messaging (`NEvo.Messaging.Events` namespace: `Event`,
  `IEventHandler<T>`, `IEventPublisher`) — unlike commands, this lives in
  `NEvo.Messaging` itself, not `NEvo.Messaging.Cqrs`. See "Public surface" below.

## Dependencies

Depends only on `NEvo.Core` — see `src/NEvo.Messaging/NEvo.Messaging.csproj`'s single
`ProjectReference` and `docs/development/package-boundaries.md`. `NEvo.Messaging` does
not depend on any of its own extension packages (`*.Cqrs`, `*.Authorization`, `*.Web`,
`*.EntityFramework`) — dependencies flow the other way (package-boundaries.md rule 4).

## Public surface

The message contract is small; everything else (processing strategies, handler
registry, middleware) is covered in the linked maintainer docs.

```csharp
public interface IMessage
{
    Guid Id { get; }
    DateTime CreatedAt { get; }
}

public interface IMessage<TResult> : IMessage { }
```

`IMessageHandler` (what you implement to handle a message) carries a
`MessageHandlerDescription` used for reflection-based registration, and
`HandleAsync(IMessage, IMessageContext, CancellationToken) -> Task<Either<Exception,
object>>` — see `docs/development/messaging-pipeline.md` § "Handler registration" for
how handlers are discovered and adapted.

**Breaking change.** `MessageHandlerAdapterBase<TMessageGroup>` and the two adapter
types built on it — `CommandHandlerAdapter` (`NEvo.Messaging.Cqrs`) and
`EventHandlerAdapter` — were `public` types and have been **removed**. They are
replaced by one shared, public, non-generic `MessageHandlerAdapter` (in this package's
`NEvo.Messaging.Handling` namespace) that `CommandHandlerAdapterFactory`,
`EventHandlerAdapterFactory`, and `QueryHandlerAdapterFactory` all construct. This only
affects code that referenced one of the three removed types directly — the documented
`ICommandHandler<T>`/`IEventHandler<T>`/`IMessageHandlerFactory` extension surface is
unaffected. `MessageHandlerAdapter` is not itself a documented extension point; it is
constructed by the factories above, never by third-party code.

### Events (`NEvo.Messaging.Events`)

```csharp
public record Event : Message;

public interface IEventHandler<in TMessage> where TMessage : Event
{
    Task<Either<Exception, Unit>> HandleAsync(TMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}

public interface IEventPublisher
{
    Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken);
}
```

Unlike a command (exactly one handler expected), an event can have **multiple**
handlers, processed either sequentially or in parallel
(`SequentialEventProcessingStrategy`/`ParallelEventProcessingStrategy`, both
registered by `AddEvents()` below) — see `docs/development/messaging-pipeline.md` for
how the processing strategy is selected per message, and
`docs/development/failure-semantics.md` for what happens when one of several handlers
fails.

## Configuration

```csharp
builder.Services.AddMessages();
builder.Services.AddEvents(); // registers IEventPublisher and event handler discovery
```

`AddMessages()` registers (per `src/NEvo.Messaging/ServiceCollectionExtensions.cs`):
the handler registry/provider (reflection-based discovery), `IMessageContextAccessor`,
the default `CorrelationIdMessageProcessingMiddleware`/
`CausationIdMessageProcessingMiddleware`/`TelemetryMessageProcessingMiddleware`,
`IMessageProcessor`, `IMessageContextProvider`, internal dispatch/publish strategies,
and transport defaults (`IMessageEnvelopeMapper`, `IMessageSerializer`,
`IMessageTypeMapper`). Additional middleware is registered via
`AddMessageProcessingMiddleware<T>()` / `AddMessageProcessingHandlerMiddleware<T>()`.
Inbox/outbox are **not** registered by `AddMessages()` — both are opt-in (see
`docs/development/inbox-outbox.md`) and require an explicit implementation registration
(e.g. from `NEvo.Messaging.EntityFramework`).

`AddEvents()` is a separate call (per `src/NEvo.Messaging/Events/
ServiceCollectionExtensions.cs`): registers the event handler adapter factory, both
sequential/parallel processing strategies, `IEventPublisher`, and the default event
publish-strategy factory. Call it alongside `AddMessages()` if you publish or handle
events, not just commands.

## Limitations

- Command handler resolution requires exactly one handler —
  `MoreThanOneHandlerFoundException` if multiple are found for the same command type
  (events allow multiple handlers).
- Outbox partition-assignment semantics are not yet implemented — see
  `docs/development/failure-semantics.md` § "Outbox partition-assignment semantics".
- A background process to poll and publish outbox messages is expected but not part of
  this package.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency; provides the middleware primitive
  this package's pipeline is built on.
- [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md),
  [`NEvo.Messaging.Authorization`](NEvo.Messaging.Authorization.md),
  [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md),
  [`NEvo.Messaging.EntityFramework`](NEvo.Messaging.EntityFramework.md) — extension
  packages that depend on this one.

## Examples and tests

`tests/NEvo.Messaging.Tests/` — the primary coverage for pipeline dispatch, middleware
chain execution, and handler resolution.
