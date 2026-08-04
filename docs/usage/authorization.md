---
id: guides.authorization
type: guide
title: Authorization
status: current
summary: >
  Configuring [AllowPermission] end-to-end given there is no DI registration helper
  spanning the whole chain, and what to expect when a check fails.
---

# Authorization

## Goal

Enforce a permission check on a command handler, end-to-end: from ASP.NET Core claims,
through `NEvo.Authorization`'s provider abstractions, to `[AllowPermission]` on your
handler method.

## Prerequisites

- [`NEvo.Authorization`](../reference/packages/NEvo.Authorization.md),
  [`NEvo.Web.Authorization`](../reference/packages/NEvo.Web.Authorization.md), and
  [`NEvo.Messaging.Authorization`](../reference/packages/NEvo.Messaging.Authorization.md)
  all referenced.
- A command handler already working (see [Commands](commands.md)).

## Steps

### 1. Register claims-based authorization

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddClaimsAuthorization<Guid, MyDataScope>();
```

`MyDataScope` is your own `AuthDataScope` subtype carrying whatever scoping data your
permissions need (e.g. a tenant or company ID).

### 2. Register the messaging-pipeline middleware — manually

**No single DI helper wires all three packages together.** Register both pieces of
`NEvo.Messaging.Authorization` yourself, in the right stage:

```csharp
builder.Services.AddMessageProcessingMiddleware<UserContextMiddleware<Guid, MyDataScope>>();
builder.Services.AddMessageProcessingHandlerMiddleware<ValidatePermissionMiddleware<Guid>>();
```

`UserContextMiddleware` (message-level) must be registered so it runs before
`ValidatePermissionMiddleware` (handler-level) needs to read the populated permissions
— this ordering is guaranteed by the pipeline's two separate middleware stages, not by
registration order within either stage.

### 3. Define a permission mapper

```csharp
public class OrderPermissionMapper : IPermissionMapper<MyDataScope>
{
    public bool CanMapRole(Role<MyDataScope> role) => role.Name == "OrderManager";
    public IEnumerable<IPermission> MapRole(Role<MyDataScope> role)
        => [new Permission<MyDataScope>("orders:create", role.DataScope)];
}

builder.Services.AddSingleton<IPermissionMapper<MyDataScope>, OrderPermissionMapper>();
```

### 4. Annotate your handler and write a validator

```csharp
public class CreateOrderHandler : ICommandHandler<CreateOrder>
{
    [AllowPermission("orders:create", typeof(OrderScopeValidator))]
    public Task<Either<Exception, Unit>> HandleAsync(CreateOrder message, IMessageContext context, CancellationToken cancellationToken)
        => UnitExt.DefaultEitherTask;
}

public class OrderScopeValidator : IDataScopeMessageValidator<MyDataScope, CreateOrder>
{
    // Called once per permission the current user has, of type Permission<MyDataScope>.
    // Return true to grant access for that permission.
    public bool Validate(MyDataScope dataScope, CreateOrder message) => true;
}
```

Access is granted the moment **any** of the user's permissions validates successfully
against your validator — `PermissionName` itself ("orders:create" above) is not checked
against the user's permission names by the framework; matching is entirely up to your
validator's own logic. See `docs/project/known-issues.md` § "`AllowPermissionAttribute.PermissionName`
is not checked" — do not assume declaring a name alone restricts access.

## Constraints and failure modes

- **A permission-denied failure currently surfaces as a generic HTTP `500`, not
  `403`**, when exposed via `NEvo.Messaging.Web`'s default endpoint mapping — see
  `docs/project/known-issues.md` § "Authorization surfaces a generic HTTP 500, not
  403". If your API needs a real `403`, you need your own result-handling layer that
  inspects the exception before it reaches the default mapping.
- `AllowPermissionAttribute`'s constructor-time check that `validatorType` implements
  the required interface is disabled — an incorrect `validatorType` surfaces only at
  first invocation, not at startup. See `docs/project/known-issues.md`.
- `AddClaimsAuthorization` does not register `IHttpContextAccessor` — you must call
  `AddHttpContextAccessor()` yourself, or DI resolution fails at first use.

## Verification

A request with a user holding the required permission succeeds (your handler runs); a
request with a user lacking it returns the generic `500` described above (not silent
success) — confirming the check is actually being enforced, even though the status
code doesn't distinguish it from other failures.

## Next steps

[Troubleshooting](troubleshooting.md) — for diagnosing failures once authorization is
wired up.
