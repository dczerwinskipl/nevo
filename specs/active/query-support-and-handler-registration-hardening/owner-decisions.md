# Owner decisions — query-support-and-handler-registration-hardening

## D1: Query handler adapter — composition over inheritance, shared across Command/Event/Query

- **Question:** How should a Query handler produce a typed result, given `MessageHandlerAdapterBase<TMessageGroup>` hardcodes its abstract method to return `Unit`? Options were: (a) a Query-only adapter independent of the base class, leaving Command/Event untouched; (b) one shared, composed adapter used by Command/Event/Query alike, replacing the inheritance-based base class entirely; (c) redesign `IMessageHandler` itself to be generic (rejected outright — unjustified by evidence, explicitly out of scope).
- **Options considered:** Targeted (Query-only, no shared extraction) | Shared composed invoker for all three kinds (recommended) | Redesign `IMessageHandler` to be generic (not recommended, listed for completeness)
- **Decision:** Shared composed invoker for all three kinds.
- **Rationale:** Owner does not want `MessageHandlerAdapterBase<TMessageGroup>` used for Query at all, prefers composition over inheritance, and asked whether the shared boilerplate could be extracted and reused rather than duplicated a third time. Discovery confirmed `MessageHandlerDescription.Method` (the actual handler interface `MethodInfo`, already populated by both existing factories) is populated but unused today — exactly the hook needed to invoke any handler kind generically without per-kind inheritance.
- **Consequences:** `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and `EventHandlerAdapter` are deleted. A new shared, non-generic `MessageHandlerAdapter` (in `NEvo.Messaging.Handling`) resolves the handler instance via `ActivatorUtilities.CreateInstance` and invokes `HandlerDescription.Method` reflectively for every kind (Command/Event/Query). `CommandHandlerAdapterFactory`/`EventHandlerAdapterFactory`/the new `QueryHandlerAdapterFactory` keep their own `ForInterface`/`GetMessageHandlerDescriptions` (kind-specific discovery metadata) but all construct the same shared adapter in `Create()`. Because this touches Command/Event internals that currently have zero test coverage, characterization tests for existing Command/Event adapter behavior must land and pass **before** the refactor (D5 covers where). All three deleted types are `public` today, and the new `MessageHandlerAdapter` must also be `public` — this is a genuine public-API breaking change, resolved explicitly in D6 (do not treat it as additive/non-breaking).
- **Date:** 2026-08-08
- **Affected artifacts:** areas/shared-handler-invocation.md, tasks/01-command-event-adapter-characterization.md, tasks/02-shared-handler-invocation-adapter.md, tasks/04-query-abstractions-and-discovery.md

## D2: Registration idempotency — retrofit AddCommands/AddEvents, not just AddQueries

- **Question:** Should the new `AddQueries()` alone be idempotent (`TryAdd`-based), or should the existing `AddCommands()`/`AddEvents()` also be retrofitted? Discovery found composing distinct `AddX` calls together does not itself duplicate shared infrastructure (each registers disjoint types) — the real defect is that a *repeated* call to the same `AddCommands()`/`AddEvents()` risks a duplicate-key crash in `MessageHandlerExtractor` or silent duplicate strategy registration, because both use plain `Add*` rather than `TryAdd*`/`TryAddEnumerable`.
- **Options considered:** AddQueries only (minimal, smallest diff) | Also retrofit AddCommands/AddEvents (recommended by owner)
- **Decision:** Also retrofit AddCommands/AddEvents.
- **Rationale:** Owner chose consistency across all three registration methods over the smallest possible diff.
- **Consequences:** `AddCommands()`, `AddEvents()`, and the new `AddQueries()` all move to `TryAdd*`/`TryAddEnumerable`-based registration for their handler-factory/strategy/dispatcher services. This is a behavior change to existing public methods (a repeated call that previously could throw now silently no-ops) — regression tests must prove existing single-call behavior is unchanged, and add new tests proving repeat-call idempotency for all three.
- **Date:** 2026-08-08
- **Affected artifacts:** areas/registration-hardening.md, tasks/03-registration-idempotency-hardening.md

## D3: No new composing registration method (e.g. `AddMessages`-style sugar)

- **Question:** The original request suggested `services.AddMessages(...)` as an optional composing helper over Commands/Events/Queries — but discovery found `AddMessages()` already exists and means something different (the shared core: registry, extractor, processor, middleware). Should this change introduce a new composing helper (under a different name) or leave registration fully explicit?
- **Options considered:** No new composing method — `AddQueries()` follows the exact existing `AddMessages()`+`AddCommands()` convention (recommended) | Add a new composing helper (e.g. `AddCqrs()`) under a name that doesn't collide with the existing `AddMessages()`
- **Decision:** No new composing method.
- **Rationale:** Owner accepted the recommendation — avoids any naming collision with the existing, differently-scoped `AddMessages()`, and keeps the registration surface consistent with today's explicit, opt-in shape.
- **Consequences:** A consumer wanting Query support calls `services.AddMessages().AddQueries()` (mirroring `AddMessages().AddCommands()` today) — no new public extension method beyond `AddQueries()` itself.
- **Date:** 2026-08-08
- **Affected artifacts:** areas/registration-hardening.md, tasks/05-query-dispatch-and-registration.md

## D4: `Query<TResult>` is a concrete abstract record, not an `IQuery<TResult>` interface

- **Question:** The original request's suggested shape was `IQuery<TResult>`. Discovery found `Command` is a concrete record (`Command : Message`, no `ICommand`/`ICommand<TResult>` interface exists anywhere), and `Message<TResult> : Message, IMessage<TResult>` already exists as a ready-made base. Should Query mirror the literal `IQuery<TResult>` wording, or follow Command's established concrete-record convention?
- **Options considered:** `Query<TResult> : Message<TResult>` concrete abstract record, matching Command's convention (recommended) | `IQuery<TResult>` interface, matching the original request's literal wording
- **Decision:** `Query<TResult> : Message<TResult>` concrete abstract record.
- **Rationale:** Owner accepted the recommendation — consistency with the repository's established `Command` pattern over the literal wording of the original request.
- **Consequences:** `IQueryHandler<TQuery, TResult> where TQuery : Query<TResult>` (mirroring `ICommandHandler<TMessage> where TMessage : Command`). No `IQuery<TResult>` marker interface is introduced.
- **Date:** 2026-08-08
- **Affected artifacts:** areas/query-cqrs-support.md, tasks/04-query-abstractions-and-discovery.md

## D5: New `tests/NEvo.Messaging.Cqrs.Tests` project

- **Question:** Command/Event CQRS-layer code (adapters, factories, strategy, dispatcher, `AddCommands`) has zero dedicated test coverage today — no `NEvo.Messaging.Cqrs.Tests` project exists, and `NEvo.Messaging.Tests` has no reference to `NEvo.Messaging.Cqrs`. This spec must add characterization tests (D1) and full Query test coverage — where should they live? This is itself a new-project decision (owner-approval gate).
- **Options considered:** New `tests/NEvo.Messaging.Cqrs.Tests` project, mirroring the existing one-test-project-per-src-package convention (recommended) | Add a test-only project reference from the existing `NEvo.Messaging.Tests` to `NEvo.Messaging.Cqrs` and put tests there
- **Decision:** New `tests/NEvo.Messaging.Cqrs.Tests` project.
- **Rationale:** Owner accepted the recommendation — matches the existing per-package test project convention and closes the documented coverage gap properly.
- **Consequences:** A new `tests/NEvo.Messaging.Cqrs.Tests/NEvo.Messaging.Cqrs.Tests.csproj` is created (xUnit/FluentAssertions/Moq, matching the existing test stack), referenced from `nevo.sln`, and `docs/development/testing-strategy.md`'s "Test projects" list and "Required tests per subsystem" table gain a row for it.
- **Date:** 2026-08-08
- **Affected artifacts:** areas/shared-handler-invocation.md, areas/query-cqrs-support.md, tasks/01-command-event-adapter-characterization.md, tasks/06-documentation-and-example.md

## D6: Deleted adapter types are a public breaking change; the shared replacement is public, not internal

- **Question:** `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and `EventHandlerAdapter` (deleted per D1) are `public` types today, but `overview.md`'s original "Compatibility and migration" section claimed additive-only / no migration steps / not a breaking change — the spec review flagged this as factually wrong given those types are public. Separately, the new shared `MessageHandlerAdapter` must be constructed by `CommandHandlerAdapterFactory`/`EventHandlerAdapterFactory` from the separate `NEvo.Messaging.Cqrs` assembly, and no `InternalsVisibleTo` is in this change's scope — so it cannot be `internal`. Two coupled questions: should the spec add compatibility shims for the deleted types to avoid a breaking change, and should the new adapter be `public`?
- **Options considered:** Add compatibility shims (deprecated forwarding types) to avoid a breaking change, keep `MessageHandlerAdapter` `internal` via a new `InternalsVisibleTo` | Accept the breaking change, `MessageHandlerAdapter` is a public utility type, document the removal/addition explicitly (owner's direct choice)
- **Decision:** Accept the breaking change. `MessageHandlerAdapter` is a `public` type. No compatibility shims, no `InternalsVisibleTo`.
- **Rationale:** Owner: "może być breaking change, jako że to nasz projekt i możemy robić co nam się podoba" — these adapter types were never a documented extension point (only `IMessageHandlerFactory` is, per `docs/development/extension-points.md`), so removing them doesn't reduce real extensibility, but they are `public` C# types today and the spec must describe their removal accurately rather than claim nothing changed.
- **Consequences:** `overview.md` § "Compatibility and migration" is corrected to state this plainly as a breaking change: `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, `EventHandlerAdapter` (all public) are removed; `MessageHandlerAdapter` (public) is added. Task 06 documents this in the relevant package reference doc(s). No deprecated forwarding types or new `InternalsVisibleTo` are added anywhere in this change.
- **Date:** 2026-08-08
- **Affected artifacts:** overview.md, areas/shared-handler-invocation.md, tasks/01-command-event-adapter-characterization.md, tasks/02-shared-handler-invocation-adapter.md, tasks/06-documentation-and-example.md
