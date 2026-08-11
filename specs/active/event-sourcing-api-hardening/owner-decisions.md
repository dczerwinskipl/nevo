# Owner decisions — event-sourcing-api-hardening

Decisions D1-D9 below record the architectural direction supplied directly in the
originating request (`nevo-event-sourcing-spec-agent-instructions.md`, provided by the
owner as an explicit specification brief) — recorded per that document's own instruction
not to reopen them absent conflicting repository evidence. Decisions D10-D14 were
resolved interactively during discovery, where the input document left a genuine
public-API/package-boundary/new-project/git-workflow question unresolved.

## D1: Three-level command-handling model

- **Question:** How should commands be handled across simple, orchestrated, and fully
  custom cases?
- **Decision:** Three deliberately different levels — (1) aggregate-method convention
  (framework owns load/replay/dispatch/version/append/publish; user writes only the
  domain decision method), (2) explicit `IEventSourcedCommandHandler<TCommand,
  TAggregate, TId>`-shaped handler (framework still owns the ES lifecycle; user handles
  orchestration/I-O before delegating to a domain decision, optionally reusing Level 1's
  own decision-method discovery), (3) ordinary `ICommandHandler<TCommand>` (full
  escape hatch, no ES magic added to it).
- **Rationale:** Preserves the existing convention-based developer experience as the
  default while giving orchestration cases an explicit, framework-supported escape
  hatch instead of forcing more magic into the aggregate model.
- **Consequences:** Drives `areas/shared-es-execution-and-explicit-handler.md` (tasks
  03-04).
- **Date:** 2026-08-08 (input document date; recorded 2026-08-10)
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md,
  tasks/04-explicit-event-sourced-command-handler.md

## D2: State-specific decision-method resolution — most-specific-wins, ambiguity is an error

- **Question:** When the same command is supported by more than one concrete aggregate
  state type, how is the matching decision method resolved?
- **Decision:** Exact runtime type preferred; otherwise the nearest compatible base-state
  implementation wins; equally specific ambiguous candidates are a configuration/runtime
  error. No reliance on reflection enumeration order or `.First()`-style behavior.
- **Rationale:** Discovery confirmed today's `AggregateDecider`/`AggregateEvolver`
  resolution (`Deciding/AggregateDecider.cs:25-35`, `Evolving/AggregateEvolver.cs:41-55`)
  already has exactly this gap — both filter candidates by `IsAssignableFrom` and take
  whatever LanguageExt's `.ToOption()` returns first, with no specificity ranking and no
  ambiguity detection.
- **Consequences:** Drives task 03's deterministic resolution algorithm and its
  ambiguity-error acceptance criteria.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/shared-es-execution-and-explicit-handler.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md

## D3: Primary/Fallback handler roles, no numeric priority

- **Question:** How should the framework distinguish an intentional convention fallback
  from a competing explicit handler, and detect accidental duplicates?
- **Decision:** Semantic roles (`Primary`/`Fallback`, exact names may be refined by the
  spec) instead of a general numeric priority system. One Primary → use it. No Primary +
  one Fallback → use Fallback. Two+ Primary candidates → configuration error. Multiple
  competing Fallback candidates for the same route → configuration error. Convention
  aggregate-method routing is always Fallback; explicit ES handlers and ordinary
  `ICommandHandler<T>` are always Primary — two of the latter for the same command is
  therefore always an error, never a silent preference.
- **Rationale:** Keeps duplicate-handler protection intact while making the ES
  convention route distinguishable from a genuine handler conflict, without the
  complexity of ranked priorities.
- **Consequences:** Discovery found today's `MessageHandlerDescription`
  (`NEvo.Messaging/Handling/IMessageHandler.cs:8`) has no role/kind field at all, and a
  decider-based handler already collides with a same-command `ICommandHandler<T>` today
  (both feed `MessageHandlerRegistry`'s single `MessageType`-keyed dictionary) —
  confirms the gap this decision closes. Drives task 05.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/handler-registration-and-options.md,
  tasks/05-primary-fallback-handler-roles.md

## D4: `AddEventSourcing(options => {...})` with convention fallback enabled by default

- **Question:** How is the aggregate-method convention route made configurable?
- **Decision:** `services.AddEventSourcing(options => {...})` with a clearly named
  option (e.g. `options.CommandHandling.UseAggregateMethodsAsFallback()`) to enable/
  disable it. Enabled by default. Disabling it leaves explicit ES handlers and ordinary
  command handlers usable. Public terminology describes developer-facing behavior
  ("aggregate method convention/fallback"), not an internal implementation name.
- **Rationale:** Convention handling is a core NEvo usability benefit and should not
  require opt-in, but must be disable-able for cases that want only explicit handling.
- **Consequences:** Discovery found `AddEventSourcing(params Type[])`
  (`ServiceCollectionExtensions.cs:39-61`) currently wires the convention path
  unconditionally with no options object at all (`// TODO: add provider?` at line 56)
  and registers `IMessageHandlerProvider` with plain `AddSingleton`, not `TryAdd` —
  both gaps are closed by task 06. Because `NEvo.Ddd.EventSourcing` is documented
  `status: experimental` and unreleased, changing `AddEventSourcing`'s signature is not
  treated as a compatibility-sensitive breaking change requiring a migration path.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/handler-registration-and-options.md,
  tasks/06-event-sourcing-registration-options.md

## D5: Authorization — message-level static permission, additive handler-specific requirements, new aggregate-aware extension point

- **Question:** How does Event Sourcing integrate with authorization without leaking
  into the domain model or duplicating permission attributes per state type?
- **Decision:** Operation-level permission belongs on the message/command, not on
  concrete aggregate-state decision methods. An explicit handler may add further
  requirements, composed as AND (never override). A new extension point (conceptually
  `IAggregateAuthorization<TCommand, TAggregate>`) runs after rehydration and before the
  decision, for rules that need the loaded resource. No full permission DSL.
- **Rationale:** Discovery found today's `ValidatePermissionMiddleware` reads
  `[AllowPermission]` **exclusively from `HandlerDescription.Method`**
  (`NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:17`), which is method-
  only (`AttributeTargets.Method`) — it cannot be placed on a message type today — and
  `DeciderCommandHandlerProvider` leaves `Method` `null`, so an ES convention-routed
  command today receives **zero permission enforcement**, silently. No message-level
  permission mechanism, no requirement composition, and no resource-aware authorization
  extension point exist anywhere in the repository today — all three are new. Drives
  task 07.
- **Sharpened by D25 (2026-08-11, final spec-refine)** — this decision left the ES
  executor's relationship to the *normal* message/handler permission checks ambiguous
  (the spec text allowed either "fix `ValidatePermissionMiddleware`" or "move checks
  into the executor"). D25 closes that: normal checks stay entirely in the messaging
  pipeline; the executor never invokes them, only the aggregate-aware hook.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/authorization-integration.md,
  tasks/07-message-level-and-aggregate-authorization.md

## D6: Event Store / Aggregate Repository boundary — separate stream persistence from rehydration, remove projection loading from the repository

- **Question:** How should the persistence boundary be cleaned up ahead of a future real
  provider, without implementing one now?
- **Decision:** A low-level stream-persistence abstraction (`IEventStreamStore` or
  similar) handles read/append/expected-version only. `IAggregateRepository` (or its
  refined equivalent) handles obtaining a stream, rehydrating/evolving, and returning
  current state + version — it must not become a projection repository. No global
  position/checkpoint machinery. `AppendAsync` must not be assumed to own the final
  application transaction commit.
- **Rationale:** Sets up the next persistence specification (real providers) without
  redesigning public aggregate/command APIs again, per the input document's explicit
  purpose for this change.
- **Consequences:** Discovery found `IAggregateRepository` already mixes stream
  persistence, rehydration, **and** `LoadProjectionAsync` (real implementation throws
  `NotImplementedException`, `IAggregateRepository.cs:72-75`) — task 02 removes the
  projection responsibility from the repository per this decision.
- **Narrowed by D20-D22 (2026-08-11, final spec-refine) — the "minimum event envelope
  additions" clause above is removed, not merely restated.** External review found this
  decision's original "minimum envelope" language ("stable EventId, stream identity,
  version, payload/type, correlation/causation if an obvious source exists") still
  designed persistence metadata this middle step doesn't need — it left "decide whether
  to keep version out-of-band or add it to the envelope" and "add correlation/causation
  if the executor has context access" as open implementation choices, exactly the kind
  of guessing at a future provider's storage shape this specification's own principles
  argue against. **No envelope type is introduced at all** — not even a minimal one.
  Domain event payload (`Event : Message`, `Id`/`CreatedAt` only), runtime
  message-processing context (`IMessageContext`/`MessageContextHeaders`, already
  carrying correlation/causation), and a future provider's own persisted representation
  are three distinct, undesigned-here concerns — see `overview.md` § "Architectural
  principles" → "Persistence-metadata layering" for the full three-layer statement and
  the two compatibility sentences this decision now defers to. Stream version stays
  exactly where it is today: an out-of-band `int` parameter/return value, never an
  envelope field. `IMessageContext.Headers.CorrelationId`/`CausationId`
  (`NEvo.Messaging/Context/MessageContextHeaders.cs:19-56`) remain runtime
  infrastructure metadata, not promoted onto the domain event or any new type.
  ~~Original (now-removed) clause, kept struck through for audit trail: "Minimum event
  envelope additions only (stable EventId, stream identity, version, payload/type,
  correlation/causation if an obvious source exists)."~~
- **Date:** 2026-08-08 (recorded 2026-08-10; envelope clause removed 2026-08-11)
- **Affected artifacts:** areas/persistence-boundary.md,
  tasks/02-harden-event-store-and-repository-contracts.md, overview.md

## D7: Synchronous event visibility / flush semantics preserved, no inbox/outbox redesign

- **Question:** How does Event Sourcing preserve the existing synchronous-visibility
  guarantee (a synchronous handler reloading the aggregate sees the newly appended
  state) without a cosmetically cleaner but behavior-changing Unit of Work rewrite?
- **Decision:** Source event append/persist must happen before synchronous domain-event
  handlers run. No change to current `SaveChanges`-style behavior. Distinguish
  "flush/save inside current transaction" from "final commit." No inbox/outbox
  persistence redesign unless a very small compatibility change is strictly required —
  and if so, flag it explicitly since transaction semantics are owner-gated.
- **Rationale:** Preserves an existing, load-bearing semantic the messaging pipeline
  already depends on (`docs/development/transaction-model.md`), rather than
  reintroducing risk while hardening an unrelated layer.
- **Consequences:** **Corrected 2026-08-10 (spec-refine, review issue 3) — the original
  discovery claim below was factually wrong and is replaced, not merely restated.**
  There is no primitive literally *named* "flush," but `DbContext.SaveChangesAsync()`
  already **is** the repository's flush mechanism, already used exactly this way by
  `EntityFrameworkMessageInbox.RegisterProcessedAsync` and
  `EntityFrameworkMessageOutbox.SaveMessageAsync`
  (`src/NEvo.Messaging.EntityFramework/EntityFrameworkMessageInbox.cs:18,25`,
  `EntityFrameworkMessageOutbox.cs:38`) — both call it inline, once per call, enlisting
  in the ambient `TransactionScope` without committing it
  (`docs/development/transaction-model.md` § "Transaction ownership", questions 1-2:
  "Whether a handler calls `SaveChangesAsync()` on its own `DbContext` is entirely up to
  that handler's implementation; NEvo does not impose or coordinate a single save
  point"). The ES executor (task 03, renumbered from 04) does not need to invent a new
  primitive — for a future EF-backed store it follows the exact same established
  pattern (call `SaveChangesAsync()` on its own append path before returning control to
  the pipeline); for `FakeEventStore` (in-memory, no `DbContext`) the append is
  synchronous and already visible immediately, so no explicit flush call is needed
  there. Synchronous dispatch re-enters `IMessageProcessor.ProcessMessageAsync` under
  the same ambient `TransactionScope`
  (`InternalSyncProcessDispatchStrategy.cs:8-9`) — the ES executor must append (and,
  for a future DbContext-backed store, save) before triggering this re-entrant
  dispatch, ordering against the existing pipeline rather than introducing a new
  cross-cutting mechanism.
  ~~Original (incorrect) claim, kept here struck through for audit trail per this
  document's append-only convention: "Discovery found no 'flush'/`SaveChanges`
  primitive exists anywhere in the repository (`grep` for `flush` returns nothing)."~~
- **Date:** 2026-08-08 (recorded 2026-08-10; consequences corrected 2026-08-10)
- **Affected artifacts:** areas/shared-es-execution-and-explicit-handler.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md

## D8: `MapQueryEndpoint<TQuery, TResult>` HTTP mapping consistent with `MapCommandEndpoint`

- **Question:** How should Query be exposed over HTTP as ergonomically as Command?
- **Decision:** `app.MapQueryEndpoint<TQuery, TResult>(route)` returning a
  `RouteHandlerBuilder` (chainable with `.RequireAuthorization()` etc.), binding GET
  route/query-string values into the Query using existing ASP.NET Core Minimal API
  mechanisms (not a custom binder) where they can satisfy the contract. Message
  transport metadata (`Id`, `CreatedAt`) must not become required GET parameters. Keep
  the existing Right→200/Left→Problem behavior; do not invent generic domain-specific
  404 semantics — document the escape hatch for resource-specific mapping instead.
- **Rationale:** Matches the existing `MapCommandEndpoint` ergonomics and avoids
  building a separate HTTP-result framework.
- **Consequences:** Discovery found the target framework is `net9.0`
  (`Directory.Build.props:3`), `[AsParameters]`/`BindAsync`/`IBindableFromHttpContext`
  are all available but currently unused anywhere in the repository, and the existing
  ExampleApp `GetDocumentQuery` `MapGet` already branches `DocumentNotFoundException` →
  404 (`Routes.cs:25`) — a distinction the generic `MapQueryEndpoint` will not
  reproduce by default, consistent with this decision's "document the escape hatch"
  clause. Drives task 08.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/http-query-endpoint.md,
  tasks/08-map-query-endpoint-and-get-binding.md

## D9: Dedicated `NEvo.ExampleApp.Documents.Api` example service

- **Question:** How should the example application demonstrate the hardened design?
- **Decision:** A new dedicated example project (`NEvo.ExampleApp.Documents.Api` or a
  naming form consistent with existing ExampleApp projects), moving the Document domain
  out of `ServiceA.Api`. Demonstrates convention handling, an explicit ES handler,
  permission metadata, aggregate-aware authorization, `MapCommandEndpoint` +
  `MapQueryEndpoint`, aggregate reload after writes, and version/concurrency behavior.
  `InMemoryDocumentEventStore` is removed once the real repository/store path works.
- **Rationale:** The ExampleApp is the project's executable documentation/acceptance
  surface; a Document-focused service demonstrates the full design coherently instead
  of accumulating ES workarounds inside the generic ServiceA example.
- **Consequences:** Discovery found the Document domain today lives inside
  `ServiceA.Api` but in namespace `NEvo.Ddd.EventSourcing.Tests.Mocks`
  (`Document.cs:3`) — i.e. it currently borrows test-fixture-shaped types rather than
  owning its own domain namespace; the new service gets its own namespace. Discovery
  also found the current solution **does not build**:
  `InMemoryDocumentEventStore` fails to implement the current `IEventStore` interface
  (`IEventStore.AppendEventsAsync`/`LoadEventsStreamAsync`, CS0535) — confirming it is
  already stale, consistent with removing it (this build failure was transient during
  discovery and was fixed before any task started — see D19). Drives tasks 09-10.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/documents-example-service.md,
  tasks/09-create-documents-example-project.md,
  tasks/10-documents-example-es-and-auth-demo.md

## D10: `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Cqrs` dependency — keep, separate at folder level only

**Superseded by D15 (2026-08-10, spec-refine, review issue 5).** Kept below verbatim
for audit trail — do not implement per this entry; see D15 for the current decision.

- **Question:** `docs/development/event-sourcing.md` and `package-boundaries.md` both
  explicitly flag this project reference as an unresolved question for this
  specification. Should this change alter it?
- **Options considered:** Keep as-is, no change (no consumer need identified today) |
  Begin decoupling into two packages now (no concrete driver, larger effort) | Keep the
  single project/reference for now, but reorganize the package's own folders so core ES
  concepts (evolving, deciding, the aggregate model) are separated from the
  Cqrs-integration concepts (the decider-to-`IMessageHandler` adapter, provider,
  registration) that actually require the dependency — owner's choice.
- **Decision:** Folder-level separation within the single `NEvo.Ddd.EventSourcing`
  project. Core Event Sourcing concepts (evolver, decider, aggregate model) are
  organized separately from the messaging-integration layer, which is where the actual
  `NEvo.Messaging.Cqrs` dependency is confined. The project reference itself is
  unchanged for this specification.
- **Rationale:** Owner: sets up a future package split cheaply (folder boundaries are a
  low-cost, reversible precursor to a project boundary) without paying the cost of an
  actual package split now, when no concrete consumer need for transport-agnostic ES
  exists yet.
- **Consequences:** Task 02 performs this reorganization directly on top of task 01's
  characterization baseline, before any other ES source change lands, so later tasks can
  target the post-reorganization folder layout.
- **Date:** 2026-08-10
- **Affected artifacts:** areas/characterization-and-reorganization.md,
  tasks/02-separate-core-and-integration-folders.md

## D11: `ICreateAggregateCommand<TAggregate,TId>` — wire it in, do not leave unused or delete

**Superseded by D16 (2026-08-10, spec-refine, review issue 5).** Kept below verbatim
for audit trail — do not implement per this entry; see D16 for the current decision.

- **Question:** This marker interface is declared but never referenced in production
  code — create-vs-mutate dispatch is inferred purely from `Option<TAggregate>` being
  `None`/`Some`. What should this spec do with it?
- **Options considered:** Leave as-is, note as pre-existing unused code | Wire it into
  the hardened Level 1 resolution logic now, making "this is a creation command"
  explicit | Remove it now as dead code.
- **Decision:** Wire it into the create-vs-mutate resolution logic as part of task 02's
  reorganization work.
- **Rationale:** Owner's general policy for this discovery pass: clear genuinely dead
  code with no benefit, but when something looks like an unfinished-but-low-effort
  abstraction and completing it was not explicitly written out of scope by the input
  document, include the completion in this change rather than leaving it half-built or
  deleting a usable abstraction. `ICreateAggregateCommand<TAggregate,TId>` fits that
  description — the input document's Level 1 scope discusses create-vs-mutate dispatch
  generally without ruling this interface in or out.
- **Consequences:** Task 02's create-vs-mutate resolution logic checks
  `ICreateAggregateCommand<TAggregate,TId>` explicitly rather than relying purely on
  `Option<TAggregate>` being `None`, while preserving current behavior for commands that
  don't implement it (characterization tests from task 01 must cover this).
- **Date:** 2026-08-10
- **Affected artifacts:** areas/characterization-and-reorganization.md,
  tasks/02-separate-core-and-integration-folders.md

## D12: No dedicated test project for the Documents example service; manual testing only

- **Question:** `ServiceA.Api` (today's home of the Document example) has zero
  dedicated tests, and Scope 10 of the input document requires version/concurrency
  behavior to be covered "at least in tests." Should the new
  `NEvo.ExampleApp.Documents.Api` get its own test project?
- **Options considered:** New dedicated `tests/NEvo.ExampleApp.Documents.Api.Tests`
  project (matches the one-test-project-per-package precedent set by the archived
  query-support change's D5) | No dedicated test project — manual acceptance testing of
  the example only, with the required behavior covered by
  `tests/NEvo.Ddd.EventSourcing.Tests` instead.
- **Decision:** No dedicated test project for the example service. It is verified by
  manual walkthrough only. A follow-up specification is expected to add integration
  tests for it later. The version/optimistic-concurrency acceptance criteria this
  change actually requires are covered by unit tests in
  `tests/NEvo.Ddd.EventSourcing.Tests` (tasks 01/02/03), not by the example.
  This is a narrower scope than Scope 10's acceptance-criteria list in the original
  input document — see `overview.md` § "Compatibility and migration" note on this
  scope reduction.
- **Rationale:** Owner: defer example-service integration tests to a follow-up
  specification rather than adding a new test project now.
- **Consequences:** Task 10 (`documents-example-es-and-auth-demo`) is verified by
  `dotnet build` plus a documented manual walkthrough, not `dotnet test` against a new
  project.
- **Sharpened by D28 (2026-08-11, final spec-refine)** — the manual walkthrough
  originally asked for a two-concurrent-writes HTTP race to demonstrate
  `AggregateConcurrencyException`; D28 removes that, keeping only the deterministic
  core-test coverage this entry already establishes.
- **Date:** 2026-08-10
- **Affected artifacts:** areas/documents-example-service.md,
  tasks/10-documents-example-es-and-auth-demo.md, overview.md

## D13: Dedicated public exception type for optimistic-concurrency conflicts

- **Question:** A stream-version mismatch on append today surfaces as a plain
  `Exception` (`ServiceCollectionExtensions.cs:20-22`, the only `IEventStore`
  implementation, `FakeEventStore`), unlike the messaging layer's own precedent
  (`NoHandlerFoundException`, `MoreThanOneHandlerFoundException`). Should hardening
  introduce a dedicated type?
- **Options considered:** Introduce a dedicated public exception type (e.g.
  `AggregateConcurrencyException`) | Keep using a plain `Exception`.
- **Decision:** Introduce a dedicated public exception type.
- **Rationale:** Owner accepted the recommendation — consistent with NEvo's existing
  exception-per-failure-mode pattern; lets callers pattern-match a concurrency conflict
  specifically instead of string-matching `Exception.Message`.
- **Consequences:** **Corrected 2026-08-10 (spec-refine, review issue 2) — the original
  wording below ambiguously said "throw"; confirmed current code never throws here.**
  `IAggregateRepository.AppendEventsAsync`/`IEventStore.AppendEventsAsync` already
  return `EitherAsync<Exception, Unit>` (`IAggregateRepository.cs:7,22`), not
  `Task<Unit>` with CLR throw semantics. `FakeEventStore.AppendEventsAsync`
  (`ServiceCollectionExtensions.cs:20-22`) already demonstrates the pattern this
  decision continues: `return new Exception(...)` — a plain `return`, implicitly
  converted into the `Left` case of `EitherAsync<Exception, Unit>` — never a thrown
  exception propagating up the call stack. Task 02 (renumbered from 03) updates this
  one `return` site (and any future real `IEventStreamStore` implementation's
  equivalent) to `return new AggregateConcurrencyException(...)` instead of a plain
  `Exception`, preserving the exact same return-not-throw shape. Every acceptance
  criterion and task description in this change must say "returns
  `AggregateConcurrencyException` as `Either<Exception, Unit>.Left`" — never
  "throws/returns" — per this correction.
  ~~Original (ambiguous) wording, kept here struck through for audit trail: "Task 03
  introduces the type and updates every real/future `IEventStreamStore` implementation
  (currently only `FakeEventStore`) to throw it on an expected-version mismatch..."~~
- **Date:** 2026-08-10 (consequences corrected 2026-08-10, same day, during spec-refine)
- **Affected artifacts:** areas/persistence-boundary.md,
  tasks/02-harden-event-store-and-repository-contracts.md

## D14: Branch targeting — new `feature/event-sourcing-api-hardening` branch, PR #10 retargeted manually

- **Question:** `tools/specs.mjs`'s `per-change` branch mode deterministically derives
  `branch = "<prefix>/<change-slug>"`, with no field to pin an existing branch name. The
  input document requires work to land on the existing `feature/event-sourcing` branch
  (PR #10's branch, already carrying `main`), but also suggested the change-id
  `event-sourcing-api-hardening`. These two instructions conflict at the tooling level —
  which should win?
- **Options considered:** Rename the change-id to `event-sourcing` so the tool
  deterministically derives branch `feature/event-sourcing`, landing commits directly
  on PR #10 with no new branch | Keep change-id `event-sourcing-api-hardening` and
  accept that the first `task-start` creates a new `feature/event-sourcing-api-hardening`
  branch off the current `feature/event-sourcing` tip (inheriting all its commits,
  including the `main` merge), with PR #10 retargeted/stacked or replaced outside the
  spec workflow's own automation.
- **Decision:** Keep change-id `event-sourcing-api-hardening`; accept the new branch.
- **Rationale:** Owner's explicit choice — prioritizes the more descriptive change-id
  over automatically continuing PR #10's exact branch.
- **Consequences:** `change.yaml` uses `branch.mode: per-change`, `branch.prefix:
  feature`, deriving `feature/event-sourcing-api-hardening`. Because the current working
  branch at spec-create time is `feature/event-sourcing` (with `main` already merged),
  the new branch created by the first `task-start` inherits that exact baseline commit —
  satisfying "do not restart from a clean main branch" — but is a distinct branch from
  PR #10's. The owner is responsible for retargeting or stacking PR #10, or opening a
  replacement PR, outside this workflow's automation; this is noted as a manual
  follow-up, not something any `/nevo-ai:*` command performs automatically.
- **Date:** 2026-08-10
- **Affected artifacts:** change.yaml, overview.md

## D15: No folder/namespace reorganization — supersedes D10

- **Question:** External review (spec-refine) challenged D10's folder-level
  core/integration split as incidental scope: "the primary goal of this specification
  is Event Sourcing API hardening and persistence readiness, not package beautification
  ... unless current package boundaries actively block the planned API changes, remove
  or substantially reduce folder/namespace reorganization that is only justified as
  'cleaner for a future package split.'" Does any task in this change actually require
  the reorganization to proceed?
- **Options considered:** Keep D10's folder-level split (original decision) | Remove it
  entirely — no folder/namespace changes in this specification, revisit only if a
  concrete future need arises.
- **Decision:** Remove it entirely. Task 02 (`separate-core-and-integration-folders`) is
  deleted from the task list, not reduced. `NEvo.Ddd.EventSourcing`'s current folder
  layout (`Evolving/`, `Deciding/`, `Handling/`, root) is unchanged by this
  specification. The project reference to `NEvo.Messaging.Cqrs` is unchanged (this part
  of D10 was never in question).
- **Rationale:** Owner: no task in this change (executor extraction, repository
  hardening, Primary/Fallback registration, authorization, HTTP mapping, the Documents
  example) requires the folder boundary to exist first — every one of them can be
  implemented against the current flat layout exactly as easily as against a
  reorganized one. The reorganization's only justification was "cheaper to split later,"
  which is speculative benefit for a hypothetical future change, not a requirement of
  this one — inconsistent with this specification's own stated principle: "do not
  introduce infrastructure whose only justification is a hypothetical future provider
  unless the abstraction is required to avoid locking the public API now" (the same
  reasoning applies to a folder boundary as to an abstraction).
- **Consequences:** Task 02 is deleted. Every task that depended on it now depends
  directly on task 01 (`characterize-event-sourcing-baseline`). All subsequent tasks are
  renumbered down by one (former 03→02, 04→03, ... 11→10); the two documentation tasks
  (formerly one task, 12) are split per D21-equivalent scope below and become 11-12. See
  `change.yaml` for the final numbering.
- **Date:** 2026-08-10
- **Affected artifacts:** change.yaml, overview.md,
  areas/characterization-and-reorganization.md (renamed
  areas/characterization-and-baseline.md), tasks/02-separate-core-and-integration-folders.md
  (deleted)

## D16: `ICreateAggregateCommand<TAggregate,TId>` stays untouched, out of scope — supersedes D11

- **Question:** External review challenged D11's decision to wire the unused marker
  interface into create-vs-mutate resolution: "do not give this marker new semantics
  merely because it exists... before including behavior based on it, the spec would
  need to define [what happens if a create command targets an already-existing stream,
  whether it changes command resolution, whether it changes aggregate initialization
  semantics, or whether it is simply unused legacy/dead scaffolding]... if not required
  for the current hardening work, keep it out of the behavior-changing scope... prefer
  deleting an unnecessary task over inventing semantics to justify it." Does this
  change's actual hardening work (executor extraction, ambiguity resolution, Primary/
  Fallback registration) require `ICreateAggregateCommand` to be wired in?
- **Options considered:** Keep D11's decision (wire it into task 02's resolution logic)
  | Leave it completely untouched — no behavior based on it, note it as unused/legacy
  scaffolding, defer any decision about it to a future change if one ever needs it |
  Delete the interface now as dead code.
- **Decision:** Leave it completely untouched in this specification. Not wired in, not
  deleted. Recorded here as a known unused type for a future change to pick up only if
  a concrete need for explicit create-vs-mutate marking actually materializes.
- **Rationale:** Owner: D11's own unresolved questions (what happens on a create
  command against an existing stream, whether it changes resolution/initialization
  semantics) are exactly the kind of undesigned behavior a hardening change should not
  invent answers for just because a marker interface happens to exist. The task that
  carried this work (task 02) is deleted per D15 for an unrelated reason (folder reorg);
  since `ICreateAggregateCommand` had no task of its own, this decision simply removes
  it from scope rather than reassigning it elsewhere.
- **Consequences:** No task in this change references, wires, or deletes
  `ICreateAggregateCommand<TAggregate,TId>`. Create-vs-mutate dispatch continues to be
  inferred purely from `Option<TAggregate>` being `None`/`Some`, exactly as today —
  task 01's characterization tests cover this existing behavior and no task changes it.
- **Date:** 2026-08-10
- **Affected artifacts:** change.yaml, overview.md,
  areas/characterization-and-reorganization.md (renamed
  areas/characterization-and-baseline.md)

## D17: Aggregate modeling style is a supported default, not the Event Sourcing core's permanent definition

- **Question:** The currently implemented modeling style (immutable object-oriented
  aggregate state, decision methods discovered on concrete state types) is the only
  style this specification implements or documents as a feature. Should the core
  contracts this change hardens (Event Store, aggregate repository, execution
  lifecycle, persistence contracts) be designed in a way that would make this style
  the Event Sourcing core's only possible future shape, or should room be explicitly
  preserved for other styles (mutable aggregates, static/functional decider+evolver
  functions) without designing or implementing them now?
- **Options considered:** Design the core generically now, with an explicit strategy
  abstraction (e.g. `IDecisionStrategy`, `IMutableAggregateStrategy`,
  `IFunctionalDeciderStrategy`) anticipating future styles | Harden the core against
  the current OO-immutable style only, revisit generality later if/when a second style
  is actually needed | Add a documented compatibility constraint now (no new
  abstraction), so the *contracts* (repository/store/executor) don't accidentally bake
  in an assumption that decision/evolution logic must be an instance method on an
  immutable aggregate object — without building any multi-style abstraction.
- **Decision:** The third option — a documented compatibility constraint, no new
  abstraction.
- **Rationale:** Owner: "the desired outcome is direction and room to evolve, not a
  finished multi-model architecture." A speculative strategy hierarchy has no current
  consumer and no current evidence it's needed (violates this specification's own
  "do not introduce infrastructure whose only justification is a hypothetical future
  provider" principle) — but silently letting the hardened contracts assume
  "decision/evolution = instance method on immutable state" would foreclose future
  styles for free, at zero benefit to this change. A documented constraint costs
  nothing to implement and prevents that foreclosure.
- **Consequences:** Every task touching the Event Store/repository/executor contracts
  (tasks 02-04, renumbered) must design those contracts so nothing in their *public
  shape* requires decision/evolution logic to be an instance method on an immutable
  aggregate-state object — e.g. the executor's decision-method discovery is itself
  convention-specific and stays exactly as-is (that's fine, it's an explicit
  Level-1/Level-2 concern, not a repository/store-level constraint), but the
  repository/store contracts themselves (load/append/version) must remain agnostic to
  *how* the caller produces the next state. The exact compatibility-constraint wording
  is recorded in `overview.md` § "Architectural principles" and repeated in
  `areas/shared-es-execution-and-explicit-handler.md`. No new type is introduced by
  this decision.
- **Date:** 2026-08-10
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  areas/persistence-boundary.md, tasks/02-harden-event-store-and-repository-contracts.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md

## D18: Query GET binding resolved — `[AsParameters]` on the concrete `Query<TResult>` record, no contract change

- **Question:** The spec previously hedged: "if the current Query contract prevents
  ergonomic route/query binding, propose the smallest coherent adjustment" — external
  review flagged this as an unresolved contradiction that must not be left for the
  implementation task to invent. Does `[AsParameters]` binding on a concrete
  `Query<TResult>`-derived record (e.g. `GetDocumentQuery(Guid DocumentId) :
  Query<DocumentDto>`) actually require the inherited `Message`/`Message<TResult>`
  fields (`Id`, `CreatedAt`) as bindable/required GET parameters, or not?
- **Options considered:** Assume `[AsParameters]` binds every public property
  (including inherited `Id`/`CreatedAt`) and therefore requires a `Query<TResult>`
  contract adjustment to exclude them | Verify empirically against real ASP.NET Core
  Minimal API binding behavior before deciding anything, then record whichever answer
  the evidence gives.
- **Decision:** Verified empirically. **No contract change is needed.** ASP.NET Core's
  `[AsParameters]` binder, for a record type with exactly one public constructor, binds
  that constructor's own parameters — not every public property of the type.
  `GetDocumentQuery(Guid DocumentId) : Query<TResult>`'s only public constructor is
  `GetDocumentQuery(Guid DocumentId)` (the base call to `Query<TResult>`'s parameterless
  constructor is implicit and not part of the derived type's own public constructor
  surface); `Id`/`CreatedAt` are inherited init-only properties, not parameters of that
  constructor, so the binder never touches them.
- **Rationale:** Confirmed by a minimal, disposable ASP.NET Core 9 probe project
  (outside the repository, in the scratch working directory) mirroring the real
  `Message`/`Message<TResult>`/`Query<TResult>` shapes: `app.MapGet("/api/documents/
  {documentId:guid}", ([AsParameters] GetDocumentQuery query) => ...)` returned HTTP 200
  with server-generated `Id`/`CreatedAt` values when the request supplied **only** the
  route's `documentId` and no `id`/`createdAt` query-string values at all — proving
  they are not required, exactly as this specification's constraint demands.
- **Consequences:** `MapQueryEndpoint<TQuery, TResult>` (task 08, renumbered from 09)
  binds `TQuery` via `[AsParameters]` with no further binding-contract design work
  needed and no change to `Query<TResult>`/`Message<TResult>`. The task's own
  acceptance criteria are updated to assert this directly rather than hedge on it.
- **Date:** 2026-08-10
- **Affected artifacts:** areas/http-query-endpoint.md,
  tasks/08-map-query-endpoint-and-get-binding.md

## D19: No build-fix scope remains — the branch's current green build is the baseline

- **Question:** At spec-create time (2026-08-10), `dotnet build NEvo.sln` failed with 5
  errors, and the original task 01 (`fix-build-and-characterize-baseline`) existed
  partly to fix them. An external commit (`5804bb14b`, "Fix build job compile failures
  only," `copilot-swe-agent[bot]`) landed the mechanical fix on this branch before any
  task in this change started implementation. Should the specification's active
  artifacts (Problem, Current architecture, Proposed architecture, task scope/
  acceptance criteria) continue to narrate the historical compile failure, or should
  they treat the current green build as the baseline and move the history to git/this
  record only?
- **Options considered:** Keep the "branch does not build" narrative in active
  artifacts for historical completeness | Remove it from active artifacts — the
  specification describes the system to be built from *today's* state, not a
  transient discovery-time condition; git history and this decision record are the
  correct place for that chronology.
- **Decision:** Remove it from active artifacts. `dotnet build`/`dotnet test
  tests/NEvo.Ddd.EventSourcing.Tests` succeeding is this specification's baseline and
  regression condition — task 01 (renamed `characterize-event-sourcing-baseline`,
  D19-driven rename) verifies this rather than fixing it, and every other task treats a
  passing build as a precondition it must not break, not a target it works toward.
- **Rationale:** Owner (final spec-refine): "that history is not a system requirement
  and should not remain as current architecture/problem/task scope... the resulting
  spec should simply treat a green build as the baseline/regression condition."
- **Consequences:** `overview.md`'s "Critical fact: the branch does not currently
  build" paragraph, the "branch also does not currently compile" Problem-statement
  clause, and task 01's original "fix 5 compile errors" goal are all removed. Task 01
  is renamed `fix-build-and-characterize-baseline` → `characterize-event-sourcing-
  baseline` (id, filename, `change.yaml`, and every `depends_on`/
  `dependency_contracts` reference updated together, since all tasks were still
  `draft`). D9's own "Discovery also found the current solution does not build"
  sentence is left as dated historical evidence supporting that decision's original
  rationale, not as active guidance — it is not repeated anywhere else.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, tasks/01-characterize-event-sourcing-baseline.md
  (renamed), areas/characterization-and-baseline.md, change.yaml

## D20: No persisted Event Envelope is designed in this specification

- **Question:** D6's original "minimum event envelope additions" clause (stable
  EventId, stream identity, version, payload/type, correlation/causation "if an
  obvious source exists") still asked task 02 to design persistence metadata this
  middle step doesn't need, and left open implementation choices ("decide whether to
  keep version out-of-band or add it to the envelope," "add correlation/causation if
  the executor has context access"). Should this specification define even a minimal
  envelope/metadata type, or design none at all?
- **Options considered:** Keep a minimal envelope (smallest possible additive type) |
  Design no envelope type at all — distinguish domain event payload, runtime
  message-processing context, and a future provider's own persisted representation as
  three separate, undesigned-here concerns, and let the next real-provider
  specification decide the envelope shape once concrete persistence requirements are
  known.
- **Decision:** No envelope type at all.
- **Rationale:** Owner (final spec-refine): "the exact public/internal shape of the
  persisted envelope does not need to be over-designed now... persistence-readiness
  does not mean guessing Marten/PostgreSQL/Kurrent storage records before implementing
  any of them." Even a "minimal" envelope is still a public type this specification
  would need to justify and the next provider specification would then be constrained
  by — the smaller, cheaper, more reversible choice is to add nothing and let the
  provider that actually needs storage metadata define its own representation.
- **Consequences:** Task 02 does not introduce any envelope/metadata type. The domain
  event payload (`Event : Message`) is unchanged. `IAggregateEvent<TAggregate,TId>`
  keeps carrying only `StreamId` beyond what `Message` already provides. Stream
  version stays an out-of-band `int`. See `overview.md` § "Architectural principles" →
  "Persistence-metadata layering" for the full three-layer statement and the two
  compatibility sentences the next persistence specification can cite directly. This
  narrows D6 — see D6's own amendment note.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, owner-decisions.md (D6 amendment),
  areas/persistence-boundary.md, tasks/02-harden-event-store-and-repository-contracts.md

## D21: Correlation/causation stay runtime infrastructure metadata, not domain-event fields

- **Question:** `IMessageContext.Headers.CorrelationId`/`CausationId` already exist.
  Should this specification add corresponding fields to the domain event or a new
  envelope type "since a future Event Store may want to persist them," or leave them
  exactly where they are?
- **Options considered:** Add optional/nullable correlation/causation fields to the
  event (or a new envelope) now, for a future provider to populate | Leave them as
  `IMessageContext`/`MessageContextHeaders`-only runtime metadata; the Event Sourcing
  executor may read `IMessageContext` (it already participates in the messaging
  lifecycle) without promoting anything onto the domain event.
- **Decision:** Leave them as runtime-context-only metadata. No optional/nullable
  fields are added anywhere "for later."
- **Rationale:** Owner (final spec-refine): "correlation and causation are
  infrastructure/runtime metadata. They must not become domain-event business
  properties merely because a future Event Store may persist them... do not invent a
  second correlation mechanism."
- **Consequences:** No new field on any domain event type or `IAggregateEvent<
  TAggregate,TId>`. If a future real provider needs correlation/causation in its
  persisted representation, it reads them from `IMessageContext` at append time and
  maps them into its own storage record — a decision for that future specification,
  not this one.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/persistence-boundary.md,
  tasks/02-harden-event-store-and-repository-contracts.md

## D22: This specification does not freeze the final persistence-provider SPI

- **Question:** Given D20/D21 leave the low-level store contract intentionally
  undesigned beyond `IEventStreamStore`'s current append/load/version shape, should
  this specification claim that shape is final, or explicitly reserve room for the
  next real-provider specification to refine it?
- **Options considered:** Present `IEventStreamStore`'s shape from task 02 as the
  final, frozen persistence SPI | Explicitly state it stabilizes only the
  user-facing aggregate/command execution direction, not the low-level provider SPI,
  which the next real-provider specification may still refine.
- **Decision:** Explicitly reserve room — record the compatibility statement in
  `overview.md` verbatim so the next specification can cite it directly rather than
  re-deriving permission to adjust the store contract.
- **Rationale:** Owner (final spec-refine): "this specification stabilizes the
  user-facing aggregate/command execution direction. It does not freeze the final
  persistence-provider SPI." This avoids a false promise that could otherwise block or
  complicate the follow-up real-provider specification (Follow-up 1 in the original
  brief) from adjusting `IEventStreamStore` once concrete PostgreSQL/Marten/Kurrent
  requirements are known.
- **Consequences:** `overview.md` carries the compatibility sentence verbatim. Public
  aggregate decision APIs and the explicit Level 2 handler API are what this
  specification does stabilize (per D1-D2, D24) — the distinction matters because it
  tells the next specification exactly what it may still change (the store SPI) versus
  what it may not (aggregate/command-handler public APIs) without another breaking
  round of the latter.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md

## D23: Append/flush/commit expressed as a storage-contract ordering guarantee, not an EF-specific note

- **Question:** D7's correction (2026-08-10) established that `SaveChangesAsync()` is
  already the repository's flush mechanism, used by inbox/outbox. Should the
  specification describe the Event Sourcing executor's own obligation as "the executor
  calls EF `SaveChangesAsync()`," or as a provider-agnostic ordering guarantee that an
  EF-backed provider happens to satisfy via `SaveChangesAsync()`?
- **Options considered:** Describe the requirement in EF-specific terms (call
  `SaveChangesAsync()`) | Express it as a storage-contract visibility/ordering
  guarantee that any provider (in-memory, EF, external Event Store) must satisfy in
  its own way, citing `SaveChangesAsync()` only as the established *pattern* an
  EF-backed provider would follow.
- **Decision:** Express it as a provider-agnostic guarantee.
- **Rationale:** Owner (final spec-refine): "keep the distinction: (1) append/write,
  (2) make the source write visible/durable enough inside the supported current
  consistency boundary, (3) final transaction commit... express the requirement as a
  storage contract/ordering guarantee, not as 'the executor will call EF
  SaveChanges.'" The Event Sourcing core must remain implementable by an in-memory
  store, an EF/PostgreSQL-backed store, and an external Event Store alike (per the
  original brief's "Future compatibility requirements") — describing the guarantee in
  EF-specific terms would misstate that generality even though the *current* only
  implementation (`FakeEventStore`) needs no explicit call at all.
- **Consequences:** `overview.md` § "Architectural principles" records the exact
  three-sentence guarantee (append visibility; synchronous publish only after
  successful append; successful append does not imply final commit). Task 03's
  executor orders its own append before the pipeline's re-entrant synchronous
  dispatch; it does not itself call any provider-specific save method — that is each
  `IEventStreamStore` implementation's own responsibility. This sharpens D7 without
  reversing it.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md

## D24: Explicit Level 2 handling supports both existing and creation paths via `Option<TAggregate>`, never `null`

- **Question:** The original Level 2 wording said the explicit handler "receives the
  already-rehydrated aggregate/current state," silently assuming every command targets
  an existing aggregate. But `DeciderCommandHandler` already supports creation
  (`Option<TAggregate>.None`) alongside mutation (`Option<TAggregate>.Some`). Must the
  hardened Level 2 API define explicit create-vs-existing semantics before
  implementation, and if so, using what shape?
- **Options considered:** Leave the ambiguity for the implementing task to resolve
  informally | Wire `ICreateAggregateCommand<TAggregate,TId>` into Level 2 dispatch to
  distinguish the paths | Use `null` to represent a missing aggregate | Preserve the
  existing `Option<TAggregate>` Some/None model explicitly in the Level 2 handler's own
  signature (or an equivalent execution-context shape exposing the same Some/None
  distinction).
- **Decision:** Preserve `Option<TAggregate>` explicitly. The explicit Level 2 handler
  receives the current state as `Option<TAggregate>` (or a minimal execution context
  exposing the equivalent explicit Some/None state) — `Some` when an existing
  stream/aggregate was rehydrated, `None` on the creation path.
- **Rationale:** Owner (final spec-refine): "this is a real public-API semantic and
  must be resolved in the specification before implementation... preserve the current
  Some/None create-vs-existing model. Do not wire `ICreateAggregateCommand` into
  dispatch in this specification. Do not introduce a second special create-handler
  hierarchy merely to solve this. Do not use `null` to represent a missing aggregate."
  This keeps Level 2 consistent with Level 1's already-working model rather than
  inventing a parallel one, and keeps D16 (leave `ICreateAggregateCommand` untouched)
  intact.
- **Consequences:** Task 04's `IEventSourcedCommandHandler<TCommand, TAggregate, TId>`
  (or refined name) signature takes `Option<TAggregate>`, not a bare `TAggregate`. A
  Level 2 handler may still delegate to Level 1's decision discovery, including the
  existing creation decision path. Task 04 gains explicit acceptance criteria for both
  the `Some` and `None` cases. This does not reopen D16 — `ICreateAggregateCommand`
  remains unwired.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  tasks/04-explicit-event-sourced-command-handler.md

## D25: Authorization ownership split — messaging pipeline owns normal checks, the ES executor owns only the aggregate-aware hook, both share the same `Option<TAggregate>` semantics

- **Question:** D5 left it open whether normal message/handler-level permission checks
  should be fixed in place (`ValidatePermissionMiddleware`) or moved into the Event
  Sourcing executor. Separately, D24 raised the same Some/None question for the
  aggregate-aware authorization hook that D5 introduced: does it assume an aggregate
  always exists? Both are the same underlying question — precisely which component
  owns which authorization concern, and with what current-state shape — and the
  specification must not leave either choice to implementation.
- **Options considered (ownership):** Fix `ValidatePermissionMiddleware` in place,
  keep normal checks entirely in the messaging pipeline | Move normal permission
  checks into the Event Sourcing executor, duplicating general messaging authorization
  behavior there.
  **Options considered (Some/None):** Require the aggregate-aware hook to receive a
  non-optional `TAggregate`, implicitly forcing every aggregate-aware policy to assume
  an existing resource | Give it the same explicit `Option<TAggregate>` semantics as
  the Level 2 handler (D24), letting a policy see and choose how to handle `None`.
- **Decision:** Fix `ValidatePermissionMiddleware` in place (plus the new
  message-level attribute placement) — normal message-level and handler-level checks
  stay entirely in `NEvo.Messaging.Authorization`'s existing pipeline, composed AND,
  and the Event Sourcing executor never invokes them. The executor owns exactly one
  authorization concern: the aggregate-aware hook, invoked after rehydration and
  before the decision, receiving the current state as the same `Option<TAggregate>`
  shape D24 establishes for the Level 2 handler.
- **Rationale:** Owner (final spec-refine): "the executor should not duplicate general
  messaging authorization behavior... [aggregate-aware authorization] must not assume
  an aggregate always exists... a policy that only makes sense for existing resources
  can explicitly reject/ignore `None` according to its own use case. Do not silently
  skip aggregate-aware authorization on create merely because there is no object yet."
  Keeping normal checks in the pipeline avoids two implementations of the same
  concern; sharing D24's Some/None shape avoids a second, inconsistent
  optionality convention for the one authorization concern that does need current
  state.
- **Consequences:** `overview.md` § "Architectural principles" records the exact
  conceptual pipeline-then-executor ordering. Task 03's executor description no longer
  lists "static/message-level authorization" among what it invokes — only the
  aggregate-aware hook. Task 07 is explicitly two parts in two packages: (a) fix
  `ValidatePermissionMiddleware` + add the message-level attribute, in
  `NEvo.Messaging.Authorization`; (b) add the aggregate-aware hook, in
  `NEvo.Ddd.EventSourcing` (see D26 for why not in `NEvo.Messaging.Authorization`).
  Task 07 gains acceptance criteria for both `Some` and `None` reaching the
  aggregate-aware hook, and for denial preventing append in either case. Part (a)'s
  tests move to a new, small `tests/NEvo.Messaging.Authorization.Tests` project
  (owner-approved here, per the final-refinement input directly authorizing it,
  matching the one-test-project-per-package precedent the archived query-support
  change's D5 already set for `NEvo.Messaging.Cqrs.Tests`) — this is a "new project"
  decision under `AGENTS.md`'s owner-approval list, and this entry is that approval;
  `tests/NEvo.Web.Authorization.Tests` (a different package's tests) is not reused.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  areas/authorization-integration.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md,
  tasks/07-message-level-and-aggregate-authorization.md

## D26: No new `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` project dependency

- **Question:** The aggregate-aware authorization hook (D5, D25) needs to run inside
  the Event Sourcing executor, but `NEvo.Messaging.Authorization` (home of
  `ValidatePermissionMiddleware`/`AllowPermissionAttribute`/
  `IDataScopeMessageValidator`) is a lateral sibling package —
  `docs/development/package-boundaries.md` shows `NEvo.Ddd.EventSourcing` depending
  only on `NEvo.Messaging.Cqrs`, and extension packages depending on `NEvo.Messaging`
  but explicitly "not on each other" (the one documented exception is
  `NEvo.Messaging.Web`). Should this specification add a new `NEvo.Ddd.EventSourcing`
  → `NEvo.Messaging.Authorization` reference to let the hook use authorization
  services directly, or must the hook's core contract avoid that dependency?
- **Options considered:** Add the new lateral dependency — simplest for the hook's own
  implementation to reference `IDataScopeMessageValidator`/user-context types directly
  | Keep the hook's core *contract* dependency-free of `NEvo.Messaging.Authorization`,
  expressed only in terms of the command, the `Option<TAggregate>` current state, and
  the already-available `IMessageContext` — leaving concrete implementations (written
  by the consuming application, which already references whatever packages it needs)
  free to call into `NEvo.Messaging.Authorization`/`NEvo.Authorization` themselves.
- **Decision:** No new dependency. The core `IAggregateAuthorization<TCommand,
  TAggregate>` (or equivalent) contract lives in `NEvo.Ddd.EventSourcing` (or another
  already-lower neutral abstraction), typed only in terms of the command, `Option<
  TAggregate>`, and `IMessageContext` — nothing from `NEvo.Messaging.Authorization`. A
  concrete implementation (e.g. inside the Documents example) may reference
  `NEvo.Messaging.Authorization`/`NEvo.Authorization` freely, since the package-
  boundary constraint applies to the core contract's own project, not to consumers
  implementing it.
- **Rationale:** Owner (final spec-refine): "do not introduce an unnecessary project
  dependency `NEvo.Ddd.EventSourcing -> NEvo.Messaging.Authorization` just to execute
  aggregate-aware authorization. The current Event Sourcing project already depends on
  lower messaging/CQRS infrastructure; it should not have to depend on the higher
  authorization package solely for this extension point." Adding the dependency would
  also need its own package-boundary owner-approval gate per
  `docs/development/package-boundaries.md` § "Changing a dependency" — avoiding it
  keeps this change inside the boundary decisions already made (D15).
- **Consequences:** Task 07's aggregate-aware half stays inside
  `NEvo.Ddd.EventSourcing`; its message-level half stays inside
  `NEvo.Messaging.Authorization`; neither task adds a project reference between the
  two packages. `overview.md`'s dependency graph statement and change-wide acceptance
  criteria both assert this directly, not just imply it.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/authorization-integration.md,
  tasks/07-message-level-and-aggregate-authorization.md

## D27: No new integration-test infrastructure is introduced in this change

- **Question:** Task 08's original verification asked for a `WebApplicationFactory`-
  based automated test of `MapQueryEndpoint`'s GET binding, placed under
  `tests/NEvo.Messaging.Cqrs.Tests` — but that project does not reference
  `NEvo.Messaging.Web` (where `MapQueryEndpoint` lives), and the repository has no
  ASP.NET integration-test infrastructure anywhere today. Should this specification
  add a project reference (or a new test project) to make that automated test
  possible, or verify `MapQueryEndpoint` a different way?
- **Options considered:** Add a project reference from `NEvo.Messaging.Cqrs.Tests` to
  `NEvo.Messaging.Web` | Create a new integration-test project/harness for
  `NEvo.Messaging.Web` | Verify what's naturally unit/component-testable (the endpoint
  extension compiles, returns `RouteHandlerBuilder`), rely on D18's already-closed
  binding-mechanism evidence, and verify the concrete HTTP usage through the Documents
  example's manual walkthrough instead of new automated integration-test
  infrastructure.
- **Decision:** The third option. No new project reference, no new integration-test
  project or harness, anywhere in this change.
- **Rationale:** Owner (final spec-refine): "the repository does not currently have
  dedicated integration-test infrastructure for the ExampleApp or
  `NEvo.Messaging.Web`, and the owner does not want this specification to introduce
  such infrastructure merely to test examples/Minimal API binding end to end...
  behavior that can be tested at package/core level should be unit/component tested
  there, ExampleApp stays manually exercised/documented, broader HTTP/integration/e2e
  test infrastructure can be a later testing-focused change." D18 already closed the
  binding-mechanism question with empirical evidence outside the repository (a
  disposable probe project) — that evidence doesn't need to be re-proven with new
  in-repo test infrastructure.
- **Consequences:** Task 08's verification section drops the
  `WebApplicationFactory`/`NEvo.Messaging.Cqrs.Tests` combination entirely. Its
  acceptance criteria are re-expressed as: the endpoint extension compiles and returns
  `RouteHandlerBuilder` (verified via `dotnet build` plus ordinary unit tests of any
  naturally-testable extracted logic), D18's binding conclusion is retained as the
  grounded decision (not re-verified), and the concrete HTTP GET behavior is verified
  manually through the Documents example walkthrough (task 10). This is the same
  "no new test infrastructure" principle D12 already applied to the ExampleApp,
  extended here to `NEvo.Messaging.Web`.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/http-query-endpoint.md,
  tasks/08-map-query-endpoint-and-get-binding.md

## D28: Manual ExampleApp concurrency racing is removed

- **Question:** Task 10's manual walkthrough asked for reproducing two concurrent
  writes against the Documents example over HTTP to surface
  `AggregateConcurrencyException`. Given D12 already keeps the example verification
  manual/non-automated, and optimistic-concurrency behavior is exactly the kind of
  thing a deterministic unit test proves more reliably than a manually-reproduced HTTP
  race, should the walkthrough keep this requirement?
- **Options considered:** Keep the manual concurrent-write race as part of the
  walkthrough's required steps | Remove it — the walkthrough covers the ordinary
  CRUD + query flow and links to the user guide's explanation of optimistic
  concurrency; deterministic concurrency-conflict coverage lives entirely in Event
  Sourcing core tests (task 02's `AggregateConcurrencyException` unit test, task 03's
  executor-level concurrency test).
- **Decision:** Remove it from the walkthrough's required steps.
- **Rationale:** Owner (final spec-refine): "do not use an in-memory example race as
  the acceptance test for concurrency semantics. Optimistic concurrency belongs in
  deterministic Event Sourcing core tests against the stream-store/repository/executor
  behavior... it may explain that the repository uses expected-version optimistic
  concurrency and link to the user guide, but it does not need to manufacture a
  concurrent HTTP race." A manually-reproduced race is inherently flaky/timing-
  dependent and adds no coverage beyond what tasks 02-03's automated tests already
  prove deterministically.
- **Consequences:** Task 10's walkthrough covers: create, change, approve, query,
  reload produces the expected current state, Level 1 vs Level 2 usage, permissions,
  query/command endpoint mapping — and may mention expected-version optimistic
  concurrency in prose with a link to the user guide, but does not reproduce a race.
  Task 10's acceptance criteria drop the version-conflict-over-HTTP requirement.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/documents-example-service.md,
  tasks/10-documents-example-es-and-auth-demo.md

## D29: Explicit expected stream state (`NoStream`/`Exact(version)`) — no magic create version

- **Question:** Today's creation path means `Option<TAggregate>.None` →
  `AppendEventsAsync(..., expectedVersion: 0, ...)`, while an existing aggregate means
  `Option<TAggregate>.Some` → `AppendEventsAsync(..., expectedVersion: loaded.Version,
  ...)`. The numeric literal `0` is carrying two different concepts at once — "the
  stream must not already exist" and "the expected version happens to be zero." A
  comparison against mature .NET Event Sourcing designs (Eventuous, Marten) found this
  exact pattern called out as worth avoiding, because a real provider (PostgreSQL/
  Marten/Kurrent-style) naturally distinguishes "start a new stream" from "append at a
  known revision," and forcing that distinction to be reverse-engineered from a numeric
  coincidence later is exactly the kind of contradiction task 02's own boundary-hardening
  work should prevent now, while the contract is already being touched. Should this
  change introduce an explicit expected-stream-state concept, or leave the numeric
  `expectedVersion` convention as-is for the next persistence specification to address?
- **Options considered:** Leave `expectedVersion: int` as-is, defer the semantic split to
  the future real-provider specification | Introduce an explicit two-case expected-
  stream-state concept (`NoStream` / `Exact(version)`) in task 02's own contract work,
  since the boundary is already being hardened there | Go further and add a general
  `Any`/unconditional-append mode alongside the two cases, matching some mature
  frameworks' fuller option set.
- **Decision:** The second option. `IEventStreamStore`'s append contract distinguishes
  at least `NoStream` (valid only if the stream does not exist — the `Option.None`
  creation path) from `Exact(version)` (valid only if the stream is at exactly the
  observed version — the `Option.Some` mutation path). **No `Any`/`IgnoreVersion`/
  unconditional-append mode, and no automatic retry/rebase semantics** — the third
  option is explicitly rejected; NEvo has no current use case for it, and it can be
  designed later against a real use case if one ever appears. Exact type/case naming
  is not owner-fixed (`ExpectedStreamState.NoStream`/`.Exact(version)` or
  `ExpectedStreamVersion.NoStream`/`.Exact(version)` are both acceptable directions —
  pick whichever reads most consistently with existing NEvo naming). The low-level
  stream read result must preserve stream existence explicitly enough for the
  repository to map missing stream → `Option<TAggregate>.None` and existing stream →
  rehydrated `Some` plus observed version — it must not collapse "stream does not
  exist" into the same shape as "stream exists with zero events" (`events: []`,
  `version: 0`) if that erases the distinction the append contract now makes. Both
  `NoStream` and `Exact(version)` failures remain the exact same
  `AggregateConcurrencyException` returned via `Either<Exception, T>.Left` (D13) — this
  is not a new error hierarchy, just a richer expectation the same error type responds
  to. `FakeEventStore`'s read path must not create a stream as a side effect of being
  read — a read of a nonexistent stream stays observably "no stream" until an append
  actually creates it.
- **Rationale:** Owner, after comparing the current direction against Eventuous/Marten/
  Wolverine/Equinox: "the current numeric `0` create convention is cheap to remove now
  while task 02 is already changing the stream-store boundary, and explicit semantics
  adapt more naturally to future real stores... do not let a future provider have to
  reverse-engineer that intent from a magic integer." This is the one concrete
  persistence-contract improvement those reference designs motivate — not an invitation
  to adopt any of their broader API shapes (D31's non-goals list is explicit about
  this).
- **Consequences:** Task 02 gains the `NoStream`/`Exact(version)` contract, the
  existence-preserving read-result shape, and `FakeEventStore` behavior/tests proving
  no side-effect stream creation on read. Task 03/04 map `Option.None` → `NoStream` and
  loaded `Option.Some` → `Exact(loadedVersion)` through the shared executor, for both
  Level 1 and Level 2 identically. D22 remains in force — this is a semantic
  improvement to intent, not a claim that the low-level provider SPI is now frozen; the
  next real-provider specification may still refine the concrete storage/revision
  representation as concrete provider constraints become known.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/persistence-boundary.md,
  areas/shared-es-execution-and-explicit-handler.md,
  tasks/02-harden-event-store-and-repository-contracts.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md,
  tasks/04-explicit-event-sourced-command-handler.md

## D30: The shared lifecycle executor is convention-agnostic — reflection discovery is not its responsibility

- **Question:** Task 03 bundles "extract the shared executor" and "harden state-method
  ambiguity resolution" into one task, and its implementation-constraints text lists the
  state-method resolution algorithm directly among the executor's own work. Read
  literally, this risks making reflection/state-method discovery — the aggregate-method
  convention's own concern — sound intrinsic to the shared lifecycle executor itself,
  which would make the executor synonymous with "the class that knows how to find and
  invoke `aggregate.Approve(command)`." A comparison against mature designs (Eventuous
  separates command/application orchestration from aggregate/state restoration from
  persistence; Wolverine demonstrates a framework-managed lifecycle without the
  application handler repeating load/version/append plumbing, independent of any one
  modeling convention) surfaced this as worth confirming explicitly, consistent with
  D17's own principle. Should the specification leave this ambiguous, or state
  explicitly that the executor depends on a supplied decision mechanism rather than
  performing reflection itself?
- **Options considered:** Leave the current task 03 wording as-is (reflection resolution
  described as the executor's own implementation work) | State explicitly that the
  executor owns lifecycle orchestration only, and depends on/invokes an existing
  decision abstraction (already `IDecider`/`IDeciderRegistry` in current code, per
  `DeciderCommandHandler.HandleAsync`'s own structure) supplied by the aggregate-method
  convention path, without introducing any new abstraction | Go further and design a
  general pluggable decision-strategy hierarchy (`IDecisionStrategy`,
  `IMutableAggregateStrategy`, `IFunctionalDeciderStrategy`, etc.) so future modeling
  styles can register themselves.
- **Decision:** The second option. The shared executor owns: load stream/rehydrate,
  invoke the aggregate-aware authorization hook, invoke a supplied decision operation,
  append using the correct expected stream state, synchronous publish ordering, and
  error propagation. It does **not** own reflection/discovery or choosing the
  state-specific decision method — that remains the aggregate-method convention's own
  concern (already separated in current code: `AggregateDecider`/`AggregateEvolver`
  perform the reflection, `IDecider`/`IEvolver` are what the orchestration layer
  actually depends on). The most-specific-wins resolution algorithm task 03 already
  specifies is hardening to the *convention's own* discovery logic
  (`AggregateDecider`/`AggregateEvolver`), not new responsibility added to the
  executor class itself — task 03's own diff should keep this boundary visible in the
  code structure it lands, even though both changes are still delivered in one task
  (per the "prefer modifying existing tasks" instruction). **The third option — any
  speculative decision-strategy/plugin hierarchy — is explicitly rejected.** No such
  type is introduced in this change.
- **Rationale:** Owner: "this is mainly a contract/code-boundary guardrail, not a
  request for another abstraction framework... D17 remains exactly the right
  principle... use the smallest current-code boundary that achieves this." Current code
  already has the right shape (`IDecider`/`IDeciderRegistry`/`IEvolver` as the
  orchestration layer's dependency, `AggregateDecider`/`AggregateEvolver` as the
  reflection-performing implementations) — this decision is about not regressing that
  shape while hardening it, not about building something new.
- **Consequences:** Task 03's own text is clarified so a reader cannot conclude the
  executor performs reflection — the acceptance requirement is architectural: reflection/
  state-method discovery must not be a responsibility intrinsic to the shared lifecycle
  executor. No new type is introduced. Level 1 stays exactly as ergonomic as before (no
  added boilerplate merely to make the separation visible). Level 2 stays
  framework-managed and may still delegate to the same convention decision mechanism
  (D1, D24 unaffected).
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  tasks/03-es-command-executor-and-ambiguity-resolution.md

## D31: An explicit Event Sourced handler manages exactly one Event Sourced write target

- **Question:** Level 2's explicit handler may use DI, call external services, and load
  read-only facts before deciding — but the specification did not previously state
  whether the framework-managed append/version/concurrency lifecycle that handler
  participates in could, now or later, be stretched to cover more than one Event
  Sourced aggregate stream in a single command execution. Left unstated, this could
  gradually turn Level 2 into a hidden multi-aggregate transaction coordinator, which
  none of the reference designs reviewed (Eventuous, Marten/Wolverine, Equinox) treat as
  part of their own core command/aggregate lifecycle — that capability belongs to a
  saga/process-manager/workflow layer in all of them. Should this specification state
  a boundary now, and if so, where does a genuinely multi-aggregate use case belong
  instead?
- **Options considered:** Leave it unstated, let a future task/implementation decide
  whether Level 2 can span multiple aggregate writes | State explicitly that the shared
  executor (and therefore Level 2) manages exactly one target aggregate stream per
  command execution, and name where genuine multi-aggregate orchestration belongs
  instead | Design a multi-aggregate atomic write capability now, since the executor
  already manages append/version/concurrency for one stream.
- **Decision:** The second option. The shared Event Sourced executor manages one target
  aggregate stream for one command execution. An explicit Level 2 handler may read
  external services/facts/policies via DI before deciding — that's unrestricted — but
  the framework-managed write lifecycle (append/version/concurrency) it participates in
  covers only that one stream. A use case genuinely needing writes to two or more
  independently-versioned Event Sourced aggregate streams, cross-aggregate
  orchestration, or saga-like coordination belongs to Level 3 (ordinary
  `ICommandHandler<T>`, full application-owned orchestration) today, or to a future
  dedicated saga/process-manager/workflow capability — never designed or implemented in
  this specification.
- **Rationale:** Owner: "clarify this now so Level 2 does not gradually become a hidden
  transaction coordinator... it is fine for Level 2 to *read* information from
  elsewhere; the restriction concerns the write lifecycle the executor manages." Stating
  the boundary now costs nothing (no code change, no new type) and keeps Level 2's
  expected-version/concurrency semantics understandable as the change actually ships,
  rather than leaving an implementer to guess whether "just one more `AppendEventsAsync`
  call in the same handler" is in-scope.
- **Consequences:** `docs/usage/event-sourcing.md` (task 11) documents this explicitly
  as part of the Level 1/2/3 "when to use each" guidance — Level 3 is named as where
  multi-aggregate write orchestration belongs, not framed as a lesser or "non-Event-
  Sourced" option. `docs/development/event-sourcing.md` (task 12) states the same
  boundary for maintainers. No multi-aggregate atomic-write capability, saga/process-
  manager/workflow capability, or automatic-retry-after-conflict behavior is
  implemented anywhere in this change.
- **Date:** 2026-08-11
- **Affected artifacts:** overview.md, tasks/04-explicit-event-sourced-command-handler.md,
  tasks/11-user-facing-event-sourcing-guide.md,
  tasks/12-internal-event-sourcing-architecture-docs.md
