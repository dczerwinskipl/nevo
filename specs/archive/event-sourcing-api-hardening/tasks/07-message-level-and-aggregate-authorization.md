---
id: event-sourcing-api-hardening.message-level-and-aggregate-authorization
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
  - primary-fallback-handler-roles
semantic_references:
  decisions: [D5, D24, D25, D26]
  dependency_contracts:
    - es-command-executor-and-ambiguity-resolution
    - primary-fallback-handler-roles
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/authorization-integration.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs
    - src/NEvo.Messaging.Authorization/AllowPermissionAttribute.cs
    - src/NEvo.Messaging.Authorization/IDataScopeMessageValidator.cs
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandlerProvider.cs
    - docs/development/package-boundaries.md
  optional:
    - docs/development/messaging-pipeline.md
    - docs/development/extension-points.md
    - docs/reference/packages/NEvo.Messaging.Authorization.md
    - docs/reference/packages/NEvo.Ddd.EventSourcing.md
allowed_paths:
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Messaging.Authorization.Tests/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
  - NEvo.sln
forbidden_paths:
  - src/NEvo.Messaging.Web/**
  - examples/**
  - tests/NEvo.Web.Authorization.Tests/**
---

# Task: Message-level and aggregate-aware authorization

## Goal

Two distinct parts, in two packages, never crossing the boundary between them (D25,
D26): (a) fix the confirmed-live gap where a command routed through the ES convention
Fallback receives zero permission enforcement, and add message-level permission-
attribute placement composed additively (AND) with handler-specific requirements — both
entirely inside `NEvo.Messaging.Authorization`'s existing pipeline; (b) add the new
aggregate/resource-aware authorization extension point in `NEvo.Ddd.EventSourcing`,
invoked by task 03's executor after rehydration, before the decision, receiving the
current state as `Option<TAggregate>` (D24) — never invoked by, and never invoking,
part (a)'s pipeline logic.

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — provides the one
  aggregate-aware hook point this task implements the logic behind.
- `primary-fallback-handler-roles` (task 05) — provides the resolved route/role so
  part (a)'s fix targets the correct `Method`/permission source regardless of which
  route was selected.

## Implementation constraints

**Part (a) — `NEvo.Messaging.Authorization` (D25, decided, not an open choice):**

- Fix `ValidatePermissionMiddleware` in place so a Fallback-routed command is
  authorized against the command's actual required permission — ground the fix in
  whichever route/`Method` task 05 makes available. Do not move this logic into the
  Event Sourcing executor; do not duplicate it there either.
- Add a permission-attribute placement usable on the message/command type itself (an
  extension of `AllowPermissionAttribute`'s `AttributeTargets`, or a distinct
  message-level attribute type if reusing the same one isn't structurally clean —
  ground this in `AllowPermissionAttribute.cs`'s actual current shape before deciding).
  A command declares its primary permission once, at the message level — not copied
  onto every aggregate-state method that could produce it.
- Compose message-level and handler-specific requirements as AND — evaluate both sets,
  deny if either fails. Do not implement override/replacement semantics.
- Do not redesign `IDataScopeMessageValidator`'s own per-attribute validation contract —
  extend where/what it's invoked against.

**Part (b) — `NEvo.Ddd.EventSourcing` (D24, D26):**

- Add `IAggregateAuthorization<TCommand, TAggregate>` (or a refined equivalent name),
  invoked by task 03's executor after rehydration, before the decision. It receives the
  command, the current state as **`Option<TAggregate>`** (`Some` = rehydrated existing
  aggregate, `None` = creation path — D24, matching the Level 2 handler's own
  semantics from task 04), and `IMessageContext` for user/security-context access. A
  denial prevents the decision/append from happening in either case — it must never be
  silently skipped merely because `None` means no aggregate object exists yet. It
  lives outside the aggregate domain model — never called from inside a decision
  method.
- **Do not add a `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` project
  reference (D26).** Type the contract only in terms of the command, `Option<
  TAggregate>`, and `IMessageContext` — all already available without a new
  reference. A concrete implementation of the contract (e.g. inside the Documents
  example, task 10, which already references whatever it needs) may call into
  `NEvo.Messaging.Authorization`/`NEvo.Authorization` itself; that is a consumer
  choice, not something the core contract's own package may do.

**Test target correction:** `tests/NEvo.Web.Authorization.Tests` tests
`NEvo.Web.Authorization`, a different package — it is not the right home for part
(a)'s new/changed tests. No `NEvo.Messaging.Authorization.Tests` project exists today
(the package has zero dedicated tests). Create one — a small, package-local unit test
project matching the repository's one-test-project-per-package convention (referenced
from `NEvo.sln`) — for part (a)'s coverage. Part (b)'s coverage lives in
`tests/NEvo.Ddd.EventSourcing.Tests` alongside the executor's own tests. Do not build a
web/integration test harness for either part.

## Acceptance criteria

1. A command with only a convention (Fallback) route and a message-level permission
   requirement denies a user lacking that permission — this test must fail against the
   pre-task code (proving the gap is real) and pass after this task (automated, in the
   new `NEvo.Messaging.Authorization.Tests`).
2. A handler-specific additional requirement is enforced in addition to the
   message-level requirement (AND) — a user with one but not the other is denied either
   way (automated).
3. The aggregate-aware authorization extension point receives `Some` with the actual
   rehydrated aggregate state when one exists, and `None` on the creation path; a
   denial from it prevents any append in either case (automated, in
   `tests/NEvo.Ddd.EventSourcing.Tests`, per D24).
4. Permission resolution for a Fallback-routed command does not depend on
   `HandlerDescription.Method` being the domain operation method (automated —
   regression-proves the specific defect this task fixes).
5. A pre-existing non-ES command's handler-level `[AllowPermission]` enforcement is
   unchanged (regression test in the new `NEvo.Messaging.Authorization.Tests`,
   covering what `ValidatePermissionMiddleware` already does today).
6. `NEvo.Ddd.EventSourcing.csproj` has no `ProjectReference` to
   `NEvo.Messaging.Authorization` after this task (inspection, per D26).
7. The executor's code (task 03) contains no call into part (a)'s pipeline logic, and
   `ValidatePermissionMiddleware` contains no call into part (b)'s hook (inspection,
   per D25).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Authorization.Tests
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- A full permission expression/policy DSL.
- Redesigning `IDataScopeMessageValidator`'s validation contract.
- Retrofitting message-level attributes onto every existing non-ES command in the
  repository.
- Any `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` project reference
  (D26) — if implementation finds this unavoidable, stop and report it as new
  evidence rather than adding it.
- Any change to `tests/NEvo.Web.Authorization.Tests` (a different package's tests,
  untouched by this task).
