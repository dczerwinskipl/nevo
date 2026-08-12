# Documents.Api walkthrough

Manual verification record for this example — there is no dedicated test project, so this
note plus `dotnet build` is how the example is verified.

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
| Aggregate-method convention | `CreateDocument`, `ChangeDocument`, `ApproveDocument` (`Document.cs`) |
| Message-level permission metadata | `[AllowPermission]` on `ApproveDocument` (`DocumentCommands.cs`) |
| `AddEventSourcing(options => {...})` | `Program.cs` |
| `MapCommandEndpoint` / `MapQueryEndpoint` | `Routes.cs` |
| Reload-after-write reconstructing concrete state | Query steps 2 and 4 below |

Every Document command is handled through the aggregate-method convention — no explicit
Event Sourced handler is demonstrated in this example. The one command
(`ApproveDocument`) that could plausibly need one only needs it to resolve the caller's
identity, and the framework has no current-user/context capability a decision method or
an explicit handler could use for that yet (see "About the generated `approvedBy`"
below) — wrapping that gap in an explicit handler wouldn't demonstrate genuine
orchestration, only add indirection around a placeholder.

Aggregate-aware authorization (`IAggregateAuthorization<TCommand, TAggregate>`, e.g.
"only the creator may approve") is **not** demonstrated here: this domain has no
creator/owner concept, and message-level permission already demonstrates the
authorization integration end to end. Adding a second, resource-aware authorization
mechanism on top would mean growing the domain (a `CreatedBy` field with no other use)
just to exercise the extension point.

## Step by step

Set an id to reuse across requests:

```
DOC_ID=$(uuidgen)   # or any GUID
```

### 1. Create (`POST /api/documents`)

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

Expect `{"documentId":"...","data":"hello","approved":false,"approvedBy":null}`
— `EditableDocument`-shaped (`approved: false`).

### 3. Change (`POST /api/documents/change`)

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
`Approver` role, hence no `APPROVE_DOCUMENT` permission). The `500` status is the
framework's current behavior for a denied permission, not a deliberately chosen
authorization status code.

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

Expect a response shaped like
`{"documentId":"...","data":"updated","approved":true,"approvedBy":"<non-empty guid>"}`
— `approved: true` and a non-empty `approvedBy`, proving the aggregate reloaded from its
event stream as `ApprovedDocument`, not the previous `EditableDocument` state.
`approvedBy` is a generated placeholder id (see below), not the authenticated caller's
id — it will differ from `22222222-2222-2222-2222-222222222222`.

### About the demo authentication scheme

`Authorization/DemoAuthentication.cs` treats any request carrying `X-Demo-User-Id` as
authenticated, with `X-Demo-Roles` (comma-separated) mapped to roles and, from there, to
NEvo permissions (`Authorization/DocumentPermissions.cs`). This exists only so the
walkthrough is self-contained — no Identity.Api/JWT bearer dependency, unlike
`ServiceA.Api`'s `SayHelloCommand` example, which shows the real JWT-based integration.
A real service should use a real authentication scheme.

### About the generated `approvedBy`

`EditableDocument.Approve` generates `ApprovedBy` with `Guid.NewGuid()` rather than
resolving the authenticated caller's id, because aggregate decision methods cannot yet
receive contextual dependencies such as the current user (see the `<remarks>` on
`Approve` in `Document.cs`). Treat `approvedBy` as "a non-empty id was recorded," not as
the identity of who called the endpoint.

## Optimistic concurrency

Not demonstrated here. A manually-reproduced concurrent-write race would be
flaky/timing-dependent and adds no coverage beyond what
`tests/NEvo.Ddd.EventSourcing.Tests` already proves deterministically (the repository
returns `AggregateConcurrencyException` on an expected-version mismatch). The Documents
repository uses exactly that expected-version optimistic-concurrency scheme; see the
Event Sourcing user guide (`docs/usage/event-sourcing.md`) for the full explanation.
