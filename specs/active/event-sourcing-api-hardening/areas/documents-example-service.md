# Area: Documents example service

## Responsibility

Create a dedicated `NEvo.ExampleApp.Documents.Api` example service demonstrating every
hardened concept end to end, replacing the current in-`ServiceA.Api` Document example
and its `InMemoryDocumentEventStore` workaround.

## Current state

The Document example lives inside `ServiceA.Api`
(`examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/`):
`Document.cs` (aggregate root + `EditableDocument`/`ApprovedDocument` states, `Create`
decider, `Apply` evolvers), `DocumentCommands.cs` (`CreateDocument`, `ChangeDocument`,
`ApproveDocument`), `DocumentEvents.cs` (`DocumentCreated`, `DocumentChanged`,
`DocumentApproved`), `DocumentQueries.cs` (`DocumentDto`, `GetDocumentQuery`,
`DocumentNotFoundException`, `GetDocumentQueryHandler`), `InMemoryDocumentEventStore.cs`.
**These types are declared in namespace `NEvo.Ddd.EventSourcing.Tests.Mocks`**
(`Document.cs:3` etc.) even though they live in the example app — the example currently
depends on test-fixture-shaped code rather than its own domain namespace. Only two
states exist (`EditableDocument`/`ApprovedDocument`; no `ReturnedDocument`) — the
transition graph the input specification uses as its illustrative example
(`EditableDocument -> DocumentApproved -> ApprovedDocument`) is already what's
implemented. No permission metadata exists on any Document command (contrast:
`SayHelloCommand` already has `[AllowPermission(...)]` and `.RequireAuthorization()` in
the same `ServiceA.Api`, showing the established pattern to extend). No tests exist for
the Document example. `InMemoryDocumentEventStore` conflates event persistence with
read-model projection by its own header comment and is stale against the current
`IEventStore` interface (fixed for compilation only, not redesigned, by task 01).

`GetDocumentQueryHandler` currently reads via `IEventStore.LoadProjectionAsync`, which
task 03 removes from the repository/store contracts — this handler must be rewritten to
read via the real, hardened `IAggregateRepository` path instead once task 03 lands.

ExampleApp project layout: `Identity.Api`, `ServiceA.Api`, `ServiceB.Api`,
`Orchestration.AppHost`, `Orchestration.ServiceDefaults` — all under
`examples/ExampleApp/`. No existing project is named after Documents.

## Requirements

- Create `NEvo.ExampleApp.Documents.Api` (or a naming form consistent with the existing
  `NEvo.ExampleApp.*` projects), moving the Document domain into it with its own proper
  namespace (not `NEvo.Ddd.EventSourcing.Tests.Mocks`).
- Demonstrate: Level 1 convention handling for at least one command; the
  `EditableDocument -> ApprovedDocument` transition; at least one explicit Level 2
  `IEventSourcedCommandHandler<...>` demonstrating genuine orchestration need, reusing
  Level 1's decision-method discovery rather than duplicating the transition; message-
  level permission metadata; aggregate-aware authorization if it fits without making the
  example noisy; `MapCommandEndpoint`; `MapQueryEndpoint`; aggregate reload after writes
  reconstructing the correct concrete state.
- Rewrite `GetDocumentQueryHandler` to read through the hardened `IAggregateRepository`
  path (task 03), documenting this explicitly as an intermediate/simple read path used
  before persisted projection support exists — not the final recommendation for all
  Event Sourcing read models (input specification's explicit documentation
  requirement).
- Remove `InMemoryDocumentEventStore` once the real repository path works for this
  example — do not build a fake projection system to keep it alive.
- Remove the Document example from `ServiceA.Api` once the dedicated service exists —
  `ServiceA.Api` keeps its other examples (`SayHelloCommand`, `MyEvent`) unchanged.

## Constraints

- No dedicated test project for this service (D12) — verified by manual walkthrough
  only, documented as such. A follow-up specification is expected to add integration
  tests.
- Prefer clarity over feature count — do not turn this into a showcase for every
  possible ES feature; the input specification explicitly asks for a compact, coherent
  example.
- Do not reorganize any other ExampleApp service as part of this area.

## Interfaces and boundaries

- Consumes: task 03 (repository/store contracts), task 05 (explicit handler contract),
  task 06/07 (Primary/Fallback registration, `AddEventSourcing(options => {...})`), task
  08 (message-level attribute + aggregate-aware authorization extension point), task 09
  (`MapQueryEndpoint`).
- Produces: the canonical Event Sourcing usage example that task 12's documentation
  links to.

## Area-specific acceptance criteria

1. `NEvo.ExampleApp.Documents.Api` exists as its own project, referenced from
   `NEvo.sln`, with the Document domain in its own namespace.
2. Create → change → approve → query works end to end against the real
   `IAggregateRepository`/`IEventStreamStore` path (task 03), not
   `InMemoryDocumentEventStore` (removed).
3. Reloading the aggregate after a write reconstructs the correct concrete state
   (`ApprovedDocument` after approval, not `EditableDocument`).
4. At least one command is handled via Level 1 convention and at least one via an
   explicit Level 2 handler that delegates to Level 1's own decision-method discovery.
5. At least one Document command carries message-level permission metadata, enforced
   end to end (task 08).
6. `MapCommandEndpoint`/`MapQueryEndpoint` are both used for the Document endpoints.
7. `ServiceA.Api` no longer contains any Document-related type.
8. `dotnet build` succeeds; the manual walkthrough (documented in task 11) is the
   verification record in place of a dedicated test project (D12).

## Dependencies

- `persistence-boundary` (task 03).
- `shared-es-execution-and-explicit-handler` (task 05).
- `handler-registration-and-options` (task 07).
- `authorization-integration` (task 08).
- `http-query-endpoint` (task 09).

## Out of scope

- A dedicated test project (D12).
- Any change to `ServiceB.Api`/`Identity.Api`/orchestration projects.
- Persisted projections/read models for Documents.
