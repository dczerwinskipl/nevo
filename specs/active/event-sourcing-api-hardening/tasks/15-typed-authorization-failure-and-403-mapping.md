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
  - Verify the HTTP behavior manually through the Documents example's walkthrough note
    (task 10's, extended), covering all four cases: a successful `ApproveDocument`
    request → 200; an unauthenticated request → 401 (existing ASP.NET path, unaffected
    by this task); an authenticated request lacking the required permission → 403; an
    ordinary application/framework failure not representing permission denial (e.g. a
    missing/non-existent document) → 500, unchanged.

## Acceptance criteria

**Corrected (post-review).** The original draft marked criteria 2-4 below `(test)`,
implying an automated test directly exercising `ToHttpResult`'s 403/500/200 mapping —
but `ToHttpResult` is a private method inside `NEvo.Messaging.Web`, and this task's own
declared strategy forbids a new `NEvo.Messaging.Web` test project. No automated test
could satisfy those criteria as originally worded without contradicting the task's own
scope. Criteria 2-4 are now `(manual)`, verified through the Documents walkthrough,
consistent with criteria 6-7 and with the D12/D27 precedent this task already cites.

1. `ValidatePermissionMiddleware` returns `PermissionDeniedException` (or another
   `UnauthorizedAccessException`-derived NEvo type) via `Either.Left` on denial — never a
   plain `Exception`, never thrown (test, in `tests/NEvo.Messaging.Authorization.Tests`;
   must fail against pre-task code).
2. A successful `ApproveDocument` request (authenticated, has the required permission)
   returns HTTP 200 (manual, Documents walkthrough).
3. An unauthenticated request to `ApproveDocument`'s endpoint (`.RequireAuthorization()`)
   returns 401 through the existing ASP.NET path, unaffected by this task (manual,
   Documents walkthrough).
4. An authenticated request lacking the required NEvo permission returns 403 (manual,
   Documents walkthrough — this is the behavior criterion 1's unit test proves the
   underlying exception type for; this criterion proves the resulting HTTP status the
   walkthrough actually observes).
5. An ordinary application/framework `Left` that does not represent permission denial
   still returns 500, unchanged (manual, Documents walkthrough — a request for a
   missing/non-existent document, already `DocumentNotFoundException`-shaped per the
   existing endpoint behavior, is an acceptable example of this case; no new failure
   mode needs to be manufactured for this criterion).
6. `NEvo.Messaging.Authorization.csproj` and `NEvo.Messaging.Web.csproj` each have no new
   `ProjectReference` after this task (inspection).
7. The Documents example's walkthrough note documents all four cases above (200 / 401 /
   403 / 500) explicitly, not only the 403 case (manual).
8. `dotnet build` succeeds; `dotnet test tests/NEvo.Messaging.Authorization.Tests`
   passes.

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Authorization.Tests
```

Manual walkthrough update per acceptance criteria 2-5, 7 (extends task 10's existing
walkthrough note) — this is where all HTTP-transport-level behavior (200/401/403/500)
for this task is actually verified; no automated test exists or is added for it, by this
task's own declared strategy (no new `NEvo.Messaging.Web` test project).

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
