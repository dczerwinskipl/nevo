---
id: packages.nevo-messaging-authorization
type: package
title: NEvo.Messaging.Authorization
status: current
dependencies:
  - NEvo.Messaging
  - NEvo.Authorization
summary: >
  Auth hooks for the message pipeline: populates a per-request UserContext from
  NEvo.Authorization providers and validates per-handler permissions via an attribute.
  No DI registration helper exists yet — see Configuration.
---

# NEvo.Messaging.Authorization

## Purpose

`NEvo.Messaging.Authorization` bridges `NEvo.Authorization`'s user/role/permission
providers into the message pipeline as two opt-in middleware:
`UserContextMiddleware<TId, TRoleDataScope>` (message-level, populates context) and
`ValidatePermissionMiddleware<TId>` (handler-level, enforces `[AllowPermission]`).

## When to use

Whenever handlers need permission checks based on the current user's roles. See
`docs/usage/authorization.md` for the complete end-to-end wiring walkthrough — there is
no DI registration helper, so manual setup is required either way.

## When not to use

If you don't need per-handler permission checks — e.g. a service with no user-facing
authorization concerns — skip this package entirely; `NEvo.Messaging` works without it.

## Responsibilities

- Populate a `UserContext<TId>` message-context feature from either an incoming
  `user-context` header (JSON, for propagation across service boundaries) or, if
  absent, directly from `IUserProvider<TId>`/`IRoleProvider<TRoleDataScope>`/
  `IPermissionProvider<TRoleDataScope>` (`UserContextMiddleware<TId, TRoleDataScope>`).
- Enforce permission checks on handler methods annotated with `[AllowPermission(name,
  validatorType)]`, using a per-attribute `IDataScopeMessageValidator`
  (`ValidatePermissionMiddleware<TId>`).
- Define `UserContext<TId>` (user, roles, permissions — the last excluded from JSON
  serialization via `[JsonIgnore]`) and the `IDataScopeMessageValidator`/
  `IDataScopeMessageValidator<TDataScope, TMessage>` contract.

## Dependencies

Depends on `NEvo.Messaging` and `NEvo.Authorization` — see
`src/NEvo.Messaging.Authorization/NEvo.Messaging.Authorization.csproj`.

## Public surface

Grounded directly in `src/NEvo.Messaging.Authorization/*.cs`.

```csharp
public class UserContextMiddleware<TId, TRoleDataScope>(
    IUserProvider<TId> userProvider,
    IRoleProvider<TRoleDataScope> roleProvider,
    IPermissionProvider<TRoleDataScope> permissionProvider
) : IMessageProcessingMiddleware where TRoleDataScope : AuthDataScope;

[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public class AllowPermissionAttribute(string name, Type validatorType) : Attribute
{
    public string PermissionName { get; }
    public Type ValidatorType { get; }
}

public class ValidatePermissionMiddleware<TId>(IServiceProvider serviceProvider)
    : IMessageProcessingHandlerMiddleware;

public interface IDataScopeMessageValidator<TDataScope, TMessage>
    where TDataScope : AuthDataScope where TMessage : Message
{
    bool Validate(TDataScope dataScope, TMessage message);
}
```

`context.GetUserContext<TId>()` (a `MessageContextExtensions` helper, backed by
`IMessageContext`'s feature storage from [`NEvo.Messaging.md`](NEvo.Messaging.md)) is
how a handler reads the populated `UserContext<TId>` after `UserContextMiddleware` has
run.

### How permission validation actually works

`ValidatePermissionMiddleware<TId>` runs before the handler (it's an
`IMessageProcessingHandlerMiddleware`). For a handler method with an `[AllowPermission
(name, validatorType)]` attribute:

1. It instantiates `validatorType` via `ActivatorUtilities.CreateInstance` (DI-resolved
   constructor dependencies are supported).
2. It iterates **every permission the current user has**
   (`context.GetUserContext<TId>().UserPermissions`, populated earlier by
   `UserContextMiddleware`) and calls `validator.Validate(permission, message)` for
   each.
3. Access is granted the moment **any** permission validates successfully; if none do
   (including when the user has zero permissions), access is denied.

`AllowPermissionAttribute.PermissionName` is not checked against the user's permission
names in this flow — see `docs/project/known-issues.md` § "`AllowPermissionAttribute.PermissionName`
is not checked" before relying on it.

### What happens when validation fails

`ValidatePermissionMiddleware` short-circuits the handler-level middleware chain and
returns `Either<Exception, object>.Left(new Exception("Permission denied"))` — the
handler itself never runs. This propagates unchanged through
`IMessageProcessor.ProcessMessageAsync` (no exception is thrown; it's the `Left` side of
the returned `Either`, per NEvo's repository-wide error convention — see
[`NEvo.Core.md`](NEvo.Core.md)). If you're exposing this over HTTP via
`NEvo.Messaging.Web`, see `docs/project/known-issues.md` § "Authorization surfaces a
generic HTTP 500, not 403" for what a client actually sees.

## Configuration

**No DI registration helper exists.** `src/NEvo.Messaging.Authorization/
ServiceCollectionExtensions.cs` is an empty `public static class
ServiceCollectionExtensions { }` — unlike most other NEvo packages, there is no
`AddXxx()` convenience method. Full wiring, in order:

```csharp
// 1. NEvo.Messaging + NEvo.Messaging.Cqrs (if you're using commands)
builder.Services.AddMessages();
builder.Services.AddCommands();

// 2. NEvo.Web.Authorization — supplies IUserProvider/IRoleProvider/IPermissionProvider
builder.Services.AddHttpContextAccessor();
builder.Services.AddClaimsAuthorization<Guid, MyDataScope>();

// 3. This package — both middleware, registered manually
builder.Services.AddMessageProcessingMiddleware<UserContextMiddleware<Guid, MyDataScope>>();
builder.Services.AddMessageProcessingHandlerMiddleware<ValidatePermissionMiddleware<Guid>>();
```

`UserContextMiddleware` must run (as message-level middleware) before
`ValidatePermissionMiddleware` (handler-level middleware) gets a chance to read
`UserPermissions` — this is guaranteed by the pipeline's two separate middleware stages,
not by registration order within either stage.

See `docs/usage/authorization.md` for the full end-to-end walkthrough with a worked
example.

## Limitations

- No DI registration helper — see "Configuration". Both middleware must be wired up
  manually, in the right stage (message-level vs. handler-level).
- Permission-denied failures surface as a generic HTTP `500` when using
  `NEvo.Messaging.Web`'s default endpoint mapping, not `403` — see
  `docs/project/known-issues.md`.
- `AllowPermissionAttribute.PermissionName` is not matched against the user's
  permissions by this middleware — see `docs/project/known-issues.md`. Don't assume
  declaring a name is sufficient; the validator's own logic is what actually gates
  access.
- `AllowPermissionAttribute`'s constructor-time check that `validatorType` implements
  `IDataScopeMessageValidator<,>` is disabled — see `docs/project/known-issues.md`.
- `UserContextMiddleware`'s header-name (`"user-context"`) and whether to trust header
  data at all are both unresolved design questions in source — no constant, no
  configurable trust policy yet.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends.
- [`NEvo.Authorization`](NEvo.Authorization.md) — source of the user/role/permission
  providers this package bridges into the pipeline.
- [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) — the ASP.NET Core-facing
  provider implementations this package's middleware typically consumes.

## Examples and tests

No dedicated `tests/NEvo.Messaging.Authorization.Tests/` project exists in this
repository today.
