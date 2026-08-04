---
id: development.architecture-overview
type: development
title: NEvo architecture overview
status: current
read_when:
  - starting work on any module
  - evaluating scope of a change
  - writing a new specification
summary: >
  High-level overview of NEvo's modular structure, design philosophy, and current
  maturity status of each module.
related:
  - development.package-boundaries
  - development.messaging-pipeline
---

# NEvo architecture overview

NEvo is an experimental modular .NET 9 framework designed around one principle: **a simple
web service must not require the full messaging, persistence, inbox, outbox, event sourcing,
or orchestration stack**. Capabilities are opt-in and independently composable.

## Design philosophy

- Start minimal, compose as needed
- Optional capabilities over mandatory abstractions
- Clean package boundaries (no reverse dependencies)
- Functional error handling via `Either<Exception, T>` throughout (LanguageExt)
- Async-first with `CancellationToken` on all async operations

## Module map

```
NEvo.Core                       Stable    Middleware pipeline primitives, functional types
NEvo.Messaging                  Stable    Message processing pipeline, context, inbox/outbox abstractions
NEvo.Messaging.Cqrs             Stable    CQRS commands on top of messaging (query-side not implemented)
NEvo.Messaging.Authorization    Pre-alpha Auth hooks in message processing
NEvo.Messaging.Web              Pre-alpha HTTP transport / REST dispatch
NEvo.Messaging.EntityFramework  Pre-alpha EF-based inbox and outbox implementation
NEvo.Authorization              Pre-alpha Core auth abstractions
NEvo.Web                        Pre-alpha Outbound HTTP client library
NEvo.Web.Authorization          Pre-alpha Claims-based auth middleware
NEvo.EntityFramework            Pre-alpha Shared EF base (migrations, resilience)
NEvo.Ddd.EventSourcing          Experimental  Event-sourced aggregates (see event-sourcing.md)
NEvo.Orchestrating              Experimental  Saga orchestration (see orchestration.md)
NEvo.Orchestrating.EntityFramework Experimental  EF persistence for orchestration state
```

`NEvo.Messaging.Cqrs`'s query-side support (a `Query`/`IQueryHandler` abstraction) is not
implemented — the package provides only the command side (`Command`, `ICommandHandler`,
`ICommandDispatcher`). See `docs/reference/packages/NEvo.Messaging.Cqrs.md` for the exact
scope.

## Current maturity

The messaging pipeline (`NEvo.Core` → `NEvo.Messaging` → CQRS extensions) is the most
exercised subsystem. Coverage comes primarily from example applications (`examples/ExampleApp/`)
rather than automated integration tests. Unit tests exist for core pipeline mechanics.

Event sourcing and orchestration are explicitly experimental and should not drive refactoring
priorities until the messaging and persistence layers are stabilized.

## Intended engineering direction

1. Architecture documentation and protection (current)
2. Automated tests for existing messaging pipeline behavior
3. Normalize persistence and transaction ownership
4. Focused unit tests
5. Audit and simplify
6. Decide whether to continue event sourcing or orchestration

This order is context, not approved implementation scope. Each step requires its own specification.

## What this is not

NEvo is not intended to become a production-grade universal framework without an explicit
architectural decision. It is an experimental playground testing whether different processing
models can be added independently as extensions.
