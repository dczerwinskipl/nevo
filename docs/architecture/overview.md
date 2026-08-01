---
id: architecture.overview
type: architecture
title: NEvo architecture overview
status: current
scope:
  - overview
  - modules
  - philosophy
read_when:
  - starting work on any module
  - evaluating scope of a change
  - writing a new specification
summary: >
  High-level overview of NEvo's modular structure, design philosophy, and current
  maturity status of each module.
related:
  - architecture.package-boundaries
  - architecture.messaging-pipeline
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
NEvo.Messaging.Cqrs             Stable    CQRS commands and queries on top of messaging
NEvo.Messaging.Authorization    Pre-alpha Auth hooks in message processing
NEvo.Messaging.Web              Pre-alpha HTTP transport / REST dispatch
NEvo.Messaging.EntityFramework  Pre-alpha EF-based inbox and outbox implementation
NEvo.Authorization              Pre-alpha Core auth abstractions
NEvo.Web                        Pre-alpha ASP.NET Core integration, HTTP client
NEvo.Web.Authorization          Pre-alpha Claims-based auth middleware
NEvo.EntityFramework            Pre-alpha Shared EF base (migrations, resilience)
NEvo.Ddd.EventSourcing          In progress  Event-sourced aggregates (see event-sourcing.md)
NEvo.Orchestrating              In progress  Saga orchestration (see orchestration.md)
NEvo.Orchestrating.EntityFramework In progress  EF persistence for orchestration state
```

## Current maturity

The messaging pipeline (`NEvo.Core` → `NEvo.Messaging` → CQRS extensions) is the most
exercised subsystem. Coverage comes primarily from example applications (`examples/ExampleApp/`)
rather than automated integration tests. Unit tests exist for core pipeline mechanics.

Event sourcing and orchestration are explicitly in-progress and should not drive refactoring
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
