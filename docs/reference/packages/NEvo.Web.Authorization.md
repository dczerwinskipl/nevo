---
id: packages.nevo-web-authorization
type: package
title: NEvo.Web.Authorization
status: current
dependencies:
  - NEvo.Authorization
summary: >
  Adapts ASP.NET Core's ClaimsPrincipal into NEvo.Authorization's IUserProvider/
  IRoleProvider abstractions. Despite the name, does not depend on NEvo.Web.
---

# NEvo.Web.Authorization

## Purpose

`NEvo.Web.Authorization` bridges ASP.NET Core's claims-based identity
(`HttpContext.User`) into `NEvo.Authorization`'s provider abstractions
(`IUserProvider<TId>`, `IRoleProvider<TRoleDataScope>`, `IPermissionProvider
<TRoleDataScope>`). It is a claims-adapter, not middleware — it contains no
`IMiddleware`/`RequestDelegate`/pipeline registration; every real class here is a
DI-registered provider.

## When to use

Whenever a service authenticates users via ASP.NET Core claims (cookies, JWT bearer,
etc.) and needs those claims adapted into `NEvo.Authorization`'s provider
abstractions — typically alongside `NEvo.Messaging.Authorization`. See
`docs/usage/authorization.md` for the full end-to-end walkthrough.

## When not to use

If your user/role/permission source isn't ASP.NET Core claims (e.g. a custom identity
store), implement `NEvo.Authorization`'s provider interfaces directly instead of
adapting through this package.

## Responsibilities

- Read claims from the current `HttpContext.User` (`IUserClaimsProvider`).
- Translate those claims into a `NEvo.Authorization` `User<TId>`
  (`ClaimUserProvider<TId>`) and `Role<T>` list (`ClaimRoleProvider<T>`).
- Provide claim-parsing helpers (`ClaimsExtensions`: typed value extraction with
  `LanguageExt.Option`).
- Wire all of the above into DI with one extension method
  (`AddClaimsAuthorization<TId, TRoleDataScope>`).

## Dependencies

Depends only on `NEvo.Authorization` — see
`src/NEvo.Web.Authorization/NEvo.Web.Authorization.csproj`'s single `ProjectReference`
and `docs/development/package-boundaries.md`. **This package does not depend on
`NEvo.Web`, despite the name.**

## Public surface

Grounded directly in `src/NEvo.Web.Authorization/*.cs`.

### Registration

```csharp
namespace Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static void AddClaimsAuthorization<TId, TRoleDataScope>(this IServiceCollection services)
        where TRoleDataScope : AuthDataScope;
}
```

Registers (all `TryAddScoped`, so a consumer can override any of them):
`IUserClaimsProvider` → `UserClaimsProvider`, `IUserProvider<TId>` →
`ClaimUserProvider<TId>`, `IRoleProvider<TRoleDataScope>` →
`ClaimRoleProvider<TRoleDataScope>`, `IPermissionProvider<TRoleDataScope>` →
`PermissionProvider<TRoleDataScope>` (the last is `NEvo.Authorization`'s own
implementation, not defined in this package).

### Claims access

```csharp
namespace NEvo.Web.Authorization.Claims;

public interface IUserClaimsProvider
{
    Option<IEnumerable<Claim>> GetUserClaims();
}
```

`UserClaimsProvider` reads `IHttpContextAccessor.HttpContext.User` and returns `None` if
there's no authenticated user — never throws for the unauthenticated case.

### User and role providers

`ClaimUserProvider<TId>.GetUser()` reads the `sub` (id) and `name` claims and builds a
`User<TId>`; `ToUser` is `protected virtual` — override it to change the claim-to-user
mapping. `ClaimRoleProvider<T>.GetRoles()` reads `role` claims and JSON-deserializes
each into a `Role<T>` (invalid/unparsable role claims are silently skipped, not
thrown).

## Configuration

```csharp
builder.Services.AddHttpContextAccessor(); // required — not registered by this package
builder.Services.AddClaimsAuthorization<Guid, MyDataScope>();
```

`AddHttpContextAccessor()` is **not** called by `AddClaimsAuthorization` — a consumer
must register it separately (`UserClaimsProvider` takes a constructor-injected
`IHttpContextAccessor`; without it registered, DI resolution fails at first use, not at
registration time).

Overriding the default user-mapping (`ClaimUserProvider<TId>.ToUser`) requires
registering your own subclass in place of the default (the default registration uses
`TryAddScoped`, so an explicit `AddScoped` call after `AddClaimsAuthorization` wins) —
see `docs/usage/authorization.md` for a worked example.

## Limitations

- Single-purpose: claims → `NEvo.Authorization` provider adaptation only. No routing
  helpers, no ASP.NET Core middleware, no policy/handler registration, no `[Authorize]`
  attribute integration — those concerns live in `NEvo.Authorization` itself or are the
  consuming application's responsibility.
- `ClaimRoleProvider<T>.GetRoles()` silently discards any role claim that fails JSON
  deserialization or is missing `Name`/`DataScope` — no logging or error surfaced.
- Requires `IHttpContextAccessor` to be registered separately (see "Configuration") —
  easy to miss since `AddClaimsAuthorization` doesn't do it or fail loudly at
  registration time; failure only surfaces at first resolution.

## Related packages

- [`NEvo.Authorization`](NEvo.Authorization.md) — the only real dependency; this package
  exists purely to adapt ASP.NET Core claims into its abstractions.
- **Not** `NEvo.Web` — despite the name, no dependency exists (see "Dependencies").

## Examples and tests

- `tests/NEvo.Web.Authorization.Tests/Claims/UserClaimsProviderTests.cs`
- `tests/NEvo.Web.Authorization.Tests/Roles/ClaimRoleProviderTests.cs`
- `tests/NEvo.Web.Authorization.Tests/Users/ClaimUserProviderTests.cs`
