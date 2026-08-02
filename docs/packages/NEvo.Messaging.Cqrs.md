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

Depends only on `NEvo.Messaging` — confirmed against
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

## Basic usage

```csharp
public record CreateOrder(string CustomerId) : Command;

public class CreateOrderHandler : ICommandHandler<CreateOrder>
{
    public Task<Either<Exception, Unit>> HandleAsync(CreateOrder message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask; // NEvo.Core
}

// dispatch:
await commandDispatcher.DispatchAsync(new CreateOrder("customer-1"), cancellationToken);
```

## Advanced usage

No advanced usage beyond the above is documented yet — dispatch-strategy customization
(`IMessageDispatchStrategyFactory<Command>`) is possible but not covered here.

## Limitations

- **Query-side support is not implemented.** The `.csproj` declares an empty
  `<Folder Include="Queries\" />` placeholder with no corresponding source under a
  `Queries/` directory — confirmed via `find src/NEvo.Messaging.Cqrs -name "*.cs"`
  (only `Commands/*.cs` and `GlobalUsings.cs` exist). Do not treat this package as
  providing query dispatch, a `Query`/`IQueryHandler` type, or any read-side
  abstraction — none exist yet.
- Command handler resolution still follows `NEvo.Messaging`'s single-handler rule for
  commands (see [`NEvo.Messaging.md`](NEvo.Messaging.md) § Limitations).

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends.
- `NEvo.Messaging.Web` depends on this package (for `Command`/`ICommandDispatcher` in
  its route-mapping helpers) — not yet documented (see task
  `package-docs-messaging-extensions`, this same task).

## Examples and tests

No dedicated `tests/NEvo.Messaging.Cqrs.Tests/` project exists; this package's
behavior is exercised indirectly through `tests/NEvo.Messaging.Tests/` and consuming
packages' tests.
