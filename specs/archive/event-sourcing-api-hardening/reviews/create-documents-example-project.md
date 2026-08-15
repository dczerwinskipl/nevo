---
review-of: task
change: event-sourcing-api-hardening
task: create-documents-example-project
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - path: examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/MessageHandlerRegistryExtensions.cs
    finding_id: F1
    reason: >
      This task's own text requires "Update every reference" to the moved Document
      domain types, and "Remove all Document-related files from ServiceA.Api" — this
      file's AddServiceADomain() registered GetDocumentQueryHandler (now moved to
      NEvo.ExampleApp.Documents.Api) and imported the deleted
      NEvo.Ddd.EventSourcing.Tests.Mocks namespace. Leaving it unedited would either
      break the build (the type no longer exists there) or leave a stale reference to
      a deleted type — the task's own "dotnet build succeeds" acceptance criterion
      requires touching it. Not listed in allowed_paths (only
      ExampleDomain/Documents/**, Program.cs, and Routes.cs are) — same class of gap
      as this change's own precedent (D29's exception for InMemoryDocumentEventStore.cs
      and Program.cs on the harden-event-store-and-repository-contracts task): a
      context-packet omission, not a deliberate exclusion. One-line change: removed the
      GetDocumentQueryHandler registration and the now-dead using directive.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-12
    task_fingerprint: 772f66cd20eadc0a82c0dc3cbaa9ba07e05f4ab961930d8a58050e17adcc683f
---

# Review: event-sourcing-api-hardening/create-documents-example-project

Second re-review (2026-08-12, pre-task-10 correction pass). Baseline: this file's prior
content (`pass`). `review_revision`/`self_check.revision` refreshed to current HEAD
(`985cd13a1befe493e705514f0bc26b6d8e92d96f` plus this pass's own uncommitted patch) via
the normal `self-check` workflow. Task fingerprint unchanged
(`772f66cd20eadc0a82c0dc3cbaa9ba07e05f4ab961930d8a58050e17adcc683f`) — the recorded
scope exception above remains valid against it, re-verified. Three corrections, all in
service of the example actually demonstrating what it's meant to teach before task 10
builds on it:

- **`Document` aggregate state is now genuinely immutable.** `Id`/`Data` were `{ get;
  set; }` despite every `Apply` already constructing a new concrete state object — the
  setters were unused dead surface that contradicted the OO-immutable modeling style
  this example is the canonical demonstration of. Now `{ get; }`-only, set once via the
  constructor. `EditableDocument.Apply` now returns the correctly-typed
  `EditableDocument`/`ApprovedDocument` (previously widened to the base `Document`) —
  confirmed compatible with `AggregateEvolverExtractor`'s own return-type check
  (`aggregateType.IsAssignableFrom(m.ReturnType)`, satisfied either way, since a
  narrower return type is still assignable to the base). `EditableDocument`/
  `ApprovedDocument` are now `sealed` (no example subclassing was happening or
  intended).
- **`AddDocumentsDomain` moved out of `NEvo.Messaging.Handling`** (a real NEvo
  framework namespace) **into `NEvo.ExampleApp.Documents.Api`** — an example-specific
  DI extension living in a framework namespace read as part of the framework's own
  public API, which it is not. `Program.cs` updated to match; no longer `partial`
  (that convention existed only for `ServiceA.Api`'s framework-namespace pattern, which
  no longer applies here).
- **Removed the one task-sequencing comment** in `Program.cs` ("HTTP endpoints ...
  are added once their own tasks land") — replaced with a comment stating what's
  actually true right now (the aggregate-method convention handles Document commands
  via `AddEventSourcing`), not what hasn't been built yet. Repo-wide search of this
  project found no other task/spec-chronology comments.

`dotnet build` succeeds for the whole solution.

---

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

New `NEvo.ExampleApp.Documents.Api` project (referenced from `NEvo.sln`), following the
sibling `NEvo.ExampleApp.*` projects' conventions (`Microsoft.NET.Sdk.Web`,
`Directory.Build.props` inheritance, `AddServiceDefaults()`/`MapDefaultEndpoints()`).
Kept deliberately minimal per this task's own scope boundary — no HTTP endpoints, no
auth, no EF/database/inbox wiring, since `MapCommandEndpoint`/`MapQueryEndpoint`
wiring, the explicit Level 2 handler, and authorization are all explicitly task 10's
concern, not this one's. The Document domain (`Document.cs`, `DocumentCommands.cs`,
`DocumentEvents.cs`, `DocumentQueries.cs`) moved into `NEvo.ExampleApp.Documents.Api
.Domain` — a real namespace, not the borrowed `NEvo.Ddd.EventSourcing.Tests.Mocks` the
example previously (confusingly) used despite living in a different project entirely.
Three unused `AcceptedByX`/`AcceptedByY`/`AcceptedByZ` boolean fields on `Document`
(never read or written anywhere, confirmed by repo-wide search) were dropped during the
move — a minor, behavior-invisible cleanup in service of the area's own "prefer clarity
over feature count" constraint, not a scope expansion.

`InMemoryDocumentEventStore` — the workaround that hand-built a `DocumentDto` directly
inside `AppendEventsAsync` instead of storing raw events, conflating persistence with
projection — is deleted entirely (confirmed: zero matches repo-wide). `GetDocumentQueryHandler`
now reads through the real `IAggregateRepository.LoadAggregateAsync<Document, Guid>`
path, mapping the rehydrated concrete state (checking `is ApprovedDocument` for the
`Approved` flag) to `DocumentDto`, with a doc comment stating this is an intermediate
read path pending persisted-projection support — not a load-bearing recommendation for
Event Sourcing read models generally.

`ServiceA.Api`'s `Program.cs`/`Routes.cs` no longer reference `AddEventSourcing`,
`InMemoryDocumentEventStore`, or any Document command/query — its other examples
(`SayHelloCommand`, `MyEvent`) are untouched, confirmed by diff.

## Acceptance criteria

- [x] All 6 acceptance criteria covered.
  1. `NEvo.ExampleApp.Documents.Api.csproj` exists, referenced from `NEvo.sln` —
     confirmed by `dotnet build` succeeding and `dotnet sln list`.
  2. Document domain lives under `NEvo.ExampleApp.Documents.Api.Domain`, not
     `NEvo.Ddd.EventSourcing.Tests.Mocks` — confirmed by direct read of each moved file.
  3. `InMemoryDocumentEventStore` — zero matches repo-wide (`grep`).
  4. `GetDocumentQueryHandler` reads via `IAggregateRepository`, with the required
     intermediate-read-path doc comment.
  5. `ServiceA.Api` — zero Document-related matches repo-wide under that project's path.
  6. `dotnet build` — succeeds for the whole solution.

## Scope

- [x] Scope: resolved — 1 owner-approved exception recorded above
  (`MessageHandlerRegistryExtensions.cs`, F1). No other path outside `allowed_paths`
  touched; `src/**`, `ServiceB.Api/**`, and `Identity.Api/**` (all `forbidden_paths`)
  are untouched.

## Verification

- `dotnet build` — passed (whole solution, per this task's own verification block)

## Findings

None unresolved (see the accepted scope exception above).
