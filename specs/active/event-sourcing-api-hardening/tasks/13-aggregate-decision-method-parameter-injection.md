---
id: event-sourcing-api-hardening.aggregate-decision-method-parameter-injection
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
semantic_references:
  decisions: [D4, D6, D13, D21, D23, D24, D26, D29, D30, D32, D34]
  dependency_contracts:
    - es-command-executor-and-ambiguity-resolution
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/decision-method-parameter-injection.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDeciderExtractor.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/IAggregateMethodDecider.cs
    - src/NEvo.Ddd.EventSourcing/Executing/EventSourcedCommandExecutor.cs
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

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — the shared executor's D30
  convention/executor separation, which this task preserves rather than reopens.

## Implementation constraints

- Extend `AggregateDeciderExtractor.WithCommandInputParameter`
  (`Deciding/AggregateDeciderExtractor.cs:69-72`) so a candidate method's parameter list
  is: exactly one command-typed parameter, always first, followed by zero or more
  additional parameters. A method with zero parameters, or whose first parameter is not
  a command type, is not discovered as a decider (unchanged). A method whose command
  parameter is present but not first fails with a specific, actionable discovery-time
  error (distinct from "not a decider at all").
- Add a small internal seam for resolving each additional parameter, conceptually:

  ```csharp
  internal interface IDecisionMethodParameterResolver
  {
      Either<Exception, object> Resolve(ParameterInfo parameter, /* current invocation context as needed */);
  }
  ```

  The exact "current invocation context" shape (e.g. an `IServiceProvider` reachable via
  `IMessageContext.ServiceProvider`, already accessible to the executor per D21/D23) is
  an implementation choice — pick the smallest change that lets `AggregateDecider`
  resolve extra parameters per-invocation without performing DI resolution inline via
  scattered `GetRequiredService` calls.
- Provide exactly one implementation for this task: DI-backed, resolving by parameter
  `Type` through the current scope's `IServiceProvider`. No plugin/attribute-based
  resolver selection, no public extension point.
- Resolution must happen per-invocation, not once at discovery/startup — a parameter such
  as a scoped/per-request service must reflect the actual invocation, not whatever was in
  the container when the aggregate type was first reflected over. Prove this with a test
  where the registered dependency's resolved value varies across invocations/scopes.
- `AggregateDecider`/`AggregateDeciderExtractor` keep sole ownership of decision-method
  discovery and parameter resolution — do not move any part of this into
  `EventSourcedCommandExecutor` (preserves D30). The executor may be extended only to the
  extent needed to make per-invocation context (e.g. `IMessageContext`) reachable to the
  decider; it must not itself perform reflection or resolve parameters.
- `NEvo.Ddd.EventSourcing` gains no new project reference as part of this task — DI-based
  resolution by `Type` needs no compile-time reference to any specific capability's
  defining package (this is what keeps task 14's `ICurrentUser<TId>`, added in
  `NEvo.Messaging.Authorization`, usable here without violating D26's package-boundary
  reasoning).
- `NEvo.Ddd.EventSourcing` is `status: experimental`, unreleased — changing
  `IDecider`/`IAggregateMethodDecider`/`AggregateDecideDelegate<TAggregate,TId>`'s shape
  where needed to plumb per-invocation context through is not treated as a
  compatibility-sensitive breaking change (same basis already used by D4, D6, D13, D24,
  D29, D32 for this package).
- Fail clearly and specifically:
  - a required additional parameter that cannot be resolved (nothing registered for its
    type) → an error naming the declaring method and the unresolvable parameter type;
  - an unsupported/ambiguous decision-method shape → a specific discovery-time error, not
    a silent "not discovered" or an unrelated runtime crash.
- Never inject `IServiceProvider` itself as a decision-method parameter, and never accept
  a generic "context bag" parameter type — aggregate authors declare exactly the concrete
  types they need.

## Acceptance criteria

1. A decision method with only `(TCommand command)` is discovered and invoked exactly as
   before this task (regression, task 01's characterization tests still pass).
2. A decision method declared `(TCommand command, TDependency dependency)`, with
   `TDependency` registered in DI, is discovered and invoked with `dependency` resolved
   per-invocation (test: the resolved value varies across scopes/invocations, ruling out
   discovery-time caching as a false pass).
3. A decision method declaring an unregistered additional parameter type fails at
   invocation with a specific error naming the method and the parameter type (test).
4. A method whose command parameter is not first fails at discovery time with a specific,
   actionable error (test) — distinct from a method that is legitimately not a decider at
   all (unchanged: no error, simply not discovered).
5. `EventSourcedCommandExecutor`'s own class contains no reflection/parameter-resolution
   logic — that logic lives only in `AggregateDecider`/`AggregateDeciderExtractor`
   (inspection, extends D30's existing acceptance criterion 23).
6. `NEvo.Ddd.EventSourcing.csproj` has no new `ProjectReference` after this task
   (inspection).
7. No decision method anywhere in `tests/NEvo.Ddd.EventSourcing.Tests` fixtures declares
   an `IServiceProvider` or generic context-bag parameter (inspection).
8. `dotnet build` succeeds; `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes.

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None directly — task 12 (internal architecture docs) documents this mechanism as part of
its already-scheduled rewrite, now sequenced after this task.

## Out of scope

- Any current-user-specific logic (task 14).
- A public resolver/plugin hierarchy or third-party extension point.
- Any change to `AggregateEvolver`/evolution-method discovery.
- Any change to most-specific-wins state-method resolution (D2).
