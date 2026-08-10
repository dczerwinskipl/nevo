---
id: guides.choosing-packages
type: guide
title: Choosing packages
status: current
summary: >
  Which NEvo packages to reference for a given use case, grounded in the package
  classification groupings.
---

# Choosing packages

## Goal

Know which packages to reference for your specific use case, without pulling in
capabilities you don't need — see `docs/reference/packages/classification.md` for the
full groupings this guide draws from.

## Prerequisites

None beyond [Installation](installation.md) — this guide only lists packages, it
doesn't walk through code.

## By use case

### A single-service command/event app

- [`NEvo.Core`](../reference/packages/NEvo.Core.md) — always required.
- [`NEvo.Messaging`](../reference/packages/NEvo.Messaging.md) — the dispatch pipeline.
- [`NEvo.Messaging.Cqrs`](../reference/packages/NEvo.Messaging.Cqrs.md) — for
  ergonomic command handlers (see [Quick start](quick-start.md)).

### Cross-service messaging

Everything above, plus:

- [`NEvo.Web`](../reference/packages/NEvo.Web.md) — the HTTP client wrapper
  `NEvo.Messaging.Web` builds its REST dispatch on.
- [`NEvo.Messaging.Web`](../reference/packages/NEvo.Messaging.Web.md) — REST dispatch
  to other services, and endpoint mapping to receive dispatched messages.

See [Cross-service messaging](cross-service-messaging.md) for the full walkthrough.

### Authorization

- [`NEvo.Authorization`](../reference/packages/NEvo.Authorization.md) — core
  provider abstractions.
- [`NEvo.Web.Authorization`](../reference/packages/NEvo.Web.Authorization.md) — if
  your identity source is ASP.NET Core claims (the common case).
- [`NEvo.Messaging.Authorization`](../reference/packages/NEvo.Messaging.Authorization.md)
  — the message-pipeline middleware that actually enforces `[AllowPermission]` checks.

See [Authorization](authorization.md) for the full end-to-end wiring walkthrough — none
of these three packages has a DI registration helper covering the whole chain.

### EF persistence (inbox/outbox)

- [`NEvo.EntityFramework`](../reference/packages/NEvo.EntityFramework.md) — shared EF
  infrastructure (migrations, resilience); independent of the other two EF packages
  below, not a shared base for them.
- [`NEvo.Messaging.EntityFramework`](../reference/packages/NEvo.Messaging.EntityFramework.md)
  — EF-backed inbox (idempotency) and outbox (transactional publish).

See [Inbox/outbox](inbox-outbox.md) for the manual outbox wiring step this combination
requires.

### Orchestration (experimental)

- [`NEvo.Orchestrating`](../reference/packages/NEvo.Orchestrating.md) — depends only
  on `NEvo.Core`, independent of the messaging packages above.
- [`NEvo.Orchestrating.EntityFramework`](../reference/packages/NEvo.Orchestrating.EntityFramework.md)
  — EF entity shape only, **not** a working persistence implementation; see that
  package's own "Limitations" before assuming it gives you resumable orchestrations.

Experimental — see `docs/development/orchestration.md` before relying on this for
anything beyond exploratory work.

### Event sourcing (experimental)

- [`NEvo.Messaging.Cqrs`](../reference/packages/NEvo.Messaging.Cqrs.md) — event
  sourcing dispatches through the CQRS command pipeline.
- [`NEvo.Ddd.EventSourcing`](../reference/packages/NEvo.Ddd.EventSourcing.md) — the
  decider/evolver building blocks.

Experimental, and the default `IEventStore` this package registers is a non-functional
stub — see `docs/project/known-issues.md` before relying on it for anything beyond
exploratory work.

## Constraints and failure modes

Reference only what a given use case actually needs — `NEvo.Core` is the only package
every consumer needs unconditionally; everything else is opt-in and independently
composable (see `docs/development/architecture-overview.md` § "Design philosophy").

## Verification

`dotnet build` after adding a `ProjectReference` confirms the package resolves; there is
no other verification specific to this guide — it's a lookup, not a walkthrough.

## Next steps

[Quick start](quick-start.md) for the minimal working setup, or jump directly to the
task-oriented guide for whichever use case above matches your goal.
