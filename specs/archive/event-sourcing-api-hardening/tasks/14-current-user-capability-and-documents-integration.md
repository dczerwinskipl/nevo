---
id: event-sourcing-api-hardening.current-user-capability-and-documents-integration
status: draft
change: event-sourcing-api-hardening
depends_on:
  - aggregate-decision-method-parameter-injection
  - documents-example-es-and-auth-demo
  - message-level-and-aggregate-authorization
semantic_references:
  decisions: [D4, D32, D33, D34, D35, D42, D43, D44]
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
  - src/NEvo.Authorization/**
  - src/NEvo.Web.Authorization/**
  - tests/NEvo.Messaging.Authorization.Tests/**
  - tests/NEvo.Web.Authorization.Tests/**
  - tests/NEvo.Ddd.EventSourcing.Tests/Characterization/ExplicitHandlerPermissionCompositionTests.cs
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging.Web/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
---

# Task: Current-user capability and Documents integration

## Goal

Add a small, identity-only `ICurrentUser<TId, TUser>` capability in `NEvo.Messaging.Authorization`,
and use it (through task 13's parameter injection) to replace the Documents example's
`ApprovedBy: Guid.NewGuid()` placeholder with the real authenticated user's id — closing
the gap D33 named when it removed the example's explicit Level 2 handler.

## Dependencies

- `aggregate-decision-method-parameter-injection` (task 13) — the mechanism
  `EditableDocument.Approve` uses to receive `ICurrentUser<Guid, DemoUser>`.
- `documents-example-es-and-auth-demo` (task 10) — modifies the example it created.
- `message-level-and-aggregate-authorization` (task 07) — same package boundary,
  existing authorization pipeline this capability sits alongside.

**Corrected by D44 (targeted correction pass).** As initially implemented,
`CurrentUser<TId, TUser>`'s constructor accepted `IMessageContextAccessor` unconditionally
and only threw `CurrentUserUnavailableException` from the `User` getter. Because
`DecisionMethodParameterResolver` resolves this task's `ICurrentUser<TId, TUser>` by
constructing it (construction always succeeds), the decision method was already being
invoked — the CLR had already entered `Approve`'s body — by the time reading
`currentUser.User` threw. That satisfies D42's *type* but not its intent: "the decision
method is not invoked at all" was not literally true. This task now requires
`CurrentUser<TId, TUser>` to obtain and validate the required user during construction,
throwing `CurrentUserUnavailableException` from the constructor when unavailable, so
`Approve` is never entered without one. `ICurrentUser<TId, TUser>`'s public shape
(`TUser User { get; }`) and every other part of this task (D43's generic-user design,
identity-only surface, registration shape) are unaffected.

## Implementation constraints

- Add, in `NEvo.Messaging.Authorization`:

  ```csharp
  public interface ICurrentUser<TId, TUser> where TUser : User<TId>
  {
      TUser User { get; }
  }
  ```

  Generic over the concrete user type (`TUser`), matching `UserContext<TId, TUser>` and
  `IUserProvider<TUser, TId>` — a consumer with its own user shape (e.g. the Documents
  example's `DemoUser`) is not forced onto the base `User<TId>` record.

  **Non-optional (D42).** `User` is never `Option`-wrapped. Declaring `ICurrentUser<TId, TUser>`
  as a decision-method parameter is the assertion "this decision requires a current
  authenticated user" — the framework resolves it successfully or does not invoke the
  decision method at all. (Exact name may change only if implementation finds an existing
  NEvo naming convention that is clearly better — none was found during refinement.)
- Implementation adapts `IMessageContextAccessor`/`UserContext<TId, TUser>` internally,
  and fails clearly (D42) when no message context is active or the current
  `UserContext<TId, TUser>` carries no user — by throwing
  `CurrentUserUnavailableException` from the constructor (D44), a construction-time
  check, not from the `User` getter, so task 13's parameter resolver catches it during
  activation and represents it as its own typed resolution failure before the decision
  method is ever invoked. Consumers never call `GetFeature`/`GetUserContext` themselves,
  and never receive a value they must check for absence — a resolved `ICurrentUser<TId,
  TUser>` always carries a real user.
- Register via an addition to `NEvo.Messaging.Authorization`'s
  `ServiceCollectionExtensions` (currently an empty stub — add an
  `AddCurrentUser<TId, TUser>()` or equivalent), scoped lifetime, `TryAdd*` for
  idempotency (matching this
  specification's established DI convention, D4/D32). The Documents example calls it
  from its existing `AddDocumentsAuthorization()`.
- `ICurrentUser<TId, TUser>` exposes identity only — `User` and nothing else. It must never
  expose roles, permissions, `IServiceProvider`, raw headers/`IMessageContext`,
  feature-bag getters/setters, correlation/causation, or any mutable authorization state.
  Authorization stays the responsibility of the authorization pipeline
  (`ValidatePermissionMiddleware`); if a business rule needs more than identity, it is
  injected as an explicit business-policy parameter (task 13's mechanism), not obtained
  by inspecting roles here.
- Documents integration:
  - `EditableDocument.Approve(ApproveDocument command)` becomes
    `EditableDocument.Approve(ApproveDocument command, ICurrentUser<Guid, DemoUser> currentUser)`.
  - `DocumentApproved`'s `ApprovedBy` is set directly from `currentUser.User.Id`, not
    `Guid.NewGuid()`. `Approve` contains no `Option`/`None`-handling for the current user
    (D42) — if no current user is available, task 13's parameter resolution fails before
    `Approve` is ever invoked; do not fabricate an identity, and do not reintroduce
    absence-handling inside the aggregate to work around this.
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

1. `ICurrentUser<TId, TUser>.User` returns `TUser` reflecting the current
   `IMessageContext`'s `UserContext<TId, TUser>` when one is populated (test).
2. When no current user is available (no active message context, or an unpopulated
   `UserContext<TId, TUser>`), resolving `ICurrentUser<TId, TUser>` itself fails —
   during construction/activation, before the `User` getter is ever reached (test, D44)
   — so the decision method is not invoked, no event is appended, and the caller
   observes a parameter-resolution failure (`Left`), not a fabricated or default user
   (test, D42).
3. `ICurrentUser<TId, TUser>` exposes no member beyond `User` (inspection).
4. `EditableDocument.Approve` takes `ICurrentUser<Guid, DemoUser> currentUser` as its second
   parameter; `DocumentApproved.ApprovedBy` reflects the resolved user's id, not
   `Guid.NewGuid()` (inspection + manual walkthrough). `Approve`'s body contains no
   `Option`/`None`/`Match` handling for `currentUser` (inspection, D42).
5. The placeholder `<remarks>` describing the missing-capability limitation is removed
   from `Approve` (inspection).
6. `ApproveDocumentHandler`/`ApproveDocumentDecision` remain absent; `ApproveDocument` is
   still handled entirely through the Level 1 aggregate-method convention (inspection,
   preserves D33).
7. No test or production code reaches roles, permissions, `IServiceProvider`,
   `IMessageContext`, or feature-bag members through `ICurrentUser<TId, TUser>` (inspection).
8. `dotnet build` succeeds; `dotnet test tests/NEvo.Messaging.Authorization.Tests`
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
document `ICurrentUser<TId, TUser>` and the final `ApprovedBy` behavior as part of their own,
already-scheduled scope.

## Out of scope

- Roles/permissions exposure through `ICurrentUser<TId, TUser>`.
- Any change to the authorization pipeline's enforcement logic (task 15's HTTP-mapping
  concern is separate).
- A general `IContext`/`IUserContext` abstraction, or correlation/causation exposure.
- A dedicated test project for the Documents example (D12, unaffected by this task).
- An optional/`Option<User<TId>>`-shaped current-user access convention (D42) —
  `ICurrentUser<TId, TUser>` always means "required."
- A dedicated HTTP status mapping (e.g. 503) for a missing-current-user failure — it
  follows the existing generic application/framework failure → 500 mapping (D42), never
  403 (task 15's `PermissionDeniedException` remains reserved for actual permission
  denial).
