---
id: development.persistence-development
type: development
title: Adding a persistence mechanism
status: current
read_when:
  - adding a new persistence mechanism to NEvo itself
  - implementing an EF-backed inbox, outbox, or repository
summary: >
  How to add a new persistence mechanism to NEvo itself, as distinct from a consumer
  configuring an existing one. Worked example: NEvo.Messaging.EntityFramework.
related:
  - development.transaction-model
  - development.extension-points
---

# Adding a persistence mechanism

## Subsystem responsibility

This document covers adding a new persistence mechanism **to NEvo itself** (a new
package providing an implementation of a persistence-facing interface, the way
`NEvo.Messaging.EntityFramework` does for inbox/outbox) — not a consumer configuring an
existing one, which is a usage-guide topic.

## Intended extension points

**Worked example (complete):** `NEvo.Messaging.EntityFramework`
(`docs/reference/packages/NEvo.Messaging.EntityFramework.md`) — contrast with
`NEvo.Orchestrating.EntityFramework`
(`docs/reference/packages/NEvo.Orchestrating.EntityFramework.md`), an **incomplete**
one (an EF entity shape and table configuration with no actual repository
implementation), if you want a concrete example of what to avoid leaving half-finished.

1. Define a `DbContext`-extending interface for the tables you need (see
   `IInboxDbContext`/`IOutboxDbContext` — each exposes the specific `DbSet<T>`
   properties your implementation needs, not the whole `DbContext`).
2. Implement the actual contract you're persisting for (`IMessageInbox`/`IMessageOutbox`
   in this example — `EntityFrameworkMessageInbox`/`EntityFrameworkMessageOutbox`)
   against that interface.
3. Add EF model configuration (`IEntityTypeConfiguration<T>` — see
   `InboxEntityTypeConfiguration`/`OutboxEntityTypeConfiguration`) and expose an
   `ApplyXxxConfiguration(this ModelBuilder)` extension so a consumer wires it into
   their own `DbContext.OnModelCreating`.
4. Register via `AddXxx<TDbContext>()` following the DI shape in
   `docs/development/coding-conventions.md` — note that `NEvo.Messaging.EntityFramework`
   itself only did this for inbox, not outbox (see that package's own doc); don't repeat
   that gap in something new.

## Transaction ownership

Before writing a new persistence mechanism for transactional behavior, read
`docs/development/transaction-model.md` — several of its answers (who commits, when
`SaveChangesAsync` runs) are load-bearing assumptions your implementation would inherit.

## Required tests

`dotnet build` confirms your implementation satisfies the interface; run the relevant
package's own test project as a starting point for testing your extension, and add
characterization tests per `docs/development/testing-strategy.md` if you're modifying
existing behavior rather than adding new behavior alongside it.
