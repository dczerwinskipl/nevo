---
review-of: task
change: event-sourcing-api-hardening
task: map-query-endpoint-and-get-binding
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/map-query-endpoint-and-get-binding

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

`MapQueryEndpoint<TQuery, TResult>` added to `RoutesExtensions.cs`, `routeBuilder
.MapGet(...)` binding `TQuery` via `[AsParameters]` (D18, not re-evaluated), returning
`RouteHandlerBuilder`. `MapCommandEndpoint` and `MapQueryEndpoint` now share a small
`ToHttpResult<TResult>` private extension (`Right` → `Results.Ok`, `Left` →
`Results.Problem(detail: ex.Message, statusCode: 500)`) instead of duplicating the same
`Match` — a small, coherent de-duplication, not a general result-mapping framework. The
two leftover `Console.WriteLine` calls in `MapCommandEndpoint` are gone; nothing
replaced them (`LoggingMessageProcessingMiddleware` already logs per-message, per the
task's own reasoning for not adding an `ILogger<T>` call here). No new integration-test
infrastructure was added (D27) — `tests/NEvo.Messaging.Cqrs.Tests` was not touched at
all in this task's diff.

## Acceptance criteria

- [x] All 8 acceptance criteria covered, all by inspection/`dotnet build` per this
  task's own D27-constrained verification (no automated HTTP test is in scope):
  1. Compiles as a `RouteHandlerBuilder`-returning extension using `[AsParameters]`.
  2. Returns `RouteHandlerBuilder`, chainable with `.RequireAuthorization()` (same
     return type `MapCommandEndpoint` already uses this way).
  3. `MapGet` with `[AsParameters]`, no body-bound parameter.
  4. `Id`/`CreatedAt` non-required — D18's already-closed evidence, not re-verified.
  5. Right→200/Left→Problem via the shared `ToHttpResult` helper, matching
     `MapCommandEndpoint`'s established shape exactly.
  6. `grep -n "Console.WriteLine" RoutesExtensions.cs` — no match.
  7. `Query<TResult>`/`Message<TResult>` — untouched (not in this task's diff at all).
  8. `tests/NEvo.Messaging.Cqrs.Tests` — no new `ProjectReference`, no new test project
     anywhere in this task's diff.

## Scope

- [x] Scope: compliant — only `src/NEvo.Messaging.Web/RoutesExtensions.cs` changed,
  squarely inside `allowed_paths`. `src/NEvo.Ddd.EventSourcing/**`,
  `src/NEvo.Messaging.Cqrs/Queries/**`, and `examples/**` (all `forbidden_paths`) are
  untouched.

## Verification

- `dotnet build` — passed (whole solution, per this task's own verification block)

## Findings

None.
