---
id: event-sourcing-api-hardening.current-user-capability-and-documents-integration
status: draft
change: event-sourcing-api-hardening
depends_on:
  - aggregate-decision-method-parameter-injection
  - documents-example-es-and-auth-demo
  - message-level-and-aggregate-authorization
semantic_references:
  decisions: [D4, D32, D33, D34, D35]
  dependency_contracts:
    - aggregate-decision-method-parameter-injection
    - documents-example-es-and-auth-demo
    - message-level-and-aggregate-authorization
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/current-user-capability.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Messaging.Authorization/UserContext.cs
    - src/NEvo.Messaging.Authorization/MessageContextExtensions.cs
    - src/NEvo.Messaging.Authorization/ServiceCollectionExtensions.cs
    - src/NEvo.Messaging/Context/IMessageContextAccessor.cs
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/Document.cs
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/ServiceCollectionExtensions.cs
  optional: []
allowed_paths:
  - src/NEvo.Messaging.Authorization/**
  - tests/NEvo.Messaging.Authorization.Tests/**
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging.Web/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
---

# Task: Current-user capability and Documents integration

## Goal

Add a small, identity-only `ICurrentUser<TId>` capability in `NEvo.Messaging.Authorization`,
and use it (through task 13's parameter injection) to replace the Documents example's
`ApprovedBy: Guid.NewGuid()` placeholder with the real authenticated user's id — closing
the gap D33 named when it removed the example's explicit Level 2 handler.

## Dependencies

- `aggregate-decision-method-parameter-injection` (task 13) — the mechanism
  `EditableDocument.Approve` uses to receive `ICurrentUser<Guid>`.
- `documents-example-es-and-auth-demo` (task 10) — modifies the example it created.
- `message-level-and-aggregate-authorization` (task 07) — same package boundary,
  existing authorization pipeline this capability sits alongside.

## Implementation constraints

- Add, in `NEvo.Messaging.Authorization`:

  ```csharp
  public interface ICurrentUser<TId>
  {
      Option<User<TId>> User { get; }
  }
  ```

  (Exact name may change only if implementation finds an existing NEvo naming convention
  that is clearly better — none was found during refinement.)
- Implementation adapts `IMessageContextAccessor`/`UserContext<TId>` internally (e.g.
  `accessor.MessageContext?.GetUserContext<TId>().User ?? Option<User<TId>>.None`).
  Consumers never call `GetFeature`/`GetUserContext` themselves.
- Register via an addition to `NEvo.Messaging.Authorization`'s
  `ServiceCollectionExtensions` (currently an empty stub — add an `AddCurrentUser<TId>()`
  or equivalent), scoped lifetime, `TryAdd*` for idempotency (matching this
  specification's established DI convention, D4/D32). The Documents example calls it
  from its existing `AddDocumentsAuthorization()`.
- `ICurrentUser<TId>` exposes identity only — `User` and nothing else. It must never
  expose roles, permissions, `IServiceProvider`, raw headers/`IMessageContext`,
  feature-bag getters/setters, correlation/causation, or any mutable authorization state.
  Authorization stays the responsibility of the authorization pipeline
  (`ValidatePermissionMiddleware`); if a business rule needs more than identity, it is
  injected as an explicit business-policy parameter (task 13's mechanism), not obtained
  by inspecting roles here.
- Documents integration:
  - `EditableDocument.Approve(ApproveDocument command)` becomes
    `EditableDocument.Approve(ApproveDocument command, ICurrentUser<Guid> currentUser)`.
  - `DocumentApproved`'s `ApprovedBy` is set from `currentUser.User`'s id, not
    `Guid.NewGuid()`. If `currentUser.User` is `None`, `Approve` itself decides how to
    respond (e.g. a `Left`) — do not fabricate an identity in that case either.
  - Remove the placeholder `<remarks>` on `Approve` once it no longer describes real
    behavior; replace with documentation of the actual final contract if still useful
    (business meaning/framework contract only — no task/decision-history wording, per
    `overview.md` § "Canonical comments/documentation quality").
  - Do not recreate `ApproveDocumentHandler`/`ApproveDocumentDecision` — D33 removed them
    because wrapping this exact placeholder in a Level 2 handler added indirection
    without a genuine orchestration need; this task's whole point is making Level 1
    sufficient.
  - Update task 10's walkthrough note so the recorded manual verification shows the real
    `ApprovedBy` value end to end.

## Acceptance criteria

1. `ICurrentUser<TId>.User` returns `Option<User<TId>>` reflecting the current
   `IMessageContext`'s `UserContext<TId>`, `None` when absent (test, with and without a
   populated context).
2. `ICurrentUser<TId>` exposes no member beyond `User` (inspection).
3. `EditableDocument.Approve` takes `ICurrentUser<Guid> currentUser` as its second
   parameter; `DocumentApproved.ApprovedBy` reflects the resolved user's id, not
   `Guid.NewGuid()` (inspection + manual walkthrough).
4. The placeholder `<remarks>` describing the missing-capability limitation is removed
   from `Approve` (inspection).
5. `ApproveDocumentHandler`/`ApproveDocumentDecision` remain absent; `ApproveDocument` is
   still handled entirely through the Level 1 aggregate-method convention (inspection,
   preserves D33).
6. No test or production code reaches roles, permissions, `IServiceProvider`,
   `IMessageContext`, or feature-bag members through `ICurrentUser<TId>` (inspection).
7. `dotnet build` succeeds; `dotnet test tests/NEvo.Messaging.Authorization.Tests`
   passes; the Documents example's walkthrough note is updated and manually re-verified.

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Authorization.Tests
```

Manual walkthrough update per the acceptance criteria above (extends task 10's existing
walkthrough note, not a new document).

## Documentation impact

Task 10's walkthrough note is updated in place. Tasks 11/12 (sequenced after this task)
document `ICurrentUser<TId>` and the final `ApprovedBy` behavior as part of their own,
already-scheduled scope.

## Out of scope

- Roles/permissions exposure through `ICurrentUser<TId>`.
- Any change to the authorization pipeline's enforcement logic (task 15's HTTP-mapping
  concern is separate).
- A general `IContext`/`IUserContext` abstraction, or correlation/causation exposure.
- A dedicated test project for the Documents example (D12, unaffected by this task).
