---
id: architecture.persistence
type: architecture
title: Persistence
status: current
scope:
  - persistence
  - entity-framework
  - transactions
read_when:
  - working with EF DbContext
  - modifying persistence behavior
  - working on transaction-related code
summary: >
  Current EF Core integration, DbContext usage, and open questions around
  transaction ownership. Transaction semantics are explicitly unresolved.
related:
  - architecture.inbox-outbox
  - architecture.package-boundaries
---

# Persistence

## Current implementation

EF Core 9 with SQL Server is the only persistence backend. No generic repository abstraction
exists at the framework level — code works directly with `DbContext` subclasses.

`NEvo.EntityFramework` (`src/NEvo.EntityFramework/`) provides:
- `MigrationBackgroundService` — runs pending migrations on startup via `IHostedService`
- Polly-based resilience for connection retries

## Package structure

| Package | Role |
|---|---|
| `NEvo.EntityFramework` | Shared EF infrastructure (migrations, resilience) |
| `NEvo.Messaging.EntityFramework` | EF inbox and outbox implementations |
| `NEvo.Orchestrating.EntityFramework` | EF orchestration state repository |

Each module owns its own EF configuration and migrations. There is no shared `DbContext`.

## Open questions — transaction ownership

**This area is explicitly unresolved and requires a specification before refactoring.**

`TransactionScopeMessageProcessingMiddleware` exists in the pipeline but the following
questions have no documented answers:

- Who is responsible for committing the transaction?
- When does `SaveChangesAsync` get called — inside the handler, inside middleware, or externally?
- How does the inbox check interact with the same transaction that the handler writes to?
- Is the outbox message saved in the same transaction as the handler's state change?
- What happens when multiple handlers process the same event in the same transaction scope?

These semantics are currently determined by the example application (`ServiceA.Api`) which
uses EF with the full inbox/outbox/transaction middleware stack. The intended model has not
been formally specified.

**Do not modify transaction, session, or DbContext lifetime behavior without a specification
and owner approval.**

## Migration strategy

Automatic migrations on startup (`MigrationBackgroundService`) are used in example
applications. This is appropriate for development but may not be suitable for production
deployment. This decision is deferred.
