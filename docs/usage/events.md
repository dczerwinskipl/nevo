---
id: guides.events
type: guide
title: Events
status: current
summary: >
  Publishing and handling events, and choosing sequential vs. parallel processing for
  multiple handlers of the same event.
---

# Events

## Goal

Publish an event from a command handler (or anywhere with access to `IEventPublisher`)
and react to it with one or more independent handlers.

## Prerequisites

- `NEvo.Messaging` registered with `AddMessages()` + `AddEvents()` — see [Quick
  start](quick-start.md) step 6 if you haven't done this yet. `AddEvents()` lives in
  `NEvo.Messaging` itself, not `NEvo.Messaging.Cqrs`.

## Steps

### 1. Define an event

```csharp
public record OrderCreated(string OrderId) : Event;
```

### 2. Write one or more handlers

```csharp
public class OrderCreatedAuditHandler : IEventHandler<OrderCreated>
{
    public Task<Either<Exception, Unit>> HandleAsync(OrderCreated message, IMessageContext context, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Audit: order {message.OrderId} created");
        return UnitExt.DefaultEitherTask;
    }
}
```

Unlike a command (exactly one handler expected), an event supports **multiple**
independent handlers — each is discovered and invoked separately.

### 3. Publish it

```csharp
await eventPublisher.PublishAsync(new OrderCreated(orderId), cancellationToken);
```

### 4. Choose sequential or parallel processing

Which strategy handles a given event — `SequentialEventProcessingStrategy` (default) or
`ParallelEventProcessingStrategy` (opt-in) — is controlled by `ThreadingOptions`
registered in DI. Both are registered by `AddEvents()`; you select between them via
`ThreadingOptions`, not by choosing a different publish call.

## Constraints and failure modes

Every handler for an event runs regardless of whether an earlier (sequential) or
concurrently-running (parallel) handler already failed — there is no short-circuit on
first failure. If any handler fails, the overall dispatch result is a `Left`, which —
if a transaction-scope middleware is active — can roll back the writes of handlers that
individually succeeded. See `docs/development/failure-semantics.md` § "Event fan-out
partial-failure behavior" for the full mechanism before relying on partial success
being partially persisted.

## Verification

`dotnet build` confirms your handler satisfies `IEventHandler<TMessage>`; publishing the
event and observing every registered handler's side effect (e.g. each handler's own
`Console.WriteLine`) confirms all of them were discovered and invoked.

## Next steps

[Commands](commands.md) — for single-handler, result-returning operations instead of
multi-handler fan-out.
