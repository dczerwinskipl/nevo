---
id: ai.change-impact-map
type: ai
title: Change impact map
status: current
summary: >
  Maps src/<Package>/ directories to the documentation that describes them, so an
  agent can find the minimum relevant doc set for a given source change.
related:
  - ai.task-routing
---

# Change impact map

One row per `src/` package: its reference doc, plus any maintainer doc(s) that describe
behavior spanning beyond that one package (a shared subsystem, a pipeline stage, a
cross-cutting concern). Consult only the rows for packages your change actually
touches — do not load every row for a single-package change.

| `src/` directory | Reference doc | Relevant maintainer doc(s) |
|---|---|---|
| `NEvo.Core` | `docs/reference/packages/NEvo.Core.md` | `docs/development/architecture-overview.md` |
| `NEvo.Messaging` | `docs/reference/packages/NEvo.Messaging.md` | `docs/development/messaging-pipeline.md`, `processing-model.md`, `message-context.md`, `inbox-outbox.md`, `failure-semantics.md` |
| `NEvo.Messaging.Cqrs` | `docs/reference/packages/NEvo.Messaging.Cqrs.md` | `docs/development/processing-model.md` |
| `NEvo.Messaging.Authorization` | `docs/reference/packages/NEvo.Messaging.Authorization.md` | `docs/development/extension-points.md` |
| `NEvo.Messaging.Web` | `docs/reference/packages/NEvo.Messaging.Web.md` | `docs/development/transport-development.md` |
| `NEvo.Messaging.EntityFramework` | `docs/reference/packages/NEvo.Messaging.EntityFramework.md` | `docs/development/persistence-development.md`, `inbox-outbox.md` |
| `NEvo.Authorization` | `docs/reference/packages/NEvo.Authorization.md` | — |
| `NEvo.Web.Authorization` | `docs/reference/packages/NEvo.Web.Authorization.md` | — |
| `NEvo.Web` | `docs/reference/packages/NEvo.Web.md` | `docs/development/transport-development.md` |
| `NEvo.EntityFramework` | `docs/reference/packages/NEvo.EntityFramework.md` | `docs/development/transaction-model.md`, `persistence-development.md` |
| `NEvo.Ddd.EventSourcing` | `docs/reference/packages/NEvo.Ddd.EventSourcing.md` | `docs/development/event-sourcing.md` |
| `NEvo.Orchestrating` | `docs/reference/packages/NEvo.Orchestrating.md` | `docs/development/orchestration.md` |
| `NEvo.Orchestrating.EntityFramework` | `docs/reference/packages/NEvo.Orchestrating.EntityFramework.md` | `docs/development/orchestration.md`, `persistence-development.md` |

## Package boundaries and cross-cutting invariants

For any change touching more than one package, or the dependency graph itself, always
also read `docs/development/package-boundaries.md` — it is not tied to a single `src/`
directory and is not repeated per-row above.

## Known issues

Before assuming an observed behavior is a bug to fix, check
`docs/project/known-issues.md` — many of the gaps in the packages above are already
confirmed and documented there, not novel.
