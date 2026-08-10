---
id: event-sourcing-api-hardening.map-query-endpoint-and-get-binding
status: draft
change: event-sourcing-api-hardening
semantic_references:
  decisions: [D8, D18]
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
consistent with `MapCommandEndpoint<TCommand>`, using `[AsParameters]` binding on the
concrete `Query<TResult>`-derived record — the binding contract is resolved and closed
per D18, not an open implementation question. Clean up the two leftover
`Console.WriteLine` calls in `MapCommandEndpoint` while touching this file (D8).

This task is independent of the ES-specific areas — it can be implemented in parallel
with tasks 02-07.

## Implementation constraints

- `app.MapQueryEndpoint<TQuery, TResult>(route)` returns `RouteHandlerBuilder`
  (`routeBuilder.MapGet(...)`), chainable with `.RequireAuthorization()` and other
  normal Minimal API configuration, matching `MapCommandEndpoint`'s existing shape and
  location (`NEvo.Messaging.Web/RoutesExtensions.cs`,
  `namespace Microsoft.AspNetCore.Routing`).
- Bind `TQuery` via `[AsParameters]` (**resolved, D18** — do not re-evaluate this
  choice). For a concrete Query record with exactly one public constructor (the normal
  shape, e.g. `GetDocumentQuery(Guid DocumentId) : Query<DocumentDto>`), ASP.NET Core's
  `[AsParameters]` binder targets that constructor's own parameters — it does not touch
  inherited `Message`/`Message<TResult>` properties (`Id`, `CreatedAt`), which are not
  part of the derived record's own constructor signature. This was confirmed
  empirically during spec-refine (2026-08-10): a minimal ASP.NET Core 9 probe mirroring
  the real type hierarchy returned HTTP 200 with server-generated `Id`/`CreatedAt` when
  a request supplied only the route parameter and no `id`/`createdAt` in the query
  string. **No `Query<TResult>`/`Message<TResult>` contract change is needed or
  permitted by this task** — if implementation reveals a concrete Query type that
  doesn't fit this pattern (e.g. one with more than one public constructor, or one
  whose own fields collide by name with `Id`/`CreatedAt`), stop and report it rather
  than silently changing the messaging model; that would be new evidence contradicting
  D18's resolution, not an implementation detail to route around quietly.
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
   query-string-bindable field) binds correctly through `MapQueryEndpoint` via
   `[AsParameters]`, verified by an integration test using `WebApplicationFactory` or
   equivalent (automated).
2. No GET body is required for that endpoint (automated).
3. `Id`/`CreatedAt` do not appear as required parameters for that endpoint — a request
   omitting them from the query string still binds and dispatches successfully
   (automated — this is the D18-resolved behavior, now a regression test rather than an
   open question).
4. `MapQueryEndpoint` returns `RouteHandlerBuilder`, proven by a test chaining
   `.RequireAuthorization()` after it and confirming the requirement is enforced
   (automated).
5. Right/success → HTTP 200 with `TResult`; Left/exception → the existing Problem
   response shape (automated).
6. `RoutesExtensions.cs` contains no `Console.WriteLine` call (inspection).
7. `Query<TResult>`/`Message<TResult>` are unchanged by this task (inspection — D18
   closed this question; a diff touching either type without a newly-reported,
   contradicting finding is out of scope).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None in this task — covered by task 11 (user-facing, updates `docs/usage/queries.md`'s
example and adds the Query-endpoint-mapping topic) and task 12 (internal).

## Out of scope

- Any change to `Query<TResult>`/`Message<TResult>` (D18 — closed, not an open
  adjustment this task may still make).
- A universal HTTP error-mapping framework.
- Rewiring the ExampleApp's existing `GetDocumentQuery` endpoint (task 10's concern,
  once the Documents service exists).
