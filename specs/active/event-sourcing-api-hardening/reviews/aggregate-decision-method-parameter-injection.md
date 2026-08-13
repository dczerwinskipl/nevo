---
review-of: task
change: event-sourcing-api-hardening
task: aggregate-decision-method-parameter-injection
generated: 2026-08-13
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/aggregate-decision-method-parameter-injection

- [x] Acceptance criteria: 12/12
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-13, D44 targeted correction pass — required-contextual-parameter
timing, no public-contract change). Baseline: this file did not previously exist for this
task; this is its first review, run fresh against the current revision per the owner's
explicit instruction not to reuse stale evidence.

D44 sharpened D42: a required contextual parameter must fail during resolution/activation,
not merely at some point before a `Left` is observed — a dependency that resolves
successfully (construction succeeds) and only throws once the decision method's body has
started executing is an invocation/application failure, not a parameter-resolution
failure. This task's own machinery (`DecisionMethodParameterResolver`,
`AggregateDeciderExtractor.InvokeDecide`/`Invoke`, `ResolveArguments`) already satisfied
this — it was task 14's `CurrentUser<TId, TUser>` (lazy `User` getter) that violated it in
practice. No change to this task's own production code was required.

Changed in scope for this task: `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/
ParameterInjectingAggregate.cs` (removed `ILazyThrowingDependency`/
`LazyThrowingDependency`/`MutateWithLazyThrowingDependency`, which existed solely to
assert the now-rejected "throws after invocation begins counts as resolution failure"
behavior as correct; added `MutateWithCurrentUser`/`MutateWithCurrentUserInvocationCount`,
the real `ICurrentUser<,>`-shaped regression fixture) and `tests/NEvo.Ddd.EventSourcing.
Tests/Deciding/AggregateDeciderParameterInjectionTests.cs` (removed the corresponding
test; added `DecideAsync_RequiredCurrentUserUnavailableAtActivation_FailsBeforeInvocation`,
proving via the real `ICurrentUser<Guid, User<Guid>>` DI path that a required contextual
capability unavailable at activation time yields `DecisionMethodParameterResolutionException`
with `CurrentUserUnavailableException` in the exception chain, the declaring method's own
invocation counter stays at zero, and no event is produced — the concrete D44 regression
this task's own acceptance criterion 5 now requires). `CreateDecider`/`EnterScope` also
gained `IMessageContextAccessor` DI registration (needed for `CurrentUser<,>`'s own
constructor dependency to resolve inside the test's scoped provider, matching production
wiring) and `IDisposable`-based teardown clearing each test's ambient `MessageContext`
after it runs — a pre-existing, unrelated test-isolation hazard (`MessageContextAccessor`'s
`AsyncLocal` storage is process-wide/static; an unrelated test elsewhere in the assembly
can observe a leaked, already-disposed scope) that this task's own new tests made more
likely to surface; reproduced independently on the pre-D44 baseline (same intermittent
failure, a different unrelated test, confirmed via `git stash`) and left otherwise
unfixed as out of scope for this narrow pass.

`IAggregateMethodDecider`/`IDecider`'s public contract, D43's generic-user design, the
parameter-injection architecture, and tasks 15/16 are all unaffected — no change touches
any of them.

Scope: `tests/NEvo.Ddd.EventSourcing.Tests/**`, inside `allowed_paths`; no
`src/NEvo.Messaging.Authorization/**`/`src/NEvo.Messaging.Web/**`/`examples/**`
(`forbidden_paths`) touched by this task.

`dotnet build` and `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` pass (self-check
re-run and passed — retried after one intermittent failure from the pre-existing
cross-test `AsyncLocal` hazard noted above, unrelated to this task's own correctness).
