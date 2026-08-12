---
id: event-sourcing-api-hardening.aggregate-decision-method-parameter-injection
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
semantic_references:
  decisions: [D1, D21, D23, D24, D26, D30, D34, D38, D39]
  dependency_contracts:
    - es-command-executor-and-ambiguity-resolution
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/decision-method-parameter-injection.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDeciderExtractor.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDeciderProvider.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/IAggregateMethodDecider.cs
    - src/NEvo.Ddd.EventSourcing/Executing/EventSourcedCommandExecutor.cs
    - src/NEvo.Messaging/Context/IMessageContextAccessor.cs
    - src/NEvo.Messaging/Context/IMessageContext.cs
  optional:
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
    - docs/development/event-sourcing.md
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Messaging.Web/**
  - examples/**
  - docs/**
---

# Task: Aggregate decision-method parameter injection

## Goal

Extend the aggregate-method convention's decision-method discovery so a decision method
may declare additional, framework-resolved parameters after the command — e.g.
`Approve(ApproveDocument command, ICurrentUser<Guid> currentUser)` or
`Approve(ApproveDocument command, SomeBusinessPolicy policy)` — while the existing
single-command-parameter convention (`Approve(ApproveDocument command)`) keeps working
unchanged. This is the general mechanism task 14 uses for current-user access; it is not
current-user-specific itself.

**Corrected by D38 (post-review correction).** The originally-drafted version of this
task treated a shape change to `IDecider`/`IAggregateMethodDecider`/
`AggregateDecideDelegate<TAggregate,TId>` as an acceptable, casual consequence of adding
this mechanism, reasoning from `NEvo.Ddd.EventSourcing`'s `experimental` status. Owner
review rejected that reasoning specifically for `IAggregateMethodDecider`: it is an
intentionally stabilized public capability (the same one an explicit Level 2 handler
delegates to, D1/D24), and this task must not change its shape merely to transport
parameter-resolution plumbing. This task now requires the public contract to stay
exactly as it is today — parameter resolution is entirely internal to the aggregate-method
convention's own discovery/dispatch implementation.

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — the shared executor's D30
  convention/executor separation, which this task preserves rather than reopens.

## Implementation constraints

### Public contract — unchanged

- `IAggregateMethodDecider` keeps its exact current public shape:

  ```csharp
  EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(
      Option<TAggregate> aggregate,
      IAggregateCommand<TAggregate, TId> command,
      CancellationToken cancellationToken)
  ```

  No new parameter, no `IMessageContext`, `IServiceProvider`, `ParameterInfo`, or
  resolver-state addition to this signature or to `IDecider`'s own contract. An explicit
  Level 2 handler, or any other consumer that already depends on
  `IAggregateMethodDecider` today, must compile and behave unchanged after this task.
- `EventSourcedCommandExecutor` stays exactly as convention-agnostic as it is today
  (D30) — this task adds nothing to its own class, and does not require it to pass any
  new parameter-resolution context through to the decider. If, during implementation,
  no way is found to resolve extra parameters per-invocation without either changing
  `IAggregateMethodDecider`'s signature or having the executor perform reflection/
  resolution itself, stop and report that as new evidence contradicting this
  constraint (an owner decision), rather than changing the public contract or the
  executor's D30 boundary silently.
- Aggregate decision methods never receive `IServiceProvider`, and never accept a
  generic "context bag" parameter type — authors declare exactly the concrete types
  they need (unchanged from the original draft).

### Internal mechanism

- Extend `AggregateDeciderExtractor.WithCommandInputParameter`
  (`Deciding/AggregateDeciderExtractor.cs:69-72`) so a candidate method's parameter list
  is: exactly one command-typed parameter, always first, followed by zero or more
  additional parameters. A method with zero parameters, or whose first parameter is not
  a command type, is not discovered as a decider (unchanged). A method whose command
  parameter is present but not first fails with a specific, actionable discovery-time
  error (distinct from "not a decider at all"). This applies identically to both
  discovery shapes `AggregateDeciderExtractor` already supports — a `static` creation
  method (e.g. `static Create(CreateDocument command, SomePolicy policy)`) and an
  instance method on existing state (e.g. `Approve(ApproveDocument command, SomePolicy
  policy)`), per "Cover both invocation paths" below.
- Add a small internal seam for resolving each additional parameter, exactly:

  ```csharp
  internal interface IDecisionMethodParameterResolver
  {
      Either<Exception, object> Resolve(ParameterInfo parameter);
  }
  ```

  (An equivalent async/context-aware internal shape is acceptable if actually required
  by the chosen wiring — the interface's exact member signature is an implementation
  choice; its role — one small, internal, per-parameter resolution seam, never a
  scattered `GetRequiredService` call inline in `AggregateDecider`/
  `AggregateDeciderExtractor` — is not.)
- **The resolver must read the current invocation's DI scope, never the root/startup
  provider.** `AggregateDecider` (and `AggregateDeciderProvider`, which performs
  discovery once at startup) are registered `Singleton`
  (`ServiceCollectionExtensions.cs`) — a resolver that captures or is constructed from
  an `IServiceProvider` injected directly into either of those singletons would resolve
  scoped dependencies (e.g. task 14's `ICurrentUser<TId>`) from the *root* container, a
  captive-dependency bug, not the actual current request/message scope. A validated,
  available way to avoid this: `IMessageContextAccessor` (`NEvo.Messaging`, already
  `TryAddSingleton`, `AsyncLocal`-backed) and `IMessageContext.ServiceProvider`
  (`NEvo.Messaging/Context/IMessageContext.cs`) already exist and are themselves safe
  for a singleton to depend on — the resolver (or `AggregateDecider`) may depend on
  `IMessageContextAccessor` and read `.MessageContext?.ServiceProvider` at
  **resolve-time** (inside `Resolve`, not inside a constructor), so each invocation sees
  its own current scope even though the resolver instance itself is constructed once.
  This is one validated approach, not the only permissible one — implementation may use
  a different mechanism if it satisfies the same guarantee (current-scope resolution,
  never root-captured), and may change internal service lifetimes if that turns out to
  be the smaller change; do not adopt a fragile design solely to keep one class a
  physical singleton it doesn't need to remain.
- Provide exactly one resolution strategy for this task: DI-backed, resolving by
  parameter `Type` through the current invocation's scope. No plugin/attribute-based
  resolver selection, no public extension point.
- Resolution must happen per-invocation, not once at discovery/startup — a parameter
  such as a scoped/per-request service must reflect the actual invocation, not whatever
  was in the container when the aggregate type was first reflected over. Prove this with
  a test where the registered dependency's resolved value varies across
  invocations/scopes (not merely across two different aggregate/command types).
- `AggregateDecider`/`AggregateDeciderExtractor`/`AggregateDeciderProvider` keep sole
  ownership of decision-method discovery and parameter resolution — do not move any part
  of it into `EventSourcedCommandExecutor` (preserves D30).
- `NEvo.Ddd.EventSourcing` gains no new project reference as part of this task — DI-based
  resolution by `Type` needs no compile-time reference to any specific capability's
  defining package (this is what keeps task 14's `ICurrentUser<TId>`, added in
  `NEvo.Messaging.Authorization`, usable here without violating D26's package-boundary
  reasoning). `IMessageContextAccessor`/`IMessageContext` are already referenced
  (`NEvo.Messaging`, an existing dependency) — using them is not a new dependency.
- Fail clearly and specifically:
  - a required additional parameter that cannot be resolved (nothing registered for its
    type) → an error naming the declaring method and the unresolvable parameter type;
  - an unsupported/ambiguous decision-method shape → a specific discovery-time error, not
    a silent "not discovered" or an unrelated runtime crash.

### Supported-use contract (D39)

Additional decision-method parameters represent **already-available contextual facts or
synchronous, side-effect-free business policies/capabilities** — not a general
dependency-injection escape hatch into arbitrary application services.

Supported (contextual fact or pure/precomputed policy):

```csharp
Approve(ApproveDocument command, ICurrentUser<Guid> currentUser)
Approve(ApproveDocument command, IClock clock)
Approve(ApproveDocument command, DocumentApprovalPolicy policy)
```

Not supported as aggregate-method usage — belongs to an explicit
`IEventSourcedCommandHandler<...>` (Level 2), which already owns orchestration/external
I/O (D1):

```csharp
Approve(ApproveDocument command, DbContext db)
Approve(ApproveDocument command, HttpClient client)
Approve(ApproveDocument command, IExternalApprovalService service)
```

— unless the supplied object is itself a precomputed/pure value or policy that performs
no I/O during the decision (e.g. a policy object whose data was already loaded before
the decision call, exposing only synchronous, side-effect-free members).

This is an **architectural usage contract**, not a mechanically enforced one — do not
implement type inspection, an allow-list of permitted parameter types, or any runtime
check trying to detect "is this an I/O-performing service." The mechanism resolves any
registered type; the contract above governs what a decision method *should* declare,
enforced by documentation/review, not by code. This distinction (contextual
fact/pure policy vs. orchestration/I/O) must be reflected in this task's own acceptance
criteria (below) and is required content for tasks 11/12's later usage/developer
documentation.

## Acceptance criteria

1. `IAggregateMethodDecider.DecideAsync`'s signature (`Option<TAggregate> aggregate,
   IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken`),
   and `IDecider`'s own contract, are byte-identical to before this task (inspection —
   diff `IAggregateMethodDecider.cs`/`Deciding/IAggregateMethodDecider.cs` against the
   pre-task revision).
2. A decision method with only `(TCommand command)` is discovered and invoked exactly as
   before this task (regression, task 01's characterization tests still pass).
3. A **static creation** decision method declared `static Create(TCommand command,
   TDependency dependency)`, with `TDependency` registered in DI, is discovered and
   invoked with `dependency` resolved per-invocation (test: the resolved value varies
   across scopes/invocations, ruling out discovery-time caching as a false pass).
4. An **instance** decision method on existing state declared `Approve(TCommand command,
   TDependency dependency)` is discovered and invoked with `dependency` resolved
   per-invocation, with the same varies-across-scopes proof as criterion 3 — a single
   instance-method test alone does not satisfy this criterion; both the static/creation
   and instance/existing-state paths must each have their own passing test.
5. A decision method declaring an unregistered additional parameter type fails at
   invocation with a specific error naming the method and the parameter type (test).
6. A method whose command parameter is not first fails at discovery time with a specific,
   actionable error (test) — distinct from a method that is legitimately not a decider at
   all (unchanged: no error, simply not discovered).
7. `EventSourcedCommandExecutor`'s own class gains no reflection/parameter-resolution
   logic and no new dependency needed only to transport per-invocation context to the
   decider — that logic lives only in `AggregateDecider`/`AggregateDeciderExtractor`/
   `AggregateDeciderProvider` (inspection, extends D30's existing acceptance
   criterion 23).
8. `NEvo.Ddd.EventSourcing.csproj` has no new `ProjectReference` after this task
   (inspection).
9. No decision method anywhere in `tests/NEvo.Ddd.EventSourcing.Tests` fixtures declares
   an `IServiceProvider` or generic context-bag parameter (inspection).
10. A resolved dependency reflects the current invocation's DI scope, not a value
    captured once from the root/startup container — proven by a test using a scoped
    registration whose resolved instance differs between two separate invocations in two
    separate scopes (test; this is the concrete proof for the "current invocation scope,
    not root provider" constraint, distinct from criteria 3-4's "resolved per-invocation
    at all" proof).
11. The task's own text (this file) states the supported-use contract — contextual
    facts/synchronous side-effect-free policies are supported; orchestration/external I/O
    belongs to an explicit `IEventSourcedCommandHandler<...>` — with the good/bad examples
    above (inspection; carried into tasks 11/12's later documentation, not written here).
12. `dotnet build` succeeds; `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes.

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None directly — tasks 11/12 (user-facing/internal docs) document this mechanism and its
supported-use contract as part of their already-scheduled rewrite, now sequenced after
this task.

## Out of scope

- Any current-user-specific logic (task 14).
- A public resolver/plugin hierarchy or third-party extension point.
- Any change to `AggregateEvolver`/evolution-method discovery.
- Any change to most-specific-wins state-method resolution (D2).
- Mechanically enforcing the supported-use contract (type inspection, an allow-list, or
  any runtime "is this I/O" check) — it is a documented usage contract, not code.
- Changing `IAggregateMethodDecider`'s or `IDecider`'s public contract for any reason
  other than an owner decision explicitly authorizing it (none exists for this task).
