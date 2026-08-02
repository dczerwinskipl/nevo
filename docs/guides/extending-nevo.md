---
id: guides.extending-nevo
type: guide
title: Extending NEvo
status: current
summary: >
  How to add a new transport, persistence mechanism, handler, or event type, each
  grounded in an existing package that already does it. Process only — see
  coding-conventions.md for standing coding rules this guide doesn't repeat.
---

# Extending NEvo

This guide covers **process**: the steps and existing extension points to follow when
adding something new. For standing coding rules (the `Either<Exception, T>`
convention, dependency direction, DI registration shape) that apply regardless of what
you're extending, see
[Coding conventions](../development/coding-conventions.md) instead.

## Goal

Know which existing package to model a new extension on, and what shape that
extension needs to take to plug into NEvo's pipeline correctly.

## Prerequisites

Read [Coding conventions](../development/coding-conventions.md) first — every example
below follows its DI-registration and `Either<Exception, T>` rules without restating
them.

## Adding a transport

**Worked example: [`NEvo.Messaging.Web`](../packages/NEvo.Messaging.Web.md).**

Outbound dispatch and inbound receipt are separate concerns:

1. **Outbound:** implement `IExternalMessageDispatchStrategy` (`DispatchAsync` for the
   message, plus `ShouldApply(IMessage)` to decide whether your transport handles a
   given message) — see `RestExternalMessageDispatchStrategy` in
   `NEvo.Messaging.Web` for the shape: resolve/build a `MessageEnvelopeDto` via
   `IMessageEnvelopeMapper`, then hand it to your transport client.
2. **Inbound:** map an endpoint (or equivalent entry point for your transport) that
   resolves `IMessageProcessor`/`ICommandDispatcher` from DI and calls
   `ProcessMessageAsync`/`DispatchAsync` — see `RoutesExtensions.MapMessagesEndpoints`/
   `MapCommandEndpoint` in `NEvo.Messaging.Web` for the ASP.NET Core shape.
3. Register your strategy following the DI shape in
   [Coding conventions](../development/coding-conventions.md) § "DI registration
   shape" — `NEvo.Messaging.Web`'s `AddRestMessageDispatcher` is the reference.

## Adding a persistence mechanism

**Worked example: [`NEvo.Messaging.EntityFramework`](../packages/NEvo.Messaging.EntityFramework.md)**
(a *complete* one) — contrast with
[`NEvo.Orchestrating.EntityFramework`](../packages/NEvo.Orchestrating.EntityFramework.md)
(an *incomplete* one: an EF entity shape and table configuration with no actual
repository implementation) if you want a concrete example of what to avoid leaving
half-finished.

1. Define a `DbContext`-extending interface for the tables you need (see
   `IInboxDbContext`/`IOutboxDbContext` — each exposes the specific `DbSet<T>`
   properties your implementation needs, not the whole `DbContext`).
2. Implement the actual contract you're persisting for (`IMessageInbox`/
   `IMessageOutbox` in this example — `EntityFrameworkMessageInbox`/
   `EntityFrameworkMessageOutbox`) against that interface.
3. Add EF model configuration (`IEntityTypeConfiguration<T>` — see
   `InboxEntityTypeConfiguration`/`OutboxEntityTypeConfiguration`) and expose an
   `ApplyXxxConfiguration(this ModelBuilder)` extension so a consumer wires it into
   their own `DbContext.OnModelCreating`.
4. Register via `AddXxx<TDbContext>()` following the DI shape in
   [Coding conventions](../development/coding-conventions.md) — note
   `NEvo.Messaging.EntityFramework` itself only did this for inbox, not outbox (see
   that package's own doc); don't repeat that gap in something new.

## Adding a handler

**Worked example: [`NEvo.Messaging.Cqrs`](../packages/NEvo.Messaging.Cqrs.md).**

```csharp
public record MyCommand(string Value) : Command;

public class MyCommandHandler : ICommandHandler<MyCommand>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask;
}
```

Register the handler type so `NEvo.Messaging`'s reflection-based discovery
(`MessageHandlerExtractor`) picks it up — see
[`NEvo.Messaging.Cqrs`](../packages/NEvo.Messaging.Cqrs.md) § Configuration for the
exact registration call. Add `[AllowPermission(...)]` (from
[`NEvo.Messaging.Authorization`](../packages/NEvo.Messaging.Authorization.md)) on the
handler method if it needs a permission check — see that package's doc for exactly
how the check runs and what happens on failure before relying on it.

## Adding an event type

**Worked example: `NEvo.Messaging`'s own `Events` namespace** (`Event`,
`IEventHandler<T>`, `IEventPublisher`, registered via `AddEvents()`) — this lives in
`NEvo.Messaging` itself, not `NEvo.Messaging.Cqrs`.

```csharp
public record MyEvent(string Data) : Event;

public class MyEventHandler : IEventHandler<MyEvent>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask;
}
```

Publish via `IEventPublisher.PublishAsync(new MyEvent(...), cancellationToken)`.
Unlike commands (exactly one handler expected), events support **multiple** handlers,
dispatched sequentially or in parallel depending on which `IMessageProcessingStrategy`
(`SequentialEventProcessingStrategy`/`ParallelEventProcessingStrategy`) claims the
message — both are registered by `AddEvents()`; which one applies to a given event
type is a detail of `EventProcessingStrategyBase`'s subclasses, not something this
guide's process-level scope covers further.

## Verification

For any of the above: `dotnet build` confirms your implementation satisfies the
interface; run the relevant package's own test project (see that package's doc's
"Examples and tests" section) as a starting point for testing your extension, and add
characterization tests per [Testing](../development/testing.md) if you're modifying
existing behavior rather than adding new behavior alongside it.

## Next steps

See each worked-example package's own doc (linked above) for that extension point's
specific limitations before building on it — several have documented gaps (missing DI
helpers, incomplete implementations) worth knowing about upfront.
