---
id: packages.classification
type: package
title: Package classification
status: current
dependencies: []
summary: >
  Groups all 13 real src/ packages (confirmed via `dotnet sln NEvo.sln list`) into
  functional categories, as the entry point for the per-package documentation under
  docs/packages/.
---

# Package classification

Confirmed against `dotnet sln NEvo.sln list` — the 13 packages under `src/`, not the
`examples/ExampleApp/*` projects. See
[Package boundaries](../architecture/package-boundaries.md) for the dependency graph
these groups are drawn from.

## Core primitives

| Package | Responsibility |
|---|---|
| `NEvo.Core` | Middleware pipeline primitives, functional types. No dependencies on other NEvo packages. |

## Messaging core

| Package | Responsibility |
|---|---|
| `NEvo.Messaging` | Message processing pipeline, context, inbox/outbox abstractions. |

## Messaging extensions

| Package | Responsibility |
|---|---|
| `NEvo.Messaging.Cqrs` | CQRS commands and queries on top of messaging. |
| `NEvo.Messaging.Authorization` | Auth hooks in message processing. |
| `NEvo.Messaging.Web` | HTTP transport / REST dispatch. |
| `NEvo.Messaging.EntityFramework` | EF-based inbox and outbox implementation. |

## Authorization

| Package | Responsibility |
|---|---|
| `NEvo.Authorization` | Core auth abstractions. |
| `NEvo.Web.Authorization` | Claims-based auth middleware. |

## Persistence

| Package | Responsibility |
|---|---|
| `NEvo.EntityFramework` | Shared EF base (migrations, resilience). |

## Web

| Package | Responsibility |
|---|---|
| `NEvo.Web` | ASP.NET Core integration, HTTP client. |

## Event sourcing (experimental)

| Package | Responsibility |
|---|---|
| `NEvo.Ddd.EventSourcing` | Event-sourced aggregates. |

## Orchestration (experimental)

| Package | Responsibility |
|---|---|
| `NEvo.Orchestrating` | Saga orchestration. Depends only on `NEvo.Core`. |
| `NEvo.Orchestrating.EntityFramework` | EF persistence for orchestration state. |

## Individual package docs

Per-package docs (using the `package` doc type and
[the package-doc template](../templates/package-doc-template.md)) are added
incrementally by later tasks in this change. Until a package has its own doc, this
classification and [Package boundaries](../architecture/package-boundaries.md) are the
canonical references.
