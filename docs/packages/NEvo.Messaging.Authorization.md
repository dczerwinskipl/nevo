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

Depends on `NEvo.Messaging` and `NEvo.Authorization` — confirmed against
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

**`AllowPermissionAttribute.PermissionName` is not checked against the user's
permission names anywhere in this flow** — matching is defined entirely by the
validator you provide (`IDataScopeMessageValidator<TDataScope, TMessage>`'s default
`Validate(IPermission, IMessage)` only checks that the permission's runtime type is
`Permission<TDataScope>` and the message's type is `TMessage`, then calls your
`Validate(TDataScope, TMessage)`). Treat `PermissionName` as documentation/metadata for
the attribute, not as part of the enforcement logic, unless your own validator
implementation chooses to check `permission.Name` itself.

### What happens when validation fails

`ValidatePermissionMiddleware` short-circuits the handler-level middleware chain and
returns `Either<Exception, object>.Left(new Exception("Permission denied"))` — the
handler itself never runs. This propagates unchanged through
`IMessageProcessor.ProcessMessageAsync` (no exception is thrown; it's the `Left` side of
the returned `Either`, per NEvo's repository-wide error convention — see
[`NEvo.Core.md`](NEvo.Core.md)).

**If you're exposing this over HTTP via `NEvo.Messaging.Web`'s
`MapCommandEndpoint`/`MapMessagesEndpoints`, a permission-denied failure currently comes
back as HTTP `500` with `detail: "Permission denied"`** — those route helpers map every
`Left` the same way (`Results.Problem(statusCode: 500)`), with no special case for
authorization failures (see [`NEvo.Messaging.Web.md`](NEvo.Messaging.Web.md) §
Limitations). If your API needs a `403 Forbidden` instead, you need your own
result-handling layer that inspects the exception message/type before it reaches
`NEvo.Messaging.Web`'s default mapping — there is no built-in way to distinguish a
permission-denied `Left` from any other failure `Left` today.

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
`UserPermissions` — this is guaranteed by the pipeline's two separate middleware stages
(see [`NEvo.Messaging.md`](NEvo.Messaging.md) § Advanced usage), not by registration
order within either stage.

## Basic usage

```csharp
public class MyHandler : ICommandHandler<MyCommand>
{
    [AllowPermission("orders:create", typeof(OrderScopeValidator))]
    public Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask;
}

public class OrderScopeValidator : IDataScopeMessageValidator<OrderDataScope, MyCommand>
{
    // Called once per permission the current user has, of type Permission<OrderDataScope>.
    // Return true to grant access for that permission.
    public bool Validate(OrderDataScope dataScope, MyCommand message) => true;
}
```

## Advanced usage

Propagating user context across a service boundary: `UserContextMiddleware` checks for
a `user-context` header (JSON-serialized `UserWithRoles`) before falling back to the
local providers — a calling service can pre-populate this header so the receiving
service doesn't need to re-resolve the user from its own identity source.

## Limitations

- No DI registration helper — see "Configuration". Both middleware must be wired up
  manually, in the right stage (message-level vs. handler-level).
- Permission-denied failures surface as a generic HTTP `500` when using
  `NEvo.Messaging.Web`'s default endpoint mapping, not `403` — see "What happens when
  validation fails" above.
- `AllowPermissionAttribute.PermissionName` is not matched against the user's
  permissions by this middleware — see "How permission validation actually works".
  Don't assume declaring a name is sufficient; the validator's own logic is what
  actually gates access.
- `AllowPermissionAttribute`'s constructor has its `validatorType`-implements-
  `IDataScopeMessageValidator<,>` check commented out in source, with `// TODO fix that,
  something from with generics` — an incorrect `validatorType` is not caught until the
  handler actually runs (`ValidatePermissionMiddleware` casts it via
  `ActivatorUtilities.CreateInstance`, which throws at that point instead).
- `UserContextMiddleware`'s header-name (`"user-context"`) and whether to trust header
  data at all are both marked `// todo` in source — no constant, no configurable
  trust policy yet.

## Related packages

- [`NEvo.Messaging`](NEvo.Messaging.md) — the package this one extends.
- [`NEvo.Authorization`](NEvo.Authorization.md) — source of the user/role/permission
  providers this package bridges into the pipeline.
- [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) — the ASP.NET Core-facing
  provider implementations this package's middleware typically consumes.

## Examples and tests

No dedicated `tests/NEvo.Messaging.Authorization.Tests/` project exists in this
repository today.
