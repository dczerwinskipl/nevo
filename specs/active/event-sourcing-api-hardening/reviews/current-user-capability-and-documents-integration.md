---
review-of: task
change: event-sourcing-api-hardening
task: current-user-capability-and-documents-integration
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/current-user-capability-and-documents-integration

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-12, targeted post-review correction pass — comment/documentation
cleanup only, no design change). Baseline: this file's prior content (`pass`, no
findings). Owner found two XML-documentation inaccuracies and one workflow-history
comment in this task's own files:

- `CurrentUser.cs`: the adapter's doc comment claimed to be "the only place this
  internal representation is read," which is false — `ValidatePermissionMiddleware`
  also reads `UserContext<TId>` directly for its own, separate purpose. Corrected to
  describe `CurrentUser<TId>` as adapting `IMessageContextAccessor`/`UserContext<TId>`
  into the narrow `ICurrentUser<TId>` capability, without the overreaching claim.
- `ServiceCollectionExtensions.AddCurrentUser<TId>`: the doc comment described
  `IMessageContextAccessor` as having an "ambient-per-operation lifetime" in a way that
  read as a scoped DI registration — `IMessageContextAccessor` is actually registered
  `Singleton` and exposes ambient state via `AsyncLocal`. Corrected to describe
  `AddCurrentUser<TId>` as registering a scoped `ICurrentUser<TId>` that reads the
  ambient authorization context for the current message invocation, without
  characterizing the accessor's own lifetime.
- `CurrentUserTests.cs`: a comment justifying the DI-resolution test pattern by
  reference to "the same precedent `AggregateDecider`'s own registration test already
  established" was reworded to explain the pattern directly (DI resolution because
  `CurrentUser<TId>` is internal).

`ICurrentUser<TId>`'s shape (`Option<User<TId>> User`, identity only) is unchanged. No
production behavior or public contract changed. `dotnet build` and
`dotnet test tests/NEvo.Messaging.Authorization.Tests` re-run clean (13/13). Self-check
re-run and passed. Acceptance-criteria coverage and scope compliance unchanged from the
original review.
