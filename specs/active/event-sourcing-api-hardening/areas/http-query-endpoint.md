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
and unused. The current ExampleApp `GetDocumentQuery` (`GetDocumentQuery(Guid
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
  binding `TQuery` from route values and query-string values using existing ASP.NET Core
  Minimal API binding mechanisms (`[AsParameters]` or another built-in mechanism —
  verify actual behavior against `Query<TResult>`'s real shape rather than assuming) —
  not a custom binder, not a GET body.
- `Id`/`CreatedAt` (inherited from `Message`/`Message<TResult>`) must not become
  required GET parameters. If the chosen binding mechanism would otherwise expose them
  as bindable/required properties, resolve this with the smallest coherent adjustment —
  proposing a `Query<TResult>` contract change if genuinely necessary, but not a
  redesign of the messaging model.
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

- Reuse existing ASP.NET Core Minimal API binding rather than inventing a custom binder,
  per the input specification's explicit preference — verify the chosen mechanism's
  actual behavior against `Query<TResult>`'s current shape before relying on it.
- Do not build a separate HTTP result-mapping framework — a tiny, coherent
  result-mapping helper is acceptable if it reduces duplication between
  `MapCommandEndpoint` and `MapQueryEndpoint`, but this is not a redesign of either.

## Interfaces and boundaries

- Consumes: `Query<TResult>`/`Message<TResult>` (unchanged unless the binding-contract
  requirement above forces a small adjustment), `IQueryDispatcher` (from the archived
  query-support change).
- Provides to task 11 (Documents example): `MapQueryEndpoint<GetDocumentQuery,
  DocumentDto>` as the example's query endpoint, replacing its current hand-wired
  `MapGet`.

## Area-specific acceptance criteria

1. A representative Query with a route parameter and at least one query-string parameter
   binds correctly via `MapQueryEndpoint`, with no GET body required.
2. `Id`/`CreatedAt` do not appear as required parameters for that Query's GET endpoint.
3. `MapQueryEndpoint` returns `RouteHandlerBuilder` and remains chainable with
   `.RequireAuthorization()`.
4. Right/success maps to HTTP 200 with `TResult`; Left/exception maps to the existing
   standard Problem response behavior, matching `MapCommandEndpoint`'s established
   shape.
5. `RoutesExtensions.cs` no longer contains a `Console.WriteLine` call.

## Dependencies

None from other areas in this change — Query/`IQueryDispatcher` already exist on `main`
via the archived query-support change. Sequenced independently; can be implemented in
parallel with the ES-specific areas.

## Out of scope

- A universal HTTP error-mapping framework.
- Resource-specific 404 semantics built into the generic infrastructure.
- Any change to `IQueryDispatcher`/`QueryProcessingStrategy` themselves.
