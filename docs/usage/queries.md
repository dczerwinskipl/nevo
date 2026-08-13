---
id: guides.queries
type: guide
title: Queries
status: current
summary: >
  Dispatching a query via IQueryDispatcher and writing a typed query handler, using
  NEvo.Messaging.Cqrs's Query support.
---

# Queries

## Goal

Write and register a handler for your own read-side query, and dispatch it to get back
a typed result — either directly via `IQueryDispatcher` or from an HTTP endpoint.

## Prerequisites

- [`NEvo.Messaging.Cqrs`](../reference/packages/NEvo.Messaging.Cqrs.md) referenced and
  registered (`AddMessages()` + `AddQueries()`) — see [Quick start](quick-start.md) if
  you haven't done this yet. `AddQueries()` does not require `AddCommands()`.

## Steps

### 1. Define a query

A query is a `record` deriving from `Query<TResult>`, where `TResult` is whatever type
the query returns:

```csharp
public record GetOrderStatus(string OrderId) : Query<OrderStatusDto>;
```

### 2. Write a handler

```csharp
public class GetOrderStatusHandler : IQueryHandler<GetOrderStatus, OrderStatusDto>
{
    public Task<Either<Exception, OrderStatusDto>> HandleAsync(GetOrderStatus query, IMessageContext context, CancellationToken cancellationToken)
        => Task.FromResult(Either<Exception, OrderStatusDto>.Right(new OrderStatusDto(query.OrderId, "Shipped")));
}
```

Handler discovery is reflection-based, the same as for commands — you don't manually
register each handler type; `NEvo.Messaging`'s `MessageHandlerExtractor` finds it via
`IQueryHandler<TQuery, TResult>`'s adapter (`QueryHandlerAdapterFactory`, registered by
`AddQueries()`). One shared `QueryProcessingStrategy` instance serves every
`Query<TResult>` regardless of what `TResult` is.

### 3. Dispatch it

Directly, via `IQueryDispatcher`:

```csharp
var result = await queryDispatcher.DispatchAsync(new GetOrderStatus("order-1"), cancellationToken);
```

Or over HTTP, via `NEvo.Messaging.Web`'s `MapQueryEndpoint<TQuery, TResult>` — the
recommended HTTP Query pattern, binding the query from route/query-string values via
`[AsParameters]` (no request body):

```csharp
app.MapQueryEndpoint<GetOrderStatus, OrderStatusDto>("/api/orders/{orderId}/status");
```

See `examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Routes.cs`'s `GetDocumentQuery`
mapping for a complete, runnable example, and
[Event Sourcing](event-sourcing.md) § "Query and read side" for the full binding
details (including why `Id`/`CreatedAt` are never required parameters).

## Constraints and failure modes

Query handler resolution requires exactly one handler for a given query type, exactly
like commands — `NoHandlerFoundException` if none is registered,
`MoreThanOneHandlerFoundException` if more than one is. There is no multi-handler
Query semantics; if you need multiple independent reactions to a trigger, use an event
instead — see [Events](events.md).

## Verification

`dotnet build` confirms your handler satisfies `IQueryHandler<TQuery, TResult>` with the
right `TResult`; dispatching the query and observing a `Right` result carrying the
expected typed value confirms it's wired up and discovered correctly.

## Next steps

[Commands](commands.md) — for write-side, single-handler operations that don't return a
domain-shaped result. [Events](events.md) — for multi-handler, fire-and-react scenarios.
