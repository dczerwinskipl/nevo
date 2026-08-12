---
id: event-sourcing-api-hardening.documents-example-es-and-auth-demo
status: draft
change: event-sourcing-api-hardening
depends_on:
  - create-documents-example-project
  - event-sourcing-registration-options
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
semantic_references:
  decisions: [D9, D12, D33, D28]
  dependency_contracts:
    - create-documents-example-project
    - event-sourcing-registration-options
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/documents-example-service.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/
  optional: []
allowed_paths:
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
forbidden_paths:
  - src/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
---

# Task: Documents example — ES levels and authorization demo

## Goal

Wire the Documents example service to demonstrate the hardened concepts that fit this
compact domain honestly end to end: Level 1 aggregate-method convention handling,
message-level permission metadata, aggregate-aware authorization (if it fits without
making the example noisy), `MapCommandEndpoint` + `MapQueryEndpoint`, and
`AddEventSourcing(options => {...})` registration — verified by a documented manual
walkthrough (D12), no dedicated test project.

**Narrowed by D33.** This example no longer demonstrates an explicit Level 2 handler.
`ApproveDocument`'s only candidate orchestration need — capturing the approver's
identity — is not a genuine one today: the framework has no current-user/context
capability an aggregate decision method or an explicit handler could use to resolve it,
so an explicit handler here would only wrap a placeholder value, not real orchestration.
See D33 for the full rationale.

## Dependencies

- `create-documents-example-project` (task 09).
- `event-sourcing-registration-options` (task 06).
- `message-level-and-aggregate-authorization` (task 07).
- `map-query-endpoint-and-get-binding` (task 08).

## Implementation constraints

- All Document commands (`CreateDocument`, `ChangeDocument`, `ApproveDocument`) stay on
  the Level 1 aggregate-method convention path — no explicit
  `IEventSourcedCommandHandler<...>` is registered for any of them (D33).
  `EditableDocument.Approve` generates the approver identifier directly
  (`Guid.NewGuid()`), documented with a prominent `<remarks>` stating this is a
  placeholder for a not-yet-available current-user/context capability the aggregate
  decision method cannot use today.
- At least one Document command carries message-level permission metadata (task 07),
  wired with `.RequireAuthorization()` on its `MapCommandEndpoint` call.
- Add an aggregate-aware authorization example only if it stays compact — e.g. "only the
  document's creator may approve it" — using the `IAggregateAuthorization<TCommand,
  TAggregate>` extension point from task 07. If this makes the example noisy, omit it
  and note why in this task's own PR description rather than forcing it in.
- Use `AddEventSourcing(options => {...})` (task 06) with convention fallback enabled
  (the default), and use `MapQueryEndpoint<GetDocumentQuery, DocumentDto>` (task 08) in
  place of the current hand-wired `MapGet`.
- Write the manual walkthrough as a short, step-by-step doc comment or `README`-style
  note inside the example project (not a new top-level doc — task 11 links to it as the
  canonical sample), covering: create → change → approve → query, reload-after-write,
  the Level 1 aggregate-method convention, permissions, and query/command endpoint
  mapping. **Do not
  include a manufactured concurrent-write/HTTP-race scenario (D28)** — optimistic
  concurrency is covered deterministically in Event Sourcing core tests (tasks 02-03);
  the walkthrough may mention, in prose, that the repository uses expected-version
  optimistic concurrency and link to `docs/usage/event-sourcing.md`'s explanation,
  without reproducing a race.

## Acceptance criteria

1. Create → change → approve → query works end to end via HTTP, verified manually and
   recorded in the walkthrough note (owner-decision: manual verification is sufficient
   per D12, not `automated`).
2. Reloading the aggregate after approval returns `ApprovedDocument`-shaped data via the
   query, not `EditableDocument`-shaped data (manual, recorded in the walkthrough).
3. All Document commands are handled via the Level 1 aggregate-method convention; no
   explicit `IEventSourcedCommandHandler<...>` is registered for any Document command
   (inspection, D33). `EditableDocument.Approve` generates the approver identifier
   directly, documented with a `<remarks>` describing the current missing capability
   (inspection).
4. At least one command enforces message-level permission end to end, demonstrated by a
   request without the required permission being denied (manual, recorded in the
   walkthrough).
5. `MapCommandEndpoint`/`MapQueryEndpoint` are both used for Document endpoints
   (inspection).
6. `dotnet build` succeeds (automated).
7. The walkthrough does not include a manufactured concurrent-write/HTTP-race scenario
   (inspection, per D28) — optimistic-concurrency coverage lives entirely in
   `tests/NEvo.Ddd.EventSourcing.Tests` (tasks 02-03).

## Verification

```
dotnet build
```

Manual walkthrough per the acceptance criteria above, recorded in the example project's
own walkthrough note.

## Documentation impact

The walkthrough note lives in this task's own scope (inside the example project); task
11 (user-facing) links to it as the canonical Event Sourcing example, and task 12
(internal) links to it as a maintainer reference.

## Out of scope

- A dedicated test project (D12) — a follow-up specification is expected to add
  integration tests.
- Any change to `ServiceA.Api`/`ServiceB.Api`.
