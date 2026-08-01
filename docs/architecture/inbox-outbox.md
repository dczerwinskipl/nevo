---
id: architecture.inbox-outbox
type: architecture
title: Inbox and outbox
status: current
scope:
  - messaging
  - inbox
  - outbox
  - idempotency
read_when:
  - working with inbox or outbox
  - implementing idempotency
  - modifying message persistence
summary: >
  Inbox (idempotency) and outbox (transactional message publishing) abstractions.
  Both are opt-in — not required for basic messaging scenarios.
related:
  - architecture.persistence
  - architecture.messaging-pipeline
---

# Inbox and outbox

Both patterns are **opt-in**. Not every message handler requires idempotency or transactional
publishing. A service that can tolerate duplicate processing or has no outgoing messages
does not need either.

## Inbox — idempotency

`IMessageInbox` tracks which messages have already been processed:

```csharp
interface IMessageInbox
{
    Task<Unit> RegisterProcessedAsync(IMessage, IMessageContext);
    Task<Unit> RegisterProcessedAsync(IMessageHandler, IMessage, IMessageContext);
    bool IsAlreadyProcessed(IMessage, IMessageContext);
    bool IsAlreadyProcessed(IMessageHandler, IMessage, IMessageContext);
}
```

Idempotency can be tracked at:
- **Message level** — the entire message was already processed
- **Handler level** — this specific handler already processed this message (useful when
  one message triggers multiple handlers and only some need idempotency)

`InboxMessageProcessingMiddleware` checks `IsAlreadyProcessed` before dispatching and
calls `RegisterProcessedAsync` after successful handling.

EF implementation: `NEvo.Messaging.EntityFramework` (SQL Server table).

## Outbox — transactional message publishing

`IMessageOutbox` stores messages to be published atomically with the handler's state change:

```csharp
interface IMessageOutbox
{
    IAsyncEnumerable<MessageEnvelopeDto> GetMessagesToPublishAsync(int count, int? partition);
    Task<Unit> SaveMessageAsync(MessageEnvelopeDto message);
}
```

The outbox supports **partitioning** via the `partition` parameter on `GetMessagesToPublishAsync`.
The semantics of partition assignment are not yet formally specified.

A background process (not part of this package) is expected to poll the outbox and publish
messages via the configured transport.

## Wire format

`MessageEnvelopeDto` carries the serialized message, type name, and context headers.
`IMessageTypeMapper` maps between `Type` and string name. The default implementation
(`DefaultMessageTypeMapper`) uses the full type name with assembly.

## When to use

| Scenario | Inbox | Outbox |
|---|---|---|
| External message from another service | Yes — prevent duplicate processing | Yes — publish response atomically |
| Internal in-process command | No — not needed | No — no external transport |
| Fire-and-forget event with no state | No | No |
| Event that must trigger downstream side effects exactly once | Yes | Yes |
