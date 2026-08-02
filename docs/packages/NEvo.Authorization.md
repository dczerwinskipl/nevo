---
id: packages.nevo-authorization
type: package
title: NEvo.Authorization
status: current
dependencies:
  - NEvo.Core
summary: >
  Core authorization abstractions: user/role/permission provider contracts and a
  data-scope-aware role/permission model. Transport-agnostic — consumed by both
  NEvo.Messaging.Authorization and NEvo.Web.Authorization.
---

# NEvo.Authorization

## Purpose

`NEvo.Authorization` defines the provider abstractions (`IUserProvider<TId>`,
`IRoleProvider<T>`, `IPermissionProvider<T>`) and data model (`User<T>`, `Role<T>`,
`Permission<T>`, `AuthDataScope`) that concrete, transport-specific packages implement.
It has no knowledge of HTTP or messaging — those concerns live in
[`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) and `NEvo.Messaging.Authorization`
respectively.

## Responsibilities

- Define the user contract (`IUserProvider<TId>` → `Option<User<TId>>`).
- Define the role contract, generic over a data scope (`IRoleProvider<T>` →
  `IEnumerable<Role<T>>`, `T : AuthDataScope`).
- Define the permission contract and its default role→permission mapping mechanism
  (`IPermissionProvider<T>`, the concrete `PermissionProvider<T>`, and the
  `IPermissionMapper<T>` a consumer implements to map a role to permissions).
- Define `AuthDataScope` — the abstract base every role/permission's generic scope type
  derives from, letting roles/permissions carry domain-specific scoping data (e.g. a
  tenant or organization ID) without this package knowing what that data is.

## Dependencies

Depends only on `NEvo.Core` — confirmed against
`src/NEvo.Authorization/NEvo.Authorization.csproj`'s single `ProjectReference`.

## Public surface

Grounded directly in `src/NEvo.Authorization/**/*.cs`.

```csharp
public abstract record AuthDataScope;

public record User<T>(T Id, string UserName);

public interface IUserProvider<TId>
{
    Option<User<TId>> GetUser();
}
```

```csharp
public interface IRole { string Name { get; } }
public record Role<T>(string Name, T DataScope) : IRole where T : AuthDataScope;

public interface IRoleProvider<T> where T : AuthDataScope
{
    IEnumerable<Role<T>> GetRoles();
}
```

```csharp
public interface IPermission { string Name { get; } }
public record Permission<T>(string Name, T DataScope) : IPermission where T : AuthDataScope;

public interface IPermissionProvider<T> where T : AuthDataScope
{
    IEnumerable<IPermission> GetPermissions(IEnumerable<Role<T>> roles);
}

public interface IPermissionMapper<T> where T : AuthDataScope
{
    bool CanMapRole(Role<T> role);
    IEnumerable<IPermission> MapRole(Role<T> role);
}
```

`PermissionProvider<T>` (the default `IPermissionProvider<T>`) takes an
`IEnumerable<IPermissionMapper<T>>` and, for each role, applies every mapper whose
`CanMapRole` returns true — a consumer's own domain defines the actual role→permission
rules by implementing `IPermissionMapper<T>`, not this package.

`PermissionExtensions` provides wildcard-aware data-scope string matching
(`"*".AllowedForAll()`, `value.AllowedFor(other)`) — a convention for `AuthDataScope`
subtypes that carry a string scope value, not an enforced part of the type itself.

## Configuration

No DI registration extension exists in this package. Consumers register concrete
implementations of the three provider interfaces — most commonly via
[`NEvo.Web.Authorization`](NEvo.Web.Authorization.md)'s `AddClaimsAuthorization<TId,
TRoleDataScope>()`, which registers `PermissionProvider<TRoleDataScope>` (this
package's own implementation) alongside its own `IUserProvider`/`IRoleProvider`.

## Basic usage

```csharp
public record TenantDataScope(string TenantId) : AuthDataScope;

public class OrderPermissionMapper : IPermissionMapper<TenantDataScope>
{
    public bool CanMapRole(Role<TenantDataScope> role) => role.Name == "OrderManager";
    public IEnumerable<IPermission> MapRole(Role<TenantDataScope> role)
        => [new Permission<TenantDataScope>("orders:manage", role.DataScope)];
}

builder.Services.AddSingleton<IPermissionMapper<TenantDataScope>, OrderPermissionMapper>();
```

## Advanced usage

Multiple `IPermissionMapper<T>` implementations can be registered together —
`PermissionProvider<T>` applies every mapper whose `CanMapRole` matches a given role, so
a single role can contribute permissions from more than one mapper (e.g. a shared
"read-only" mapper plus a role-specific mapper).

## Limitations

- No built-in role or permission persistence/storage — this package only defines the
  contracts. Where roles/permissions actually come from (claims, a database, a remote
  service) is entirely up to the provider implementation.
- `AuthDataScope` is an empty abstract marker record — it carries no shared members of
  its own; all scope data lives on the concrete subtype a consumer defines.

## Related packages

- [`NEvo.Core`](NEvo.Core.md) — the only dependency.
- [`NEvo.Web.Authorization`](NEvo.Web.Authorization.md) — implements
  `IUserProvider`/`IRoleProvider` by adapting ASP.NET Core claims, and reuses this
  package's `PermissionProvider<T>` directly.
- [`NEvo.Messaging.Authorization`](NEvo.Messaging.Authorization.md) — consumes all
  three provider interfaces to populate a message-pipeline `UserContext<TId>` and
  enforce `[AllowPermission]` checks.

## Examples and tests

No dedicated `tests/NEvo.Authorization.Tests/` project exists in this repository today;
its abstractions are exercised indirectly through
[`NEvo.Web.Authorization`](NEvo.Web.Authorization.md)'s test suite
(`tests/NEvo.Web.Authorization.Tests/`).
