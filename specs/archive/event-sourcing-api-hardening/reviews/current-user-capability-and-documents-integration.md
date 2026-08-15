---
review-of: task
change: event-sourcing-api-hardening
task: current-user-capability-and-documents-integration
generated: 2026-08-13
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/current-user-capability-and-documents-integration

- [x] Acceptance criteria: 8/8
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-13, D44 targeted correction pass — required-contextual-parameter
timing, no public-contract change). Baseline: this file did not previously exist for this
task; this is its first review, run fresh against the current revision per the owner's
explicit instruction not to reuse stale evidence.

D44 (sharpening D42): `CurrentUser<TId, TUser>` previously satisfied DI construction
unconditionally and only threw `CurrentUserUnavailableException` from the `User` getter —
by which point `AggregateDeciderExtractor.Invoke` had already entered the decision
method's body. Fixed in `src/NEvo.Messaging.Authorization/CurrentUser.cs`: the required
user is now obtained and validated inside the constructor (`User` is a plain,
already-validated `{ get; }` auto-property); `CurrentUserUnavailableException` is thrown
during construction/activation when no message context is active or the current
`UserContext<TId, TUser>` carries no user. `ICurrentUser<TId, TUser>`'s public shape
(`TUser User { get; }`) is unchanged; `Documents.Api`'s `EditableDocument.Approve`
(`currentUser.User.Id`, no `Option`/`Match`/absence handling) needed no change — it
already matched the corrected contract exactly.

`tests/NEvo.Messaging.Authorization.Tests/CurrentUserTests.cs` updated: the
missing-context/missing-user cases now assert failure while *resolving*
`ICurrentUser<Guid, User<Guid>>` (`Build(accessor)` itself throws via
`GetRequiredService`), not merely from reading `.User` afterward — proving the real
activation-time boundary rather than the getter alone.

Scope: `src/NEvo.Messaging.Authorization/**` and
`tests/NEvo.Messaging.Authorization.Tests/**`, both inside `allowed_paths`; no
`src/NEvo.Ddd.EventSourcing/**`/`src/NEvo.Messaging.Web/**`
(`forbidden_paths`) touched by this task.

`dotnet build` and `dotnet test tests/NEvo.Messaging.Authorization.Tests` pass (13/13;
self-check re-run and passed).
