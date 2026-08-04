---
id: development.inbox-outbox
type: development
title: Inbox and outbox
status: current
read_when:
  - working with inbox or outbox
  - implementing idempotency
  - modifying message persistence
summary: >
  Inbox (idempotency) and outbox (transactional message publishing) abstractions.
  Both are opt-in — not required for basic messaging scenarios.
related:
  - development.transaction-model
  - development.messaging-pipeline
---

# Inbox and outbox

This is the maintainer-level document for the inbox/outbox mechanism internals — the
consumer-facing "how do I enable this in my own handler" guide lives at
`docs/usage/inbox-outbox.md`.

## Subsystem responsibility

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
calls `RegisterProcessedAsync` after successful handling. See
`docs/development/transaction-model.md` question 3 for how this interacts with the
ambient transaction.

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

The outbox supports **partitioning** via the `partition` parameter on
`GetMessagesToPublishAsync`. Partition assignment itself is not yet implemented — see
`docs/development/failure-semantics.md` § "Outbox partition-assignment semantics".

A background process (not part of this package) is expected to poll the outbox and publish
messages via the configured transport.

## Wire format

`MessageEnvelopeDto` carries the serialized message, type name, and context headers.
`IMessageTypeMapper` maps between `Type` and string name. The default implementation
(`DefaultMessageTypeMapper`) uses the full type name with assembly.

## Ordering constraints

See `docs/development/transaction-model.md` question 4 for whether an outbox save
shares the handler's transaction — it is conditional on the call site, not guaranteed.

## When to use

| Scenario | Inbox | Outbox |
|---|---|---|
| External message from another service | Yes — prevent duplicate processing | Yes — publish response atomically |
| Internal in-process command | No — not needed | No — no external transport |
| Fire-and-forget event with no state | No | No |
| Event that must trigger downstream side effects exactly once | Yes | Yes |
