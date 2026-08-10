---
id: guides.inbox-outbox
type: guide
title: Inbox/outbox
status: current
summary: >
  Enabling idempotent message processing and transactional publish in your own
  handler, including the manual outbox DI wiring step NEvo doesn't automate.
---

# Inbox/outbox

## Goal

Make your own handler idempotent (safe to process the same message twice) and/or
publish messages transactionally alongside your handler's own state change.

## Prerequisites

- [`NEvo.Messaging.EntityFramework`](../reference/packages/NEvo.Messaging.EntityFramework.md)
  referenced.
- A `DbContext` you control, to implement `IInboxDbContext`/`IOutboxDbContext` against.

## Steps

### 1. Wire your `DbContext`

```csharp
public class MyDbContext(DbContextOptions options) : DbContext(options), IInboxDbContext, IOutboxDbContext
{
    public DbSet<InboxProcessedMessage> InboxProcessedMessages => Set<InboxProcessedMessage>();
    public DbSet<InboxProcessedHandler> InboxProcessedHandlers => Set<InboxProcessedHandler>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyInboxConfiguration().ApplyOutboxConfiguration();
    }
}
```

### 2. Register the inbox

```csharp
services.AddEntityFrameworkInbox<MyDbContext>();
services.AddMessageProcessingMiddleware<InboxMessageProcessingMiddleware>();
```

### 3. Register the outbox manually — there is no DI helper

**`AddEntityFrameworkOutbox<TDbContext>()` does not exist.** Register it yourself:

```csharp
services.AddScoped<IMessageOutbox, EntityFrameworkMessageOutbox>();
services.AddScoped<IOutboxDbContext>(sp => sp.GetRequiredService<MyDbContext>());
```

This is not an oversight to work around — it's the current state of the package (see
`docs/reference/packages/NEvo.Messaging.EntityFramework.md` § Limitations); the manual
registration above is the complete workaround.

### 4. Save to the outbox from your handler

```csharp
await messageOutbox.SaveMessageAsync(messageEnvelopeDto);
```

## Constraints and failure modes

- The inbox check runs inside the ambient transaction opened by
  `TransactionScopeMessageProcessingMiddleware`, if that middleware is registered
  before it — see `docs/development/inbox-outbox.md` § "Inbox — idempotency" for the
  exact ordering requirement, and `docs/development/transaction-model.md` question 3
  for how much of this is verified by test versus understood from code structure.
- Outbox partition assignment is not implemented — do not rely on any particular
  partitioning strategy; see `docs/development/failure-semantics.md` § "Outbox
  partition-assignment semantics".
- No locking exists against two concurrent outbox readers processing the same message
  — see `docs/project/known-issues.md` § "Outbox is missing locking, partitioning, and
  a DI helper" before running more than one publisher process.
- A message's context headers are not preserved through an outbox round-trip today —
  see the same known-issues entry.

## Verification

Processing the same message twice and observing the handler's side effect happen only
once confirms inbox idempotency is working. Inspecting the `OutboxMessages` table after
a handler runs (and before a publisher has polled it) confirms the outbox save
succeeded within the handler's own transaction.

## Next steps

[Troubleshooting](troubleshooting.md) — for diagnosing failures once inbox/outbox is
wired up.
