---
id: event-sourcing-api-hardening.documents-example-es-and-auth-demo
status: draft
change: event-sourcing-api-hardening
depends_on:
  - create-documents-example-project
  - explicit-event-sourced-command-handler
  - event-sourcing-registration-options
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
semantic_references:
  decisions: [D9, D12]
  dependency_contracts:
    - create-documents-example-project
    - explicit-event-sourced-command-handler
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

Wire the Documents example service to demonstrate every hardened concept end to end:
Level 1 convention handling, an explicit Level 2 handler delegating to Level 1's
decision-method discovery, message-level permission metadata, aggregate-aware
authorization (if it fits without making the example noisy), `MapCommandEndpoint` +
`MapQueryEndpoint`, and `AddEventSourcing(options => {...})` registration — verified by
a documented manual walkthrough (D12), no dedicated test project.

## Dependencies

- `create-documents-example-project` (task 09).
- `explicit-event-sourced-command-handler` (task 04).
- `event-sourcing-registration-options` (task 06).
- `message-level-and-aggregate-authorization` (task 07).
- `map-query-endpoint-and-get-binding` (task 08).

## Implementation constraints

- At least one Document command (e.g. `ChangeDocument`) stays on the Level 1 convention
  path. At least one command (e.g. `ApproveDocument`, if it has a genuine orchestration
  need — otherwise pick whichever command can motivate one honestly, per the input
  specification's "prefer clarity over feature count") is handled via an explicit Level
  2 handler that delegates to Level 1's own decision-method discovery for the actual
  transition, not a duplicated implementation.
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
  and a version-conflict scenario (two concurrent changes against the same document
  version).

## Acceptance criteria

1. Create → change → approve → query works end to end via HTTP, verified manually and
   recorded in the walkthrough note (owner-decision: manual verification is sufficient
   per D12, not `automated`).
2. Reloading the aggregate after approval returns `ApprovedDocument`-shaped data via the
   query, not `EditableDocument`-shaped data (manual, recorded in the walkthrough).
3. At least one command uses Level 1 and at least one uses Level 2 delegating to Level
   1's discovery (inspection).
4. At least one command enforces message-level permission end to end, demonstrated by a
   request without the required permission being denied (manual, recorded in the
   walkthrough).
5. `MapCommandEndpoint`/`MapQueryEndpoint` are both used for Document endpoints
   (inspection).
6. A version-conflict scenario (two concurrent writes against the same loaded version)
   surfaces `AggregateConcurrencyException` through the HTTP layer's existing Problem
   response shape (manual, recorded in the walkthrough).
7. `dotnet build` succeeds (automated).

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
