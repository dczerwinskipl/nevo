---
review-of: task
change: query-support-and-handler-registration-hardening
task: documentation-and-example
generated: 2026-08-09
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: docs/reference/packages/classification.md
    reason: >-
      Not in this task's allowed_paths, but AC2 ("no document in docs/ still states
      query-side support is absent or unimplemented") required correcting this file's
      stale "Query-side is not implemented" classification row — otherwise the task's
      own acceptance criterion would be directly violated by a file outside its scope.
      One-line correction, same shape as the other package-doc updates in this task.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-09
    task_fingerprint: "914302c3fdd1b4a50435b6f861b9e0a5ad100cdbdff2fb2f560727718a7c1e15"
---

# Review: query-support-and-handler-registration-hardening/documentation-and-example

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — new `docs/usage/queries.md`; `NEvo.Messaging.Cqrs.md`,
`NEvo.Messaging.md` (D6 breaking-change note), `architecture-overview.md`, and
`testing-strategy.md` all updated; `GetDocumentQuery` example wired end-to-end in
`examples/ExampleApp/`. `node tools/docs.mjs validate` passes (61 documents).

## Checklist

- [x] All acceptance criteria covered — see note on AC5 below
- [x] Required automated verification passed
- [x] Scope: resolved
  - 1 owner-approved exception recorded (F1 — `classification.md`, outside this task's
    `allowed_paths`)
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | `node tools/docs.mjs validate` — 61 documents, no errors |
| 2 | Met | `grep -rniE "query.{0,20}(not implemented\|absent\|no support\|unimplemented)" docs/` — no matches after correcting `classification.md` (F1) |
| 3 | Met | `testing-strategy.md` "Test projects" lists `NEvo.Messaging.Cqrs.Tests` |
| 4 | Met | `NEvo.Messaging.md`'s public-surface section states the removal of `MessageHandlerAdapterBase`/`CommandHandlerAdapter`/`EventHandlerAdapter` and the addition of `MessageHandlerAdapter` as a breaking change |
| 5 | Met by inspection, not by a completed live run — see note below | `GetDocumentQuery`/`GetDocumentQueryHandler`/`DocumentDto` added; `Routes.cs` wires `GET /api/document/{documentId}` to `IQueryDispatcher`; `AddQueries()` and the handler registration are wired in `Program.cs`. `FakeEventStore` (always returns `None`, per `areas/documentation-and-example.md` § Current state) cannot support a real create-then-query round trip, so this task adds `InMemoryDocumentEventStore` (example-only, registered after `AddEventSourcing()`) so the example is genuinely demonstrable. |

### Note on AC5

I started `NEvo.ExampleApp.ServiceA.Api` standalone (`dotnet run`, outside the Aspire
AppHost) to attempt the manual create-then-query verification myself. Two pre-existing,
unrelated environmental issues blocked a completed run in this sandbox: (1) without
Aspire supplying a real SQL connection string, `MigrationBackgroundService` exhausts its
retries and stops the whole host after ~10 attempts (`HostOptions.BackgroundServiceExceptionBehavior:
StopHost`); (2) every request (not just the new one) fails with `UriFormatException`
from `Program.cs`'s Swagger setup, because `IdentityUrl` isn't configured when run
outside Aspire. Both predate this task and are unrelated to Query. I confirmed the app
does start and route to the new endpoint (the 500 response came from the `IdentityUrl`
issue above, not from `GetDocumentQuery`'s own code), and the code builds and is wired
correctly by inspection. A full click-through run needs the project's supported runtime
(the Aspire AppHost with a real SQL Server), consistent with this AC's own designation
as "inspection — manual run" — I'm flagging this so the owner does that pass rather than
silently asserting I completed it myself.

## Scope compliance

Compliant except for the one accepted exception above (F1). All other touched paths are
within `allowed_paths` (`docs/usage/**`, the two named package docs, the two named
development docs, `examples/ExampleApp/**`).

## Verification

- `node tools/docs.mjs validate` — passed (61 documents)
- `dotnet build` — passed
