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
DI-registered provider (confirmed by `grep -r "IMiddleware\|RequestDelegate"
src/NEvo.Web.Authorization/` — no matches).

## Responsibilities

- Read claims from the current `HttpContext.User` (`IUserClaimsProvider`).
- Translate those claims into a `NEvo.Authorization` `User<TId>`
  (`ClaimUserProvider<TId>`) and `Role<T>` list (`ClaimRoleProvider<T>`).
- Provide claim-parsing helpers (`ClaimsExtensions`: typed value extraction with
  `LanguageExt.Option`).
- Wire all of the above into DI with one extension method
  (`AddClaimsAuthorization<TId, TRoleDataScope>`).

## Dependencies

Depends only on `NEvo.Authorization` — confirmed directly against
`src/NEvo.Web.Authorization/NEvo.Web.Authorization.csproj`'s single `ProjectReference`,
and against the corrected `docs/architecture/package-boundaries.md` (the previous,
now-fixed diagram falsely showed a dependency on `NEvo.Web` — see task
`architecture-corrections`). **This package does not depend on `NEvo.Web`, despite the
name.**

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
mapping (see "Advanced usage"). `ClaimRoleProvider<T>.GetRoles()` reads `role` claims and
JSON-deserializes each into a `Role<T>` (invalid/unparsable role claims are silently
skipped, not thrown).

## Configuration

```csharp
builder.Services.AddHttpContextAccessor(); // required — not registered by this package
builder.Services.AddClaimsAuthorization<Guid, MyDataScope>();
```

`AddHttpContextAccessor()` is **not** called by `AddClaimsAuthorization` — a consumer
must register it separately (`UserClaimsProvider` takes a constructor-injected
`IHttpContextAccessor`; without it registered, DI resolution fails). This is easy to
miss: even `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs:75` registers it
right before `AddClaimsAuthorization` with the comment `// TODO: part of claims auth?`,
i.e. the example's own author wasn't sure it was this package's responsibility either.

## Basic usage

Registration, adapted directly from
`examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs:74-76`:

```csharp
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddClaimsAuthorization<Guid, RoleDataScope>();
```

Consuming a registered provider:

```csharp
public class MyEndpoint(IUserProvider<Guid> userProvider)
{
    public IResult Handle()
        => userProvider.GetUser().Match(
            Some: user => Results.Ok(user),
            None: () => Results.Unauthorized()
        );
}
```

## Advanced usage

Override `ClaimUserProvider<TId>.ToUser` to change how a `User<TId>` is built from
claims (e.g. a different id/name claim type):

```csharp
public class MyUserProvider(IUserClaimsProvider claimsProvider) : ClaimUserProvider<Guid>(claimsProvider)
{
    protected override Option<User<Guid>> ToUser(IEnumerable<Claim> claims)
        => claims.GetClaimValue<Guid>("custom_id")
            .Map(id => new User<Guid>(id, "unknown"));
}
```

Register the override in place of the default with `services.AddScoped<IUserProvider
<Guid>, MyUserProvider>()` after calling `AddClaimsAuthorization` (the default
registration uses `TryAddScoped`, so an explicit `AddScoped` call after it wins).

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
  exists purely to adapt ASP.NET Core claims into its abstractions. Not yet documented
  (see task `package-docs-auth-and-persistence`).
- **Not** `NEvo.Web` — despite the name, no dependency exists (see "Dependencies").

## Examples and tests

- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs:74-77` — real
  registration, including the JWT bearer auth it's paired with and a custom
  `IPermissionMapper<RoleDataScope>`.
- `tests/NEvo.Web.Authorization.Tests/Claims/UserClaimsProviderTests.cs`
- `tests/NEvo.Web.Authorization.Tests/Roles/ClaimRoleProviderTests.cs`
- `tests/NEvo.Web.Authorization.Tests/Users/ClaimUserProviderTests.cs`
