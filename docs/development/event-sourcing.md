---
id: development.event-sourcing
type: development
title: Event sourcing
status: experimental
read_when:
  - working on NEvo.Ddd.EventSourcing
  - implementing a real IEventStreamStore provider
  - adding a new aggregate decision-method parameter type
  - modifying handler registration, Primary/Fallback resolution, or aggregate-aware authorization
summary: >
  Maintainer-facing architecture of NEvo.Ddd.EventSourcing after the API-hardening
  change: the executor's lifecycle, convention discovery and decision-method parameter
  injection, Primary/Fallback registration, the store/repository boundary and
  concurrency model, the authorization ownership split, and the compatibility
  constraints a future persistence/modeling specification must not violate.
related:
  - development.messaging-pipeline
  - development.package-boundaries
  - development.transaction-model
---

# Event sourcing

## Status

Split status, stated precisely rather than as one blanket label: the **command-handling,
registration, and authorization API surface is hardened** by
`specs/active/event-sourcing-api-hardening/` (executor lifecycle, Primary/Fallback
roles, decision-method parameter injection, aggregate-aware authorization, typed
403 mapping) and is safe to build on. The **persistence layer stays experimental** — the
only `IEventStreamStore` implementation is an in-memory `FakeEventStore`
(`src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs:12-81`); no real
PostgreSQL/Marten/Kurrent-style provider ships in this repository. Do not use the
absence of a real provider as a reason to redesign the now-hardened API surface — the
next persistence specification is expected to implement `IEventStreamStore` against the
existing contract, not change it wholesale (see "Compatibility constraints for future
work" below).

For the consumer-facing "how do I use this" guide, see
[`docs/usage/event-sourcing.md`](../usage/event-sourcing.md) — this document covers
implementation architecture instead, deliberately not task-oriented guidance.

## Subsystem responsibility

`NEvo.Ddd.EventSourcing` gives an aggregate two things to implement and nothing else: a
**decider** (command [+ current state] → domain events) and an **evolver** (state +
event → next state). Everything else — loading/replaying a stream, resolving which
decision/evolution method applies, appending, and publishing — is this package's job.
Decider-backed commands dispatch through the normal `NEvo.Messaging` pipeline exactly
like any other command; this package supplies `IMessageHandlerProvider`/
`IMessageHandlerFactory` implementations, not a parallel dispatch path.

## The executor: shared lifecycle, convention-agnostic

`EventSourcedCommandExecutor.ExecuteAsync`
(`src/NEvo.Ddd.EventSourcing/Executing/EventSourcedCommandExecutor.cs:11-24`) is the one
lifecycle both command-handling levels (below) go through:

```
load (IAggregateRepository.LoadAggregateAsync)
  -> aggregate-aware authorization (IAggregateAuthorization.AuthorizeAsync)
  -> decide (a Func<Option<TAggregate>, EitherAsync<...>> supplied by the caller)
  -> append (IAggregateRepository.AppendEventsAsync, ExpectedStreamState computed by the executor)
  -> synchronous publish (IEventPublisher, one event at a time, first failure short-circuits)
```

`decide` is a delegate parameter, not something the executor derives itself — this is
what makes the executor equally usable by the aggregate-method convention (Level 1,
`DeciderCommandHandler.HandleAsync` supplies `decider.DecideAsync` as `decide`,
`src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs:19-28`) and by an explicit
`IEventSourcedCommandHandler<...>` (Level 2, `EventSourcedCommandHandlerAdapter`
supplies `handler.HandleAsync` as `decide`,
`src/NEvo.Ddd.EventSourcing/Handling/EventSourcedCommandHandlerAdapter.cs:39-45`). Both
routes get load/authorize/append/publish for free and neither can bypass the aggregate-
aware authorization hook.

**The executor performs no reflection and no state-method discovery itself** (D30) —
that responsibility lives entirely in `AggregateDecider`/`AggregateEvolver` (next
section). This is a deliberate separation, not an accident of how the code happened to
be organized: the executor depends on/invokes only the `IDecider`/`IEvolver` shape those
types already implement, so a hypothetical future non-reflection-based modeling style
could in principle supply its own `IDecider`/`IEvolver` implementation without requiring
any change to the executor's lifecycle code. **No such alternative modeling style exists
today** — this is a documented compatibility property of the boundary, not an announced
feature (see "Compatibility constraints for future work").

**Expected-stream-state mapping.** The executor derives `ExpectedStreamState` from the
loaded state it already has, once, in `AppendAndPublish`
(`EventSourcedCommandExecutor.cs:28-45`): `None -> ExpectedStreamState.NoStream`,
`Some(loaded) -> ExpectedStreamState.Exact(loaded.Version)`
(`src/NEvo.Ddd.EventSourcing/ExpectedStreamState.cs`). Both Level 1 and Level 2 get this
mapping identically because both go through this one executor — neither constructs an
`ExpectedStreamState` by hand, and no call site anywhere uses a bare integer literal to
mean "create."

**Append-before-publish ordering** is enforced structurally, not by convention: append
happens first inside `AppendAndPublish`, and publish only runs if append returned
`Right` (LanguageExt `EitherAsync`'s `from`/`select` short-circuits on the first `Left`).
A synchronous downstream handler triggered by the same command's publish therefore always
sees the just-appended state if it reloads the aggregate.

**Publish requires `Event`.** `IAggregateEvent<TAggregate, TId>` alone only guarantees a
`StreamId` — nothing stops a hand-written type from implementing it without deriving
from `NEvo.Messaging.Events.Event`. The aggregate-method convention rejects this at
discovery time (`RequireEventDerivedType`, next section); an explicit Level 2 handler has
no such compile/discovery-time check, so `PublishAllAsync`
(`EventSourcedCommandExecutor.cs:52-79`) checks again at publish time and fails with a
clear `InvalidOperationException` naming the offending type, rather than an unchecked
cast blowing up opaquely.

## Convention discovery: `AggregateDecider`/`AggregateEvolver`

`AggregateDecider` (`src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs`) is the
current implementation of **two distinct public roles**, registered as two separate
singletons of the same concrete type
(`src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs:136-137`) rather than one
instance shared via a factory alias:

- `IAggregateMethodDecider` — the stable capability an explicit Level 2 handler
  delegates to when it wants the convention's own decision logic instead of duplicating
  it.
- `IDecider` — one member of `IDeciderRegistry`'s `IEnumerable<IDecider>` collection
  (`DeciderRegistry.cs`), the general decision-mechanism abstraction the Level 1
  `DeciderCommandHandler` resolves through.

Both roles resolve through the same `GetDeciderDelegate` → `MostSpecificCandidateResolver.Resolve`
path (`AggregateDecider.cs:36-54`, `src/NEvo.Ddd.EventSourcing/MostSpecificCandidateResolver.cs`):
candidates are already filtered to "declaring type is assignable from the runtime
aggregate type," then the most-specific declaring type wins; two or more candidates tied
at the most-specific level — including two candidates sharing the exact same declaring
type — fail deterministically, naming every tied candidate. Enumeration order is never a
tiebreaker. `AggregateEvolver.GetEvolverDelegate`
(`src/NEvo.Ddd.EventSourcing/Evolving/AggregateEvolver.cs:40-58`) uses the identical
resolver for evolution methods.

**Discovery** (`AggregateDeciderExtractor.ExtractDeciders`,
`src/NEvo.Ddd.EventSourcing/Deciding/AggregateDeciderExtractor.cs`) scans every type
assignable to a registered aggregate root type, `DeclaredOnly` (so an inherited instance
method is not re-extracted once per subclass, which would otherwise produce spurious
same-declaring-type ties three or more levels deep), for public methods whose return
type is `Either<Exception, IEnumerable<TEvent>>` where `TEvent` implements
`IAggregateEvent<,>`. A candidate whose event type implements `IAggregateEvent<,>` but
does not derive from `Event` fails loudly at discovery time
(`RequireEventDerivedType`, `AggregateDeciderExtractor.cs:54-67`) instead of being
silently excluded and failing later at publish. A `static` method with no aggregate
instance is the creation decider — only invoked when no aggregate currently exists;
an instance method is invoked against the rehydrated instance. The command must be the
method's first parameter; a command parameter present but not first is a discovery-time
error (`AggregateDeciderExtractor.cs:92-99`), not a silent skip.

`AggregateDeciderProvider`/`EvolverRegistry` build the `Type -> candidates` dictionaries
once, from `AggregateExtractorConfiguration.AggregateTypes` (populated by
`AddEventSourcing`'s `Type[]` argument), and are held as singletons for the process
lifetime.

## Decision-method parameter injection

A decision method may declare additional parameters after the command — resolved
per-invocation, never cached from discovery time, and never exposing `IServiceProvider`
or a generic context bag to aggregate code.

**Where it lives.** The seam is `IDecisionMethodParameterResolver`
(`src/NEvo.Ddd.EventSourcing/Deciding/IDecisionMethodParameterResolver.cs`), implemented
by `DecisionMethodParameterResolver`
(`src/NEvo.Ddd.EventSourcing/Deciding/DecisionMethodParameterResolver.cs`) — internal to
this assembly, resolving by `ParameterInfo.ParameterType` through
`IMessageContext.ServiceProvider`, itself read at resolve-time via
`IMessageContextAccessor` (already-existing `NEvo.Messaging` infrastructure — no new
project reference). `AggregateDecider` constructs one resolver instance per
`AggregateDecider` (itself a singleton) but the resolver reads the *current invocation's*
scope on every call, not a value captured once at construction — this is what lets a
singleton-held resolver still observe the current request's DI scope instead of the root
container (`AggregateDecider.cs:20-24`).

This stays inside `AggregateDeciderExtractor`/`AggregateDecider`/`AggregateDeciderProvider`
— the convention's own discovery/invocation path — rather than the shared executor,
consistent with the executor/convention separation above (D30): parameter resolution is
part of "how the convention invokes a decision method," not part of the executor's
generic lifecycle.

**Resolution order and failure semantics** (`AggregateDeciderExtractor.ResolveArguments`,
`AggregateDeciderExtractor.cs:180-202`): argument `0` is always the command; each
subsequent parameter is resolved in declaration order via
`parameterResolver.Resolve(parameters[index])`, short-circuiting to `Left` on the first
failure. The decision method is **never invoked** unless every declared parameter
resolved successfully — there is no partial invocation and no `null`/default value ever
passed for an unresolved parameter.

**The required-contextual-dependency invariant (D44).** A required dependency must be
resolved *and validated* during resolution/activation, not lazily once the decision
method is already running. `DecisionMethodParameterResolver.Resolve` distinguishes three
failure modes, each producing a `DecisionMethodParameterResolutionException`
(`src/NEvo.Ddd.EventSourcing/Deciding/DecisionMethodParameterResolutionException.cs`):
no current message context available, resolving/activating the service threw, or no
service is registered for that type (`DecisionMethodParameterResolver.cs:14-40`). A
service that resolves successfully as a *type* but only discovers it has no meaningful
value once something inside the decision method reads it is explicitly not this
package's concern to prevent generically — it is the concrete dependency's own
responsibility to fail during construction/activation, not lazily. `ICurrentUser<TId,
TUser>` (below) is the concrete example this invariant was designed around.
`AggregateDeciderExtractor.Invoke` (`AggregateDeciderExtractor.cs:165-178`) unwraps
`TargetInvocationException` from the reflection call so such a failure — should a
dependency violate the invariant — surfaces as the same typed `Left` shape the resolver
itself uses, never an uncontrolled reflection exception escaping the call.

**`IAggregateMethodDecider`/`IDecider`'s public contract is unchanged by this mechanism**
(D38) — parameter injection is internal wiring inside
`AggregateDeciderExtractor`/`AggregateDecider`/`AggregateDeciderProvider`; neither
interface gained a member, and neither is on this package's list of breaking-change
surfaces for this specification (see `overview.md`'s "Compatibility and migration").

**Supported-use contract (D39), documented rather than mechanically enforced:**
additional parameters represent contextual facts or synchronous, side-effect-free
business policies — `ICurrentUser<Guid, TUser>`, a clock abstraction, a precomputed
policy object. Orchestration or external I/O (a `DbContext`, an `HttpClient`, a service
that calls out) is a Level 2 concern. Nothing in `DecisionMethodParameterResolver`
prevents a consumer from injecting an I/O-performing dependency — this is a usage
convention `docs/usage/event-sourcing.md` asks consumers to follow, not a runtime
restriction this package imposes.

## Command handling: Level 1 vs. Level 2

**Level 1 — aggregate-method convention.** `DeciderCommandHandlerProvider`
(`src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandlerProvider.cs`) groups decider
descriptions by `(CommandType, AggregateType, IdType)` — `AggregateDecider` can report
several descriptions for the same route, one per concrete state type declaring a
decision method for the command, but they all resolve through one
`DeciderCommandHandlerAdapter` instance, which asks `IDeciderRegistry`/`AggregateDecider`
to pick the applicable state-specific method at execution time. Registering one adapter
per description would instead produce several competing `Fallback` candidates for what
is really a single convention route — the grouping exists specifically to prevent that.
Every handler this provider creates has `Role = HandlerRole.Fallback`
(`DeciderCommandHandlerProvider.cs:34`).

**Level 2 — explicit `IEventSourcedCommandHandler<TCommand, TAggregate, TId>`**
(`src/NEvo.Ddd.EventSourcing/Handling/IEventSourcedCommandHandler.cs`). Adapted by
`EventSourcedCommandHandlerAdapter`
(`src/NEvo.Ddd.EventSourcing/Handling/EventSourcedCommandHandlerAdapter.cs`), which
resolves the handler, the executor, and the `IAggregateAuthorization<...>` instance from
`context.ServiceProvider` and delegates entirely to
`IEventSourcedCommandExecutor.ExecuteAsync`, passing `handler.HandleAsync` as the
`decide` delegate. The handler receives `Option<TAggregate>` (`Some`/`None`, D24) — never
a bare `TAggregate`, never `null` — and manages exactly one Event Sourced write target: its
own interface shape gives it no way to reach a second, independently-versioned stream in
the same invocation (D31). A Level 2 handler is free to inject any constructor
dependency for orchestration/read I/O and may delegate the actual domain decision to
`IAggregateMethodDecider` instead of writing decision logic itself.

**Registration precedence** is entirely `HandlerRole`-driven
(`src/NEvo.Messaging/Handling/HandlerRole.cs`: `Primary`/`Fallback`, no numeric
priority) — resolved by the normal `NEvo.Messaging` handler-resolution logic, not by
anything Event Sourcing-specific. `MessageHandlerDescription.Role` defaults to `Primary`
via an `init` property, so an ordinary `ICommandHandler<T>` or an explicit Level 2
handler registered for the same command as a convention route is `Primary` by
construction and wins without any Event-Sourcing-aware branch anywhere in the resolution
path; the convention route is the one and only thing registered as `Fallback`.

## Persistence boundary: `IEventStreamStore` / `IAggregateRepository`

Two distinct interfaces, `src/NEvo.Ddd.EventSourcing/IAggregateRepository.cs`:

- **`IEventStreamStore`** — reads/appends raw event streams only. Does not rehydrate
  aggregates, does not load projections (no component in this design loads projections;
  that responsibility was removed from the repository, not relocated).
  `LoadEventsStreamAsync` returns `Option<(events, version)>` — `None` means the stream
  does not exist; `Some` carries both events and version. The two states are never
  collapsed into the same `(events: [], version: 0)` shape, and a store implementation
  must not create a backing entry merely by being read (`FakeEventStore` fixes exactly
  this — reading a nonexistent key returns `None` without a `TryGetValue`-triggered
  side effect, `ServiceCollectionExtensions.cs:61-80`).
- **`IAggregateRepository`** — composes an `IEventStreamStore` with `IEvolverRegistry` to
  load and rehydrate an aggregate to its current state *and* observed version
  (`AggregateRepository.LoadAggregateAsync`, `IAggregateRepository.cs:52-60`), and to
  append new events. Application code (Level 2 handlers, query handlers) depends on
  `IAggregateRepository`, never `IEventStreamStore` directly.

**Expected-stream-state** (`src/NEvo.Ddd.EventSourcing/ExpectedStreamState.cs`) is a
closed two-case abstract record: `NoStream` (valid only if the stream does not yet
exist) and `Exact(version)` (valid only if the stream is at exactly that version).
**There is no `Any`/`IgnoreVersion`/unconditional-append case, and no automatic
retry/rebase after a conflict** — both were explicitly rejected (D29); adding either
would materially change the concurrency-conflict contract this specification otherwise
keeps unchanged (D13).

**Concurrency conflicts** surface as `AggregateConcurrencyException`
(`src/NEvo.Ddd.EventSourcing/AggregateConcurrencyException.cs`) — **returned** via
`Either<Exception, Unit>.Left`, **never thrown** (D13). `FakeEventStore.AppendEventsAsync`
(`ServiceCollectionExtensions.cs:28-59`) is the concrete, current demonstration: the
version check and mutation happen under one lock as a single atomic unit — a
`TryGetValue -> compare -> mutate` sequence is not safe under concurrent access alone,
and `List<dynamic>` itself is not thread-safe for concurrent mutation, so both the read
and the write side of the check must share the same critical section.

**Append/flush/commit (D23)** is a storage-contract ordering guarantee, not an
EF-specific implementation note: when append completes successfully, the appended
event is visible to synchronous downstream processing inside the same supported
consistency boundary — the executor publishes only after a successful append
(enforced structurally, see above). If a concrete provider needs an explicit flush/save
to satisfy that guarantee, the provider performs it before its own append call returns
— the same pattern `EntityFrameworkMessageInbox`/`EntityFrameworkMessageOutbox` already
use for their own `SaveChangesAsync()` calls
(see `docs/development/transaction-model.md`). Successful append does not by itself mean
Event Sourcing core owns or has completed the outer application/message-processing
transaction commit — it does not coordinate a single save point, exactly as
`docs/development/transaction-model.md` § "Transaction ownership" already states for
inbox/outbox.

## Authorization ownership split

Two layers, never crossing the `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization`
package boundary — confirmed directly against
`src/NEvo.Ddd.EventSourcing/NEvo.Ddd.EventSourcing.csproj`'s `ProjectReference` entries
(`NEvo.Messaging.Cqrs`, `NEvo.Messaging` only; **no** reference to
`NEvo.Messaging.Authorization`, D26):

```
Messaging pipeline (NEvo.Messaging.Authorization, before the executor runs at all):
  UserContextMiddleware<TId,TUser,TRoleDataScope>  <- message-level, populates permissions
  ValidatePermissionMiddleware<TId,TUser>          <- message-level AND handler-level check

Event Sourcing execution (NEvo.Ddd.EventSourcing, the executor's own hook):
  load/rehydrate
  IAggregateAuthorization<TCommand,TAggregate,TId>.AuthorizeAsync   <- the one hook
  decide / append / publish
```

`ValidatePermissionMiddleware.ExecuteAsync`
(`src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:16-35`) reads
**both** `message.GetType()`'s own `[AllowPermission]` attributes (message-level — always
present regardless of which route/handler ends up selected) and
`messageHandler.HandlerDescription.Method`'s attributes (handler-level — an explicit
handler's own additional requirement). Both are required — AND, never one overriding
the other (`ValidatePermissionMiddleware.cs:27`). This is what makes a convention-routed
(`Fallback`) command's message-level permission enforce correctly even though
`DeciderCommandHandlerAdapter`'s `HandlerDescription.Method` is `null` — the check no
longer depends on `Method` being non-null the way it did before this specification.

`IAggregateAuthorization<TCommand, TAggregate, TId>`
(`src/NEvo.Ddd.EventSourcing/Executing/IAggregateAuthorization.cs`) is the **only**
authorization concern the executor owns — invoked after rehydration, before the
decision, receiving the same `Option<TAggregate>` (`Some`/`None`) current-state
semantics as a Level 2 handler (D24), so a policy can distinguish "acting on an existing
resource" from "creating a new one" and explicitly reject or ignore `None` per its own
use case, rather than being silently skipped merely because nothing exists yet. The
default registration, `AllowAllAggregateAuthorization<,,>`
(`src/NEvo.Ddd.EventSourcing/Executing/AllowAllAggregateAuthorization.cs`), permits
everything — a consumer registers their own implementation (as the Documents example
does) for resource-aware rules. This contract's own package
(`NEvo.Ddd.EventSourcing`) never references `NEvo.Messaging.Authorization` — but nothing
stops a concrete *implementation* of the hook from doing so; the constraint is on the
core contract's package, not on consumers implementing it.

**`ICurrentUser<TId, TUser>`** (`src/NEvo.Messaging.Authorization/ICurrentUser.cs`,
`CurrentUser.cs`) is identity-only — `TUser User { get; }`, `TUser : User<TId>`, never
`Option`-wrapped (D35, D42, D43). It adapts `UserContext<TId, TUser>`/
`IMessageContextAccessor` internally and is resolved into a decision method purely by
DI `Type` — never a compile-time reference from `NEvo.Ddd.EventSourcing` to
`NEvo.Messaging.Authorization`. `CurrentUser<TId, TUser>`'s constructor
(`CurrentUser.cs:20-27`) obtains and validates the current user **during construction**,
throwing `CurrentUserUnavailableException`
(`src/NEvo.Messaging.Authorization/CurrentUserUnavailableException.cs`) immediately if
none is available — never lazily from the `User` getter (D44). Combined with the
required-contextual-dependency invariant above: a missing current user becomes a
decision-method parameter-*resolution* failure (the DI activation itself throws, which
`DecisionMethodParameterResolver.Resolve`'s `catch` converts to a typed `Left`,
`DecisionMethodParameterResolver.cs:23-31`) before the decision method is ever entered —
never a value the aggregate code has to null-check, and never a substitute for the two
authorization layers above (it answers "who," not "are they allowed").

**Typed authorization failure / HTTP mapping (D36).** `PermissionDeniedException`
(`src/NEvo.Messaging.Authorization/PermissionDeniedException.cs`) derives from the BCL's
`UnauthorizedAccessException` specifically so `NEvo.Messaging.Web` can recognize and map
it without a new project reference in either direction.
`RoutesExtensions.ToHttpResult` (`src/NEvo.Messaging.Web/RoutesExtensions.cs:80-86`)
matches on the base `UnauthorizedAccessException` type — `Left` → 403 if the exception
is (or derives from) `UnauthorizedAccessException`, 500 otherwise; `Right` → 200. An
unauthenticated request never reaches this mapping at all — the existing ASP.NET
authentication/authorization gate returns 401 first, before any NEvo check runs.

## Query and read side

`RequireSome<TLeft, TRight>` (`src/NEvo.Core/EitherAsyncExtensions.cs:15-21`) replaces
`EitherExtensions.MapAsync` outright (D37) — the old name lived, confusingly, inside
`namespace LanguageExt` and looked like a plain `.Map` despite having stronger,
found-or-not-found semantics. It turns `EitherAsync<TLeft, Option<TRight>>` into
`EitherAsync<TLeft, TRight>` in one step: an existing `Left` passes through unchanged,
`Some` becomes `Right`, `None` becomes a `Left` built from the caller-supplied factory.
`MapAsync` had exactly one call site in the whole repository
(`GetDocumentQueryHandler`, in the still-unreleased Documents example), updated in the
same task this replaced it — not treated as a breaking change requiring a compatibility
shim.

The current read path loads the aggregate directly through `IAggregateRepository` and
projects to a DTO inside the query handler itself — there is no persisted, continuously-
updated projection mechanism. This re-derives current state from the event stream on
every query and is explicitly **not the final recommendation for complex read models**;
a future persistence specification owns projections. Nothing in this package's public
shape assumes projections will never exist — `LoadProjectionAsync` was simply removed
from `IAggregateRepository` rather than left half-implemented (it previously threw
`NotImplementedException`).

## Persistence-metadata layering — no envelope designed here (D20-D22)

Three concerns, kept distinct, none conflated:

1. **Domain event** — e.g. `DocumentApproved`, deriving from `Event : Message` exactly
   as before this specification. No storage revision, provider serialization metadata,
   or global log position was added to it.
2. **Runtime message-processing context** — `IMessageContext`/`MessageContextHeaders`,
   already carrying correlation id, causation id, and headers. The executor may access
   `IMessageContext` because it participates in the messaging lifecycle; that
   possibility is preserved, not newly exercised.
3. **Future persisted representation** — a real provider's own stored record, mapping
   domain event + relevant runtime metadata + provider-specific metadata into whatever a
   concrete store actually needs. **No public `EventEnvelope<T>` (or equivalent) is
   defined anywhere in this version**, and none is implied as coming imminently. Stream
   version stays a plain out-of-band `int`, never a field on the event.

**This specification stabilizes the user-facing aggregate/command execution direction.
It does not freeze the final persistence-provider SPI (D22).** The next real-provider
specification may still refine the low-level store contract (`IEventStreamStore`'s exact
shape, a concrete stream-revision representation, serialization strategy) as concrete
requirements become known, without redesigning aggregate or command-handler APIs.

## Compatibility constraints for future work

Recorded here so a maintainer implementing a future persistence provider or an
alternative modeling style finds them without cross-referencing spec history (D17,
reproduced from `specs/active/event-sourcing-api-hardening/overview.md` §
"Architectural principles"):

- **Aggregate modeling style is a supported default, not the core's permanent
  definition.** The current object-oriented, immutable-state, convention-discovered
  style is the one this package hardens and documents. Nothing in
  `IEventStreamStore`/`IAggregateRepository`'s public shape requires the next state to
  come from an instance method on an immutable object — this is a documented
  compatibility property of the contracts, not a new `IDecisionStrategy`/
  `IMutableAggregateStrategy`/`IFunctionalDeciderStrategy` abstraction. No such
  alternative style is implemented today.
- **The executor/convention separation (D30, above)** exists specifically so a future
  non-reflection-based decision mechanism could supply its own `IDecider`/`IEvolver`
  without an executor rewrite — not a promise that one will be built.
- **Level 2 manages exactly one Event Sourced write target per command (D31).**
  Coordinated, atomic writes across two or more independently-versioned aggregate
  streams belongs to Level 3 (an ordinary `ICommandHandler<T>`) or a future dedicated
  saga/process-manager capability — never designed here.
- **No `Any`/`IgnoreVersion` expected-stream-state mode, and no automatic retry/rebase**
  (D29) — both explicitly rejected as changing the concurrency-conflict contract.

## Reference implementation

`examples/ExampleApp/NEvo.ExampleApp.Documents.Api` is the maintainer-facing reference
implementation for everything above: Level 1 convention handling for
`CreateDocument`/`ChangeDocument`, message-level `[AllowPermission]` on
`ApproveDocument`, decision-method parameter injection for the approver's identity via
`ICurrentUser<Guid, DemoUser>`, and both `MapCommandEndpoint`/`MapQueryEndpoint` HTTP
mappings. See `docs/usage/event-sourcing.md` § 9 for the consumer-facing walkthrough and
`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/WALKTHROUGH.md` for the runnable
step-by-step.

## Known open questions

Carried forward, unresolved by this specification (none of D1-D44 decided them):

- Snapshot support.
- Event schema versioning/upcasting.
- Projection rebuild strategy — no projection mechanism exists at all yet (see "Query
  and read side").
- Whether an EF-backed `IEventStreamStore` is the intended real provider, or a
  placeholder for something else — the next persistence specification decides this.
