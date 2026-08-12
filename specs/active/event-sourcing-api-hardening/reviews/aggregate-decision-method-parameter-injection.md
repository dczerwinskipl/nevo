---
review-of: task
change: event-sourcing-api-hardening
task: aggregate-decision-method-parameter-injection
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/aggregate-decision-method-parameter-injection

- [x] Acceptance criteria: 10/10
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-12, targeted post-review correction pass — comment/documentation
cleanup only, no design change). Baseline: this file's prior content (`pass`, no
findings). Owner requested removal of implementation-history commentary (task/decision-
ID references) from code introduced by this task, since production comments must
describe the resulting system, not how the implementation arrived there. Two comments
fixed in this task's own files:

- `AggregateDecider.cs`: dropped a "this task's own... (D38)" reference; now states
  plainly that the internal delegate is free to evolve independently of
  `IAggregateMethodDecider`'s stable public contract.
- `ServiceCollectionExtensions.cs`: dropped a "(D4/D32 idempotency convention)"
  reference from the `IMessageContextAccessor` registration comment.
- Two test files (`AggregateDeciderParameterInjectionTests.cs`,
  `ParameterInjectingAggregate.cs`) had "task 13"/decision-ID references removed from
  their explanatory comments; behavior and assertions unchanged.

No production behavior, public contract, or test assertion changed. `dotnet build` and
`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` re-run clean (71/71). Self-check re-run
and passed. Acceptance-criteria coverage and scope compliance unchanged from the
original review.

---

Re-review (2026-08-12, design correction pass — D42, generalizes the "required
contextual parameter" invariant this task's resolver enforces). Baseline: this file's
prior content (`pass`, no findings). Owner decided declaring a contextual parameter
means the decision requires it — resolution must fail clearly for *any* reason (not only
"unregistered"), never silently degrade to `null`/`Option.None`. Changes in this task's
own files:

- `DecisionMethodParameterResolver.Resolve`: added a `DecisionMethodParameterResolutionException`
  type (naming the declaring method, parameter, and preserving any inner exception) and
  wraps `serviceProvider.GetService(...)` in try/catch, so an exception raised while
  resolving/activating a parameter is represented the same way as "not registered" —
  never an uncontrolled exception escaping DI.
- `AggregateDeciderExtractor.InvokeDecide`: now wraps `methodInfo.Invoke` and unwraps
  `TargetInvocationException`, so a parameter that resolves successfully as a *type* but
  throws when its value is actually read inside the decision method (the general
  mechanism a required contextual capability like task 14's `ICurrentUser<TId, TUser>`
  relies on) surfaces as the same typed `Left`, not an unhandled exception, and produces
  no event.
- Two new fixtures/tests added (`AggregateDeciderParameterInjectionTests.cs`,
  `ParameterInjectingAggregate.cs`): a DI-activation-throwing dependency, and a
  lazily-throwing-value dependency — proving both failure paths above, generically (not
  current-user-specific, per this task's own constraint).
- The existing unregistered-dependency test's assertion was updated from
  `InvalidOperationException` to the new, more specific
  `DecisionMethodParameterResolutionException`.

`IAggregateMethodDecider`/`IDecider`'s public contracts are unchanged; `EventSourcedCommandExecutor`
gains no new logic (D30 unaffected); no new `ProjectReference`. `dotnet build` and
`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` re-run clean (73/73 — 2 new tests
added). Self-check re-run and passed. Acceptance-criteria coverage extended (criterion 5
now also covers activation-failure wrapping); scope compliant.
