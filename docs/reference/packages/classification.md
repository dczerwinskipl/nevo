---
id: packages.classification
type: package
title: Package classification
status: current
dependencies: []
summary: >
  Groups all 13 real src/ packages into functional categories, as the entry point for
  the per-package documentation under docs/reference/packages/.
---

# Package classification

The 13 packages under `src/` (not the `examples/ExampleApp/*` projects). See
`docs/development/package-boundaries.md` for the dependency graph these groups are
drawn from.

## Core primitives

| Package | Responsibility |
|---|---|
| [`NEvo.Core`](NEvo.Core.md) | Middleware pipeline primitives, functional types. No dependencies on other NEvo packages. |

## Messaging core

| Package | Responsibility |
|---|---|
| [`NEvo.Messaging`](NEvo.Messaging.md) | Message processing pipeline, context, inbox/outbox abstractions. |

## Messaging extensions

| Package | Responsibility |
|---|---|
| [`NEvo.Messaging.Cqrs`](NEvo.Messaging.Cqrs.md) | CQRS command side on top of messaging. Query-side is not implemented (empty `Queries/` placeholder only). |
| [`NEvo.Messaging.Authorization`](NEvo.Messaging.Authorization.md) | Auth hooks in message processing. |
| [`NEvo.Messaging.Web`](NEvo.Messaging.Web.md) | HTTP transport / REST dispatch. |
| [`NEvo.Messaging.EntityFramework`](NEvo.Messaging.EntityFramework.md) | EF-based inbox and outbox implementation. |

## Authorization

| Package | Responsibility |
|---|---|
| [`NEvo.Authorization`](NEvo.Authorization.md) | Core auth abstractions. |
| [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) | Claims adapter for `NEvo.Authorization`'s providers (not middleware — no `IMiddleware`/pipeline registration). |

## Persistence

| Package | Responsibility |
|---|---|
| [`NEvo.EntityFramework`](NEvo.EntityFramework.md) | Shared EF base (migrations, resilience). |

## Web

| Package | Responsibility |
|---|---|
| [`NEvo.Web`](NEvo.Web.md) | HTTP client wrapper with pluggable authentication strategies (OAuth, none) and a REST client base (`NEvo.Web.Client`). |

## Event sourcing (experimental)

| Package | Responsibility |
|---|---|
| [`NEvo.Ddd.EventSourcing`](NEvo.Ddd.EventSourcing.md) | Event-sourced aggregates. |

## Orchestration (experimental)

| Package | Responsibility |
|---|---|
| [`NEvo.Orchestrating`](NEvo.Orchestrating.md) | Saga orchestration. Depends only on `NEvo.Core`. |
| [`NEvo.Orchestrating.EntityFramework`](NEvo.Orchestrating.EntityFramework.md) | EF entity shape and table config for orchestration state — not a working persistence implementation (no `IOrchestratorStateRepository` yet). |

## Individual package docs

Every package listed above has its own doc under `docs/reference/packages/` (using the
`package` doc type and `docs/templates/package-doc-template.md`) — click through from
the tables above, or see `docs/README.md` for the full navigation hub.
