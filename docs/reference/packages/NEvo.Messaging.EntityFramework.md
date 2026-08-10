---
id: packages.nevo-messaging-entityframework
type: package
title: NEvo.Messaging.EntityFramework
status: current
dependencies:
  - NEvo.Messaging
summary: >
  EF Core-backed implementations of NEvo.Messaging's inbox (idempotency) and outbox
  (transactional publishing) abstractions. Only inbox has a DI registration helper —
  see Limitations.
---

# NEvo.Messaging.EntityFramework

## Purpose

`NEvo.Messaging.EntityFramework` provides `IMessageInbox`/`IMessageOutbox`
implementations backed by EF Core, for the opt-in idempotency/transactional-publishing
patterns described in `docs/development/inbox-outbox.md`.

## When to use

Whenever you need EF-Core-backed inbox idempotency or outbox transactional publishing.
See `docs/usage/inbox-outbox.md` for the task-oriented walkthrough, including the
manual outbox wiring step this package requires.

## When not to use

If your service doesn't need idempotent processing or transactional publish (see
`docs/development/inbox-outbox.md` § "When to use"), skip this package.

## Responsibilities

- `EntityFrameworkMessageInbox` — implements `IMessageInbox` against
  `IInboxDbContext` (`InboxProcessedMessages`, `InboxProcessedHandlers` tables).
- `EntityFrameworkMessageOutbox` — implements `IMessageOutbox` against
  `IOutboxDbContext` (`OutboxMessages` table), including the partition-filtered query
  path described in `docs/development/inbox-outbox.md` § "Outbox".
- EF model configuration helpers (`ApplyInboxConfiguration`, `ApplyOutboxConfiguration`)
  for a consumer's `DbContext.OnModelCreating`.

## Dependencies

Depends only on `NEvo.Messaging` — see
`src/NEvo.Messaging.EntityFramework/NEvo.Messaging.EntityFramework.csproj`.

## Public surface

Grounded directly in `src/NEvo.Messaging.EntityFramework/*.cs`.

```csharp
public interface IInboxDbContext : IDbContext
{
    DbSet<InboxProcessedMessage> InboxProcessedMessages { get; }
    DbSet<InboxProcessedHandler> InboxProcessedHandlers { get; }
}

public interface IOutboxDbContext : IDbContext
{
    DbSet<OutboxMessage> OutboxMessages { get; }
}
```

```csharp
public static class ModelBuilderExtensions // in Configurations namespace
{
    public static ModelBuilder ApplyInboxConfiguration(this ModelBuilder modelBuilder);
    public static ModelBuilder ApplyOutboxConfiguration(this ModelBuilder modelBuilder);
}
```

`EntityFrameworkMessageOutbox.GetMessagesToPublishAsync` orders by `Status` then either
`Partition`+`Order` (when a partition is specified) or just `Order` — matching
`IMessageOutbox`'s partition parameter from `docs/development/inbox-outbox.md`.

## Configuration

```csharp
services.AddEntityFrameworkInbox<MyDbContext>(); // requires MyDbContext : IInboxDbContext
```

**There is no `AddEntityFrameworkOutbox<TDbContext>()` counterpart** — see
"Limitations" and `docs/usage/inbox-outbox.md` for the manual registration steps.
`ApplyInboxConfiguration`/`ApplyOutboxConfiguration` are called from your
`DbContext.OnModelCreating(ModelBuilder)`, independent of the DI registration above.

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

## Limitations

No `AddEntityFrameworkOutbox<TDbContext>()` DI helper, no locking against concurrent
outbox readers, no real partition assignment, and no context-header preservation across
an outbox round-trip — see `docs/project/known-issues.md` § "Outbox is missing locking,
partitioning, and a DI helper" for the full detail and the manual registration
workaround.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends; provides the
  `IMessageInbox`/`IMessageOutbox` contracts implemented here.
- [`NEvo.EntityFramework`](NEvo.EntityFramework.md) — the shared EF base package
  (migrations, resilience). Not a direct dependency of this package (not present in its
  `.csproj`), but thematically related.

## Examples and tests

No dedicated `tests/NEvo.Messaging.EntityFramework.Tests/` project exists in this
repository today.
