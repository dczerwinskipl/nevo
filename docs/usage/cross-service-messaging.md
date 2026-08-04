---
id: guides.cross-service-messaging
type: guide
title: Cross-service messaging
status: current
summary: >
  Dispatching a command from one service to another over REST, generalized from the
  example app's cross-service scenario.
---

# Cross-service messaging

## Goal

Dispatch a command from one service (the caller) to another (the receiver) over HTTP,
instead of handling it locally.

## Prerequisites

- [`NEvo.Web`](../reference/packages/NEvo.Web.md) and
  [`NEvo.Messaging.Web`](../reference/packages/NEvo.Messaging.Web.md) referenced on the
  calling service.
- [`NEvo.Messaging.Web`](../reference/packages/NEvo.Messaging.Web.md) referenced on the
  receiving service, with an endpoint mapped to receive it (see
  [Commands](commands.md)).

## Steps

### 1. Mark the command as externally routed, on the caller

```csharp
builder.Services.AddRestMessageDispatcher(configure =>
{
    configure.Name = "service-b";
    configure.BaseAddress = new Uri("https://service-b.internal");
}, typeof(ProcessOrder));
```

This registers `ProcessOrder` as externally-routed: dispatching it goes out over REST
to the configured target instead of being handled locally by this service.

### 2. Dispatch normally

```csharp
await commandDispatcher.DispatchAsync(new ProcessOrder(orderId), cancellationToken);
```

Because `ProcessOrder` is configured as externally-routed, this call goes out over REST
to the target service's `POST /api/messages/dispatch` endpoint instead of resolving a
local handler.

### 3. Receive it, on the target service

```csharp
app.MapMessagesEndpoints(); // generic message-envelope endpoint
```

The target service needs a normal `ICommandHandler<ProcessOrder>` registered (see
[Commands](commands.md)) — from the handler's perspective, a dispatch that arrived over
REST from another service is indistinguishable from a local one.

## Constraints and failure modes

- The receiving endpoint (`MapMessagesEndpoints`) does not require authorization by
  default — decide explicitly whether your internal dispatch path needs its own
  authentication (network isolation, service-to-service auth, or an
  `.RequireAuthorization()` call), rather than leaving it open. See
  `docs/project/known-issues.md` § "Example app: ServiceB's internal dispatch endpoint
  is unauthenticated" for a concrete case of what happens when this decision is skipped.
- Every dispatch failure surfaces as the same generic behavior described in
  [Commands](commands.md)/[Troubleshooting](troubleshooting.md) — a network failure and
  an application-level `Left` are not distinguished specially for cross-service calls.

## Verification

A successful dispatch is observable on the **receiving** service's side (its handler's
own side effect, e.g. a `Console.WriteLine` or a persisted state change) — not the
caller's. This is the concrete way to confirm the dispatch actually crossed the service
boundary rather than being handled locally.

## Next steps

[Inbox/outbox](inbox-outbox.md) — for making cross-service message delivery
idempotent and transactional, rather than best-effort.
