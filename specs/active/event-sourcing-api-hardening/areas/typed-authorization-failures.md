# Area: Typed authorization failure semantics and HTTP 403 mapping

## Responsibility

Replace `ValidatePermissionMiddleware`'s generic `Exception("Permission denied")` with a
typed, transport-neutral semantic failure, and make `NEvo.Messaging.Web`'s Either→HTTP
mapping recognize it as 403 — without adding a project dependency in either direction
between `NEvo.Messaging.Authorization` and `NEvo.Messaging.Web`.

## Current state

`ValidatePermissionMiddleware<TId>.ExecuteAsync`
(`src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:26-31`) returns, on
denial:

```csharp
return Task.FromResult(Either<Exception, object>.Left(
                    new Exception("Permission denied")
                ));
```

A plain `System.Exception`, indistinguishable by type from any other failure.

`NEvo.Messaging.Web`'s HTTP mapping has exactly one shared decision point,
`RoutesExtensions.ToHttpResult<TResult>` (`src/NEvo.Messaging.Web/RoutesExtensions.cs:
74-81`), used by both `MapCommandEndpoint` and `MapQueryEndpoint`:

```csharp
private static IResult ToHttpResult<TResult>(this Either<Exception, TResult> result)
    => result.Match(
        Right: value => Results.Ok(value),
        Left: ex => Results.Problem(detail: ex.Message, statusCode: 500)
    );
```

Every `Left` — permission denied, `DocumentNotFoundException`, anything — maps to 500
today. There is no typed-exception-to-status-code table anywhere in `NEvo.Messaging.Web`.
`MapMessagesEndpoints`'s separate inline mapping (lines 39-42) has the same
always-500 shape and is unaffected by this area (it is a different, lower-level
transport, out of this task's scope).

**Confirmed: no project reference exists in either direction today.**
`NEvo.Messaging.Authorization.csproj` references only `NEvo.Authorization`/
`NEvo.Messaging`; `NEvo.Messaging.Web.csproj` references only `NEvo.Core`,
`NEvo.Messaging.Cqrs`, `NEvo.Messaging`, `NEvo.Web`
(`docs/development/package-boundaries.md` § "Dependency graph" — `NEvo.Messaging.Web`'s
one documented lateral exception is `NEvo.Messaging.Cqrs`/`NEvo.Web`, not
`NEvo.Messaging.Authorization`). Neither `NEvo.Messaging.Authorization` → `NEvo.Messaging.Web`
nor the reverse is an existing or wanted dependency (adding either would be a package-
dependency-direction change requiring its own owner approval, `package-boundaries.md` §
"Changing a dependency").

`System.UnauthorizedAccessException` is not used anywhere in the current codebase
(confirmed by repository-wide search) — introducing it as the recognized signal type
carries no risk of misclassifying an existing, unrelated failure as 403 today.

Command endpoints already use `.RequireAuthorization()` (e.g. the Documents example's
`ApproveDocument` endpoint) — unauthenticated requests are already rejected with 401 by
the existing ASP.NET Core authentication/authorization gate, entirely before message
dispatch; this area does not touch that path, only what happens once a request is
authenticated but denied by NEvo's own permission check.

## Requirements

- Introduce a dedicated exception type expressing "permission denied" as a
  `NEvo.Messaging.Authorization` concern, e.g.:

  ```csharp
  public sealed class PermissionDeniedException : UnauthorizedAccessException
  {
      public PermissionDeniedException()
          : base("Permission denied.")
      {
      }
  }
  ```

  `ValidatePermissionMiddleware` returns it (via `Either.Left`, never thrown — matching
  this repository's existing `Either<Exception, T>` convention and the precedent already
  set by `AggregateConcurrencyException`/`DocumentNotFoundException`, both returned, not
  thrown) in place of the current plain `Exception`.
- `NEvo.Messaging.Web`'s `ToHttpResult` recognizes the failure by **type**, not by
  message text, and without a new project reference: pattern-match on the base BCL type
  `UnauthorizedAccessException` (already implicitly available everywhere — no package
  reference needed in either direction), not on the derived `PermissionDeniedException`
  type Web cannot see without a new dependency. This is the transport-neutral type the
  owner's brief asked to prefer; a dedicated NEvo type is still introduced (for precise,
  typed handling inside `NEvo.Messaging.Authorization`/its tests) but Web only needs to
  recognize the common BCL base, which costs nothing structurally.
- Required behavior:

  ```
  unauthenticated request        -> 401  (existing ASP.NET auth gate, unchanged)
  authenticated, missing permission -> Either.Left(UnauthorizedAccessException-derived) -> 403
  unexpected application/framework failure -> Either.Left(other Exception) -> 500 (unchanged)
  success                         -> Right -> 200 (unchanged)
  ```

- Update both `MapCommandEndpoint`/`MapQueryEndpoint`'s shared `ToHttpResult` mapping
  consistently — a single added branch, not two divergent implementations.

## Constraints

- No dependency from `NEvo.Messaging.Authorization` to `NEvo.Messaging.Web`, and no new
  dependency from `NEvo.Messaging.Web` to `NEvo.Messaging.Authorization` — this task
  resolves the requirement entirely through the shared BCL base type, adding zero new
  `ProjectReference` entries anywhere (owner-decision, recorded below).
- Do not match on `ex.Message` text anywhere in the mapping logic.
- Do not introduce a general/pluggable exception-to-status-code mapping framework — one
  added, explicit branch (`UnauthorizedAccessException` → 403) alongside the existing
  default (→ 500), nothing more general.
- Do not change `MapMessagesEndpoints`'s separate inline mapping — out of scope for this
  task.

## Testing approach (no new test project)

Per the D12/D27 precedent already established in this specification ("behavior that can
be tested at package/core level should be unit/component tested there; ExampleApp/
`NEvo.Messaging.Web`-level HTTP behavior stays manually exercised/documented rather than
justifying new test infrastructure"), this task adds:

- A unit test in the existing `tests/NEvo.Messaging.Authorization.Tests` proving
  `ValidatePermissionMiddleware` returns `Either.Left` containing an
  `UnauthorizedAccessException`-derived type (specifically `PermissionDeniedException`)
  on denial — not a plain `Exception` (regression-proof: the test must fail against
  today's code).
- A manual verification step in the Documents example's walkthrough (task 10's existing
  walkthrough note, extended, not a new document) proving, over real HTTP: a request
  without the required permission returns 403; the existing "success" and "not found"
  paths still behave as before (200 / whatever `DocumentNotFoundException` already maps
  to); and an unauthenticated request still returns 401 through the existing ASP.NET
  path.
- This does **not** require a new `tests/NEvo.Messaging.Web.Tests` project — consistent
  with D27's explicit rejection of new `NEvo.Messaging.Web`-level automated test
  infrastructure in this specification.

## Interfaces and boundaries

- Consumes: `ValidatePermissionMiddleware` (task 07); `RoutesExtensions.ToHttpResult`
  (task 08).
- Produces: `PermissionDeniedException` and the 403 mapping, demonstrated by the
  Documents example's `ApproveDocument` permission check (already wired end to end in
  task 10).

## Area-specific acceptance criteria

1. `ValidatePermissionMiddleware` returns `PermissionDeniedException` (or another
   `UnauthorizedAccessException`-derived NEvo type) via `Either.Left` on denial, never a
   plain `Exception`, never thrown (test).
2. `ToHttpResult` maps any `UnauthorizedAccessException`-derived `Left` to HTTP 403
   (test).
3. `ToHttpResult` maps every other `Exception`-derived `Left` to HTTP 500, unchanged
   (test — regression).
4. `ToHttpResult` maps `Right` to HTTP 200, unchanged (test — regression).
5. `NEvo.Messaging.Authorization.csproj` gains no `ProjectReference` to
   `NEvo.Messaging.Web`; `NEvo.Messaging.Web.csproj` gains no `ProjectReference` to
   `NEvo.Messaging.Authorization` (inspection).
6. An unauthenticated request to a `.RequireAuthorization()`-protected endpoint still
   returns 401 through the existing ASP.NET Core path, unaffected by this task (manual,
   Documents walkthrough).
7. The Documents example's walkthrough note documents the 403 behavior for
   `ApproveDocument` without the required permission (manual).

## Dependencies

- `message-level-and-aggregate-authorization` (task 07) — `ValidatePermissionMiddleware`.
- `map-query-endpoint-and-get-binding` (task 08) — `RoutesExtensions.ToHttpResult`.

## Out of scope

- A general HTTP error-mapping framework (already out of scope for the whole
  specification, `overview.md` § "Out of scope").
- Any change to `MapMessagesEndpoints`'s separate mapping.
- Roles/permissions/data-scope changes — this task is purely about the failure's
  *type* and its HTTP mapping, not authorization logic itself.
- A new `NEvo.Messaging.Web.Tests` (or equivalent) test project.
