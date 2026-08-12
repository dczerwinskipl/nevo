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

---

Re-review (2026-08-12, design correction pass — D42 required contract, D43 generic
user-type). Baseline: this file's prior content (`pass`, no findings). Two bundled,
owner-directed design changes:

**D42 — `ICurrentUser<TId, TUser>.User` is required, not `Option`-wrapped.** Declaring
it as a decision-method parameter now means the decision requires a current user;
resolving it without one fails contextual-parameter resolution before the decision
method runs, through task 13's generalized resolver contract (see that task's own
re-review) — never a value the aggregate itself checks for absence. `CurrentUser<TId,
TUser>.User` throws `CurrentUserUnavailableException` (new,
`NEvo.Messaging.Authorization`) when no message context is active or the current
`UserContext` carries no user. `EditableDocument.Approve` no longer calls `.Match`;
`DocumentApproved.ApprovedBy` is set directly from `currentUser.User.Id`.

**D43 — the authorization user-context chain becomes generic over the concrete user
type.** `ICurrentUser`, `CurrentUser`, `UserContext`, `MessageContextExtensions.GetUserContext`,
`UserContextMiddleware`, `IUserProvider` (`NEvo.Authorization`), and `ClaimUserProvider`
(`NEvo.Web.Authorization`) all gain a `TUser : User<TId>` generic parameter, owner-
directed mid-implementation. `ClaimUserProvider<TUser, TId>` is now `abstract`; a new
`NEvo.Web.Authorization.Users.DefaultClaimUserProvider<TId> : ClaimUserProvider<User<TId>, TId>`
reproduces its previous default `sub`/`name`-claim mapping for a consumer with no custom
user type. `UserContextMiddleware` was also changed to consume `IUserProvider<TUser,
TId>` as an interface (matching `IRoleProvider`/`IPermissionProvider`'s existing
pattern) rather than a concrete `TUserProvider` constructor parameter — the latter, first
tried, cannot be resolved by DI without also registering the concrete type, a genuine
runtime bug caught while wiring this through, not a style choice. The Documents example
introduces `DemoUser : User<Guid>`.

**Scope note (owner-approved amendment, D43).** This pass necessarily touched
`src/NEvo.Authorization/Users/IUserProvider.cs`, `src/NEvo.Web.Authorization/**`, and
`examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs` — the last of which was
this task's own `forbidden_paths` — because `UserContextMiddleware`/`IUserProvider`/
`ClaimUserProvider` are shared infrastructure `ServiceA.Api` also depends on; leaving it
unfixed would have left the solution non-building. Confirmed directly with the owner
mid-implementation (a closed-menu choice: revert `TUser` outside `NEvo.Messaging.Authorization`,
finish it everywhere, or drop `TUser` entirely — owner chose "finish it everywhere").
This task's frontmatter is amended accordingly: `allowed_paths` now includes
`src/NEvo.Authorization/**`, `src/NEvo.Web.Authorization/**`,
`tests/NEvo.Web.Authorization.Tests/**`, `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**`,
and the one shared characterization test file that needed the same generic-arity fix
(`tests/NEvo.Ddd.EventSourcing.Tests/Characterization/ExplicitHandlerPermissionCompositionTests.cs`);
`ServiceA.Api` is removed from `forbidden_paths` (`ServiceB.Api` stays forbidden —
untouched). This is a specification scope amendment (D43), not a lightweight
`scope_exceptions` entry, per `references/review-policy.md` § "`forbidden_paths` is
categorically excluded" from that lighter path.

`ICurrentUser<TId, TUser>` still exposes identity only (`TUser User`, D42/D43
combined) — no roles, permissions, `IServiceProvider`, headers, or feature-bag access.
No `ApproveDocumentHandler` reintroduced. `dotnet build` (whole solution) and
`dotnet test tests/NEvo.Messaging.Authorization.Tests` (13/13),
`tests/NEvo.Web.Authorization.Tests` (13/13), `tests/NEvo.Ddd.EventSourcing.Tests`
(73/73) all re-run clean. Documents example re-verified live: 200/401/403/200(approve)/500,
with `approvedBy` reflecting the real authenticated user's id end to end. Self-check
re-run and passed. Acceptance-criteria coverage extended (criterion 2 now explicitly
covers the missing-current-user failure path); scope resolved per the amendment above.
