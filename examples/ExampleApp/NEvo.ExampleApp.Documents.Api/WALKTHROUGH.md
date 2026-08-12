# Documents.Api walkthrough

This walkthrough demonstrates the Documents Event Sourcing example end to end.

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
Event Sourced handler is demonstrated in this example. `EditableDocument.Approve`
receives the current user's identity as a framework-resolved additional parameter
(`ICurrentUser<Guid>`, aggregate-method convention parameter injection) rather than
through an explicit handler — see "About the resolved `approvedBy`" below.

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

Expect a `403` Problem response with `"detail":"Permission denied."` —
`ValidatePermissionMiddleware` denies the request because `ApproveDocument`'s
`[AllowPermission(DocumentPermissions.ApproveDocument, ...)]` requirement isn't met (no
`Approver` role, hence no `APPROVE_DOCUMENT` permission), returning a
`PermissionDeniedException` (`UnauthorizedAccessException`-derived) that
`NEvo.Messaging.Web`'s HTTP mapping recognizes by type and maps to `403`.

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
`{"documentId":"...","data":"updated","approved":true,"approvedBy":"22222222-2222-2222-2222-222222222222"}`
— `approved: true`, proving the aggregate reloaded from its event stream as
`ApprovedDocument`, not the previous `EditableDocument` state, and `approvedBy` matches
the authenticated caller's id from step 5 (see below), not a fabricated value.

### 7. Query a non-existent document (ordinary application failure)

```
curl -i http://localhost:5299/api/documents/$(uuidgen)
```

Expect `500` with `"detail":"Document '...' was not found."` —
`DocumentNotFoundException` is an ordinary `Exception`, not
`UnauthorizedAccessException`-derived, so it still maps to `500`, unchanged by the 403
mapping added above.

### About the demo authentication scheme

`Authorization/DemoAuthentication.cs` treats any request carrying `X-Demo-User-Id` as
authenticated, with `X-Demo-Roles` (comma-separated) mapped to roles and, from there, to
NEvo permissions (`Authorization/DocumentPermissions.cs`). This exists only so the
walkthrough is self-contained, with no Identity.Api/JWT bearer dependency. A real service
should use a real authentication scheme.

### About the resolved `approvedBy`

`EditableDocument.Approve(ApproveDocument command, ICurrentUser<Guid> currentUser)`
resolves `currentUser` per-invocation through the aggregate-method convention's
parameter-injection mechanism; `ApprovedBy` is set from `currentUser.User`'s id — the
same id `DemoUserProvider` resolved from the request's `X-Demo-User-Id` header (see
`Document.cs`). If no current user is resolved, `Approve` returns a `Left` instead of
fabricating an identity.

## Optimistic concurrency

The example uses expected-version optimistic concurrency. Concurrency conflicts are
covered by the Event Sourcing core tests (`tests/NEvo.Ddd.EventSourcing.Tests`); see the
Event Sourcing user guide (`docs/usage/event-sourcing.md`) for the full explanation.
