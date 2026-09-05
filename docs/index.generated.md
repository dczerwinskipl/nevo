<!-- GENERATED FILE — do not edit. Run: node tools/docs.mjs generate -->

# Documentation index

_Generated: 2026-09-05T09:07:21.383Z_

## Hub

| ID | Title | Status | Summary |
|---|---|---|---|
| `docs.development-readme` | [NEvo maintainer documentation](development/README.md) | current | Maintainer documentation entry point — subsystem internals, invariants, extension points, and the process docs a contributor needs. |
| `docs.readme` | [NEvo documentation](README.md) | current | Thin top-level index into NEvo's documentation, split by audience — distinct from the auto-generated docs/index.generated.md. |
| `docs.usage-readme` | [NEvo usage guides](usage/README.md) | current | Consumer documentation entry point — task-oriented guides for building a service on top of NEvo, from a first working dispatch to authorization, persistence, and cross-service messaging. |

## Guide

| ID | Title | Status | Summary |
|---|---|---|---|
| `guides.authorization` | [Authorization](usage/authorization.md) | current | Configuring [AllowPermission] end-to-end given there is no DI registration helper spanning the whole chain, and what to expect when a check fails. |
| `guides.choosing-packages` | [Choosing packages](usage/choosing-packages.md) | current | Which NEvo packages to reference for a given use case, grounded in the package classification groupings. |
| `guides.commands` | [Commands](usage/commands.md) | current | Dispatching a command via ICommandDispatcher and writing a command handler, using existing NEvo.Messaging.Cqrs extension points. |
| `guides.cross-service-messaging` | [Cross-service messaging](usage/cross-service-messaging.md) | current | Dispatching a command from one service to another over REST, generalized from the example app's cross-service scenario. |
| `guides.event-sourcing` | [Event Sourcing](usage/event-sourcing.md) | current | Modeling an aggregate, choosing a command-handling level, authorization, optimistic concurrency, and reading state back through Query — using NEvo.Ddd.EventSourcing's aggregate-method convention, decision-method parameter injection, and MapQueryEndpoint. |
| `guides.events` | [Events](usage/events.md) | current | Publishing and handling events, and choosing sequential vs. parallel processing for multiple handlers of the same event. |
| `guides.example-app-walkthrough` | [ExampleApp walkthrough](usage/example-app-walkthrough.md) | current | End-to-end guide to examples/ExampleApp's 5 projects: auth, a permission-checked command that also publishes an event to two independent handlers, the Document event-sourcing flow (and why it doesn't actually persist anything by default), and cross-service dispatch. |
| `guides.inbox-outbox` | [Inbox/outbox](usage/inbox-outbox.md) | current | Enabling idempotent message processing and transactional publish in your own handler, including the manual outbox DI wiring step NEvo doesn't automate. |
| `guides.installation` | [Installation](usage/installation.md) | current | How to reference NEvo packages in a new project today, and the open question around NuGet publishing this guide does not paper over. |
| `guides.queries` | [Queries](usage/queries.md) | current | Dispatching a query via IQueryDispatcher and writing a typed query handler, using NEvo.Messaging.Cqrs's Query support. |
| `guides.quick-start` | [Quick start](usage/quick-start.md) | current | Minimal working setup using NEvo.Core and NEvo.Messaging: register the pipeline, add NEvo.Messaging.Cqrs for a first real handler, expose it over HTTP via NEvo.Messaging.Web, then publish and react to an event — the same end-to-end "request → command → event → independent handler" shape examples/ExampleApp runs for real. |
| `guides.troubleshooting` | [Troubleshooting](usage/troubleshooting.md) | current | Common failure patterns when working with NEvo, generalized beyond any single example app, cross-linking the relevant known-issues entries. |

## Package

| ID | Title | Status | Summary |
|---|---|---|---|
| `packages.classification` | [Package classification](reference/packages/classification.md) | current | Groups all 13 real src/ packages into functional categories, as the entry point for the per-package documentation under docs/reference/packages/. |
| `packages.nevo-authorization` | [NEvo.Authorization](reference/packages/NEvo.Authorization.md) | current | Core authorization abstractions: user/role/permission provider contracts and a data-scope-aware role/permission model. Transport-agnostic — consumed by both NEvo.Messaging.Authorization and NEvo.Web.Authorization. |
| `packages.nevo-core` | [NEvo.Core](reference/packages/NEvo.Core.md) | current | Root of the dependency graph: functional primitives (Either-based error handling, argument checks) and the generic middleware-pipeline abstraction every processing pipeline in NEvo (messaging, and by extension its extensions) is built on. |
| `packages.nevo-ddd-eventsourcing` | [NEvo.Ddd.EventSourcing](reference/packages/NEvo.Ddd.EventSourcing.md) | experimental | Event-sourced aggregates: decide (command -> events) and evolve (events -> state) building blocks, wired into the NEvo.Messaging.Cqrs command pipeline. The registered default IEventStreamStore (FakeEventStore) is a real, working in-memory store with correct optimistic-concurrency semantics — not a production-durable one. See Limitations. |
| `packages.nevo-entityframework` | [NEvo.EntityFramework](reference/packages/NEvo.EntityFramework.md) | current | Shared EF Core infrastructure: startup migrations with retry, and a telemetry activity-source name. Not a dependency of NEvo.Messaging.EntityFramework or NEvo.Orchestrating.EntityFramework — see Related packages. |
| `packages.nevo-messaging` | [NEvo.Messaging](reference/packages/NEvo.Messaging.md) | current | Message processing pipeline: dispatch, middleware chain, handler resolution, context propagation, and opt-in inbox/outbox abstractions. The foundation every NEvo.Messaging.* extension package builds on. |
| `packages.nevo-messaging-authorization` | [NEvo.Messaging.Authorization](reference/packages/NEvo.Messaging.Authorization.md) | current | Auth hooks for the message pipeline: populates a per-request UserContext from NEvo.Authorization providers and validates per-handler permissions via an attribute. No DI registration helper exists yet — see Configuration. |
| `packages.nevo-messaging-cqrs` | [NEvo.Messaging.Cqrs](reference/packages/NEvo.Messaging.Cqrs.md) | current | CQRS command and query sides on top of NEvo.Messaging: Command/Query base types, ICommandHandler/IQueryHandler, ICommandDispatcher/IQueryDispatcher. |
| `packages.nevo-messaging-entityframework` | [NEvo.Messaging.EntityFramework](reference/packages/NEvo.Messaging.EntityFramework.md) | current | EF Core-backed implementations of NEvo.Messaging's inbox (idempotency) and outbox (transactional publishing) abstractions. Only inbox has a DI registration helper — see Limitations. |
| `packages.nevo-messaging-web` | [NEvo.Messaging.Web](reference/packages/NEvo.Messaging.Web.md) | current | HTTP transport for messaging: REST dispatch to external services and ASP.NET Core route mapping for commands and generic message envelopes. |
| `packages.nevo-orchestrating` | [NEvo.Orchestrating](reference/packages/NEvo.Orchestrating.md) | experimental | Saga-style orchestration: sequential step execution with automatic reverse-order compensation on failure. Experimental and in progress — deliberately decoupled from the messaging pipeline (depends only on NEvo.Core). |
| `packages.nevo-orchestrating-entityframework` | [NEvo.Orchestrating.EntityFramework](reference/packages/NEvo.Orchestrating.EntityFramework.md) | experimental | EF entity shape and table configuration for orchestrator state. Does not itself implement IOrchestratorStateRepository — see Limitations. |
| `packages.nevo-web` | [NEvo.Web](reference/packages/NEvo.Web.md) | current | HTTP client wrapper: named/configured HttpClient instances with pluggable authentication (OAuth client-credentials or none) and a REST client base. Not ASP.NET Core middleware or routing, despite the name. |
| `packages.nevo-web-authorization` | [NEvo.Web.Authorization](reference/packages/NEvo.Web.Authorization.md) | current | Adapts ASP.NET Core's ClaimsPrincipal into NEvo.Authorization's IUserProvider/ IRoleProvider abstractions. Despite the name, does not depend on NEvo.Web. |

## Project

| ID | Title | Status | Summary |
|---|---|---|---|
| `project.known-issues` | [Known issues](project/known-issues.md) | current | Central, scannable list of confirmed defects and gaps across NEvo packages. Every entry was previously documented only inside an individual package doc's Limitations section; this document consolidates them into one place. |

## Development

| ID | Title | Status | Summary |
|---|---|---|---|
| `development.ai-sessions` | [Local AI sessions](development/ai-sessions.md) | current | Provider-neutral dashboard AI sessions, mock-mode setup, runtime boundaries, trusted-network access, and Part 1 verification. |
| `development.architecture-overview` | [NEvo architecture overview](development/architecture-overview.md) | current | High-level overview of NEvo's modular structure, design philosophy, and current maturity status of each module. |
| `development.codex-app-server-research` | [Codex app-server protocol research](development/codex-app-server-research.md) | current | Dated, version-specific observations from a successful local Codex app-server smoke test, separated from the protocol contracts Nevo must still verify from official documentation and generated schemas. |
| `development.coding-conventions` | [Coding conventions](development/coding-conventions.md) | current | Standing rules a contributor follows regardless of what they're building: the Either<Exception, T> error convention, dependency-direction, DI registration shape, and constructor null-checking. Cross-links the extension workflow rather than duplicating it. |
| `development.commit-conventions` | [Commit conventions](development/commit-conventions.md) | current | Conventional Commits format adopted for this project. PR title is the squash commit message — it must follow this format. |
| `development.contributing` | [Contributing](development/contributing.md) | current | Thin entry point linking the process documents a contributor needs: coding conventions, commit conventions, git workflow, local setup, pull requests, and testing strategy. |
| `development.event-sourcing` | [Event sourcing](development/event-sourcing.md) | experimental | Maintainer-facing architecture of NEvo.Ddd.EventSourcing: the executor's lifecycle, convention discovery and decision-method parameter injection, Primary/Fallback registration, the store/repository boundary and concurrency model, the authorization ownership split, and the compatibility constraints a future persistence/modeling provider must not violate. |
| `development.extension-points` | [Extension points](development/extension-points.md) | current | The IMessageHandlerFactory contract a third-party handler-type author must implement, and a consolidated list of extension approaches that look plausible but are unsafe or unsupported today. |
| `development.failure-semantics` | [Failure and partial-failure semantics](development/failure-semantics.md) | current | Event fan-out partial-failure behavior, whether middleware ordering is a guaranteed contract, and outbox partition-assignment semantics. |
| `development.git-workflow` | [Git workflow](development/git-workflow.md) | current | Branch naming, PR strategy, merge model, and specs CLI integration for branch lifecycle. |
| `development.inbox-outbox` | [Inbox and outbox](development/inbox-outbox.md) | current | Inbox (idempotency) and outbox (transactional message publishing) abstractions. Both are opt-in — not required for basic messaging scenarios. |
| `development.local-setup` | [Local setup](development/local-setup.md) | current | Prerequisites, build commands, and how to run the example applications and the local specification dashboard. |
| `development.message-context` | [Message context](development/message-context.md) | current | Describes IMessageContext, its propagation via AsyncLocal, header management, and the feature storage mechanism. |
| `development.messaging-pipeline` | [Messaging pipeline](development/messaging-pipeline.md) | current | Describes message dispatch, middleware chain execution, processing strategy resolution, and handler invocation. Entry point: IMessageProcessor. |
| `development.nevo-ai-ux-guidelines` | [NEvo AI UX guidelines](development/nevo-ai-ux-guidelines.md) | current | NEvo-specific UX rules that apply the general UI/UX guidelines to AI sessions, chat, Work, semantic state, tasks, specifications, changes, and inspection surfaces. |
| `development.nevo-interaction-model` | [NEvo interaction model](development/nevo-interaction-model.md) | current | Product interaction guide for NEvo surfaces: purpose, entry points, canonical information, actions, drill-down, state preservation, and desktop versus mobile presentation. |
| `development.node-tooling-guidelines` | [Node tooling guidelines](development/node-tooling-guidelines.md) | current | Practical architecture guidelines for Node-based developer tooling, CLI commands, and long-lived dashboard server code. Covers module boundaries, capability-oriented ownership, thin external boundaries, pure decision logic vs IO, async process execution, lifecycle and cancellation, dependency injection, error mapping, testing boundaries, and anti-overengineering rules. |
| `development.orchestration` | [Orchestration](development/orchestration.md) | experimental | Experimental saga orchestration implementation. In progress. Decoupled from messaging. Do not use as basis for refactoring other modules. |
| `development.package-boundaries` | [Package boundaries](development/package-boundaries.md) | current | Dependency graph, allowed reference directions, and modularity rules. Core rule: dependencies flow downward only. No upward references. |
| `development.persistence-development` | [Adding a persistence mechanism](development/persistence-development.md) | current | How to add a new persistence mechanism to NEvo itself, as distinct from a consumer configuring an existing one. Worked example: NEvo.Messaging.EntityFramework. |
| `development.processing-model` | [Processing model](development/processing-model.md) | current | Describes how NEvo selects a processing strategy for a given message and how handlers are resolved. Strategy pattern with factory, predicate-filtered selection. |
| `development.pull-requests` | [Pull requests](development/pull-requests.md) | current | PR format, required fields by change class, and review expectations. |
| `development.react-component-guidelines` | [React component and module guidelines](development/react-component-guidelines.md) | current | Practical architecture guidelines for React UI code: component composition, module and file boundaries, "one primary concept per module", feature-local vertical ownership, token -> primitive -> wrapper -> feature layering, state/effect/context ownership, view-model projections, testing, and anti-mechanical refactoring principles. |
| `development.storybook` | [Storybook guidelines and workflows](development/storybook.md) | current | Guide to Storybook for the NEvo dashboard: running locally, static builds, story hierarchy and naming conventions, fixture and scenario reuse, state management patterns, Vitest test projects, and the mandatory agent visual verification workflow. |
| `development.testing` | [Testing strategy](development/testing-strategy.md) | current | Test stack, project structure, coverage expectations, conventions, and which tests are required when changing each documented subsystem. Integration tests for the messaging pipeline do not yet exist — this is a known gap. |
| `development.transaction-model` | [Transaction model](development/transaction-model.md) | current | Transaction ownership and commit behavior: what is answered by the code today, and what remains genuinely unresolved. |
| `development.transport-development` | [Adding a transport](development/transport-development.md) | current | How to add a new transport mechanism to NEvo itself, as distinct from a consumer using an existing one. Worked example: NEvo.Messaging.Web. |
| `development.ui-ux-guidelines` | [UI and UX guidelines](development/ui-ux-guidelines.md) | current | Portable UI/UX rules for information hierarchy, visual weight, typography, semantic color, progressive disclosure, discovery, interaction hierarchy, responsive behavior, dense content, visual patterns, and composed-screen verification. |

## Adr

| ID | Title | Status | Summary |
|---|---|---|---|
| `adr.0001-conventional-commits` | [Adopt Conventional Commits](decisions/ADR-0001-conventional-commits.md) | accepted |  |
| `adr.0002-lightweight-markdown-workflow` | [Use lightweight custom Markdown workflow for AI-assisted SDLC](decisions/ADR-0002-lightweight-markdown-workflow.md) | accepted |  |
| `adr.0003-technical-decision-triage-and-option-analysis` | [Adopt signal-based triage and mandatory solution-option analysis, without DDD apparatus](decisions/ADR-0003-technical-decision-triage-and-option-analysis.md) | accepted |  |
| `adr.0004-review-artifacts-and-handoff` | [Persist review output as an artifact with actor-classified findings and a fixed closing shape](decisions/ADR-0004-review-artifacts-and-handoff.md) | accepted |  |
| `adr.0005-deterministic-approval-and-hardened-guard` | [Make task approval deterministic and CLI-enforced; replace the Bash guard's regex allowlist with an explicit, whitelist-only validator](decisions/ADR-0005-deterministic-approval-and-hardened-guard.md) | accepted |  |
| `adr.0006-process-continuity-and-hardening` | [Process continuity and hardening — suspension-based recovery, derived batch state, tiered fingerprints, and verify-before-destructive-cleanup finalization](decisions/ADR-0006-process-continuity-and-hardening.md) | accepted |  |
| `adr.0007-provider-neutral-ai-sessions` | [Use provider-neutral local AI sessions in the specification dashboard](decisions/ADR-0007-provider-neutral-ai-sessions.md) | accepted |  |

## Ai

| ID | Title | Status | Summary |
|---|---|---|---|
| `ai.change-impact-map` | [Change impact map](ai/change-impact-map.md) | current | Maps src/<Package>/ directories to the documentation that describes them, so an agent can find the minimum relevant doc set for a given source change. |
| `ai.how-to-navigate` | [How to navigate NEvo artifacts](ai/how-to-navigate.md) | current | Step-by-step guide for agents to find the right context for a task. Always start with the specs CLI, not by scanning all files. |
| `ai.specification-workflow` | [NEvo specification workflow](ai/specification-workflow.md) | current | Vendor-neutral description of NEvo's human-led, spec-anchored development process: how changes are classified, discovered, specified, decomposed into tasks, and implemented, and how tools/docs.mjs and tools/specs.mjs enforce it. |
| `ai.task-execution-policy` | [Task execution policy](ai/task-execution-policy.md) | current | Rules for how agents execute tasks: what they may decide independently, what requires owner approval, and when to stop — for a standalone task and for an owner-authorized batch alike. |
| `ai.task-routing` | [Framework task routing](ai/task-routing.md) | current | For a given kind of framework or tooling change, which documents to read, which invariants to preserve, and which tests to run. Distinct from how-to-navigate.md, which routes the spec/task workflow itself, not framework knowledge. |
| `ai.workflow-overview` | [NEvo AI workflow — end-to-end flow](ai/workflow-overview.md) | current | The full chain of /nevo-ai:* commands from a new idea to an archived change, in order, with what each step actually gates. Companion to docs/ai/specification-workflow.md (the detailed policy) — this page is the map, that page is the rulebook. |

