# Area: HTTP Query endpoint

## Responsibility

Add `MapQueryEndpoint<TQuery, TResult>`, ergonomically consistent with the existing
`MapCommandEndpoint<TCommand>`, solving GET route/query-string binding without a GET
body and without message transport metadata becoming required parameters.

## Current state

`MapCommandEndpoint<TCommand>` (`src/NEvo.Messaging.Web/RoutesExtensions.cs:46-65`,
`namespace Microsoft.AspNetCore.Routing`) returns `RouteHandlerBuilder` from
`routeBuilder.MapPost(...)`, binds `TCommand` via ASP.NET Core's default complex-type
body inference (no attribute), resolves `ICommandDispatcher` from DI, and maps the
result: `Right` → `Results.Ok(result)`, `Left` → `Results.Problem(detail: ex.Message,
statusCode: 500)` (lines 58-61). Lines 54-55 contain two leftover
`Console.WriteLine($"Success: ...")`/`Console.WriteLine($"Failure: ...")` calls — the
only `Console.WriteLine` usage anywhere under `src/`; the established convention
elsewhere is constructor-injected `ILogger<T>` (e.g.
`LoggingMessageProcessingMiddleware`).

`Message` (`src/NEvo.Messaging/Message.cs:6-9`) is `record Message(Guid Id, DateTime
CreatedAt)`, with a parameterless constructor defaulting both. `Message<TResult>`
(`Message.cs:12-16`) and `Query<TResult> : Message<TResult>`
(`src/NEvo.Messaging.Cqrs/Queries/Query.cs:6-10`) add no new fields — `Id`/`CreatedAt`
are the only transport-metadata fields on the hierarchy.

No `[AsParameters]`, custom `BindAsync`, or `IBindableFromHttpContext` usage exists
anywhere in the repository today (confirmed by search) — TFM is `net9.0` repo-wide
(`Directory.Build.props:3`), so these ASP.NET Core Minimal API mechanisms are available
and unused. **Resolved during spec-refine (D18):** `[AsParameters]` binds a concrete
Query record's own single public constructor, not its inherited `Message` properties —
verified empirically, not merely assumed. This closes what was originally left as an
open implementation question. The current ExampleApp `GetDocumentQuery` (`GetDocumentQuery(Guid
DocumentId) : Query<DocumentDto>`,
`examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/
DocumentQueries.cs:13`) is hand-wired via `app.MapGet("/api/document/{documentId:guid}",
async (Guid documentId, IQueryDispatcher queryDispatcher, ct) => {...})` in `Routes.cs:
20-27`, manually constructing `new GetDocumentQuery(documentId)` and branching
`DocumentNotFoundException` → `Results.NotFound()` vs. other exceptions →
`Results.Problem(...)` (line 25) — a distinction `MapCommandEndpoint`'s uniform
500-on-any-`Left` does not have.

No generic `ToHttpResult()`/`ToProblemResult()` helper exists anywhere — both existing
endpoints inline the same `Right`/`Left` `.Match` pattern.

## Requirements

- `app.MapQueryEndpoint<TQuery, TResult>(route)` returning `RouteHandlerBuilder`
  (chainable with `.RequireAuthorization()` and other normal Minimal API configuration),
  binding `TQuery` via `[AsParameters]` (**resolved, D18** — confirmed empirically
  during spec-refine, not a design question the implementing task re-opens) — not a
  custom binder, not a GET body.
- `Id`/`CreatedAt` (inherited from `Message`/`Message<TResult>`) do not become required
  GET parameters. This is a closed, evidence-based fact (D18), not a risk to mitigate:
  `[AsParameters]` binds a record type's own single public constructor, and a concrete
  `Query<TResult>`-derived record's constructor never includes inherited `Message`
  properties — confirmed by a disposable ASP.NET Core 9 probe mirroring the real type
  hierarchy, which returned HTTP 200 with server-generated `Id`/`CreatedAt` when neither
  was supplied. **No `Query<TResult>`/`Message<TResult>` contract change is needed or
  in scope.**
- Preserve `MapCommandEndpoint`'s established Right→200/Left→Problem behavior for the
  generic case. Do not infer domain-specific 404 semantics from arbitrary exception
  types in the generic infrastructure — document the escape hatch for resource-specific
  mapping (e.g. how an application still gets `DocumentNotFoundException` → 404 if it
  wants that, consistent with what the current hand-wired example already does) rather
  than building it into `MapQueryEndpoint` itself.
- Remove the two leftover `Console.WriteLine` calls from `MapCommandEndpoint`
  (`RoutesExtensions.cs:54-55`) while touching this file, replacing with nothing (the
  pipeline's own `LoggingMessageProcessingMiddleware` already logs) or with `ILogger<T>`
  if a genuine log statement is warranted — small, scoped cleanup, not broader
  refactoring of `RoutesExtensions`.

## Constraints

- Use `[AsParameters]` (D18, resolved) — do not re-litigate this choice or evaluate
  alternatives during implementation.
- Do not build a separate HTTP result-mapping framework — a tiny, coherent
  result-mapping helper is acceptable if it reduces duplication between
  `MapCommandEndpoint` and `MapQueryEndpoint`, but this is not a redesign of either.
- **No new integration-test infrastructure (D27).** `tests/NEvo.Messaging.Cqrs.Tests`
  does not reference `NEvo.Messaging.Web` (where `MapQueryEndpoint` lives), and this
  repository has no `WebApplicationFactory`-based or other ASP.NET integration-test
  harness today. Do not add a project reference or a new test project to manufacture
  one. Verify what's naturally unit/component-testable (the endpoint extension
  compiles and returns `RouteHandlerBuilder`); rely on D18's already-closed binding
  evidence rather than re-proving it with new test infrastructure; verify the concrete
  HTTP GET behavior manually through the Documents example walkthrough (task 10)
  instead.

## Interfaces and boundaries

- Consumes: `Query<TResult>`/`Message<TResult>` (unchanged — D18 closed the question of
  whether a contract adjustment would be needed; it isn't), `IQueryDispatcher` (from the
  archived query-support change).
- Provides to task 10 (Documents example): `MapQueryEndpoint<GetDocumentQuery,
  DocumentDto>` as the example's query endpoint, replacing its current hand-wired
  `MapGet`.

## Area-specific acceptance criteria

1. `MapQueryEndpoint<TQuery, TResult>` compiles, uses `[AsParameters]` binding, and
   returns `RouteHandlerBuilder` chainable with `.RequireAuthorization()` (automated:
   `dotnet build` plus any naturally unit-testable extracted logic).
2. `Id`/`CreatedAt` never being required GET parameters is D18's already-closed,
   evidence-based conclusion — not re-verified with new test infrastructure here.
3. Right/success maps to HTTP 200 with `TResult`; Left/exception maps to the existing
   standard Problem response behavior, matching `MapCommandEndpoint`'s established
   shape — verified by the same code-reading/inspection standard as the rest of
   `RoutesExtensions.cs`, and manually through the Documents example walkthrough
   (task 10).
4. `RoutesExtensions.cs` no longer contains a `Console.WriteLine` call.
5. No new project reference or new test project is added to make GET binding
   automatically testable (inspection, per D27).

## Dependencies

None from other areas in this change — Query/`IQueryDispatcher` already exist on `main`
via the archived query-support change. Sequenced independently; can be implemented in
parallel with the ES-specific areas.

## Out of scope

- A universal HTTP error-mapping framework.
- Resource-specific 404 semantics built into the generic infrastructure.
- Any change to `IQueryDispatcher`/`QueryProcessingStrategy` themselves.
