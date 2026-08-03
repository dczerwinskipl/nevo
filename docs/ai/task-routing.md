---
id: ai.task-routing
type: ai
title: Framework task routing
status: current
summary: >
  For a given kind of framework change, which documents to read, which invariants to
  preserve, and which tests to run. Distinct from how-to-navigate.md, which routes the
  spec/task workflow itself, not framework knowledge.
related:
  - ai.how-to-navigate
  - ai.change-impact-map
---

# Framework task routing

This is a routing layer over NEvo's own framework documentation — it does not restate
any document's content, only points to it. For the spec/task workflow itself (finding
the next approved task, loading a context packet), see
`docs/ai/how-to-navigate.md` — that remains the sole source for that concern.

## Modifying message dispatch

- **Read:** `docs/development/messaging-pipeline.md`, `docs/development/processing-model.md`,
  `docs/development/message-context.md`.
- **Invariants to preserve:** the `Either<Exception, T>` error convention
  (`docs/reference/packages/NEvo.Core.md`); the middleware execution order is a DI-
  registration artifact, not enforced by the framework — see
  `docs/development/failure-semantics.md`.
- **Tests:** `tests/NEvo.Core.Tests/`, `tests/NEvo.Messaging.Tests/` — see
  `docs/development/testing-strategy.md` § "Required tests per subsystem".

## Adding a transport

- **Read:** `docs/development/transport-development.md`,
  `docs/development/extension-points.md`.
- **Invariants to preserve:** outbound (`IExternalMessageDispatchStrategy`) and inbound
  (endpoint mapping) are separate concerns — see the transport-development doc's worked
  example.
- **Tests:** the new transport package's own test project; add characterization tests
  per `docs/development/testing-strategy.md` before changing existing transport
  behavior.

## Adding a persistence provider

- **Read:** `docs/development/persistence-development.md`,
  `docs/development/transaction-model.md`.
- **Invariants to preserve:** transaction ownership assumptions in
  `docs/development/transaction-model.md` — a new persistence provider inherits these,
  it doesn't get to redefine them without a specification.
- **Tests:** the new provider's own test project; see
  `docs/development/testing-strategy.md` § "Persistence / transactions" for why a
  characterization test is required first.

## Changing authorization

- **Read:** `docs/development/extension-points.md` § "Forbidden or unsafe extension
  approaches", `docs/reference/packages/NEvo.Messaging.Authorization.md`,
  `docs/reference/packages/NEvo.Authorization.md`.
- **Invariants to preserve:** `UserContextMiddleware` must run before
  `ValidatePermissionMiddleware` — see `docs/development/messaging-pipeline.md`.
- **Tests:** `tests/NEvo.Web.Authorization.Tests/` — see
  `docs/development/testing-strategy.md` § "Authorization" for the coverage gap in
  `NEvo.Messaging.Authorization` itself.

## Changing inbox/outbox behavior

- **Read:** `docs/development/inbox-outbox.md`, `docs/development/failure-semantics.md`
  § "Outbox partition-assignment semantics", `docs/development/transaction-model.md`
  questions 3-4.
- **Invariants to preserve:** inbox/outbox are both opt-in — do not make either a hard
  requirement of the base messaging pipeline.
- **Tests:** none dedicated exist today — see
  `docs/development/testing-strategy.md` § "Inbox/outbox"; add characterization tests
  before changing behavior here specifically.

## Adding a new command/event type

- **Read:** `docs/usage/commands.md` or `docs/usage/events.md` (consumer-facing shape),
  `docs/development/extension-points.md` (if adding a new handler-*kind*, not just a
  new handler).
- **Invariants to preserve:** commands expect exactly one handler; events allow
  multiple — see `docs/development/messaging-pipeline.md` § "Handler registration".
- **Tests:** `tests/NEvo.Messaging.Tests/` for pipeline-level changes; the consuming
  package's own tests for a specific new command/event type.
