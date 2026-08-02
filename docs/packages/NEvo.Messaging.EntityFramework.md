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
patterns described in
[Inbox and outbox](../architecture/inbox-outbox.md) (`architecture.inbox-outbox`).

## Responsibilities

- `EntityFrameworkMessageInbox` — implements `IMessageInbox` against
  `IInboxDbContext` (`InboxProcessedMessages`, `InboxProcessedHandlers` tables).
- `EntityFrameworkMessageOutbox` — implements `IMessageOutbox` against
  `IOutboxDbContext` (`OutboxMessages` table), including the partition-filtered query
  path described in [Inbox and outbox](../architecture/inbox-outbox.md) § "Outbox".
- EF model configuration helpers (`ApplyInboxConfiguration`, `ApplyOutboxConfiguration`)
  for a consumer's `DbContext.OnModelCreating`.

## Dependencies

Depends only on `NEvo.Messaging` — confirmed against
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
`IMessageOutbox`'s partition parameter from
[Inbox and outbox](../architecture/inbox-outbox.md).

## Configuration

```csharp
services.AddEntityFrameworkInbox<MyDbContext>(); // requires MyDbContext : IInboxDbContext
```

**There is no `AddEntityFrameworkOutbox<TDbContext>()` counterpart** — see
"Limitations". `ApplyInboxConfiguration`/`ApplyOutboxConfiguration` are called from your
`DbContext.OnModelCreating(ModelBuilder)`, independent of the DI registration above.

## Basic usage

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

## Advanced usage

No advanced usage beyond the above is documented yet.

## Limitations

- **No `AddEntityFrameworkOutbox<TDbContext>()` DI helper exists** — only inbox has one
  (`ServiceCollectionExtensions.cs` defines exactly one method,
  `AddEntityFrameworkInbox<TDbContext>`). A consumer wanting `EntityFrameworkMessageOutbox`
  registered as `IMessageOutbox` must do so manually:
  `services.AddScoped<IMessageOutbox, EntityFrameworkMessageOutbox>();
  services.AddScoped<IOutboxDbContext>(sp => sp.GetRequiredService<MyDbContext>());`
- `EntityFrameworkMessageOutbox.GetMessagesToPublishAsync` and `SaveMessageAsync` both
  carry `// TODO` comments in source for locking (concurrent readers could race for the
  same messages) and partitioning (`SaveMessageAsync` hardcodes partition `0`) — neither
  is fully implemented.
- Context-header serialization for outbox messages is marked `/* ToDo - serialize? */`
  in source — `GetMessagesToPublishAsync` currently returns an empty
  `MessageContextHeaders` for every message, not the headers that were present when the
  message was saved.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends; provides the
  `IMessageInbox`/`IMessageOutbox` contracts implemented here.
- `NEvo.EntityFramework` — the shared EF base package (migrations, resilience). Not a
  direct dependency of this package (confirmed: not in its `.csproj`), but thematically
  related. Not yet documented (see task `package-docs-auth-and-persistence`).

## Examples and tests

No dedicated `tests/NEvo.Messaging.EntityFramework.Tests/` project exists in this
repository today.
