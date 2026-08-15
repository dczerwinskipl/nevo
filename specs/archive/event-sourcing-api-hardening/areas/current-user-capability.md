# Area: Current-user capability and Documents integration

## Responsibility

Introduce a small, application/domain-facing capability for the authenticated/current
user, and use it (via task 13's parameter injection) to replace the Documents example's
`Guid.NewGuid()` `ApprovedBy` placeholder with the real authenticated user's id.

## Current state

No `ICurrentUser`-shaped abstraction exists anywhere in the repository today (confirmed
by search). The closest existing concept is `UserContext<TId, TUser>`
(`src/NEvo.Messaging.Authorization/UserContext.cs`), itself generic over the concrete
user type (`TUser : User<TId>`) so a consumer with its own user shape (e.g. the Documents
example's `DemoUser`) is not forced onto the base `User<TId>` record:

```csharp
public class UserContext<TId, TUser> where TUser : User<TId>
{
    public Option<TUser> User { get; set; }
    public IEnumerable<IRole> UserRoles { get; set; } = [];
    [JsonIgnore] public IEnumerable<IPermission> UserPermissions { get; set; } = [];
    // + GetRoles/GetRole/GetPermissions/GetPermission<TDataScope>
}
```

`UserContext<TId, TUser>.User` is already `Option<TUser>` — the exact shape this area's
capability wants to expose (narrowed to non-optional at the `ICurrentUser<TId, TUser>`
boundary, D42). `UserContext<TId, TUser>` is retrieved via
`context.GetUserContext<TId, TUser>()` (`MessageContextExtensions.cs`), a thin wrapper
over `IMessageContext.GetFeature<UserContext<TId, TUser>>()` — i.e. it is a feature-bag
entry, not a first-class `IMessageContext` member. It is populated by
`UserContextMiddleware<TId, TUser, TRoleDataScope>` (`UserContextMiddleware.cs`) from a
`"user-context"` header or `IUserProvider<TUser, TId>`/`IRoleProvider`/
`IPermissionProvider`. `IMessageContextAccessor`
(`src/NEvo.Messaging/Context/IMessageContextAccessor.cs:3-6`) exposes the current
`IMessageContext?` via `AsyncLocal`-backed ambient access
(`MessageContextAccessor.cs:3-36`).

`EditableDocument.Approve(ApproveDocument command)`
(`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/Document.cs:47-50`) currently
generates `ApprovedBy: Guid.NewGuid()`, documented in a `<remarks>` block as an explicit
placeholder pending exactly this capability (D33). `ApproveDocumentHandler`/
`ApproveDocumentDecision` were removed by D33 specifically because wrapping this
placeholder in an explicit Level 2 handler added indirection without a genuine
orchestration need — D33's own text names the missing capability this area now adds.

## Requirements

- `ICurrentUser<TId, TUser>` (exact name may be refined only if an existing NEvo naming
  convention gives a clearly better option — no such convention was found during
  discovery, so this is the working name unless implementation finds otherwise). Generic
  over the concrete user type (`TUser : User<TId>`), matching `UserContext<TId, TUser>`
  and `IUserProvider<TUser, TId>`, so a consumer with its own user shape is not forced
  onto the base `User<TId>` record:

  ```csharp
  public interface ICurrentUser<TId, TUser> where TUser : User<TId>
  {
      TUser User { get; }
  }
  ```

  **Non-optional (D42).** Declaring `ICurrentUser<TId, TUser>` as a decision-method
  parameter means the decision requires a current authenticated user — the framework
  resolves it successfully or does not invoke the decision method at all. `User` is never
  `Option`-wrapped; no `None`/absence handling is exposed to or required from the
  aggregate.

- Lives in `NEvo.Messaging.Authorization` (identity/authorization context), not
  `NEvo.Ddd.EventSourcing` (Event Sourcing core stays generic per task 13's own
  constraint — it resolves `ICurrentUser<TId, TUser>` by type through DI, with no
  compile-time reference to it).
- The implementation adapts `IMessageContextAccessor`/`UserContext<TId, TUser>`
  internally — consumers of `ICurrentUser<TId, TUser>` never need to know this internal
  representation, never call `GetFeature`/`GetUserContext` themselves. When no message
  context is active, or the current `UserContext<TId, TUser>` carries no user, resolving
  `ICurrentUser<TId, TUser>` fails clearly (D42) — through task 13's decision-method-
  parameter-resolution failure path, not by returning a value the aggregate must itself
  check for absence. **The check must happen during construction/activation (D44), not
  from the `User` getter** — a decision method must never be entered before the current
  user's availability has been validated. `User` is a plain, already-validated property
  read once a `CurrentUser<TId, TUser>` instance exists; the observable contract is what
  matters either way — a resolved `ICurrentUser<TId, TUser>` always carries a real user.
- Register `ICurrentUser<TId, TUser>` via an addition to `NEvo.Messaging.Authorization`'s
  `ServiceCollectionExtensions` (currently an empty stub class,
  `src/NEvo.Messaging.Authorization/ServiceCollectionExtensions.cs`) — e.g. an
  `AddCurrentUser<TId, TUser>()` method, scoped lifetime (matching
  `IMessageContextAccessor`'s own ambient-per-operation lifetime), registered with
  `TryAdd*` for idempotency (matching this specification's own established DI
  convention, D4/D32). The Documents example calls it from its existing
  `AddDocumentsAuthorization()`
  (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/ServiceCollectionExtensions.cs`)
  with its own `DemoUser : User<Guid>` as `TUser`.
- Documents integration: replace `EditableDocument.Approve(ApproveDocument command)` with
  `EditableDocument.Approve(ApproveDocument command, ICurrentUser<Guid, DemoUser> currentUser)`
  (task 13's parameter injection), and set `ApprovedBy` directly from
  `currentUser.User.Id` instead of `Guid.NewGuid()`. `Approve` contains no `None`/absence
  handling (D42) — if no current user is available, the decision method is never invoked;
  the framework's parameter-resolution failure (task 13) is what the caller observes, not
  a value `Approve` itself branches on.
- Remove the placeholder `<remarks>` on `EditableDocument.Approve` once it is no longer
  true; replace with documentation reflecting the actual, final behavior (business
  meaning/framework contract, not task/decision-history wording — see `overview.md` §
  "Canonical comments/documentation quality").

## Constraints (do not expose)

`ICurrentUser<TId, TUser>` exposes identity only. It must never expose, directly or
indirectly:

- roles or permissions (`UserContext<TId, TUser>.UserRoles`/`UserPermissions` stay
  internal to the adapter, not surfaced),
- `IServiceProvider`,
- raw headers or `IMessageContext` itself,
- feature-bag getters/setters (`GetFeature`/`SetFeature`),
- correlation/causation identifiers,
- mutable authorization state (no setters; `User` is read-only).

Authorization stays the responsibility of the authorization pipeline
(`ValidatePermissionMiddleware`, the message-level/handler-level permission checks,
task 07) — `ICurrentUser<TId, TUser>` is identity-only and must not become a second,
parallel authorization surface. If a business rule needs something richer than identity
(e.g. "only the document's creator may approve it"), it is expressed as an explicit
business policy/capability parameter (task 13's mechanism already supports this —
`SomeBusinessPolicy` in the owner's own example), not by inspecting security roles from
inside the aggregate.

Do not recreate an explicit `ApproveDocumentHandler` solely to obtain the current user —
that is exactly the indirection D33 removed; the parameter-injection path is the whole
point of this area.

Do not create a generic `IContext`/`IUserContext` god object here or in any future
extension of this capability — correlation/causation and other future read-only facts
get their own dedicated abstraction later, reusing task 13's injection mechanism, not
folded into `ICurrentUser<TId, TUser>`.

## Interfaces and boundaries

- Consumes: task 13's parameter-injection mechanism (the actual wiring that lets
  `Approve` declare `ICurrentUser<Guid, DemoUser> currentUser`); `IMessageContextAccessor`/
  `UserContext<TId, TUser>` (existing, `NEvo.Messaging.Authorization`/`NEvo.Messaging`).
- Produces: `ICurrentUser<TId, TUser>`, consumed by the Documents example's
  `EditableDocument.Approve`; available to any future aggregate decision method that
  needs identity without exposing anything broader.

## Area-specific acceptance criteria

1. `ICurrentUser<TId, TUser>.User` returns `TUser` matching the currently authenticated
   user when the current `IMessageContext`'s `UserContext<TId, TUser>` carries one (test).
2. When no current user is available (no active message context, or an unpopulated
   `UserContext<TId, TUser>`), resolving `ICurrentUser<TId, TUser>` fails during
   construction/activation — before the decision method is invoked at all (test, D44) —
   and the caller observes a parameter-resolution failure (`Left`), not a fabricated or
   default user (test, D42).
3. `ICurrentUser<TId, TUser>` exposes no member beyond `User` (inspection).
4. `EditableDocument.Approve` declares `ICurrentUser<Guid, DemoUser> currentUser` as its
   second parameter and produces `DocumentApproved` with `ApprovedBy` set from the
   resolved current user's id, not `Guid.NewGuid()` (inspection + manual walkthrough,
   task 10's walkthrough note updated). `Approve` contains no `Option`/`None`-handling
   for the current user (inspection, D42).
5. `EditableDocument.Approve`'s `<remarks>` no longer states the placeholder/missing-
   capability limitation (inspection) — it documents the real, final behavior instead.
6. `ApproveDocumentHandler`/`ApproveDocumentDecision` are not reintroduced; `Approve`
   remains reachable only through the Level 1 aggregate-method convention (inspection,
   preserves D33).
7. No test or production code accesses roles, permissions, `IServiceProvider`,
   `IMessageContext`, or feature-bag members through `ICurrentUser<TId, TUser>`
   (inspection).
8. `dotnet build` succeeds; the Documents example's manual walkthrough (task 10) is
   updated to show the real `ApprovedBy` value end to end (no dedicated test project
   for the example itself, per D12 — unaffected by this area).

## Dependencies

- `decision-method-parameter-injection` (task 13) — `ICurrentUser<TId, TUser>` is only
  usable by `Approve` once task 13's mechanism exists.
- `documents-example-es-and-auth-demo` (task 10) — modifies the example it created.
- `message-level-and-aggregate-authorization` (task 07) — same package
  (`NEvo.Messaging.Authorization`) and existing authorization-pipeline boundary.

## Out of scope

- Roles/permissions exposure through `ICurrentUser<TId, TUser>`.
- Any change to the authorization pipeline itself (task 15's concern is HTTP mapping of
  its failures, not identity resolution).
- A general `IContext`/`IUserContext` abstraction, or correlation/causation exposure.
- Registering `ICurrentUser<TId, TUser>` for any package other than
  `NEvo.Messaging.Authorization` and the Documents example that consumes it.
- An optional/`Option<TUser>`-shaped current-user access convention (D42) —
  `ICurrentUser<TId, TUser>` always means "required"; a genuinely optional contextual
  capability, if ever needed, gets its own explicit representation in a future change,
  not a second convention added here.
- A dedicated HTTP status mapping (e.g. 503) for a missing-current-user or other
  contextual-parameter resolution failure — it follows the existing generic
  application/framework failure → 500 mapping (D42), never 403.
