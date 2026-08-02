---
id: guides.quick-start
type: guide
title: Quick start
status: current
summary: >
  Minimal working setup using NEvo.Core and NEvo.Messaging: register the pipeline, add
  NEvo.Messaging.Cqrs for a first real handler, expose it over HTTP via
  NEvo.Messaging.Web, then publish and react to an event — the same end-to-end
  "request → command → event → independent handler" shape examples/ExampleApp runs for
  real.
---

# Quick start

## Goal

Get a message dispatched through NEvo's processing pipeline in a new project, starting
from the two packages every consumer builds on: [`NEvo.Core`](../packages/NEvo.Core.md)
and [`NEvo.Messaging`](../packages/NEvo.Messaging.md).

## Prerequisites

See [Installation](installation.md) — reference `NEvo.Core` and `NEvo.Messaging` via
`ProjectReference` before continuing.

## Steps

### 1. Register the pipeline

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddMessages();
var app = builder.Build();
```

`WebApplication.CreateBuilder` (not the plain `Host.CreateApplicationBuilder`) is used
from the start because step 5 below exposes the handler over HTTP — this matches how
`examples/ExampleApp`'s services are actually bootstrapped (`Program.cs`).
`AddMessages()` (from `NEvo.Messaging`) registers `IMessageProcessor`, the handler
registry, context accessor, and the default correlation/causation/telemetry middleware
— see [`NEvo.Messaging`](../packages/NEvo.Messaging.md) § Configuration for the full
list of what this registers.

### 2. Define a message

```csharp
public record SayHello(string Name) : IMessage
{
    public Guid Id { get; } = Guid.NewGuid();
    public DateTime CreatedAt { get; } = DateTime.UtcNow;
}
```

`IMessage` (from `NEvo.Messaging`) is the base contract every dispatchable message
implements — see [`NEvo.Messaging`](../packages/NEvo.Messaging.md) § Public surface.

### 3. Dispatch it manually — and see why that's not the real path

```csharp
var processor = app.Services.GetRequiredService<IMessageProcessor>();
var context = app.Services.GetRequiredService<IMessageContextProvider>().CreateContext();
Either<Exception, Unit> result = await processor.ProcessMessageAsync(new SayHello("world"), context, CancellationToken.None);
```

This runs `SayHello` through the full middleware chain. **It will fail** at this point
with "no handler found" — `NEvo.Core`/`NEvo.Messaging` alone define the pipeline and the
`IMessage`/`IMessageHandler` contracts, but writing a raw `IMessageHandler` by hand
requires manually constructing a `MessageHandlerDescription` and registering it into
`MessageHandlerExtractorConfiguration` yourself — there is no ergonomic handler-authoring
story in these two packages alone (verified directly against
`src/NEvo.Messaging/Handling/MessageHandlerExtractor.cs`: handler discovery is
driven entirely by `IMessageHandlerFactory` implementations keyed by handler interface,
and none ships in `NEvo.Messaging` itself). Manually resolving `IMessageProcessor` like
this is also not how any real service serves a request — steps 4-5 below replace it
with the actual mechanism `examples/ExampleApp` uses.

### 4. Add `NEvo.Messaging.Cqrs` for a first real handler

This is why, per `README.md`'s own framing ("start with minimal infrastructure...add
CQRS when read/write scaling becomes essential"), `NEvo.Messaging.Cqrs` is almost always
the very next package a consumer adds — it's the thin, ergonomic layer that makes
writing and registering a handler practical:

```csharp
builder.Services.AddCommands(); // NEvo.Messaging.Cqrs

public record SayHello(string Name) : Command;

public class SayHelloHandler : ICommandHandler<SayHello>
{
    public Task<Either<Exception, Unit>> HandleAsync(SayHello message, IMessageContext context, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Hello, {message.Name}!");
        return UnitExt.DefaultEitherTask;
    }
}
```

See [`NEvo.Messaging.Cqrs`](../packages/NEvo.Messaging.Cqrs.md) for how commands are
registered and dispatched (`ICommandDispatcher`), and note its own limitation: only the
command side is implemented, there is no query-side support.

### 5. Expose it over HTTP

Resolving `IMessageProcessor`/`ICommandDispatcher` by hand (step 3) is not how a real
request reaches a handler. Every endpoint in `examples/ExampleApp` instead uses
[`NEvo.Messaging.Web`](../packages/NEvo.Messaging.Web.md)'s `MapCommandEndpoint<TCommand>`,
which maps an HTTP `POST` straight to `ICommandDispatcher.DispatchAsync`
(`src/NEvo.Messaging.Web/RoutesExtensions.cs`):

```csharp
app.MapCommandEndpoint<SayHello>("/api/say-hello");
```

```bash
curl -X POST https://localhost:<port>/api/say-hello -d '{"name":"world"}'
```

This now reaches `SayHelloHandler` over HTTP, using the exact same route-mapping
mechanism as `POST /api/hello` in
[ExampleApp's `ServiceA.Api`](example-app-walkthrough.md#scenario-2-a-permission-checked-command)
(unauthenticated here, for simplicity — that walkthrough's endpoint additionally
requires a token).

### 6. Publish an event, and react to it independently

A command handler can also publish an event that other, independent handlers react to
— this is the same shape `examples/ExampleApp` uses to fan out side effects. Add
`AddEvents()` (from `NEvo.Messaging`), define an event, publish it from the handler, and
add a second, independent handler that reacts to it:

```csharp
builder.Services.AddEvents(); // registers IEventPublisher and event handler discovery

public record Greeted(string Name) : Event;

public class SayHelloHandler(IEventPublisher eventPublisher) : ICommandHandler<SayHello>
{
    public async Task<Either<Exception, Unit>> HandleAsync(SayHello message, IMessageContext context, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Hello, {message.Name}!");
        return await eventPublisher.PublishAsync(new Greeted(message.Name), cancellationToken);
    }
}

public class GreetedAuditHandler : IEventHandler<Greeted>
{
    public Task<Either<Exception, Unit>> HandleAsync(Greeted message, IMessageContext context, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Audit: greeted {message.Name}");
        return UnitExt.DefaultEitherTask;
    }
}
```

Calling `POST /api/say-hello` now prints both the handler's own line and the audit
handler's line — two independent handlers reacting to one published event. **This is
the exact shape already running in `examples/ExampleApp`:** `POST /api/hello` maps to
`SayHelloCommand` → `SayHelloCommandHandler`, which publishes `MyEvent`, fanned out to
two independent handlers, `MyEventHandlerA` and `MyEventHandlerB` — see [ExampleApp
walkthrough § Scenario
2](example-app-walkthrough.md#scenario-2-a-permission-checked-command) for the real,
running code, so you recognize this as the same pattern, not an unrelated example.

## Verification

- A successful `HandleAsync` invocation for `SayHelloHandler` (observable via the
  `Console.WriteLine` in step 4, or by asserting on the `Either<Exception, Unit>`
  returned from dispatch) confirms the pipeline, registration, and handler discovery are
  all wired correctly.
- After step 5, `curl`ing `/api/say-hello` returns `200 OK` and prints `Hello, world!` to
  the console.
- After step 6, the same request additionally prints `Audit: greeted world` — confirming
  the published `Greeted` event reached its independent handler.

## Next steps

- [Package classification](../packages/classification.md) — see what else is
  available (authorization, persistence, HTTP transport, orchestration) as your
  service grows.
- [ExampleApp walkthrough](example-app-walkthrough.md) — a full, working multi-service
  example combining several of these packages.
