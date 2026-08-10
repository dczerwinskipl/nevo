---
id: spec.event-sourcing-api-hardening
type: change
title: Event Sourcing API hardening and persistence readiness
status: draft
change: event-sourcing-api-hardening
---

# Event Sourcing API hardening and persistence readiness

**Refined 2026-08-10** against owner comments and an external review collected in
`nevo-event-sourcing-spec-refinement-prompt.md` (PR #20). This refinement fixed several
factual errors in the original discovery, reduced incidental scope (folder
reorganization, `ICreateAggregateCommand` wiring), resolved the Query GET-binding
question concretely instead of deferring it, strengthened the persistence-envelope and
concurrency-semantics wording, split documentation into a first-class user-facing
deliverable plus the original internal one, and added an explicit compatibility
constraint preserving room for future aggregate-modeling styles. See
`owner-decisions.md` (D15-D18) for the specific changes and their rationale; D10/D11
are marked superseded there rather than deleted, for audit trail.

## Context

NEvo has an experimental Event Sourcing model (`NEvo.Ddd.EventSourcing`,
`docs/development/event-sourcing.md`: `status: experimental`) on branch
`feature/event-sourcing-api-hardening` (created off `feature/event-sourcing`/PR #10,
`main` already merged in) that already provides an attractive developer experience:
commands discovered on concrete aggregate-state types, event replay/evolution, and
hidden load→decide→append plumbing. Before real persistence providers, projections,
checkpoints, or stronger inbox/outbox integration are built on top of it, this change
hardens the current API — command-handling levels, handler registration semantics,
authorization integration, the Event Store/repository boundary, and the HTTP Query
endpoint surface — so the next persistence specification does not need to redesign
public aggregate/command APIs again.

This is deliberately a middle step, not a production-grade Event Sourcing stack. The
recently added Query support and handler-registration hardening
(`specs/archive/query-support-and-handler-registration-hardening/`, merged to `main`)
must be preserved and integrated with this work, not replaced.

## Current architecture

Grounded in repository discovery (file:line citations; four parallel read-only research
passes, a live `dotnet build`, and — during spec-refine — a re-verification pass that
corrected two factual errors and closed one open design question with empirical
evidence):

**Aggregate model & decision dispatch.** Aggregate state is already multiple concrete
types (`Document` → `EditableDocument`/`ApprovedDocument`,
`tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs:5,30,55`).
`AggregateEvolver.Evolve` (`Evolving/AggregateEvolver.cs:30-39`) is already pure `State +
Event -> NewState` with no I/O/DI. Decider/evolver method resolution is reflection-based,
matched by signature shape (`AggregateDeciderExtractor.cs:36-51`), not attributes. **Gap:**
both `AggregateDecider.GetDeciderDelegate` (`Deciding/AggregateDecider.cs:25-35`) and
`AggregateEvolver.GetEvolverDelegate` (`Evolving/AggregateEvolver.cs:41-55`) filter
candidates by `IsAssignableFrom` and take LanguageExt `.ToOption()`'s first match — no
specificity ranking, no ambiguity detection. `ICreateAggregateCommand<TAggregate,TId>`
(`ICreateAggregateCommand.cs:3-6`) is declared but never referenced in production code —
create-vs-mutate is inferred purely from `Option<TAggregate>` being `None`/`Some`.
**This specification does not change that (D16)** — the marker interface remains
untouched, recorded as known unused scaffolding for a future change to pick up only if
a concrete need materializes. `DeciderCommandHandler.HandleAsync`
(`Handling/DeciderCommandHandler.cs:14-34`) does load → decide → append; it does not
itself re-evolve state after append.

**Persistence boundary.** `IAggregateRepository` (`IAggregateRepository.cs:5-18`) already
mixes stream append/load, aggregate rehydration, **and** `LoadProjectionAsync` (the real
implementation throws `NotImplementedException`, lines 72-75). `IEventStore` is the
lower-level stream abstraction; only implementation is in-memory `FakeEventStore`.
`IAggregateRepository.AppendEventsAsync`/`IEventStore.AppendEventsAsync` already return
`EitherAsync<Exception, Unit>` (`IAggregateRepository.cs:7,22`) — an expected-version
mismatch already flows through `Either`'s `Left`, **never a thrown CLR exception**:
`FakeEventStore.AppendEventsAsync` (`ServiceCollectionExtensions.cs:20-22`) already
demonstrates this — `return new Exception(...)`, a plain `return`, not a `throw`. This
specification's hardening changes only the exception *type* used (a dedicated
`AggregateConcurrencyException`), never the return-vs-throw shape (D13, corrected
2026-08-10). The event envelope carries only `Id`/`CreatedAt` (from `Message`) plus
`StreamId` — no correlation/causation/global-position field on the event itself, but
`IMessageContext.Headers.CorrelationId`/`CausationId`
(`Context/MessageContextHeaders.cs:19-56`) already exist as an obvious source if needed.
`AddEventSourcing(params Type[])` (`ServiceCollectionExtensions.cs:39-61`) wires the
convention path unconditionally, with no options object (`// TODO: add provider?` at
line 56), and registers `IMessageHandlerProvider` with plain `AddSingleton`, not `TryAdd`
— unlike `AddCommands`/`AddEvents`/`AddQueries` after the recent query-support hardening.

**Handler registration / authorization.** `MessageHandlerDescription`
(`NEvo.Messaging/Handling/IMessageHandler.cs:8`) has no role/kind/priority field.
Duplicate detection is a pure `MessageType`-keyed count in `MessageHandlerRegistry` — a
decider-based ES handler and a plain `ICommandHandler<TCommand>` registered for the same
command **already collide and throw `MoreThanOneHandlerFoundException`** today, with no
way to prefer one. `ValidatePermissionMiddleware` reads `[AllowPermission]`
**exclusively from `HandlerDescription.Method`**
(`NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:17`), which is
method-targeted only; `DeciderCommandHandlerProvider` leaves `Method` `null` — so **an ES
convention-routed command today receives zero permission enforcement**, silently. No
message-level permission attribute placement, no requirement composition, and no
aggregate/resource-aware authorization extension point exist anywhere today.

**Flush/visibility semantics — corrected during spec-refine (review issue 3).** The
original discovery claimed no "flush"/`SaveChanges` primitive exists anywhere in the
repository. This was factually wrong. `DbContext.SaveChangesAsync()` already **is** the
repository's flush mechanism, already used exactly this way by
`EntityFrameworkMessageInbox.RegisterProcessedAsync`/
`EntityFrameworkMessageOutbox.SaveMessageAsync`
(`src/NEvo.Messaging.EntityFramework/`) — both call it inline, once per call, enlisting
in the ambient `TransactionScope` without committing it
(`docs/development/transaction-model.md` § "Transaction ownership": "Whether a handler
calls `SaveChangesAsync()` on its own `DbContext` is entirely up to that handler's
implementation; NEvo does not impose or coordinate a single save point"). Synchronous
dispatch re-enters `IMessageProcessor.ProcessMessageAsync` under the same ambient
`TransactionScope` (`InternalSyncProcessDispatchStrategy.cs:8-9`). The ES executor
(task 03) does not need to invent a new primitive — it orders its own append (and, for a
future `DbContext`-backed store, its own `SaveChangesAsync()` call, following the
established inbox/outbox pattern exactly) before this re-entrant dispatch.

**HTTP/Query.** `MapCommandEndpoint<TCommand>` (`RoutesExtensions.cs:46-65`) returns
`RouteHandlerBuilder`, binds via implicit body, uniformly maps `Left` → `Results.Problem(
..., 500)`, and contains two leftover `Console.WriteLine` calls (lines 54-55) alongside
the `ILogger<T>` convention used elsewhere. `Query<TResult> : Message<TResult>` carries
only inherited `Id`/`CreatedAt`. TFM is `net9.0` repo-wide
(`Directory.Build.props:3`); `[AsParameters]`/`BindAsync`/`IBindableFromHttpContext` are
available but unused anywhere today. **Resolved during spec-refine (D18)**: the original
specification hedged on whether `[AsParameters]` binding would require `Id`/`CreatedAt`
as GET parameters, allowing a `Query<TResult>` contract change "if genuinely necessary."
This was verified empirically rather than left open — a disposable ASP.NET Core 9 probe
mirroring the real `Message`/`Message<TResult>`/`Query<TResult>` hierarchy confirmed
that `[AsParameters]` binds a concrete Query record's own single public constructor
only; inherited `Message` properties are never part of that constructor and are never
bound or required. **No `Query<TResult>`/`Message<TResult>` contract change is needed.**
`GetDocumentQuery` is hand-wired via `IQueryDispatcher` in `Routes.cs:20-27` and
branches `DocumentNotFoundException` → 404 — a distinction a generic `MapQueryEndpoint`
will not reproduce by default.

**ExampleApp.** The Document example lives inside `ServiceA.Api` but its types are
declared in namespace `NEvo.Ddd.EventSourcing.Tests.Mocks`
(`ExampleDomain/Documents/Document.cs:3`) — the example currently borrows
test-fixture-shaped code rather than owning its own domain namespace. Only two states
exist (`EditableDocument`/`ApprovedDocument`, no `ReturnedDocument`). No permission
metadata and no tests exist on any Document command/handler/query.

**Critical fact: the branch does not currently build.** `dotnet build NEvo.sln` fails
with 5 errors: `InMemoryDocumentEventStore` does not implement the current
`IEventStore.AppendEventsAsync`/`LoadEventsStreamAsync` (CS0535) — confirming it is
already stale against the versioned interface, consistent with its own header comment
calling it a workaround pending PR #10; and three test files
(`AggregateEvolverTests.cs:14,35`, `AggregateDeciderEvolverIntegrationTests.cs:21`) fail
with CS9174 — `new AggregateEvolver([typeof(Document)])` cannot construct
`IOptions<AggregateExtractorConfiguration>` from a collection expression, since
`AggregateEvolver`'s only constructor takes `IOptions<AggregateExtractorConfiguration>`
directly (`AggregateEvolver.cs:15`) — these tests predate a constructor-signature change
and were never fixed.

## Problem

The current Event Sourcing implementation cannot safely host a real persistence provider
yet: handler registration cannot distinguish an intentional convention fallback from an
accidental duplicate handler; authorization silently does not run for the convention
route; the repository mixes stream persistence with rehydration and (unfinished)
projection loading; there is no options surface to disable the convention route; there
is no ergonomic HTTP Query mapping to match the existing Command mapping; and the
current documentation neither reflects the hardened design nor gives a NEvo user a
task-oriented path to using Event Sourcing without reading framework source. The branch
also does not currently compile.

## Constraints

- `docs/development/package-boundaries.md`: dependencies flow downward only.
  `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Cqrs` is explicitly flagged as an
  unresolved question by that document and by `docs/development/event-sourcing.md` —
  **this specification does not change the dependency (D15)**; a folder-level
  reorganization was considered and rejected as incidental scope during spec-refine (see
  "Architectural principles" below and D15/D16 in `owner-decisions.md`).
- `docs/development/coding-conventions.md`: `Either<Exception, T>` for fallible
  operations — a concurrency conflict is always **returned**, never thrown (D13); `TryAdd*`/
  `TryAddEnumerable` for idempotent DI registration, matching the precedent already set
  by the archived query-support change.
- `docs/development/testing-strategy.md`: characterization tests before changing existing
  behavior (task 01 is a hard prerequisite for every other task).
- `docs/development/event-sourcing.md`: `status: experimental` — "should not drive
  refactoring of other modules"; this change treats it as the thing being hardened, not
  as an established pattern to propagate elsewhere.
- No production PostgreSQL/Marten/Kurrent provider, no persisted projections, no
  subscription/checkpoint machinery, no snapshotting, no event upcasting, no distributed
  transaction coordination, no inbox/outbox redesign, no new permission DSL, no universal
  HTTP error-mapping framework, no folder/namespace reorganization, no speculative
  multi-modeling-style abstraction — see "Out of scope".

## Affected modules

- `src/NEvo.Ddd.EventSourcing/` (hardened repository/store contracts; shared ES
  executor; explicit handler; Primary/Fallback registration; options — **no folder
  reorganization**, D15)
- `src/NEvo.Messaging.Authorization/` (message-level permission attribute placement,
  requirement composition, aggregate-aware authorization extension point)
- `src/NEvo.Messaging.Web/` (`MapQueryEndpoint`, `RoutesExtensions` cleanup)
- `src/NEvo.Messaging/Handling/` (`MessageHandlerDescription` role metadata, if the
  chosen design requires a field there rather than a wrapping concept — task 05
  determines the smallest coherent change)
- `examples/ExampleApp/NEvo.ExampleApp.Documents.Api/` (new project)
- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/` (Document domain removed)
- `tests/NEvo.Ddd.EventSourcing.Tests/` (characterization + new coverage)
- `docs/usage/event-sourcing.md` (**new** — first-class user-facing guide, task 11),
  `docs/usage/README.md`, `docs/usage/queries.md`, `docs/usage/choosing-packages.md`,
  `docs/usage/example-app-walkthrough.md`
- `docs/development/event-sourcing.md` (internal architecture rewrite, task 12),
  `docs/development/messaging-pipeline.md` (also has pre-existing stale content found
  during discovery — see task 12)

## Options and trade-offs

The command-handling model, registration semantics, persistence boundary, authorization
integration, and HTTP mapping approach are owner-supplied direction (D1-D9,
`owner-decisions.md`) from the originating specification brief, not independently
re-derived options in this document. Genuine options were presented and resolved
interactively for the four gaps the brief did not cover — package-dependency handling
(D10, superseded by D15), the unused `ICreateAggregateCommand` marker (D11, superseded
by D16), the example service's test strategy (D12), and the concurrency-conflict error
shape (D13) — plus one tooling conflict, branch targeting (D14). A subsequent
spec-refine pass (this document's current state) resolved one further open design
question with empirical evidence (D18 — Query GET binding) and reduced scope per
external review (D15, D16) rather than presenting it as a fresh option set, since the
review itself supplied the direction. See `owner-decisions.md` for full details.

## Owner decisions

See `owner-decisions.md` (D1-D18; D10 and D11 are superseded by D15 and D16
respectively — kept for audit trail, not deleted).

## Proposed architecture

1. **Characterize the baseline.** Task 01 fixes the branch's current 5 compile errors
   and writes characterization tests for today's decider/evolver/repository/
   registration behavior — **no folder reorganization and no `ICreateAggregateCommand`
   wiring follow it** (D15, D16 — both were removed from scope during spec-refine as
   incidental to this specification's actual goal).
2. **Persistence boundary.** Task 02 separates stream persistence
   (`IEventStreamStore`) from aggregate rehydration (`IAggregateRepository`, projection
   loading removed), adds the minimum event envelope fields (keeping the domain event
   payload and persisted-envelope metadata conceptually distinct), introduces a
   dedicated `AggregateConcurrencyException` **returned** via `Either` (D13), and
   documents transaction/commit-ownership constraints (D6, D7 corrected) plus the
   modeling-style-agnostic compatibility constraint (D17).
3. **Shared ES execution + explicit handler.** Task 03 extracts the shared
   load→authorize→decide→append→publish executor with the full ordering semantics (D1,
   D2, D7) and the deterministic most-specific-state-wins resolution (D2), itself
   agnostic to aggregate modeling style (D17). Task 04 adds the explicit
   `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` (Level 2, D1), reusing task
   03's executor and Level 1's own decision-method discovery.
4. **Registration semantics.** Task 05 adds Primary/Fallback role metadata and the
   configuration-error rules (D3), with explicit regression coverage proving Query
   resolution and Event fan-out are unaffected (review issue 6). Task 06 adds
   `AddEventSourcing(options => {...})` with the aggregate-method-convention-as-fallback
   toggle, enabled by default (D4), and fixes the non-idempotent `AddSingleton`
   registration found in discovery.
5. **Authorization.** Task 07 fixes `ValidatePermissionMiddleware`'s
   `HandlerDescription.Method`-only assumption for the ES fallback route, adds
   message-level permission-attribute placement with AND composition against
   handler-specific requirements, and adds the new aggregate-aware authorization
   extension point (D5).
6. **HTTP Query mapping.** Task 08 adds `MapQueryEndpoint<TQuery, TResult>` using
   `[AsParameters]` — resolved concretely, not an open question (D18) — and cleans up
   the leftover `Console.WriteLine` calls found in `RoutesExtensions` (D8).
7. **Documents example service.** Task 09 creates `NEvo.ExampleApp.Documents.Api`,
   moves the Document domain into its own namespace, and removes
   `InMemoryDocumentEventStore`. Task 10 wires Level 1 + Level 2 handling, permission
   metadata, aggregate-aware authorization, and both HTTP mappings into the new service,
   verified manually (D9, D12).
8. **Documentation — two first-class deliverables (strengthened during spec-refine).**
   Task 11 writes `docs/usage/event-sourcing.md`, a comprehensive user-facing guide (per
   the existing `docs/usage/*.md` flat-file convention) covering configuration,
   modeling, all three command-handling levels with explicit "when to use each"
   guidance, authorization, persistence/concurrency, and the Query/read side — with an
   explicit list of reader questions the guide must answer, not an "update docs where
   appropriate" note. Task 12 rewrites `docs/development/event-sourcing.md` for
   maintainers and corrects the three stale `messaging-pipeline.md` statements found
   during discovery.

## Architectural principles (reinforced during spec-refine)

**Aggregate modeling style is a supported default, not the Event Sourcing core's
permanent definition (D17).** The currently implemented style — object-oriented,
immutable aggregate state, decision methods discovered on concrete state types — is the
one this specification hardens and documents. It is not, however, baked into the
hardened contracts as the *only* possible future style: `IEventStreamStore`/
`IAggregateRepository` (task 02) and the shared executor (task 03) are designed so
nothing in their public shape requires the caller's next state to come from an instance
method on an immutable object. This is a **documented compatibility constraint**, not a
new abstraction — no `IDecisionStrategy`/`IMutableAggregateStrategy`/
`IFunctionalDeciderStrategy` hierarchy is introduced in this change, because no current
code demonstrates a concrete need for one. The constraint costs nothing to implement
correctly and prevents this hardening pass from foreclosing a future mutable or
static/functional modeling style for free.

## Compatibility and migration

`NEvo.Ddd.EventSourcing` is documented `status: experimental` and has not reached `main`
— this change treats its public surface as not yet compatibility-sensitive. Expected
breaking changes within this still-unreleased package: `AddEventSourcing`'s signature
(D4), `IAggregateRepository`/`IEventStore` member shape (D6), a new
`AggregateConcurrencyException` replacing a plain `Exception` for concurrency conflicts
— returned via `Either`, never thrown (D13), and `MessageHandlerDescription`'s shape if
task 05 requires a new field (D3). None of these affect `NEvo.Messaging`/
`NEvo.Messaging.Cqrs`'s existing public surface, which this change does not alter
outside the new message-level permission-attribute placement and `MapQueryEndpoint`
addition (both additive) — and, per D18, **not** `Query<TResult>`/`Message<TResult>`,
which are confirmed unchanged.

Scope reductions from the originating brief, both from spec-refine: D12 narrows Scope
10's "at least in tests" requirement to manual walkthrough for the example service
itself, with version/concurrency behavior covered by `tests/NEvo.Ddd.EventSourcing.Tests`
unit tests instead — a follow-up specification is expected to add example-service
integration tests. D15/D16 remove the folder/namespace reorganization and
`ICreateAggregateCommand` wiring that were originally in task 02's scope — external
review found neither required by any actual task in this change.

## Areas

- `areas/characterization-and-baseline.md` — fix the current build, characterize
  existing behavior (task 01). No reorganization, no `ICreateAggregateCommand` wiring
  (D15, D16).
- `areas/persistence-boundary.md` — Event Store/repository contract hardening,
  concurrency exception (returned, never thrown), event envelope, D17 constraint (task
  02).
- `areas/shared-es-execution-and-explicit-handler.md` — the shared executor, ambiguity
  resolution, the explicit Level 2 handler, and the D17 constraint (tasks 03-04).
- `areas/handler-registration-and-options.md` — Primary/Fallback roles, ES registration
  options, and explicit non-ES regression coverage (tasks 05-06).
- `areas/authorization-integration.md` — message-level, handler-specific, and
  aggregate-aware authorization (task 07).
- `areas/http-query-endpoint.md` — `MapQueryEndpoint` and GET binding, resolved via
  `[AsParameters]` (D18) (task 08).
- `areas/documents-example-service.md` — the dedicated example service (tasks 09-10).
- `areas/user-facing-documentation.md` — the first-class `docs/usage/event-sourcing.md`
  guide (task 11).
- `areas/internal-documentation.md` — maintainer-facing architecture documentation
  (task 12).

## Change-wide acceptance criteria

1. `dotnet build` succeeds across the whole solution (it does not today).
2. A command handled only by the aggregate-method convention (no Primary registered)
   succeeds through the shared executor.
3. An explicit Event Sourced handler or an ordinary `ICommandHandler<T>` registered
   alongside the convention route for the same command is used in preference to the
   convention route; two Primary handlers for the same command fail as a configuration
   error.
4. A command supported by two aggregate state types resolves to the most-specific
   runtime type; two equally-specific candidates fail deterministically.
5. Disabling the aggregate-method convention leaves a command with only a convention
   handler unroutable (no handler found), while explicit/ordinary handlers remain
   usable.
6. A stream-version mismatch on append is **returned** as
   `Either<Exception, Unit>.Left` containing `AggregateConcurrencyException` — never
   thrown.
7. The source event is appended/persisted before a synchronous domain-event handler
   triggered by the same command runs; that handler reloading the aggregate sees the new
   state.
8. Message-level permission is enforced for a command handled through the convention
   fallback route (it is not enforced today).
9. Handler-specific authorization requirements compose as AND with message-level
   requirements, never as a silent override.
10. Aggregate-aware authorization runs after rehydration and before the decision; a
    denial prevents append/decision side effects.
11. `MapQueryEndpoint<TQuery, TResult>` binds a representative query via `[AsParameters]`
    from route and query-string values, without requiring a GET body, and without
    `Id`/`CreatedAt` becoming required parameters (D18); it returns a
    `RouteHandlerBuilder` chainable with `.RequireAuthorization()`.
12. The Documents example service demonstrates create/change/approve/query end to end,
    reload-after-write reconstructing the correct concrete state, and both HTTP mappings
    — verified manually per D12.
13. Query handler resolution, Event fan-out, and every existing `AddCommands`/
    `AddEvents`/`AddQueries` idempotency guarantee are unaffected by the Primary/
    Fallback change (review issue 6).
14. Neither the hardened repository/store contracts nor the shared executor require the
    aggregate's next state to come from an instance method on an immutable object
    (D17) — a documented constraint, not a new abstraction.
15. `docs/usage/event-sourcing.md` exists and answers every "required reader question"
    listed in task 11 without requiring framework source; `docs/development/
    event-sourcing.md` is rewritten for maintainers (task 12); neither document presents
    an unimplemented capability (mutable aggregates, functional deciders, persisted
    projections) as available.
16. `node tools/specs.mjs validate` and `node tools/docs.mjs validate` pass.

## Verification strategy

`dotnet build` across the solution after every task; `dotnet test` across
`tests/NEvo.Ddd.EventSourcing.Tests` (and any other test project a task's own
"Verification" section names) after every task touching it; `node tools/specs.mjs
validate`; `node tools/docs.mjs validate` for tasks touching docs; manual walkthrough of
the Documents example service (task 10, per D12) covering create → change → approve →
query and a version-conflict scenario.

## Out of scope

Everything the originating specification brief marked non-goal: a production
PostgreSQL/Marten/Kurrent Event Store provider, persisted projections, an asynchronous
projection daemon, global event-log subscriptions, projection checkpoints/rebuilds,
multi-stream projections, aggregate snapshots, event upcasting/schema migration,
distributed transaction coordination, cross-store exactly-once guarantees, inbox/outbox
persistence redesign (beyond a strictly-required minimal compatibility touch, flagged if
found), saga/process-manager redesign, a complete permission DSL, a complete new
validation framework, and a universal REST/HTTP error-mapping framework. Also out of
scope, from the original owner-decision round: a dedicated test project for the
Documents example service (D12). Also out of scope, added during spec-refine: any
folder/namespace reorganization of `NEvo.Ddd.EventSourcing` (D15); wiring
`ICreateAggregateCommand<TAggregate,TId>` into any resolution logic (D16); a speculative
multi-modeling-style strategy abstraction (`IDecisionStrategy` or similar) — the D17
constraint is documentation-only, not a new type; mutable-aggregate or static/functional
decider implementations; any speculative "how to implement projections" documentation.
