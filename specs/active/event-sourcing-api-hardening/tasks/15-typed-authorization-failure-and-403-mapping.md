---
id: event-sourcing-api-hardening.typed-authorization-failure-and-403-mapping
status: draft
change: event-sourcing-api-hardening
depends_on:
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
semantic_references:
  decisions: [D12, D27, D36]
  dependency_contracts:
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/typed-authorization-failures.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs
    - src/NEvo.Messaging.Web/RoutesExtensions.cs
    - docs/development/package-boundaries.md
  optional:
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/ServiceCollectionExtensions.cs
allowed_paths:
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Messaging.Web/**
  - tests/NEvo.Messaging.Authorization.Tests/**
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
---

# Task: Typed authorization failure semantics and HTTP 403 mapping

## Goal

Replace `ValidatePermissionMiddleware`'s generic `Exception("Permission denied")` with a
typed, transport-neutral semantic failure, and make `NEvo.Messaging.Web`'s Either→HTTP
mapping recognize it as 403 — with zero new project reference in either direction between
`NEvo.Messaging.Authorization` and `NEvo.Messaging.Web`.

## Dependencies

- `message-level-and-aggregate-authorization` (task 07) — `ValidatePermissionMiddleware`.
- `map-query-endpoint-and-get-binding` (task 08) — `RoutesExtensions.ToHttpResult`.

## Implementation constraints

- Add, in `NEvo.Messaging.Authorization`:

  ```csharp
  public sealed class PermissionDeniedException : UnauthorizedAccessException
  {
      public PermissionDeniedException()
          : base("Permission denied.")
      {
      }
  }
  ```

  `ValidatePermissionMiddleware.ExecuteAsync`
  (`src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:26-31`) returns it
  via `Either.Left` in place of `new Exception("Permission denied")` — returned, never
  thrown, matching this repository's `Either<Exception, T>` convention and the existing
  `AggregateConcurrencyException`/`DocumentNotFoundException` precedent.
- `RoutesExtensions.ToHttpResult<TResult>`
  (`src/NEvo.Messaging.Web/RoutesExtensions.cs:74-81`) gains one branch: a `Left` whose
  exception `is UnauthorizedAccessException` maps to `Results.Problem(..., statusCode:
  403)`; every other `Left` keeps mapping to 500, unchanged. Match on the **base BCL
  type** `UnauthorizedAccessException`, not on `PermissionDeniedException` directly —
  `NEvo.Messaging.Web` has no reference to `NEvo.Messaging.Authorization` and gains none
  for this task; the BCL base type is recognizable without one. Do not match on
  `ex.Message`.
- `MapCommandEndpoint`/`MapQueryEndpoint` both go through this same shared
  `ToHttpResult`, so both are covered by one change, not two.
- Do not add a `ProjectReference` from `NEvo.Messaging.Authorization` to
  `NEvo.Messaging.Web`, or from `NEvo.Messaging.Web` to `NEvo.Messaging.Authorization`.
- Do not build a general/pluggable exception→status-code mapping mechanism — this one
  added branch, alongside the existing default.
- Do not touch `MapMessagesEndpoints`'s separate inline mapping.
- No new automated integration/unit test project — per the D12/D27 precedent already set
  in this specification for `NEvo.Messaging.Web`-level HTTP behavior:
  - Add a unit test in the existing `tests/NEvo.Messaging.Authorization.Tests` proving
    `ValidatePermissionMiddleware` now returns `Either.Left` containing an
    `UnauthorizedAccessException`-derived type (not a plain `Exception`) on denial.
  - Verify the 403/500/200/401 HTTP behavior manually through the Documents example's
    walkthrough note (task 10's, extended) — 401 stays through the existing
    `.RequireAuthorization()`/ASP.NET path, unaffected by this task.

## Acceptance criteria

1. `ValidatePermissionMiddleware` returns `PermissionDeniedException` (or another
   `UnauthorizedAccessException`-derived NEvo type) via `Either.Left` on denial — never a
   plain `Exception`, never thrown (test, must fail against pre-task code).
2. `ToHttpResult` maps any `UnauthorizedAccessException`-derived `Left` to HTTP 403
   (test).
3. `ToHttpResult` maps every other `Exception`-derived `Left` to HTTP 500, unchanged
   (test — regression).
4. `ToHttpResult` maps `Right` to HTTP 200, unchanged (test — regression).
5. `NEvo.Messaging.Authorization.csproj` and `NEvo.Messaging.Web.csproj` each have no new
   `ProjectReference` after this task (inspection).
6. An unauthenticated request to `ApproveDocument`'s endpoint (`.RequireAuthorization()`)
   still returns 401 through the existing ASP.NET path (manual, Documents walkthrough).
7. The Documents example's walkthrough note documents a request to `ApproveDocument`
   without the required permission returning 403 (manual).
8. `dotnet build` succeeds; `dotnet test tests/NEvo.Messaging.Authorization.Tests`
   passes.

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Authorization.Tests
```

Manual walkthrough update per acceptance criteria 6-7 (extends task 10's existing
walkthrough note).

## Documentation impact

Task 10's walkthrough note is updated in place. Task 11 (user-facing guide, sequenced
after this task) documents the 401/403/500 semantics as part of its authorization
section; task 12 documents the typed-failure/HTTP-mapping boundary for maintainers.

## Out of scope

- A general HTTP error-mapping framework.
- Any change to `MapMessagesEndpoints`'s separate mapping.
- Roles/permissions/data-scope logic — this task changes the failure's type and its HTTP
  mapping only.
- A new `NEvo.Messaging.Web.Tests` (or equivalent) test project.
