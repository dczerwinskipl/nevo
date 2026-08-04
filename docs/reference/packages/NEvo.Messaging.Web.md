---
id: packages.nevo-messaging-web
type: package
title: NEvo.Messaging.Web
status: current
dependencies:
  - NEvo.Messaging
  - NEvo.Messaging.Cqrs
  - NEvo.Web
summary: >
  HTTP transport for messaging: REST dispatch to external services and ASP.NET Core
  route mapping for commands and generic message envelopes.
---

# NEvo.Messaging.Web

## Purpose

`NEvo.Messaging.Web` provides HTTP transport for the message pipeline in two
directions: dispatching messages to *other* services over REST
(`RestExternalMessageDispatchStrategy`), and exposing HTTP endpoints so *this* service
can receive messages/commands (`RoutesExtensions`).

## When to use

Whenever a service needs to dispatch commands to another NEvo-based service over HTTP,
or expose its own message/command endpoints. See `docs/usage/cross-service-messaging.md`
for the task-oriented walkthrough.

## When not to use

For purely internal (in-process) messaging with no cross-service HTTP dispatch, this
package isn't needed — use `NEvo.Messaging`/`NEvo.Messaging.Cqrs` directly.

## Responsibilities

- Dispatch a message externally over REST when configured to do so
  (`RestExternalMessageDispatchStrategy` implements `IExternalMessageDispatchStrategy`;
  `ShouldApply` checks whether the message type has REST routing configured).
- Map ASP.NET Core endpoints: a generic message-envelope dispatch endpoint
  (`MapMessagesEndpoints`) and a typed command endpoint
  (`MapCommandEndpoint<TCommand>`).
- Configure the REST client used for outbound dispatch, built on
  [`NEvo.Web`](NEvo.Web.md)'s HTTP client wrapper (`AddHttpClientServices`).

## Dependencies

Depends on `NEvo.Messaging`, `NEvo.Messaging.Cqrs`, and `NEvo.Web` — see
`src/NEvo.Messaging.Web/NEvo.Messaging.Web.csproj`'s `ProjectReference` entries (a
redundant direct reference to `NEvo.Core` is also present but not drawn as a separate
edge in `docs/development/package-boundaries.md` since it's already transitively
reachable via `NEvo.Messaging`).

**This is the one documented exception to `package-boundaries.md` rule 4** ("messaging
extension packages depend on `NEvo.Messaging` but not on each other") — this package
also depends on `NEvo.Messaging.Cqrs`, for its `Command`/`ICommandDispatcher`-based
route mapping (`MapCommandEndpoint<TCommand>`, `RoutesExtensions.cs`). Do not describe
messaging extension packages as fully independent of each other.

## Public surface

Grounded directly in `src/NEvo.Messaging.Web/*.cs`.

```csharp
public interface IRestMessageClientService
{
    Task<Either<Exception, Unit>> DispatchAsync(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken);
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken);
}
```

```csharp
namespace Microsoft.AspNetCore.Routing;

public static class RoutesExtensions
{
    public static RouteGroupBuilder MapMessagesEndpoints<T>(this T routeBuilder, string prefix = "/api/messages") where T : IEndpointRouteBuilder;
    public static RouteHandlerBuilder MapCommandEndpoint<TCommand>(this IEndpointRouteBuilder routeBuilder, string routeName) where TCommand : Command;
}
```

`MapMessagesEndpoints` maps `POST {prefix}/dispatch`, accepting a generic
`MessageEnvelopeDto` and routing it through `IMessageProcessor`. `MapCommandEndpoint`
maps a single typed command directly to `ICommandDispatcher.DispatchAsync` (from
[`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md)).

## Configuration

```csharp
builder.Services.AddMessages();               // NEvo.Messaging
builder.Services.AddCommands();                // NEvo.Messaging.Cqrs
builder.Services.AddRestMessageDispatcher(configure =>
{
    // HttpClientServiceConfiguration — see NEvo.Web.md
}, typeof(MyExternalCommand));
```

The single-argument `AddRestMessageDispatcher()` overload registers only
`IRestMessageClientFactory`/`IExternalMessageDispatchStrategy`; the overload above also
wires up the HTTP client (`AddHttpClientServices`, from `NEvo.Web`) and marks the given
message types as externally-routed. On the receiving side, map endpoints in
`Program.cs`:

```csharp
app.MapMessagesEndpoints();
app.MapCommandEndpoint<CreateOrder>("/api/orders");
```

See `docs/usage/cross-service-messaging.md` for the full end-to-end walkthrough.

## Limitations

- `AddRestMessageDispatcher`'s single-argument overload's configuration API may change
  shape in a future revision (currently a delegate, may move to a builder pattern).
- `MapMessagesEndpoints`'s dispatch handler does not yet propagate headers from the
  incoming envelope into the message context.
- `MapCommandEndpoint`'s success/failure branches currently write to `Console.WriteLine`
  — no structured logging.
- Both `MapMessagesEndpoints` and `MapCommandEndpoint` map **every** `Either.Left` to
  the same generic HTTP 500 — see `docs/project/known-issues.md` § "Authorization
  surfaces a generic HTTP 500, not 403" for the concrete authorization-failure case.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md), [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md)
  — both real dependencies (see "Dependencies").
- [`NEvo.Web`](NEvo.Web.md) — provides the underlying HTTP client wrapper this
  package's REST dispatch is built on.

## Examples and tests

No dedicated `tests/NEvo.Messaging.Web.Tests/` project exists in this repository today.
