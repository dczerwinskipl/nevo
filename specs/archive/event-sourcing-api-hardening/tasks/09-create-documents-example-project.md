---
id: event-sourcing-api-hardening.create-documents-example-project
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
semantic_references:
  decisions: [D9]
  dependency_contracts: [harden-event-store-and-repository-contracts]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/documents-example-service.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/Document.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/DocumentCommands.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/DocumentEvents.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/DocumentQueries.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/InMemoryDocumentEventStore.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs
  optional:
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/NEvo.ExampleApp.ServiceA.Api.csproj
allowed_paths:
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Routes.cs
  - NEvo.sln
forbidden_paths:
  - src/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.Identity.Api/**
---

# Task: Create the Documents example project

## Goal

Create `NEvo.ExampleApp.Documents.Api`, move the Document domain into it with its own
proper namespace (not `NEvo.Ddd.EventSourcing.Tests.Mocks`), remove the domain from
`ServiceA.Api`, wire the real hardened repository path, and remove
`InMemoryDocumentEventStore`.

## Dependencies

- `harden-event-store-and-repository-contracts` (task 02) — the real repository path
  this task wires in place of the workaround.

This task's ordering relative to tasks 04/05/06/07/08 (which the *behavior* demo in task
10 needs) is deliberately loose — this task only creates the project skeleton and moves
the domain; task 10 adds the Level 2/authorization/registration-options/query-endpoint
demonstrations once those tasks land.

## Implementation constraints

- New project `examples/ExampleApp/NEvo.ExampleApp.Documents.Api/`, referenced from
  `NEvo.sln`, following the existing `NEvo.ExampleApp.*` project conventions (target
  framework, `Directory.Build.props` inheritance, etc.).
- Move `Document.cs`, `DocumentCommands.cs`, `DocumentEvents.cs`, `DocumentQueries.cs`
  into the new project under a proper namespace (e.g.
  `NEvo.ExampleApp.Documents.Api.Domain` or similar — not
  `NEvo.Ddd.EventSourcing.Tests.Mocks`). Update every reference.
- Remove `InMemoryDocumentEventStore.cs` entirely; wire the real
  `IAggregateRepository`/`IEventStreamStore` (task 02) via `AddEventSourcing(...)`
  (task 06's options-based registration, if already landed at implementation time —
  otherwise the current signature, updated in a later task if sequencing requires).
  Rewrite `GetDocumentQueryHandler` to read through the real repository path, and add a
  one-line doc comment on it stating this is an intermediate/simple read path used
  before persisted projection support exists.
- Remove all Document-related files from `ServiceA.Api`; leave its other examples
  (`SayHelloCommand`, `MyEvent`) untouched.

## Acceptance criteria

1. `NEvo.ExampleApp.Documents.Api.csproj` exists and is referenced from `NEvo.sln`
   (automated: `dotnet build`).
2. The Document domain's types live in a namespace under
   `NEvo.ExampleApp.Documents.Api.*`, not `NEvo.Ddd.EventSourcing.Tests.Mocks`
   (inspection).
3. `InMemoryDocumentEventStore` no longer exists anywhere in the repository (inspection:
   `grep`).
4. `GetDocumentQueryHandler` reads through the real `IAggregateRepository` path
   (inspection), with a comment documenting it as an intermediate read path.
5. `ServiceA.Api` contains no Document-related file (inspection).
6. `dotnet build` succeeds for the whole solution (automated).

## Verification

```
dotnet build
```

## Documentation impact

None in this task — tasks 11 (user-facing) and 12 (internal) link the finished example.

## Out of scope

- Level 2 explicit handler demonstration, permission metadata, aggregate-aware
  authorization demonstration, `MapCommandEndpoint`/`MapQueryEndpoint` wiring (task 10).
- Any test project for this service (D12).
