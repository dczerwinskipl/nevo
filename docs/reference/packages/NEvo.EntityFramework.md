---
id: packages.nevo-entityframework
type: package
title: NEvo.EntityFramework
status: current
dependencies:
  - NEvo.Core
summary: >
  Shared EF Core infrastructure: startup migrations with retry, and a telemetry
  activity-source name. Not a dependency of NEvo.Messaging.EntityFramework or
  NEvo.Orchestrating.EntityFramework — see Related packages.
---

# NEvo.EntityFramework

## Purpose

`NEvo.EntityFramework` provides small, shared EF Core infrastructure: a generic
background service that runs pending migrations on startup with retry, and a shared
telemetry activity-source name. See `docs/development/transaction-model.md` for the
broader persistence picture, including the transaction-ownership questions.

## When to use

Whenever a service wants automatic EF Core migrations on startup with built-in retry.

## When not to use

If you manage migrations another way (e.g. a deployment pipeline step), or don't need
retry behavior, this package's only real feature isn't necessary.

## Responsibilities

- Run pending EF Core migrations on application startup, with retry
  (`MigrationBackgroundService<TDbContext>`).
- Provide a DI registration helper for the migration worker
  (`AddMigrationWorker<TDbContext>`).
- Define a shared `ActivitySource` name for migration telemetry (`Telemetry.Migration`).

## Dependencies

Depends only on `NEvo.Core` — see `src/NEvo.EntityFramework/NEvo.EntityFramework.csproj`'s
single `ProjectReference`.

## Public surface

Grounded directly in `src/NEvo.EntityFramework/**/*.cs` — this is the entire package
(3 files).

```csharp
public class MigrationBackgroundService<TDbContext>(
    ILogger<MigrationBackgroundService<TDbContext>> logger,
    IServiceProvider serviceProvider
) : BackgroundService where TDbContext : DbContext;
```

On start, it retries `TDbContext.Database.MigrateAsync()` up to 10 times, waiting
`retryAttempt` seconds between attempts (1s, 2s, ... up to 10s) via Polly, logging a
warning on each retry. Each attempt runs in its own DI scope
(`serviceProvider.CreateScope()`).

```csharp
public static class Telemetry
{
    public static string Migration = "NEvo.EntityFramework.Migration";
}
```

Used as the `ActivitySource` name for both the outer "Migrating database" and
per-attempt "Migrating database attempt" spans.

## Configuration

```csharp
builder.Services.AddMigrationWorker<MyDbContext>();
```

Registers `MigrationBackgroundService<MyDbContext>` as a hosted service
(`IHostedService`) — migrations run automatically on application startup. The retry
count (10) and backoff (linear, 1-10s) are not currently configurable; changing them
requires editing `MigrationBackgroundService` itself.

## Limitations

- If all 10 retries fail, the whole host stops — see `docs/project/known-issues.md` §
  "A persistently failing migration takes the whole host down".
- Automatic migrations on startup are explicitly called out in
  `docs/development/transaction-model.md` as "appropriate for development but may not
  be suitable for production deployment" — this decision is deferred, not resolved.
- Retry count and backoff are hardcoded, not configurable per consumer.
- No rollback or down-migration support — only `MigrateAsync()` (forward) is called.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency.
- **Not** a dependency of `NEvo.Messaging.EntityFramework` or
  `NEvo.Orchestrating.EntityFramework`, despite the three sharing a persistence theme —
  neither package's `.csproj` has a `ProjectReference` to this one. The three are
  **parallel EF integrations** — each owns its own EF configuration and migrations
  independently, not a dependency chain through this package. See
  [`NEvo.Messaging.EntityFramework`](NEvo.Messaging.EntityFramework.md) and
  `NEvo.Orchestrating.EntityFramework`.

## Examples and tests

No dedicated `tests/NEvo.EntityFramework.Tests/` project exists in this repository
today.
