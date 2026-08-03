---
id: packages.nevo-messaging-cqrs
type: package
title: NEvo.Messaging.Cqrs
status: current
dependencies:
  - NEvo.Messaging
summary: >
  CQRS command side on top of NEvo.Messaging: Command base type, ICommandHandler,
  ICommandDispatcher. Query-side support is not implemented — see Limitations.
---

# NEvo.Messaging.Cqrs

## Purpose

`NEvo.Messaging.Cqrs` adds command-oriented types and dispatch on top of
[`NEvo.Messaging`](NEvo.Messaging.md)'s generic message pipeline: a `Command` base
record, `ICommandHandler<TMessage>`, and `ICommandDispatcher` for explicit
(non-reflection-triggered) dispatch.

## When to use

Whenever you're dispatching commands (single-handler, result-returning operations) —
this is the standard way to add command support to a NEvo-based service. See
`docs/usage/commands.md` for the task-oriented walkthrough.

## When not to use

If you only need events (multi-handler, no result), `NEvo.Messaging`'s own event
support (`AddEvents()`) doesn't require this package. If you need query/read-side
dispatch, this package does not provide it — see "Limitations".

## Responsibilities

- Define the `Command` message type (a `Message` subclass, per
  [`NEvo.Messaging.md`](NEvo.Messaging.md)'s `IMessage` contract).
- Provide `ICommandHandler<TMessage>` for command handlers and adapt them into the
  generic `IMessageHandler` pipeline (`CommandHandlerAdapter`/`CommandHandlerAdapterFactory`).
- Provide `ICommandDispatcher` for dispatching a command directly (resolving/creating
  message context and delegating to the configured dispatch strategy).
- Register the single-handler `CommandProcessingStrategy` used by
  [`NEvo.Messaging.md`](NEvo.Messaging.md)'s processing-strategy selection.

## Dependencies

Depends only on `NEvo.Messaging` — see
`src/NEvo.Messaging.Cqrs/NEvo.Messaging.Cqrs.csproj`'s single `ProjectReference`.

## Public surface

Grounded directly in `src/NEvo.Messaging.Cqrs/Commands/*.cs`.

```csharp
public record Command : Message
{
    public Command();
    public Command(Guid id, DateTime createdAt);
}

public interface ICommandHandler<in TMessage> where TMessage : Command
{
    Task<Either<Exception, Unit>> HandleAsync(TMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}

public interface ICommandDispatcher
{
    Task<Either<Exception, Unit>> DispatchAsync(Command command, CancellationToken cancellationToken);
}
```

`CommandDispatcher` (the default `ICommandDispatcher`) resolves the current
`IMessageContext` via `IMessageContextAccessor` (creating one via
`IMessageContextProvider` if none is set yet), then delegates to
`IMessageDispatchStrategyFactory<Command>`.

## Configuration

```csharp
builder.Services.AddMessages();   // NEvo.Messaging
builder.Services.AddCommands();   // this package
```

`AddCommands()` registers `IMessageHandlerFactory` → `CommandHandlerAdapterFactory`,
`IMessageProcessingStrategy` → `CommandProcessingStrategy`, `ICommandDispatcher` →
`CommandDispatcher`, and `IMessageDispatchStrategyFactory<Command>` →
`DefaultCommandDispatchStrategyFactory`.

## Limitations

- **Query-side support is not implemented.** The `.csproj` declares an empty
  `<Folder Include="Queries\" />` placeholder with no corresponding source under a
  `Queries/` directory — only `Commands/*.cs` and `GlobalUsings.cs` exist. Do not treat
  this package as providing query dispatch, a `Query`/`IQueryHandler` type, or any
  read-side abstraction — none exist yet.
- Command handler resolution follows `NEvo.Messaging`'s single-handler rule for
  commands (see [`NEvo.Messaging.md`](NEvo.Messaging.md) § Limitations).

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends.
- [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) depends on this package (for
  `Command`/`ICommandDispatcher` in its route-mapping helpers).

## Examples and tests

No dedicated `tests/NEvo.Messaging.Cqrs.Tests/` project exists; this package's
behavior is exercised indirectly through `tests/NEvo.Messaging.Tests/` and consuming
packages' tests.
