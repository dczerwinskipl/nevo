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

**Corrected by D38 (post-review).** `NEvo.Ddd.EventSourcing`'s `experimental` status
already justified other public-surface changes in this package (D4, D6, D13, D24, D29,
D32), but `IAggregateMethodDecider`/`IDecider` are the one part of that surface owner
review singled out as intentionally stabilized already — the same capability an explicit
Level 2 handler delegates to (D1/D24). This area's mechanism does **not** rely on that
precedent: `IAggregateMethodDecider.DecideAsync`'s signature and `IDecider`'s own
contract stay exactly as they are. Only `WithCommandInputParameter`'s discovery filter
(widening from "exactly one parameter" to "one command parameter, then zero or more
resolved ones") and the fully internal resolution machinery behind it change.

`AggregateDecider` and `AggregateDeciderProvider` are both registered `Singleton`
(`ServiceCollectionExtensions.cs`) — any internal resolver design must read the
*current invocation's* DI scope, not a scope captured at singleton-construction time,
or it silently becomes a captive-dependency bug (a scoped service like task 14's
`ICurrentUser<TId>` would resolve from the root container instead of the actual
request). `IMessageContextAccessor` (`NEvo.Messaging`, already `TryAddSingleton`,
`AsyncLocal`-backed) and `IMessageContext.ServiceProvider` are a validated way to let a
singleton-held resolver still read the correct current scope at resolve-time — this is
one validated approach the task may use, not a mandate that it is the only one.

## Requirements

- A decision method's parameter list may be: `(TCommand command)` (unchanged, today's
  convention) or `(TCommand command, TParam1 p1, ...)` — the command is always the first
  parameter; every parameter after it is resolved by the framework, not supplied by the
  caller.
- **Every declared non-command parameter is required (D42).** Declaring a parameter is
  itself the assertion "this decision requires this contextual fact/capability" — the
  framework resolves every declared parameter successfully, or the decision method is
  not invoked at all. This holds regardless of *why* resolution fails: the type is
  unregistered, activation throws, or a resolved capability's own implementation reports
  "no current value" for this invocation (e.g. `ICurrentUser<TId>`, area
  `current-user-capability`, when no user is available). No optional-parameter
  convention exists — a required dependency that cannot be produced always fails the
  invocation before the decision method runs; it is never translated into `null`,
  `default`, or an `Option.None` passed to the method.
- **All contextual parameters must be successfully resolved before the aggregate
  decision method is invoked (D44).** A required contextual capability must validate its
  own availability during dependency resolution/activation — for a DI-backed capability,
  that means during service construction, not lazily from a value getter the decision
  method happens to read. A dependency that resolves successfully (construction
  succeeds) but throws only after the decision method has started executing is an
  ordinary invocation/application failure, not a parameter-resolution failure — the
  method has already been entered by then, which is exactly what "not invoked at all"
  rules out. For `ICurrentUser<TId, TUser>` (area `current-user-capability`), this means
  current-user availability is validated while DI constructs/resolves the capability,
  not when `.User` is read.
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
      Either<Exception, object> Resolve(ParameterInfo parameter);
  }
  ```

  Exact member shape (this synchronous form, or an equivalent async/context-aware
  internal shape if actually required) is an implementation decision for this task, not
  fixed by this spec — the constraint is the shape of the *contract* (small, internal,
  one resolution unit at a time, reading the current invocation's DI scope — see above),
  not its exact wiring details. `IMessageContext.ServiceProvider`, reached via
  `IMessageContextAccessor` (per D21/D23), is a validated way to get a per-invocation
  scope without changing `IAggregateMethodDecider`'s signature.
- The default/only implementation for this task is DI-backed (`IServiceProvider`-based
  resolution by parameter type). No plugin/provider chain, no attribute-based resolver
  selection, no public extension point for third-party resolvers.
- Both decision-method invocation shapes `AggregateDeciderExtractor.CreateDecide` already
  handles today — the `static` creation path (`methodInfo.IsStatic`, invoked with
  `target: null`) and the instance path on existing state (invoked with `target:
  aggregate`) — must resolve additional parameters identically. Neither path is
  privileged; a fix or test covering only one is incomplete.

## Supported-use contract (D39)

Additional decision-method parameters represent **already-available contextual facts or
synchronous, side-effect-free business policies/capabilities** — not a general
dependency-injection escape hatch. Supported: `ICurrentUser<Guid>`, `IClock`, a
precomputed/pure policy object (`DocumentApprovalPolicy`). Not supported as
aggregate-method usage — belongs to an explicit `IEventSourcedCommandHandler<...>`
(Level 2, which already owns orchestration/external I/O, D1): a `DbContext`, an
`HttpClient`, a service that performs I/O during the call — unless the supplied object
is itself precomputed/pure and performs no I/O during the decision. This is an
architectural usage contract, not a mechanically enforced one — no type inspection, no
allow-list, no runtime "is this I/O" check. It governs what a decision method *should*
declare (enforced by documentation/review), not what the mechanism *can* resolve (it
resolves any registered type).

## Constraints

- Do not introduce a general service-locator pattern reachable from aggregate code —
  aggregate decision methods declare concrete parameter types (`ICurrentUser<Guid>`,
  `SomeBusinessPolicy`, ...), never `IServiceProvider` itself, and never a generic
  "context bag" parameter.
- Preserve the existing single-command-parameter convention exactly — a decision method
  with only `(TCommand command)` compiles, discovers, and executes identically to today,
  with no new required registration or attribute.
- Discovery/invocation fails clearly, not silently, when:
  - a required additional parameter cannot be resolved — whether nothing is registered
    for its type, an exception is raised while resolving/activating it (including one a
    contextual capability's own implementation throws to signal "no current value
    available," per D42, and — per D44 — must throw during that resolution/activation
    step itself, not from a value read later inside the decision method), or any other
    resolution failure — surfaced as a discovery-time or decide-time error naming the
    method and the unresolvable parameter type, with the original exception preserved as
    diagnostic context, never a generic DI exception bubbling up unexplained and never
    silently converted into `null`/`default`/`Option.None`;
  - a decision method's parameter shape is ambiguous or unsupported (e.g. the first
    parameter is not a command type at all) — the existing "not discovered as a decider"
    behavior for a completely unrecognized shape is preserved; a shape that looks
    almost-but-not-quite right (e.g. the command parameter is not first) fails with a
    specific, actionable message rather than being silently skipped as "not a decider."
- Do not move decision-method discovery into `EventSourcedCommandExecutor` (the shared
  executor) — it stays inside the aggregate-method convention's own discovery/dispatch
  path (`AggregateDeciderExtractor`/`AggregateDecider`/`AggregateDeciderProvider`),
  preserving D30's executor/convention separation. The executor requires **no new
  parameter or dependency** to support this mechanism — the resolver reaches the current
  invocation's scope itself (e.g. via the already-existing `IMessageContextAccessor`),
  not through anything the executor passes down. If no way is found to achieve this
  without either changing `IAggregateMethodDecider`'s signature or having the executor
  perform resolution/reflection itself, stop and report it as an owner decision (D38)
  rather than changing either boundary silently.
- Do not change `IAggregateMethodDecider`'s or `IDecider`'s public contract for any
  reason short of an explicit owner decision authorizing it (D38) — none exists for this
  task.
- Do not build this mechanism as current-user-specific. It must work for an arbitrary
  service or business-policy type (the spec's own examples: `ICurrentUser<Guid>`,
  `SomeBusinessPolicy`, both together) and must remain usable, without change, by a
  future contextual capability (e.g. correlation/causation) that task 14/15 do not
  introduce.
- No public resolver/plugin hierarchy, no `IServiceProvider` exposed to aggregate code,
  no generic "context bag" parameter type.
- No optional-contextual-parameter semantics (D42) — every declared parameter is
  required, with no per-parameter opt-in/opt-out convention. A genuinely optional
  contextual capability, if ever needed, gets its own explicit, typed representation in a
  future change (e.g. a capability whose own declared shape is `Option<T>`), not a
  weakening of this mechanism's default semantics.
- An unresolvable required contextual dependency has no dedicated HTTP status mapping —
  it is an ordinary application/framework failure, following whatever generic mapping
  already applies to an unexpected `Left` (D42) — never conflated with permission denial.

## Interfaces and boundaries

- Consumes: `IMessageContextAccessor`/`IMessageContext` (`NEvo.Messaging`, already an
  existing dependency — read directly by the resolver, not plumbed through task 03's
  executor) and existing DI registration (`AddEventSourcing`, task 06).
- Produces: the parameter-injection mechanism task 14 (`ICurrentUser<TId>`) and any
  future contextual-parameter capability build on, without changing
  `IAggregateMethodDecider`'s/`IDecider`'s shape again.

## Area-specific acceptance criteria

1. `IAggregateMethodDecider.DecideAsync`'s signature and `IDecider`'s own contract are
   unchanged by this task (inspection).
2. A decision method declared as `Approve(ApproveDocument command)` (single parameter)
   is discovered and invoked exactly as before this task (regression, characterization
   test from task 01 baseline still passes).
3. A **static creation** decision method (e.g. `static Create(CreateDocument command,
   TDependency dependency)`) and an **instance** decision method on existing state (e.g.
   `Approve(ApproveDocument command, TDependency dependency)`) both resolve `dependency`
   from the current invocation's scope — each with its own passing test; one instance-
   method test alone does not cover this criterion.
4. A resolved dependency varies across separate invocations/scopes using a scoped
   registration (test) — proving current-invocation-scope resolution, not a value
   captured once from the root/startup container (distinct from criterion 3's "resolved
   at all" proof).
5. A decision method declaring an additional parameter type that is **not** registered
   in DI fails at invocation with a clear, specific error naming the method and the
   unresolvable parameter type — not a generic unhandled exception. A contextual
   dependency that *is* registered but throws while being resolved/activated fails the
   same way — the original exception is preserved as diagnostic context, never escaping
   as an uncontrolled reflection/DI exception (test, D42). This failure occurs before the
   decision method is invoked — proven by a regression test asserting the decision
   method's own invocation count stays at zero and no event is produced (test, D44); a
   dependency that resolves/activates successfully and only throws when a value it
   exposes is read *inside* the decision method's body is an ordinary application
   failure, not this kind of resolution failure, and is not exercised as one.
6. A method whose first parameter is not a command type is not discovered as a decider
   (unchanged from today); a method whose command parameter is not first (e.g.
   `Approve(TDependency dependency, ApproveDocument command)`) fails with a specific,
   actionable discovery-time error distinguishing this from "not a decider at all."
7. `EventSourcedCommandExecutor`'s own class contains no new reflection/parameter-
   resolution logic and no new dependency added only to transport per-invocation
   context — that logic lives only in the aggregate-method convention's own
   discovery/decide path (inspection, extends D30).
8. `NEvo.Ddd.EventSourcing.csproj` gains no new `ProjectReference` as part of this task
   (inspection) — DI-backed resolution requires no compile-time reference to any
   specific capability's defining package.
9. No aggregate decision method anywhere in the repository (including the Documents
   example, once task 14 lands) declares an `IServiceProvider` parameter (inspection).
10. The supported-use contract (facts/pure policies supported; orchestration/I/O
    belongs to Level 2) is stated in this task's own text (inspection).

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
- An optional-contextual-parameter convention, a generic processing-context/correlation
  parameter resolver, or a "dedicated resolver if registered, otherwise DI-backed"
  extension seam (D42) — the internal seam may remain structured so a future change could
  add one without redesigning this mechanism, but none of that is built now.
