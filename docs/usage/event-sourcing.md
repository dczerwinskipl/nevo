---
id: guides.event-sourcing
type: guide
title: Event Sourcing
status: current
summary: >
  Modeling an aggregate, choosing a command-handling level, authorization, optimistic
  concurrency, and reading state back through Query — using NEvo.Ddd.EventSourcing's
  aggregate-method convention, decision-method parameter injection, and MapQueryEndpoint.
---

# Event Sourcing

## Goal

Build a fully working Event Sourced aggregate — model it, configure it, handle commands
against it, authorize access to it, and read it back through Query — without reading
`NEvo.Ddd.EventSourcing`'s own source.

## Prerequisites

- [`NEvo.Messaging.Cqrs`](../reference/packages/NEvo.Messaging.Cqrs.md) and
  [`NEvo.Ddd.EventSourcing`](../reference/packages/NEvo.Ddd.EventSourcing.md)
  referenced — see [Choosing packages](choosing-packages.md) § "Event sourcing".
- A working command handler and dispatch setup (see [Commands](commands.md)) — this
  guide assumes `AddMessages()` and `AddCommands()` are already registered.
- Familiarity with `Either<Exception, T>` as NEvo's fallible-result shape (see
  [Commands](commands.md)) — every decision method and every framework operation in
  this guide returns one instead of throwing.

## 1. Overview and mental model

`NEvo.Ddd.EventSourcing` gives an aggregate two things to write and nothing else: a way
to **decide** what happened (a command produces zero or more domain events) and a way to
**evolve** state from what happened (an event folds into the next state). Everything
around that — loading the aggregate's event stream, replaying it, calling your decision
method, appending the new events, and publishing them — is the framework's job.

```
command -> decide -> domain event(s) -> evolve -> new aggregate state
```

What you own: the aggregate type(s), the decision methods, the evolution methods, and
the commands/events themselves. What the framework owns: stream load/replay, optimistic
concurrency, append ordering, and publishing the resulting events through the same
`IEventPublisher` any other command handler uses.

The style this guide documents — aggregate state as immutable, object-oriented types,
with decision/evolution methods discovered by convention — is the **currently
supported, default** modeling approach. It is not the only style the underlying
`IEventStreamStore`/`IAggregateRepository` contracts could ever support: nothing in
their public shape requires the next state to come from an instance method on an
immutable object. No mutable-aggregate or static/functional-decider style is
implemented today, though — treat this as a documented compatibility property of the
contracts, not a feature you can reach for yet.

## 2. Configuration

```csharp
builder.Services.AddEventSourcing(
    options => options.UseAggregateMethodFallback = true,
    typeof(Document));
```

- The `Type[]` arguments are the aggregate root types to scan for decision/evolution
  methods (see § 3) — every type assignable to each one, in the same assembly, is
  scanned.
- `EventSourcingOptions.UseAggregateMethodFallback` (default `true`) controls whether
  the aggregate-method convention is registered as a **fallback** route for commands
  with no explicit handler (see § 5). Set it to `false` to require an explicit handler
  (§ 4 — the explicit `IEventSourcedCommandHandler<...>` or an ordinary
  `ICommandHandler<T>`) for every command — the decider/evolver machinery itself stays
  registered either way, since an explicit `IEventSourcedCommandHandler<...>` may still
  delegate to it.
- The older `AddEventSourcing(params Type[])` overload (no options) still compiles and
  behaves identically — it delegates to the overload above with default options.
- `AddEventSourcing` needs `AddMessages()` registered first (handler/context
  infrastructure); it does not require `AddCommands()`/`AddQueries()` itself — it
  registers its own handler-discovery providers for the convention route and for the
  explicit `IEventSourcedCommandHandler<...>` (§ 4).
- No `IEventStreamStore` is registered by your code above — `AddEventSourcing`
  registers an in-memory default (`FakeEventStore`) unless you register your own. See
  § 7 for exactly what that default does and does not guarantee.

## 3. Modeling aggregates

An aggregate root implements `IAggregateRoot<TId>` (a marker requiring an `Id`). Model
each distinct lifecycle stage as its own concrete type, using the Documents example
(`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/Document.cs`) as the
reference:

```csharp
public abstract class Document(Guid id, string data) : IAggregateRoot<Guid>
{
    public Guid Id { get; } = id;
    public string Data { get; } = data;

    public static Either<Exception, IEnumerable<DocumentDomainEvent>> Create(CreateDocument command)
        => new[] { new DocumentCreated(command.DocumentId, command.Data) };

    public static Document Apply(DocumentCreated @event)
        => new EditableDocument(@event.DocumentId, @event.Data);
}

public sealed class EditableDocument(Guid id, string data) : Document(id, data)
{
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Change(ChangeDocument command)
        => new[] { new DocumentChanged(Id, command.Data) };

    public EditableDocument Apply(DocumentChanged @event) => new(Id, @event.Data);

    public ApprovedDocument Apply(DocumentApproved @event) => new(Id, Data, @event.ApprovedBy);
}

public sealed class ApprovedDocument(Guid id, string data, Guid approvedBy) : Document(id, data)
{
    public Guid ApprovedBy { get; } = approvedBy;
}
```

**Decision methods** (`Create`, `Change`, `Approve`) return
`Either<Exception, IEnumerable<TEvent>>`, where `TEvent` implements
`IAggregateEvent<TAggregate, TId>` and derives from `Event`. There is no marker
attribute or base-class requirement beyond that return-type shape:

- A `static` method with no aggregate instance is the **creation** decision — it is
  only ever invoked when no aggregate currently exists for the command's stream id.
- An instance method is invoked with the current, rehydrated aggregate instance — put
  it on the specific concrete type it applies to (`EditableDocument.Change`,
  `EditableDocument.Approve`), not on the abstract base, when the operation is only
  valid in that state. `ApproveDocument` sent against an already-`ApprovedDocument`
  finds no matching decider and fails, rather than silently re-running.
- The command must be the method's first parameter; zero or more additional,
  framework-resolved parameters may follow it — see "Decision-method parameter
  injection" in § 4.

**Evolution methods** (`Apply`) return the next aggregate state — `static` for the
creation event, instance methods for every subsequent event, resolved the same way as
decision methods (return-type/parameter shape, not attributes). `AggregateEvolver.Evolve`
is pure `State + Event -> NewState`: no I/O, no DI, nothing but the fold.

**Replay:** loading an aggregate means reading its raw event stream
(`IEventStreamStore.LoadEventsStreamAsync`) and folding every event through the
matching `Apply` method in order, starting from no state — the same mechanism that
turns a freshly-created `EditableDocument` into an `ApprovedDocument` after a
`DocumentApproved` event is exactly how a full replay from an empty stream reconstructs
current state; there is no separate "replay mode."

**Same-command-on-multiple-states resolution:** when more than one candidate decision
or evolution method could apply to the current runtime state, the framework picks the
most specific one — the candidate whose declaring type is assignable from every other
candidate's declaring type. Two candidates tied at the same specificity (including two
methods declared on the exact same type) fail deterministically, naming every tied
candidate, rather than picking one arbitrarily.

**Domain invariants** (e.g. "an already-approved document cannot be approved again")
belong in the decision method — return `Left` with a descriptive exception. This is
separate from authorization (§ 6): a domain invariant failure means the operation makes
no sense regardless of who's asking; an authorization failure means this particular
caller isn't allowed to ask.

**When concrete state types are useful vs. excessive:** introduce a new state type when
behavior genuinely differs per stage — `Change`/`Approve` only exist on
`EditableDocument`, so calling them against an `ApprovedDocument` is a compile-time
impossibility, not a runtime check. If every command your aggregate accepts is valid in
every state, a single type is simpler; you are not required to carve out a state type
for every conceptual stage.

## 4. Command handling: choosing an approach

| Need | Use |
|---|---|
| A pure business decision — no I/O, no external orchestration | **The aggregate-method convention** (§ 3) |
| That decision also needs a contextual fact or a synchronous, side-effect-free policy (e.g. the current user) | **The aggregate-method convention** + decision-method parameter injection (below) |
| Orchestration or external I/O around a single aggregate's write — a `DbContext` lookup, an `HttpClient` call, a service call before deciding | **The explicit handler** — `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` |
| Coordinated, atomic writes across two or more independently-versioned aggregate streams | **An ordinary `ICommandHandler<T>`** (or a future saga/process-manager capability — not built here) |

**The aggregate-method convention** is everything in § 3 — no registration beyond
`AddEventSourcing`'s aggregate type list, no explicit handler class. This is the
default and the lowest-friction path.

**The explicit `IEventSourcedCommandHandler<...>`** is for when a command needs
orchestration the aggregate itself shouldn't perform:

```csharp
public class SomeHandler(ISomeExternalService external)
    : IEventSourcedCommandHandler<SomeCommand, SomeAggregate, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<SomeAggregate, Guid>>> HandleAsync(
        SomeCommand command, Option<SomeAggregate> aggregate, CancellationToken cancellationToken)
    {
        // constructor-injected orchestration/read I/O here, then either
        // return events directly, or delegate to IAggregateMethodDecider for the
        // actual domain decision.
    }
}
```

The current state arrives as `Option<TAggregate>` — `Some` when an existing
aggregate/stream was rehydrated, `None` on the creation path — **never** a bare
`TAggregate`, never `null`. The framework still owns load, version tracking, append,
and publish; the explicit handler manages exactly one Event Sourced write target per
command — it has no way to write a second, independently-versioned stream in the same
invocation. A use case genuinely needing that belongs to an ordinary `ICommandHandler<T>`.

**An ordinary `ICommandHandler<T>`** (see [Commands](commands.md)) has no
Event Sourcing plumbing at all — write your own repository calls, or coordinate
multiple aggregates yourself. Nothing about it is Event-Sourcing-specific; it's the
escape hatch for anything the aggregate-method convention or the explicit handler
doesn't fit.

### Decision-method parameter injection

An aggregate-method convention decision method — a `static` creation method or an
instance method — may declare additional parameters after the command:

```csharp
public Either<Exception, IEnumerable<DocumentDomainEvent>> Approve(
    ApproveDocument command, ICurrentUser<Guid, DemoUser> currentUser)
    => new[] { new DocumentApproved(Id, ApprovedBy: currentUser.User.Id) };
```

- Resolved per-invocation from the current message's DI scope — never the root/startup
  container, and never a general `IServiceProvider` parameter (no service-locator
  escape hatch is ever supported).
- **Every declared parameter is required.** Declaring one is the assertion "this
  decision needs this contextual fact." If it cannot be resolved, the decision method
  is never invoked at all — the framework returns a `Left`, never a `null`/default
  value passed into your method.
- A required dependency must be resolved **and validated** before the method runs, not
  after. `ICurrentUser<TId, TUser>` (§ 6) is the concrete example: its implementation
  checks for a current user during its own construction, not lazily the first time
  something reads `.User` — so a missing user is always a parameter-resolution failure
  that happens before `Approve` is ever entered, never a value the aggregate itself has
  to null-check.
- Additional parameters represent **contextual facts or synchronous, side-effect-free
  business policies** — `ICurrentUser<Guid, TUser>`, a clock abstraction, a precomputed
  policy object. Orchestration or external I/O (a `DbContext`, an `HttpClient`, a
  service that calls out) is a concern for the explicit handler, not something to
  inject here — this is a usage convention this guide asks you to follow, not
  something the framework mechanically rejects.
- The original single-command-parameter form keeps compiling and behaving identically —
  this is purely additive.

## 5. Handler registration and fallback semantics

Every handler has a `Role`: `Primary` (the default for every ordinary handler) or
`Fallback` (only the aggregate-method convention route uses this). Resolution rule, no
numeric priority involved:

- If any `Primary` handler is registered for a command (an explicit
  `IEventSourcedCommandHandler<...>` or an ordinary `ICommandHandler<T>`), it is used —
  the convention route (`Fallback`) is not even considered.
- If no `Primary` handler exists, the `Fallback` (convention) route handles it, as long
  as `UseAggregateMethodFallback` is enabled (§ 2).
- Two `Primary` candidates for the same command is a configuration error
  (`MoreThanOneHandlerFoundException`) — resolved at handler-resolution time, not
  silently picking one.
- With `UseAggregateMethodFallback` disabled and no `Primary` handler registered, the
  command has no handler at all — explicit handlers (the `IEventSourcedCommandHandler<...>`
  or an ordinary `ICommandHandler<T>`) remain usable regardless of this toggle.

This is why registering an explicit `IEventSourcedCommandHandler<...>` or a normal
`ICommandHandler<T>` for a command that also has a matching aggregate-method convention
decision method
does not collide with it — the explicit handler simply takes over as `Primary`.

## 6. Authorization

Two distinct, non-overlapping layers:

**Message-level and handler-level permission** — ordinary NEvo authorization
(`[AllowPermission(name, validatorType)]`, see [Authorization](authorization.md)),
enforced entirely by the normal messaging pipeline **before Event Sourcing execution
even begins**. Place the attribute on the command type for a requirement that applies
regardless of which route ends up handling it (this is how the Documents example gates
`ApproveDocument`); place it on an explicit handler method for a requirement specific
to that handler. Both compose as AND — a handler-specific requirement is additional,
never a replacement for the command's own.

**Aggregate-aware authorization** (`IAggregateAuthorization<TCommand, TAggregate,
TId>`) is the *only* authorization concern Event Sourcing itself owns. It runs after
the aggregate is rehydrated and before the decision method executes, receiving the
same explicit `Option<TAggregate>` state as the explicit handler — so a policy can
distinguish "acting on an existing resource" from "creating a new one," and explicitly
reject or ignore the `None` case according to its own use case rather than being
silently skipped just because nothing exists yet. The default registration
(`AllowAllAggregateAuthorization`) permits everything; supply your own implementation
to add resource-aware rules (e.g. "only the creator may approve"). A denial here
prevents the decision and the append entirely, exactly like a message-level denial —
just later in the pipeline, after rehydration.

Do not duplicate permission attributes across every concrete-state method for the same
logical operation — declare the requirement once, at the message level.

**HTTP consequence:**

| Situation | Status |
|---|---|
| Unauthenticated request to an endpoint requiring authorization | `401` — the existing ASP.NET authentication/authorization gate rejects it before any NEvo check runs |
| Authenticated, but a message-level/handler-level permission check fails | `403` — a `PermissionDeniedException` (`UnauthorizedAccessException`-derived) is returned via `Either.Left`, and `NEvo.Messaging.Web`'s HTTP mapping recognizes the BCL base type |
| Any other failure (e.g. the target document doesn't exist) | `500` — unchanged, unrelated to authorization |

**`ICurrentUser<TId, TUser>`** (`NEvo.Messaging.Authorization`) is an identity-only,
**required** capability — `TUser User { get; }`, never `Option`-wrapped — a decision
method may request via parameter injection (§ 4). Resolving it without an available
current user fails while the capability itself is being resolved, before the decision
method is ever invoked — distinct from, and never a substitute for, the two
authorization layers above: it tells you *who* is asking, it does not itself decide
whether they're allowed.

## 7. Persistence and concurrency

`IEventStreamStore` reads/appends raw event streams. `IAggregateRepository` composes an
`IEventStreamStore` with the evolver to load and rehydrate an aggregate to its current
state and observed version, and to append new events — application code (explicit
handlers, query handlers) depends on `IAggregateRepository`, not `IEventStreamStore`
directly.

`AddEventSourcing` registers an in-memory default store (`FakeEventStore`) unless you
register your own `IEventStreamStore`. It enforces real optimistic-concurrency
semantics (see below) and correctly reports a stream that was never appended to as
missing rather than as an empty stream — but it holds everything in memory for the
process's lifetime only. A real, durable/production store is not shipped by this
package yet.

**Expected stream state.** Every append declares what it expects the stream to look
like beforehand — `ExpectedStreamState.NoStream` (the stream must not already exist:
the creation path) or `ExpectedStreamState.Exact(version)` (the stream must be at
exactly that version: the update path). There is no unconditional/"don't check" append
mode, and no automatic retry after a conflict. Both the aggregate-method convention and
the explicit handler compute this mapping for you from the same `Option<TAggregate>`
state you already have —
`None -> NoStream`, `Some(loaded) -> Exact(loaded.Version)` — you never construct it by
hand.

**Concurrency conflicts** surface as `AggregateConcurrencyException`, always
**returned** via `Either<Exception, Unit>.Left` — never thrown. Handle it the same way
you handle any other `Left`, not with a `try`/`catch` around dispatch.

**Create-vs-update mental model:** creating a new aggregate expects no existing stream
and fails if one is already there; updating an existing aggregate expects it to be at
exactly the version you last observed and fails if someone else appended since then.
There is no way to force an append regardless of the current version.

**Append/flush/commit.** When an append completes successfully, the newly appended
event is visible to synchronous downstream processing inside the same invocation — a
synchronous event handler triggered by the same command, reloading the aggregate, sees
the new state. This does not by itself mean the outer application/message-processing
transaction has committed — for the in-memory default store, append is immediately
visible; a future EF/SQL-backed store may need to flush before its append call returns
while still participating in the ambient transaction, the same pattern NEvo's inbox/
outbox implementations already use.

**Three distinct concerns, not one envelope.** The domain event itself (e.g.
`DocumentApproved`, deriving from `Event`), the runtime message-processing context
(`IMessageContext` — correlation id, causation id, headers), and a future real
provider's own persisted representation are kept separate. There is no persisted
"Event Envelope" type in this version, and none is coming imminently — stream version
stays a plain out-of-band `int`, not a field on the event.

## 8. Query and read side

A Query for Event Sourced state looks like any other Query (see
[Queries](queries.md)): a `Query<TResult>` record and an `IQueryHandler<TQuery,
TResult>`. The intermediate read path used today loads the aggregate directly through
`IAggregateRepository` and projects it to a DTO in the handler itself:

```csharp
public class GetDocumentQueryHandler(IAggregateRepository repository)
    : IQueryHandler<GetDocumentQuery, DocumentDto>
{
    public async Task<Either<Exception, DocumentDto>> HandleAsync(
        GetDocumentQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
        => await repository.LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
            .RequireSome(() => new DocumentNotFoundException(query.DocumentId))
            .Map(loaded => ToDto(loaded.Aggregate));
}
```

`RequireSome` (`NEvo.Core`) turns the repository's "found or not found"
`EitherAsync<Exception, Option<T>>` shape into a plain `EitherAsync<Exception, T>` in
one step — an existing `Left` passes through unchanged, `Some` becomes `Right`, `None`
becomes a `Left` built from the factory you supply — so the rest of the handler can
`.Map` over the loaded aggregate as if it were already known to exist.

This is **not the final recommendation for complex read models** — it re-derives
current state from the event stream on every query. Persisted, continuously-updated
projections are a future specification's scope; there is no projection API to use yet,
so do not reach for one.

**Mapping Query as HTTP GET:**

```csharp
app.MapQueryEndpoint<GetDocumentQuery, DocumentDto>("/api/documents/{documentId:guid}");
```

`MapQueryEndpoint<TQuery, TResult>` binds the query from route and query-string values
via `[AsParameters]` — no request body. Only the query record's own primary-constructor
parameters are bound (`DocumentId` above, from the route); `Id`/`CreatedAt` (inherited
from `Message`) are never required GET parameters. It returns a `RouteHandlerBuilder`,
chainable with `.RequireAuthorization()` exactly like `MapCommandEndpoint`.

## 9. Example: the Documents service

`examples/ExampleApp/NEvo.ExampleApp.Documents.Api` is the canonical, runnable
walkthrough for everything above — every command handled through the aggregate-method
convention, message-level permission on `ApproveDocument`, decision-method parameter
injection for the approver's identity, both `MapCommandEndpoint`/`MapQueryEndpoint`
mappings, and reload-after-write reconstructing the correct concrete state. Run it
directly (no other example project needed):

```bash
dotnet run --project examples/ExampleApp/NEvo.ExampleApp.Documents.Api
```

See its own `WALKTHROUGH.md`
(`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/WALKTHROUGH.md`) for the full
step-by-step: create → query → change → approve denied (401 unauthenticated, then 403
authenticated-but-unpermitted) → approve succeeding → query again showing the
`ApprovedDocument`-shaped result with the real approver's id.

## Constraints and failure modes

What this version of Event Sourcing intentionally does **not** provide yet — do not
expect or document workarounds for these:

- No real, durable/production event store (PostgreSQL/Marten/Kurrent-style) — the
  registered default is in-memory only.
- No persisted projections, subscriptions, or checkpoints — read state today by loading
  the aggregate directly (§ 8).
- No snapshotting, no event upcasting/schema migration.
- No unconditional/"don't check" append mode and no automatic retry or rebase after a
  concurrency conflict (§ 7).
- No coordinated, atomic multi-aggregate writes in one command — that's an ordinary
  `ICommandHandler<T>` or a future saga/process-manager capability (§ 4), never the
  aggregate-method convention or the explicit handler.
- No mutable-aggregate or static/functional decider modeling style is implemented — the
  object-oriented immutable style in § 3 is the only one available today (§ 1).

## Verification

```bash
node tools/docs.mjs validate
node tools/docs.mjs check
```

Beyond documentation validation: `dotnet build`, then run the Documents example (§ 9)
and walk through its `WALKTHROUGH.md` end to end — create, query, change, both approve
failure modes, approve success, and the final query showing the reloaded
`ApprovedDocument` state.

## Next steps

- [Queries](queries.md) — Query fundamentals independent of Event Sourcing.
- [Authorization](authorization.md) — the general `[AllowPermission]` wiring Event
  Sourcing's message-level checks build on.
- [ExampleApp walkthrough](example-app-walkthrough.md) — the other 4 example projects
  (auth, cross-service dispatch) this guide doesn't cover.
