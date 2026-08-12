# Documents.Api walkthrough

Manual verification record for this example (D12 — no dedicated test project; this note
plus `dotnet build` is the acceptance evidence for task 10 of the
`event-sourcing-api-hardening` change). Task 11's user-facing guide and task 12's
internal architecture doc link here as the canonical Event Sourcing example.

Run the service directly — no other example project or Identity.Api needs to be
running:

```
dotnet run --project examples/ExampleApp/NEvo.ExampleApp.Documents.Api
```

It listens on the URL printed at startup (`http://localhost:<port>` by default). The
commands below use `http://localhost:5299` — substitute your own port.

## What this demonstrates

| Concept | Where |
|---|---|
| Level 1 — aggregate-method convention | `CreateDocument`, `ChangeDocument` (`Document.cs`) |
| Level 2 — explicit handler delegating to Level 1 | `ApproveDocument` → `ApproveDocumentHandler.cs` |
| Message-level permission metadata | `[AllowPermission]` on `ApproveDocument` (`DocumentCommands.cs`) |
| `AddEventSourcing(options => {...})` | `Program.cs` |
| `MapCommandEndpoint` / `MapQueryEndpoint` | `Routes.cs` |
| Reload-after-write reconstructing concrete state | Query steps 2 and 4 below |

Aggregate-aware authorization (`IAggregateAuthorization<TCommand, TAggregate>`, e.g.
"only the creator may approve") is **not** demonstrated here: this domain has no
creator/owner concept, and message-level permission already demonstrates the
authorization integration end to end. Adding a second, resource-aware authorization
mechanism on top would mean growing the domain (a `CreatedBy` field with no other use)
just to exercise the extension point — the input specification explicitly allows
omitting this when it would make the example noisy rather than clearer.

## Level 1 vs Level 2

`CreateDocument` and `ChangeDocument` have no explicit handler — the aggregate-method
convention (Level 1, Fallback role) routes them straight to `Document.Create` /
`EditableDocument.Change`.

`ApproveDocument` has `ApproveDocumentHandler` registered as an explicit
`IEventSourcedCommandHandler<ApproveDocument, Document, Guid>` (Level 2, Primary role).
The genuine reason it needs Level 2: the resulting `DocumentApproved` event must record
*who* approved the document, and a decision method only ever sees the command and the
current aggregate state — it has no way to resolve caller identity. The handler resolves
the approver from the same current-user context `UserContextMiddleware` populates for
the permission check below (via `IMessageContextAccessor`), delegates the actual
`EditableDocument -> ApprovedDocument` transition to `EditableDocument.Approve` through
`IAggregateMethodDecider` — the transition rule stays defined exactly once — and enriches
the returned event with the resolved approver. `EditableDocument.Approve` itself is
still discovered as a convention (Fallback) candidate for `ApproveDocument`, but is never
selected, because the explicit handler is registered as Primary (one Primary always wins
over a Fallback).

## Step by step

Set an id to reuse across requests:

```
DOC_ID=$(uuidgen)   # or any GUID
```

### 1. Create (Level 1, `POST /api/documents`)

```
curl -X POST http://localhost:5299/api/documents \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\",\"data\":\"hello\"}"
```

Expect `200 {}`.

### 2. Query (`GET /api/documents/{documentId}`, `MapQueryEndpoint`)

```
curl http://localhost:5299/api/documents/$DOC_ID
```

Expect `{"documentId":"...","data":"hello","approved":false,"approvedBy":null,"id":"..."}`
— `EditableDocument`-shaped (`approved: false`).

### 3. Change (Level 1, `POST /api/documents/change`)

```
curl -X POST http://localhost:5299/api/documents/change \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\",\"data\":\"updated\"}"
```

Querying again shows `"data":"updated"` — the aggregate reloaded from its event stream
before applying the change, not from an in-memory shortcut.

### 4. Approve without the required permission (message-level permission, denied)

First, with no authentication at all:

```
curl -i -X POST http://localhost:5299/api/documents/approve \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\"}"
```

Expect `401` — `RequireAuthorization()` on the endpoint rejects an unauthenticated
request outright (see `Routes.cs`).

Then, authenticated but without the `Approver` role:

```
curl -X POST http://localhost:5299/api/documents/approve \
  -H "Content-Type: application/json" \
  -H "X-Demo-User-Id: 11111111-1111-1111-1111-111111111111" \
  -d "{\"documentId\":\"$DOC_ID\"}"
```

Expect a `500` Problem response with `"detail":"Permission denied"` —
`ValidatePermissionMiddleware` denies the request because `ApproveDocument`'s
`[AllowPermission(DocumentPermissions.ApproveDocument, ...)]` requirement isn't met (no
`Approver` role, hence no `APPROVE_DOCUMENT` permission). This is the message-level
permission enforcement task 07 added, exercised end to end.

### 5. Approve with the required permission

```
curl -X POST http://localhost:5299/api/documents/approve \
  -H "Content-Type: application/json" \
  -H "X-Demo-User-Id: 22222222-2222-2222-2222-222222222222" \
  -H "X-Demo-Roles: Approver" \
  -d "{\"documentId\":\"$DOC_ID\"}"
```

Expect `200 {}`.

### 6. Query again — reload produces `ApprovedDocument`-shaped data

```
curl http://localhost:5299/api/documents/$DOC_ID
```

Expect
`{"documentId":"...","data":"updated","approved":true,"approvedBy":"22222222-2222-2222-2222-222222222222","id":"..."}`
— `approved: true` and `approvedBy` set to the identity resolved in step 5, proving the
aggregate reloaded from its event stream as `ApprovedDocument`, not the previous
`EditableDocument` state, and that the Level 2 handler's enrichment reached the
persisted event.

### About the demo authentication scheme

`Authorization/DemoAuthentication.cs` treats any request carrying `X-Demo-User-Id` as
authenticated, with `X-Demo-Roles` (comma-separated) mapped to roles and, from there, to
NEvo permissions (`Authorization/DocumentPermissions.cs`). This exists only so the
walkthrough is self-contained — no Identity.Api/JWT bearer dependency, unlike
`ServiceA.Api`'s `SayHelloCommand` example, which shows the real JWT-based integration.
A real service should use a real authentication scheme.

## Optimistic concurrency

Not demonstrated here. A manually-reproduced concurrent-write race would be
flaky/timing-dependent and adds no coverage beyond what
`tests/NEvo.Ddd.EventSourcing.Tests` already proves deterministically (the repository
returns `AggregateConcurrencyException` on an expected-version mismatch). The Documents
repository uses exactly that expected-version optimistic-concurrency scheme; see the
Event Sourcing user guide (`docs/usage/event-sourcing.md`, added by this change's
documentation task) for the full explanation.
