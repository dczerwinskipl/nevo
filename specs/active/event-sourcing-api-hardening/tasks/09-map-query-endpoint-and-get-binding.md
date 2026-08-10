---
id: event-sourcing-api-hardening.map-query-endpoint-and-get-binding
status: draft
change: event-sourcing-api-hardening
semantic_references:
  decisions: [D8]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/http-query-endpoint.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Messaging.Web/RoutesExtensions.cs
    - src/NEvo.Messaging/Message.cs
    - src/NEvo.Messaging.Cqrs/Queries/Query.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/DocumentQueries.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Routes.cs
  optional: []
allowed_paths:
  - src/NEvo.Messaging.Web/**
  - tests/NEvo.Messaging.Cqrs.Tests/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging.Cqrs/Queries/**
  - examples/**
---

# Task: MapQueryEndpoint and GET binding

## Goal

Add `MapQueryEndpoint<TQuery, TResult>` to `NEvo.Messaging.Web`, ergonomically
consistent with `MapCommandEndpoint<TCommand>`, solving GET route/query-string binding
without a body and without `Id`/`CreatedAt` becoming required parameters. Clean up the
two leftover `Console.WriteLine` calls in `MapCommandEndpoint` while touching this file
(D8).

This task is independent of the ES-specific areas — it can be implemented in parallel
with tasks 02-08.

## Implementation constraints

- `app.MapQueryEndpoint<TQuery, TResult>(route)` returns `RouteHandlerBuilder`
  (`routeBuilder.MapGet(...)`), chainable with `.RequireAuthorization()` and other
  normal Minimal API configuration, matching `MapCommandEndpoint`'s existing shape and
  location (`NEvo.Messaging.Web/RoutesExtensions.cs`,
  `namespace Microsoft.AspNetCore.Routing`).
- Bind `TQuery` from route values and query-string values using an existing ASP.NET
  Core Minimal API mechanism (`[AsParameters]` is the leading candidate given `net9.0`
  — verify its actual binding behavior against `Query<TResult>`'s real current shape
  before committing to it; do not invent a custom `IValueProvider`/binder if a built-in
  mechanism satisfies the contract).
- `Id`/`CreatedAt` (inherited from `Message`/`Message<TResult>`) must not appear as
  required GET parameters. If the chosen binding mechanism would otherwise expose them,
  resolve it with the smallest coherent adjustment — e.g. excluding inherited
  `Message` properties from the bound set, or (only if genuinely necessary) a small
  `Query<TResult>` contract adjustment; do not redesign the messaging model to solve
  this.
- Map `Right` → `Results.Ok(result)`, `Left` → the existing standard Problem response
  behavior (matching `MapCommandEndpoint`'s current `Results.Problem(detail:
  ex.Message, statusCode: 500)` pattern) — do not add domain-specific 404 inference from
  exception type in this generic path.
- Remove the two `Console.WriteLine` calls from `MapCommandEndpoint`
  (`RoutesExtensions.cs:54-55`) — delete them; do not replace with an `ILogger<T>` call
  unless a genuinely useful log statement is missing after removal (the pipeline's own
  `LoggingMessageProcessingMiddleware` already logs per-message).

## Acceptance criteria

1. A representative Query (a record with a route-bindable id and at least one
   query-string-bindable field) binds correctly through `MapQueryEndpoint`, verified by
   an integration test using `WebApplicationFactory` or equivalent (automated).
2. No GET body is required for that endpoint (automated).
3. `Id`/`CreatedAt` do not appear as required parameters for that endpoint (automated —
   e.g. a request omitting them still binds and dispatches successfully).
4. `MapQueryEndpoint` returns `RouteHandlerBuilder`, proven by a test chaining
   `.RequireAuthorization()` after it and confirming the requirement is enforced
   (automated).
5. Right/success → HTTP 200 with `TResult`; Left/exception → the existing Problem
   response shape (automated).
6. `RoutesExtensions.cs` contains no `Console.WriteLine` call (inspection).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None in this task — covered by task 12 and `docs/usage/queries.md` (task 11 updates the
ExampleApp usage once the Documents service exists).

## Out of scope

- Any change to `Query<TResult>`/`Message<TResult>` beyond the smallest adjustment
  strictly necessary to solve the `Id`/`CreatedAt` binding problem, if any is needed.
- A universal HTTP error-mapping framework.
- Rewiring the ExampleApp's existing `GetDocumentQuery` endpoint (task 11's concern,
  once the Documents service exists).
