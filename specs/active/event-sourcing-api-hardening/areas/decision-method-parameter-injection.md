# Area: Aggregate decision-method parameter injection

## Responsibility

Extend the aggregate-method convention's decision-method discovery so a decision method
may declare additional parameters beyond the command — resolved by the framework — while
keeping today's single-command-parameter convention working unchanged.

## Current state

`AggregateDeciderExtractor.WithCommandInputParameter`
(`Deciding/AggregateDeciderExtractor.cs:69-72`) requires a decision method to have
**exactly one** parameter, and that parameter must implement `IAggregateCommand<,>`:

```csharp
private static IEnumerable<(MethodInfo Method, Type EventType, Type CommandType)> WithCommandInputParameter(this IEnumerable<(MethodInfo Method, Type EventType)> methods)
    => methods.Where(m => m.Method.GetParameters().Length == 1)
        .Where(m => m.Method.GetParameters()[0].ParameterType.IsCommand())
        .Select(m => (m.Method, m.EventType, m.Method.GetParameters()[0].ParameterType));
```

`AggregateDeciderExtractor.CreateDecide<TAggregate, TId>` (`Deciding/
AggregateDeciderExtractor.cs:102-114`) compiles a closure that invokes the method with
exactly the command as its sole argument (`methodInfo.Invoke(instance, [command])` /
`methodInfo.Invoke(null, [command])`), once per aggregate-type/command-type pair,
discovered eagerly at startup by `AggregateDeciderProvider`/`ServiceCollectionExtensions`
and cached in `AggregateDecider`'s `_deciders` dictionary
(`Deciding/AggregateDecider.cs:16`). `AggregateDecider.DecideAsync`
(`Deciding/AggregateDecider.cs:18-26`) resolves the correct delegate via
`GetDeciderDelegate` (most-specific-wins, D2) and invokes it with only the aggregate
option and the command — it has no notion of per-invocation values beyond those two.
`IDecider`/`IAggregateMethodDecider` (`Deciding/IAggregateMethodDecider.cs`) are the
public contracts `AggregateDecider` implements; `AggregateDecideDelegate<TAggregate,
TId>` (`Deciding/AggregateDecider.cs:12-14`) is the compiled-closure delegate shape.

A concrete, currently-live motivating case: `EditableDocument.Approve(ApproveDocument
command)` (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/Document.cs:47-50`)
generates `ApprovedBy: Guid.NewGuid()` because it has no way to ask the framework for the
current user — this area's mechanism is what task 14 uses to fix that placeholder.

`NEvo.Ddd.EventSourcing` is documented `status: experimental` and unreleased (D4, D6,
D13, D24, D29, D32 already changed public surface in this package on that basis) —
narrowing `WithCommandInputParameter`'s "exactly one parameter" filter, and any resulting
shape change to `IDecider`/`IAggregateMethodDecider`/`AggregateDecideDelegate`, is treated
the same way: not yet compatibility-sensitive.

## Requirements

- A decision method's parameter list may be: `(TCommand command)` (unchanged, today's
  convention) or `(TCommand command, TParam1 p1, ...)` — the command is always the first
  parameter; every parameter after it is resolved by the framework, not supplied by the
  caller.
- Parameter resolution is **per-invocation**, not resolved once at discovery/startup time
  — a parameter such as the current user must reflect the invocation that is actually
  running, not whatever was in scope when the aggregate type was first reflected over
  (discovery happens once at startup; resolution of a given invocation's extra parameter
  values must happen at decide-time).
- Resolution is DI-backed for the first implementation: an additional parameter's value
  comes from whatever is registered in the DI container for that parameter's type. The
  discovery/decide path does not need compile-time knowledge of any specific parameter
  type (e.g. it never references `ICurrentUser<TId>` by name) — this is what keeps
  `NEvo.Ddd.EventSourcing` free of a new dependency on `NEvo.Messaging.Authorization`
  when task 14 introduces `ICurrentUser<TId>` there (consistent with D26's reasoning for
  the aggregate-aware authorization hook, applied here to the same underlying constraint:
  resolve by `Type` through DI, not by a compile-time reference to the concrete
  capability).
- Resolution happens behind a focused internal seam, not inline `GetRequiredService`
  calls scattered through `AggregateDecider`/`AggregateDeciderExtractor`:

  ```csharp
  internal interface IDecisionMethodParameterResolver
  {
      Either<Exception, object> Resolve(ParameterInfo parameter, /* current invocation context as needed */);
  }
  ```

  Exact member shape (sync vs. the `Either<Exception, object>` above, what "current
  invocation context" concretely is — e.g. an `IServiceProvider` obtained via
  `IMessageContext.ServiceProvider`, since the executor already has access to
  `IMessageContext` per D21/D23, or a scoped `IServiceProvider` provided another way) is
  an implementation decision for this task, not fixed by this spec — the constraint is
  the shape of the *contract* (small, internal, one resolution unit at a time), not its
  wiring details.
- The default/only implementation for this task is DI-backed (`IServiceProvider`-based
  resolution by parameter type). No plugin/provider chain, no attribute-based resolver
  selection, no public extension point for third-party resolvers.

## Constraints

- Do not introduce a general service-locator pattern reachable from aggregate code —
  aggregate decision methods declare concrete parameter types (`ICurrentUser<Guid>`,
  `SomeBusinessPolicy`, ...), never `IServiceProvider` itself, and never a generic
  "context bag" parameter.
- Preserve the existing single-command-parameter convention exactly — a decision method
  with only `(TCommand command)` compiles, discovers, and executes identically to today,
  with no new required registration or attribute.
- Discovery/invocation fails clearly, not silently, when:
  - a required additional parameter cannot be resolved (e.g. nothing registered for its
    type) — surfaced as a discovery-time or decide-time error naming the method and the
    unresolvable parameter type, not a generic DI exception bubbling up unexplained;
  - a decision method's parameter shape is ambiguous or unsupported (e.g. the first
    parameter is not a command type at all) — the existing "not discovered as a decider"
    behavior for a completely unrecognized shape is preserved; a shape that looks
    almost-but-not-quite right (e.g. the command parameter is not first) fails with a
    specific, actionable message rather than being silently skipped as "not a decider."
- Do not move decision-method discovery into `EventSourcedCommandExecutor` (the shared
  executor) — it stays inside the aggregate-method convention's own discovery/dispatch
  path (`AggregateDeciderExtractor`/`AggregateDecider`), preserving D30's
  executor/convention separation. The executor may still need to make whatever
  per-invocation context the resolver needs (e.g. `IMessageContext`) reachable to
  `AggregateDecider`, but it does not itself perform parameter resolution or reflection.
- Do not build this mechanism as current-user-specific. It must work for an arbitrary
  service or business-policy type (the spec's own examples: `ICurrentUser<Guid>`,
  `SomeBusinessPolicy`, both together) and must remain usable, without change, by a
  future contextual capability (e.g. correlation/causation) that task 14/15 do not
  introduce.
- No public resolver/plugin hierarchy, no `IServiceProvider` exposed to aggregate code,
  no generic "context bag" parameter type.

## Interfaces and boundaries

- Consumes: task 03's executor (whatever minimal per-invocation context, e.g.
  `IMessageContext`, it can make available to the decider without performing resolution
  itself) and existing DI registration (`AddEventSourcing`, task 06).
- Produces: the parameter-injection mechanism task 14 (`ICurrentUser<TId>`) and any
  future contextual-parameter capability build on, without changing the aggregate-method
  convention's own shape again.

## Area-specific acceptance criteria

1. A decision method declared as `Approve(ApproveDocument command)` (single parameter)
   is discovered and invoked exactly as before this task (regression, characterization
   test from task 01 baseline still passes).
2. A decision method declared as `Approve(ApproveDocument command, TDependency
   dependency)`, where `TDependency` is registered in DI, is discovered and invoked with
   `dependency` resolved from the current invocation's scope (proven by a test whose
   registered dependency varies per resolved scope/request, not a singleton constant, so
   the test cannot pass by accident via discovery-time caching).
3. A decision method declaring an additional parameter type that is **not** registered
   in DI fails at invocation with a clear, specific error naming the method and the
   unresolvable parameter type — not a generic unhandled exception.
4. A method whose first parameter is not a command type is not discovered as a decider
   (unchanged from today); a method whose command parameter is not first (e.g.
   `Approve(TDependency dependency, ApproveDocument command)`) fails with a specific,
   actionable discovery-time error distinguishing this from "not a decider at all."
5. `EventSourcedCommandExecutor`'s own class contains no new reflection/parameter-
   resolution logic — that logic lives only in the aggregate-method convention's own
   discovery/decide path (inspection, extends D30).
6. `NEvo.Ddd.EventSourcing.csproj` gains no new `ProjectReference` as part of this task
   (inspection) — DI-backed resolution requires no compile-time reference to any
   specific capability's defining package.
7. No aggregate decision method anywhere in the repository (including the Documents
   example, once task 14 lands) declares an `IServiceProvider` parameter (inspection).

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — the executor's D30 boundary
  and whatever minimal per-invocation context surface it already has.

## Out of scope

- Any current-user-specific logic (task 14's concern).
- A public resolver/plugin hierarchy or third-party extension point.
- Any change to `AggregateEvolver`/evolution-method discovery — this area is
  decision-method (decider) discovery only.
- Any change to most-specific-wins state-method resolution (D2) — parameter injection is
  a per-candidate concern, orthogonal to which candidate is selected.
