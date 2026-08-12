# Area: Current-user capability and Documents integration

## Responsibility

Introduce a small, application/domain-facing capability for the authenticated/current
user, and use it (via task 13's parameter injection) to replace the Documents example's
`Guid.NewGuid()` `ApprovedBy` placeholder with the real authenticated user's id.

## Current state

No `ICurrentUser`-shaped abstraction exists anywhere in the repository today (confirmed
by search). The closest existing concept is `UserContext<TId>`
(`src/NEvo.Messaging.Authorization/UserContext.cs:10-30`):

```csharp
public class UserContext<TId>
{
    public Option<User<TId>> User { get; set; }
    public IEnumerable<IRole> UserRoles { get; set; } = [];
    [JsonIgnore] public IEnumerable<IPermission> UserPermissions { get; set; } = [];
    // + GetRoles/GetRole/GetPermissions/GetPermission<TDataScope>
}
```

`UserContext<TId>.User` is already `Option<User<TId>>` — the exact shape this area's
capability wants to expose. `UserContext<TId>` is retrieved via
`context.GetUserContext<TId>()` (`MessageContextExtensions.cs:7-10`), a thin wrapper over
`IMessageContext.GetFeature<UserContext<TId>>()` — i.e. it is a feature-bag entry, not a
first-class `IMessageContext` member. It is populated by `UserContextMiddleware<TId,
TRoleDataScope>` (`UserContextMiddleware.cs:15-71`) from a `"user-context"` header or
`IUserProvider<TId>`/`IRoleProvider`/`IPermissionProvider`. `IMessageContextAccessor`
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

- `ICurrentUser<TId>` (exact name may be refined only if an existing NEvo naming
  convention gives a clearly better option — no such convention was found during
  discovery, so this is the working name unless implementation finds otherwise):

  ```csharp
  public interface ICurrentUser<TId>
  {
      Option<User<TId>> User { get; }
  }
  ```

- Lives in `NEvo.Messaging.Authorization` (identity/authorization context), not
  `NEvo.Ddd.EventSourcing` (Event Sourcing core stays generic per task 13's own
  constraint — it resolves `ICurrentUser<TId>` by type through DI, with no compile-time
  reference to it).
- The implementation adapts `IMessageContextAccessor`/`UserContext<TId>` internally
  (`accessor.MessageContext?.GetUserContext<TId>().User`, or equivalent) — consumers of
  `ICurrentUser<TId>` never need to know this internal representation, never call
  `GetFeature`/`GetUserContext` themselves.
- Register `ICurrentUser<TId>` via an addition to `NEvo.Messaging.Authorization`'s
  `ServiceCollectionExtensions` (currently an empty stub class,
  `src/NEvo.Messaging.Authorization/ServiceCollectionExtensions.cs`) — e.g. an
  `AddCurrentUser<TId>()` method, scoped lifetime (matching `IMessageContextAccessor`'s
  own ambient-per-operation lifetime), registered with `TryAdd*` for idempotency
  (matching this specification's own established DI convention, D4/D32). The Documents
  example calls it from its existing `AddDocumentsAuthorization()`
  (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/ServiceCollectionExtensions.cs:31-48`).
- Documents integration: replace `EditableDocument.Approve(ApproveDocument command)` with
  `EditableDocument.Approve(ApproveDocument command, ICurrentUser<Guid> currentUser)`
  (task 13's parameter injection), and set `ApprovedBy` from `currentUser.User` instead
  of `Guid.NewGuid()`. If `currentUser.User` is `None` at decision time, `Approve` itself
  decides how to respond (e.g. returns a `Left`) — this area does not mandate a specific
  new exception type for that case, only that the aggregate no longer fabricates an
  identity.
- Remove the placeholder `<remarks>` on `EditableDocument.Approve` once it is no longer
  true; replace with documentation reflecting the actual, final behavior (business
  meaning/framework contract, not task/decision-history wording — see `overview.md` §
  "Canonical comments/documentation quality").

## Constraints (do not expose)

`ICurrentUser<TId>` exposes identity only. It must never expose, directly or indirectly:

- roles or permissions (`UserContext<TId>.UserRoles`/`UserPermissions` stay internal to
  the adapter, not surfaced),
- `IServiceProvider`,
- raw headers or `IMessageContext` itself,
- feature-bag getters/setters (`GetFeature`/`SetFeature`),
- correlation/causation identifiers,
- mutable authorization state (no setters; `User` is read-only).

Authorization stays the responsibility of the authorization pipeline
(`ValidatePermissionMiddleware`, the message-level/handler-level permission checks,
task 07) — `ICurrentUser<TId>` is identity-only and must not become a second,
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
folded into `ICurrentUser<TId>`.

## Interfaces and boundaries

- Consumes: task 13's parameter-injection mechanism (the actual wiring that lets
  `Approve` declare `ICurrentUser<Guid> currentUser`); `IMessageContextAccessor`/
  `UserContext<TId>` (existing, `NEvo.Messaging.Authorization`/`NEvo.Messaging`).
- Produces: `ICurrentUser<TId>`, consumed by the Documents example's
  `EditableDocument.Approve`; available to any future aggregate decision method that
  needs identity without exposing anything broader.

## Area-specific acceptance criteria

1. `ICurrentUser<TId>.User` returns `Option<User<TId>>`, matching the currently
   authenticated user when one exists in the current `IMessageContext`, `None`
   otherwise (test: with and without a populated `UserContext<TId>`).
2. `ICurrentUser<TId>` exposes no member beyond `User` (inspection).
3. `EditableDocument.Approve` declares `ICurrentUser<Guid> currentUser` as its second
   parameter and produces `DocumentApproved` with `ApprovedBy` set from the resolved
   current user's id, not `Guid.NewGuid()` (inspection + manual walkthrough, task 10's
   walkthrough note updated).
4. `EditableDocument.Approve`'s `<remarks>` no longer states the placeholder/missing-
   capability limitation (inspection) — it documents the real, final behavior instead.
5. `ApproveDocumentHandler`/`ApproveDocumentDecision` are not reintroduced; `Approve`
   remains reachable only through the Level 1 aggregate-method convention (inspection,
   preserves D33).
6. No test or production code accesses roles, permissions, `IServiceProvider`,
   `IMessageContext`, or feature-bag members through `ICurrentUser<TId>` (inspection).
7. `dotnet build` succeeds; the Documents example's manual walkthrough (task 10) is
   updated to show the real `ApprovedBy` value end to end (no dedicated test project
   for the example itself, per D12 — unaffected by this area).

## Dependencies

- `decision-method-parameter-injection` (task 13) — `ICurrentUser<TId>` is only usable
  by `Approve` once task 13's mechanism exists.
- `documents-example-es-and-auth-demo` (task 10) — modifies the example it created.
- `message-level-and-aggregate-authorization` (task 07) — same package
  (`NEvo.Messaging.Authorization`) and existing authorization-pipeline boundary.

## Out of scope

- Roles/permissions exposure through `ICurrentUser<TId>`.
- Any change to the authorization pipeline itself (task 15's concern is HTTP mapping of
  its failures, not identity resolution).
- A general `IContext`/`IUserContext` abstraction, or correlation/causation exposure.
- Registering `ICurrentUser<TId>` for any package other than `NEvo.Messaging.Authorization`
  and the Documents example that consumes it.
