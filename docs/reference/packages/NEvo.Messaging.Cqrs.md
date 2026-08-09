---
id: packages.nevo-messaging-cqrs
type: package
title: NEvo.Messaging.Cqrs
status: current
dependencies:
  - NEvo.Messaging
summary: >
  CQRS command and query sides on top of NEvo.Messaging: Command/Query base types,
  ICommandHandler/IQueryHandler, ICommandDispatcher/IQueryDispatcher.
---

# NEvo.Messaging.Cqrs

## Purpose

`NEvo.Messaging.Cqrs` adds command- and query-oriented types and dispatch on top of
[`NEvo.Messaging`](NEvo.Messaging.md)'s generic message pipeline: `Command`/`Query<TResult>`
base types, `ICommandHandler<TMessage>`/`IQueryHandler<TQuery, TResult>`, and
`ICommandDispatcher`/`IQueryDispatcher` for explicit (non-reflection-triggered) dispatch.

## When to use

Whenever you're dispatching commands (single-handler, write-side operations) or queries
(single-handler, typed-result read-side operations) — this is the standard way to add
CQRS support to a NEvo-based service. See `docs/usage/commands.md` and
`docs/usage/queries.md` for the task-oriented walkthroughs.

## When not to use

If you only need events (multi-handler, no result), `NEvo.Messaging`'s own event
support (`AddEvents()`) doesn't require this package.

## Responsibilities

- Define the `Command` and `Query<TResult>` message types (`Message`/`Message<TResult>`
  subclasses, per [`NEvo.Messaging.md`](NEvo.Messaging.md)'s `IMessage` contract).
- Provide `ICommandHandler<TMessage>`/`IQueryHandler<TQuery, TResult>` for handlers and
  adapt them into the generic `IMessageHandler` pipeline
  (`CommandHandlerAdapterFactory`/`QueryHandlerAdapterFactory`, both constructing the
  shared `MessageHandlerAdapter` from [`NEvo.Messaging.md`](NEvo.Messaging.md)).
- Provide `ICommandDispatcher`/`IQueryDispatcher` for dispatching directly
  (resolving/creating message context and delegating to the configured dispatch
  strategy, or — for Query — calling `IMessageProcessor.ProcessMessageAsync<TResult>`
  directly).
- Register the single-handler `CommandProcessingStrategy` and the single-handler,
  typed-result `QueryProcessingStrategy` used by
  [`NEvo.Messaging.md`](NEvo.Messaging.md)'s processing-strategy selection.

## Dependencies

Depends only on `NEvo.Messaging` — see
`src/NEvo.Messaging.Cqrs/NEvo.Messaging.Cqrs.csproj`'s single `ProjectReference`.

## Public surface

Grounded directly in `src/NEvo.Messaging.Cqrs/Commands/*.cs` and
`src/NEvo.Messaging.Cqrs/Queries/*.cs`.

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

public abstract record Query<TResult> : Message<TResult>
{
    public Query();
    public Query(Guid id, DateTime createdAt);
}

public interface IQueryHandler<in TQuery, TResult> where TQuery : Query<TResult>
{
    Task<Either<Exception, TResult>> HandleAsync(TQuery query, IMessageContext messageContext, CancellationToken cancellationToken);
}

public interface IQueryDispatcher
{
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult> query, CancellationToken cancellationToken);
}
```

`CommandDispatcher` (the default `ICommandDispatcher`) resolves the current
`IMessageContext` via `IMessageContextAccessor` (creating one via
`IMessageContextProvider` if none is set yet), then delegates to
`IMessageDispatchStrategyFactory<Command>`. `QueryDispatcher` (the default
`IQueryDispatcher`) resolves/creates the context the same way, then calls
`IMessageProcessor.ProcessMessageAsync<TResult>` directly — Query doesn't need the
dispatch-strategy-factory indirection Command uses, since it has no swappable
internal/external transport concept.

## Configuration

```csharp
builder.Services.AddMessages();   // NEvo.Messaging
builder.Services.AddCommands();   // this package
builder.Services.AddQueries();    // this package — independent of AddCommands()
```

`AddCommands()` registers `IMessageHandlerFactory` → `CommandHandlerAdapterFactory`,
`IMessageProcessingStrategy` → `CommandProcessingStrategy`, `ICommandDispatcher` →
`CommandDispatcher`, and `IMessageDispatchStrategyFactory<Command>` →
`DefaultCommandDispatchStrategyFactory`. `AddQueries()` registers
`IMessageHandlerFactory` → `QueryHandlerAdapterFactory`,
`IMessageProcessingStrategyWithResult` → `QueryProcessingStrategy` (one shared instance
serves every `Query<TResult>` regardless of `TResult`), and `IQueryDispatcher` →
`QueryDispatcher`. Both `AddCommands()` and `AddQueries()` are idempotent
(`TryAdd*`/`TryAddEnumerable`-based) — a repeated call is a no-op, not a crash or a
duplicate registration.

## Limitations

- Command/Query handler resolution follows `NEvo.Messaging`'s single-handler rule (see
  [`NEvo.Messaging.md`](NEvo.Messaging.md) § Limitations). There is no multi-handler
  Query semantics.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends.
- [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) depends on this package (for
  `Command`/`ICommandDispatcher` in its route-mapping helpers).

## Examples and tests

`tests/NEvo.Messaging.Cqrs.Tests/` is this package's dedicated test project —
characterization tests for the Command adapter/factory/strategy/dispatcher, Query
abstraction/discovery/dispatch tests (including end-to-end DI resolution, middleware
ordering, and cancellation propagation), and registration-idempotency tests for
`AddCommands()`/`AddEvents()`/`AddQueries()`.
