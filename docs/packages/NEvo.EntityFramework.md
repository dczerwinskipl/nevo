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
telemetry activity-source name. See
[Persistence](../architecture/persistence.md) (`architecture.persistence`) for the
broader persistence picture, including the still-unresolved transaction-ownership
questions.

## Responsibilities

- Run pending EF Core migrations on application startup, with retry
  (`MigrationBackgroundService<TDbContext>`).
- Provide a DI registration helper for the migration worker
  (`AddMigrationWorker<TDbContext>`).
- Define a shared `ActivitySource` name for migration telemetry (`Telemetry.Migration`).

## Dependencies

Depends only on `NEvo.Core` — confirmed against
`src/NEvo.EntityFramework/NEvo.EntityFramework.csproj`'s single `ProjectReference`.

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
(`IHostedService`) — migrations run automatically on application startup.

## Basic usage

See "Configuration" — registration is this package's entire usage surface; there is no
additional runtime API a consumer interacts with directly.

## Advanced usage

No advanced usage beyond registration is documented yet — the retry count (10) and
backoff (linear, 1-10s) are not currently configurable; changing them requires editing
`MigrationBackgroundService` itself.

## Limitations

- **What happens if all 10 retries fail:** the exception propagates out of
  `ExecuteAsync` uncaught. For a `BackgroundService`, an unhandled exception there stops
  the whole host (default ASP.NET Core/.NET Generic Host behavior since .NET 6) — a
  persistently failing migration takes the application down, it does not fail silently
  or leave the app running without its schema updated. There is no configurable "log and
  continue" mode.
- Automatic migrations on startup are explicitly called out in
  [Persistence](../architecture/persistence.md) as "appropriate for development but may
  not be suitable for production deployment" — this decision is deferred, not resolved.
- Retry count and backoff are hardcoded, not configurable per consumer.
- No rollback or down-migration support — only `MigrateAsync()` (forward) is called.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency.
- **Not** a dependency of `NEvo.Messaging.EntityFramework` or
  `NEvo.Orchestrating.EntityFramework`, despite what
  [Persistence](../architecture/persistence.md)'s "Package structure" table might
  suggest by grouping all three together. Confirmed directly: neither package's
  `.csproj` has a `ProjectReference` to this one (verified in task
  `architecture-corrections` and re-confirmed here). The three are **parallel EF
  integrations** — each owns its own EF configuration and migrations independently, not
  a dependency chain through this package. See
  [`NEvo.Messaging.EntityFramework`](NEvo.Messaging.EntityFramework.md) and
  `NEvo.Orchestrating.EntityFramework`.

## Examples and tests

No dedicated `tests/NEvo.EntityFramework.Tests/` project exists in this repository
today.
