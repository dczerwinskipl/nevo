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

## Configuration

**No DI registration helper exists.** `src/NEvo.Messaging.Authorization/
ServiceCollectionExtensions.cs` is an empty `public static class
ServiceCollectionExtensions { }` — unlike most other NEvo packages, there is no
`AddXxx()` convenience method. A consumer must register both middleware manually:

```csharp
builder.Services.AddMessageProcessingMiddleware<UserContextMiddleware<Guid, MyDataScope>>();
builder.Services.AddMessageProcessingHandlerMiddleware<ValidatePermissionMiddleware<Guid>>();
```

(`AddMessageProcessingMiddleware`/`AddMessageProcessingHandlerMiddleware` are
`NEvo.Messaging` extension methods — see [`NEvo.Messaging.md`](NEvo.Messaging.md) §
Advanced usage.) A consumer also needs `NEvo.Web.Authorization`'s
`AddClaimsAuthorization<TId, TRoleDataScope>()` (or an equivalent manual registration of
`IUserProvider`/`IRoleProvider`/`IPermissionProvider`) for `UserContextMiddleware`'s
constructor dependencies to resolve.

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
  manually.
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
- `NEvo.Authorization` — source of the user/role/permission providers this package
  bridges into the pipeline. Not yet documented (see task
  `package-docs-auth-and-persistence`).
- `NEvo.Web.Authorization` — the ASP.NET Core-facing provider implementations this
  package's middleware typically consumes (see
  [`NEvo.Web.Authorization.md`](NEvo.Web.Authorization.md)).

## Examples and tests

No dedicated `tests/NEvo.Messaging.Authorization.Tests/` project exists in this
repository today.
