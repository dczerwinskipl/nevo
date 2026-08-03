---
id: docs.usage-readme
type: hub
title: NEvo usage guides
status: current
summary: >
  Consumer documentation entry point — task-oriented guides for building a service on
  top of NEvo, from a first working dispatch to authorization, persistence, and
  cross-service messaging.
---

# NEvo usage guides

This is the entry point for **consumers** — building a service on top of NEvo. Each
guide starts from a concrete goal, states prerequisites, and ends in a working result.
For "what does this package actually provide" reference material, see
`docs/reference/packages/`. For subsystem internals and maintainer-facing concerns, see
`docs/development/`.

## Where to start

New to NEvo: [Installation](installation.md), then [Quick start](quick-start.md).
Already have a working dispatch: pick the guide below matching what you're adding next.

| Guide | Covers |
|---|---|
| [Installation](installation.md) | Referencing NEvo packages in a new project (no NuGet feed exists yet). |
| [Quick start](quick-start.md) | Minimal working setup with `NEvo.Core` + `NEvo.Messaging`, dispatching a first message. |
| [Choosing packages](choosing-packages.md) | Which packages to reference for a given use case (single-service, cross-service, authorization, persistence, orchestration, event sourcing). |
| [Commands](commands.md) | Writing and dispatching a command handler via `NEvo.Messaging.Cqrs`. |
| [Events](events.md) | Publishing an event and handling it with multiple independent handlers. |
| [Cross-service messaging](cross-service-messaging.md) | Dispatching a command to another service over REST. |
| [Inbox/outbox](inbox-outbox.md) | Idempotent processing and transactional publish, including the manual outbox DI-wiring step. |
| [Authorization](authorization.md) | Configuring `[AllowPermission]` end-to-end across `NEvo.Authorization`, `NEvo.Web.Authorization`, and `NEvo.Messaging.Authorization`. |
| [Troubleshooting](troubleshooting.md) | Common failure patterns and where to look, by symptom. |
| [ExampleApp walkthrough](example-app-walkthrough.md) | End-to-end tour of `examples/ExampleApp`'s 5 projects: auth, permissions, event sourcing, cross-service dispatch. |

## See also

- `docs/reference/packages/classification.md` — which package does what.
- `docs/project/known-issues.md` — confirmed defects and gaps referenced throughout
  these guides.
