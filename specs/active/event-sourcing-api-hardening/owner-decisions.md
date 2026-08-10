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
  04-05).
- **Date:** 2026-08-08 (input document date; recorded 2026-08-10)
- **Affected artifacts:** overview.md, areas/shared-es-execution-and-explicit-handler.md,
  tasks/04-es-command-executor-and-ambiguity-resolution.md,
  tasks/05-explicit-event-sourced-command-handler.md

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
- **Consequences:** Drives task 04's deterministic resolution algorithm and its
  ambiguity-error acceptance criteria.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/shared-es-execution-and-explicit-handler.md,
  tasks/04-es-command-executor-and-ambiguity-resolution.md

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
  confirms the gap this decision closes. Drives task 06.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/handler-registration-and-options.md,
  tasks/06-primary-fallback-handler-roles.md

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
  both gaps are closed by task 07. Because `NEvo.Ddd.EventSourcing` is documented
  `status: experimental` and unreleased, changing `AddEventSourcing`'s signature is not
  treated as a compatibility-sensitive breaking change requiring a migration path.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/handler-registration-and-options.md,
  tasks/07-event-sourcing-registration-options.md

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
  task 08.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/authorization-integration.md,
  tasks/08-message-level-and-aggregate-authorization.md

## D6: Event Store / Aggregate Repository boundary — separate stream persistence from rehydration, remove projection loading from the repository

- **Question:** How should the persistence boundary be cleaned up ahead of a future real
  provider, without implementing one now?
- **Decision:** A low-level stream-persistence abstraction (`IEventStreamStore` or
  similar) handles read/append/expected-version only. `IAggregateRepository` (or its
  refined equivalent) handles obtaining a stream, rehydrating/evolving, and returning
  current state + version — it must not become a projection repository. Minimum event
  envelope additions only (stable EventId, stream identity, version, payload/type,
  correlation/causation if an obvious source exists). No global position/checkpoint
  machinery. `AppendAsync` must not be assumed to own the final application transaction
  commit.
- **Rationale:** Sets up the next persistence specification (real providers) without
  redesigning public aggregate/command APIs again, per the input document's explicit
  purpose for this change.
- **Consequences:** Discovery found `IAggregateRepository` already mixes stream
  persistence, rehydration, **and** `LoadProjectionAsync` (real implementation throws
  `NotImplementedException`, `IAggregateRepository.cs:72-75`) — task 03 removes the
  projection responsibility from the repository per this decision. Discovery also found
  `IMessageContext.Headers.CorrelationId`/`CausationId`
  (`NEvo.Messaging/Context/MessageContextHeaders.cs:19-56`) already exist as the
  "obvious source" this decision references for optional correlation/causation
  envelope fields — no new correlation mechanism needs inventing.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/persistence-boundary.md,
  tasks/03-harden-event-store-and-repository-contracts.md

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
  clause. Drives task 09.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/http-query-endpoint.md,
  tasks/09-map-query-endpoint-and-get-binding.md

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
  already stale, consistent with removing it. Drives tasks 10-11.
- **Date:** 2026-08-08 (recorded 2026-08-10)
- **Affected artifacts:** areas/documents-example-service.md,
  tasks/10-create-documents-example-project.md,
  tasks/11-documents-example-es-and-auth-demo.md

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
  `tests/NEvo.Ddd.EventSourcing.Tests` (tasks 01/03/04), not by the example.
  This is a narrower scope than Scope 10's acceptance-criteria list in the original
  input document — see `overview.md` § "Compatibility and migration" note on this
  scope reduction.
- **Rationale:** Owner: defer example-service integration tests to a follow-up
  specification rather than adding a new test project now.
- **Consequences:** Task 11 (`documents-example-es-and-auth-demo`) is verified by
  `dotnet build` plus a documented manual walkthrough, not `dotnet test` against a new
  project.
- **Date:** 2026-08-10
- **Affected artifacts:** areas/documents-example-service.md,
  tasks/11-documents-example-es-and-auth-demo.md, overview.md

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
  directly on task 01 (`fix-build-and-characterize-baseline`). All subsequent tasks are
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
