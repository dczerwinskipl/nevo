---
id: docs.development-readme
type: hub
title: NEvo maintainer documentation
status: current
summary: >
  Maintainer documentation entry point — subsystem internals, invariants, extension
  points, and the process docs a contributor needs.
---

# NEvo maintainer documentation

This is the entry point for **maintainers and contributors** — working on NEvo itself,
not just consuming it. For task-oriented consumer guides, see `docs/usage/`. For
per-package reference facts, see `docs/reference/packages/`.

## Where to start

[NEvo architecture overview](architecture-overview.md) for the module map and design
philosophy, then [Contributing](contributing.md) for the process docs.

## Architecture and subsystems

Core rule: dependencies flow downward only, no upward references — see
[Package boundaries](package-boundaries.md).

| Doc | Covers |
|---|---|
| [NEvo architecture overview](architecture-overview.md) | Modular structure, design philosophy, module maturity. |
| [Package boundaries](package-boundaries.md) | Dependency graph, allowed reference directions, modularity rules. |
| [Messaging pipeline](messaging-pipeline.md) | Message dispatch, middleware chain, handler invocation. |
| [Processing model](processing-model.md) | Processing-strategy selection and handler resolution. |
| [Message context](message-context.md) | `IMessageContext`, `AsyncLocal` propagation, header management. |
| [Transaction model](transaction-model.md) | Transaction ownership: what's answered by the code, what remains open. |
| [Failure semantics](failure-semantics.md) | Event fan-out partial-failure behavior, middleware-ordering contract, outbox partitioning. |
| [Extension points](extension-points.md) | The `IMessageHandlerFactory` contract, and forbidden/unsafe extension approaches. |
| [Transport development](transport-development.md) | Adding a new transport to NEvo itself. |
| [Persistence development](persistence-development.md) | Adding a new persistence mechanism to NEvo itself. |
| [Inbox and outbox](inbox-outbox.md) | Idempotency and transactional message publishing internals (both opt-in). |
| [Event sourcing](event-sourcing.md) | Experimental — event-sourced aggregates. Not a refactoring basis yet. |
| [Orchestration](orchestration.md) | Experimental — saga orchestration, decoupled from messaging. No working state persistence. |

## Contributing

| Doc | Covers |
|---|---|
| [Contributing](contributing.md) | Thin entry point linking the 6 docs below. |
| [Local setup](local-setup.md) | Prerequisites, build commands, running the example apps. |
| [Coding conventions](coding-conventions.md) | Standing rules: `Either<Exception, T>`, dependency direction, DI registration shape. |
| [Testing strategy](testing-strategy.md) | Test stack, project structure, coverage expectations, per-subsystem required tests. |
| [Commit conventions](commit-conventions.md) | Conventional Commits format (also the PR title format). |
| [Git workflow](git-workflow.md) | Branch naming, PR strategy, specs CLI integration. |
| [Pull requests](pull-requests.md) | PR format and review expectations by change class. |

## See also

- `docs/reference/packages/` — per-package reference facts.
- `docs/project/known-issues.md` — confirmed defects and gaps.
- `docs/decisions/` — architecture decision records.
