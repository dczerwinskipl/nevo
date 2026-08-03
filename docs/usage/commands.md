---
id: guides.commands
type: guide
title: Commands
status: current
summary: >
  Dispatching a command via ICommandDispatcher and writing a command handler, using
  existing NEvo.Messaging.Cqrs extension points.
---

# Commands

## Goal

Write and register a handler for your own command, and dispatch it — either directly
via `ICommandDispatcher` or from an HTTP endpoint.

## Prerequisites

- [`NEvo.Messaging.Cqrs`](../reference/packages/NEvo.Messaging.Cqrs.md) referenced and
  registered (`AddMessages()` + `AddCommands()`) — see [Quick start](quick-start.md) if
  you haven't done this yet.

## Steps

### 1. Define a command

A command is a `record` deriving from `Command`:

```csharp
public record CreateOrder(string CustomerId) : Command;
```

### 2. Write a handler

```csharp
public class CreateOrderHandler : ICommandHandler<CreateOrder>
{
    public Task<Either<Exception, Unit>> HandleAsync(CreateOrder message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask; // NEvo.Core
}
```

Handler discovery is reflection-based — you don't manually register each handler type;
`NEvo.Messaging`'s `MessageHandlerExtractor` finds it via `ICommandHandler<TMessage>`'s
adapter (`CommandHandlerAdapterFactory`, registered by `AddCommands()`).

If your handler needs a permission check, see
[Authorization](authorization.md) for `[AllowPermission(...)]` — see
`docs/reference/packages/NEvo.Messaging.Authorization.md` for exactly how the check
runs and what happens on failure before relying on it.

### 3. Dispatch it

Directly, via `ICommandDispatcher`:

```csharp
await commandDispatcher.DispatchAsync(new CreateOrder("customer-1"), cancellationToken);
```

Or over HTTP, via `NEvo.Messaging.Web`'s `MapCommandEndpoint<TCommand>` — see [Quick
start](quick-start.md) step 5 for the full example.

## Constraints and failure modes

Command handler resolution requires exactly one handler for a given command type —
`MoreThanOneHandlerFoundException` if multiple are registered. If you need multiple
independent reactions to the same trigger, use an event instead — see
[Events](events.md).

## Verification

`dotnet build` confirms your handler satisfies `ICommandHandler<TMessage>`; dispatching
the command and observing a `Right` result (or your handler's own side effect, e.g. a
`Console.WriteLine` during development) confirms it's wired up and discovered
correctly.

## Next steps

[Events](events.md) — for multi-handler, fire-and-react scenarios instead of a single
command handler.
