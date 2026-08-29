---
id: ai.task-routing
type: ai
title: Framework task routing
status: current
summary: >
  For a given kind of framework or tooling change, which documents to read, which invariants to
  preserve, and which tests to run. Distinct from how-to-navigate.md, which routes the
  spec/task workflow itself, not framework knowledge.
related:
  - ai.how-to-navigate
  - ai.change-impact-map
---

# Framework task routing

This is a routing layer over NEvo's documentation — it does not restate
any document's content, only points to it. For the spec/task workflow itself (finding
the next approved task, loading a context packet), see
`docs/ai/how-to-navigate.md` — that remains the sole source for that concern.

---

# Part 1: NEvo .NET Framework (`src/**`)

Routes for changes to the primary product: the core .NET messaging, persistence, and event-sourcing framework.

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

---

# Part 2: NEvo Developer Tooling & AI Layer (`tools/**`)

Routes for developer tooling, CLI commands, developer dashboard, and AI orchestration layer (`tools/**`).
Note: These tools currently live in this repository for end-to-end integration testing and workflow efficiency, distinct from the core .NET NEvo framework product.

## Developing Node tooling, CLI commands, and dashboard server

- **Read:** `docs/development/node-tooling-guidelines.md`.
- **Invariants to preserve:**
  - CLI entrypoints (`tools/specs.mjs`, `tools/docs.mjs`) remain thin boundaries; argument parsing and exit codes are managed at the boundary.
  - Long-lived dashboard server processes must not block the Node event loop with synchronous child process execution or unbounded request-path filesystem traversals.
  - Reusable application operations are called directly in-process without spawning the tool's own CLI.
  - Long-running background operations support explicit lifecycle management, timeouts, and `AbortSignal` cancellation.
- **Tests:** `npm test`, `npm --prefix tools/dashboard test`, `node tools/specs.mjs check`.

## Developing React UI and Dashboard frontend

- **Read:** `docs/development/react-component-guidelines.md`.
- **Invariants to preserve:**
  - Capability / vertical feature ownership: feature-specific hooks, view-models, projections, and dialogs remain feature-local unless real cross-feature reuse is demonstrated.
  - Components maintain clear separation between visual presentation and orchestration.
  - Semantic Tailwind tokens and accessible Radix UI primitives are used for UI consistency.
- **Tests:** `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`.

---

## Routing table

Machine-readable rules matched against a task's `allowed_paths` (D12) — a supplement to
the scenario-based routing above, not a replacement for it; consumed only via
`docs/routing.generated.json` (`node tools/docs.mjs generate`), never re-parsed from this
table at check time. `rule_id` is unique across this file and `change-impact-map.md`
combined.

| rule_id | path_glob | doc_ref |
|---|---|---|
| RT-01 | src/NEvo.Messaging/** | docs/development/messaging-pipeline.md |
| RT-02 | src/NEvo.Core/** | docs/development/messaging-pipeline.md |
| RT-03 | src/NEvo.Messaging.Web/** | docs/development/transport-development.md |
| RT-04 | src/NEvo.Web/** | docs/development/transport-development.md |
| RT-05 | src/NEvo.EntityFramework/** | docs/development/persistence-development.md |
| RT-06 | src/NEvo.Messaging.EntityFramework/** | docs/development/persistence-development.md |
| RT-07 | src/NEvo.Orchestrating.EntityFramework/** | docs/development/persistence-development.md |
| RT-08 | src/NEvo.Authorization/** | docs/development/extension-points.md |
| RT-09 | src/NEvo.Messaging.Authorization/** | docs/development/extension-points.md |
| RT-10 | src/NEvo.Web.Authorization/** | docs/development/extension-points.md |
| RT-11 | src/NEvo.Messaging.EntityFramework/** | docs/development/inbox-outbox.md |
| RT-12 | src/NEvo.Messaging.Cqrs/** | docs/development/processing-model.md |
| RT-13 | tools/*.mjs | docs/development/node-tooling-guidelines.md |
| RT-14 | tools/specs/** | docs/development/node-tooling-guidelines.md |
| RT-15 | tools/dashboard/server/** | docs/development/node-tooling-guidelines.md |
| RT-16 | tools/dashboard/ui/** | docs/development/react-component-guidelines.md |
