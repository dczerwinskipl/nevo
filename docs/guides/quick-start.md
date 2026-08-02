---
id: guides.quick-start
type: guide
title: Quick start
status: current
summary: >
  Minimal working setup using NEvo.Core and NEvo.Messaging: register the pipeline,
  understand what raw NEvo.Messaging gives you, and why the very next package most
  consumers add is NEvo.Messaging.Cqrs.
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
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddMessages();
var app = builder.Build();
```

`AddMessages()` (from `NEvo.Messaging`) registers `IMessageProcessor`, the handler
registry, context accessor, and the default correlation/causation/telemetry middleware
— see [`NEvo.Messaging`](../packages/NEvo.Messaging.md) § Configuration for the full
list of what this registers.

### 2. Define a message

```csharp
public record Ping(string Text) : IMessage
{
    public Guid Id { get; } = Guid.NewGuid();
    public DateTime CreatedAt { get; } = DateTime.UtcNow;
}
```

`IMessage` (from `NEvo.Messaging`) is the base contract every dispatchable message
implements — see [`NEvo.Messaging`](../packages/NEvo.Messaging.md) § Public surface.

### 3. Dispatch it

```csharp
var processor = app.Services.GetRequiredService<IMessageProcessor>();
var context = app.Services.GetRequiredService<IMessageContextProvider>().CreateContext();
Either<Exception, Unit> result = await processor.ProcessMessageAsync(new Ping("hello"), context, CancellationToken.None);
```

This runs `Ping` through the full middleware chain. **It will fail** at this point with
"no handler found" — `NEvo.Core`/`NEvo.Messaging` alone define the pipeline and the
`IMessage`/`IMessageHandler` contracts, but writing a raw `IMessageHandler` by hand
requires manually constructing a `MessageHandlerDescription` and registering it into
`MessageHandlerExtractorConfiguration` yourself — there is no ergonomic handler-authoring
story in these two packages alone (verified directly against
`src/NEvo.Messaging/Handling/MessageHandlerExtractor.cs`: handler discovery is
driven entirely by `IMessageHandlerFactory` implementations keyed by handler interface,
and none ships in `NEvo.Messaging` itself).

### 4. Add `NEvo.Messaging.Cqrs` for a first real handler

This is why, per `README.md`'s own framing ("start with minimal infrastructure...add
CQRS when read/write scaling becomes essential"), `NEvo.Messaging.Cqrs` is almost always
the very next package a consumer adds — it's the thin, ergonomic layer that makes
writing and registering a handler practical:

```csharp
builder.Services.AddCommands(); // NEvo.Messaging.Cqrs

public record Ping(string Text) : Command;

public class PingHandler : ICommandHandler<Ping>
{
    public Task<Either<Exception, Unit>> HandleAsync(Ping message, IMessageContext context, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Text);
        return UnitExt.DefaultEitherTask;
    }
}
```

See [`NEvo.Messaging.Cqrs`](../packages/NEvo.Messaging.Cqrs.md) for how commands are
registered and dispatched (`ICommandDispatcher`), and note its own limitation: only the
command side is implemented, there is no query-side support.

## Verification

A successful `HandleAsync` invocation (observable via the `Console.WriteLine` above, or
by asserting on the `Either<Exception, Unit>` returned from dispatch) confirms the
pipeline, registration, and handler discovery are all wired correctly.

## Next steps

- [Package classification](../packages/classification.md) — see what else is
  available (authorization, persistence, HTTP transport, orchestration) as your
  service grows.
- [ExampleApp walkthrough](example-app-walkthrough.md) — a full, working multi-service
  example combining several of these packages.
