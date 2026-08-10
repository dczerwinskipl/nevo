---
id: event-sourcing-api-hardening.message-level-and-aggregate-authorization
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
  - primary-fallback-handler-roles
semantic_references:
  decisions: [D5]
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
  optional:
    - docs/development/messaging-pipeline.md
allowed_paths:
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Web.Authorization.Tests/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging.Web/**
  - examples/**
---

# Task: Message-level and aggregate-aware authorization

## Goal

Fix the confirmed-live gap where a command routed through the ES convention Fallback
receives zero permission enforcement (because `ValidatePermissionMiddleware` reads
`[AllowPermission]` only from `HandlerDescription.Method`, which is `null` for
decider-based descriptions); add message-level permission-attribute placement composed
additively (AND) with handler-specific requirements; add the new
aggregate/resource-aware authorization extension point invoked by task 03's executor
after rehydration, before the decision (D5).

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — provides the two ordered
  hook points this task implements the logic behind.
- `primary-fallback-handler-roles` (task 05) — provides the resolved route/role so this
  task's fix targets the correct `Method`/permission source regardless of which route
  was selected.

## Implementation constraints

- Fix `ValidatePermissionMiddleware` (or move the check into task 03's executor, if
  that's the smaller coherent change once role resolution exists) so a Fallback-routed
  command is authorized against the command's actual required permission — ground the
  fix in whichever route/`Method` task 05 makes available, not a hardcoded ES special
  case.
- Add a permission-attribute placement usable on the message/command type itself (an
  extension of `AllowPermissionAttribute`'s `AttributeTargets`, or a distinct
  message-level attribute type if reusing the same one isn't structurally clean —
  ground this in `AllowPermissionAttribute.cs`'s actual current shape before deciding).
  A command declares its primary permission once, at the message level — not copied
  onto every aggregate-state method that could produce it.
- Compose message-level and handler-specific requirements as AND — evaluate both sets,
  deny if either fails. Do not implement override/replacement semantics.
- Add `IAggregateAuthorization<TCommand, TAggregate>` (or a refined equivalent name),
  invoked by task 03's executor after rehydration, before the decision. It receives the
  user/security context, the command, and the rehydrated aggregate/current state. A
  denial prevents the decision/append from happening. It lives outside the aggregate
  domain model — never called from inside a decision method.
- Do not redesign `IDataScopeMessageValidator`'s own per-attribute validation contract —
  extend where/what it's invoked against.

## Acceptance criteria

1. A command with only a convention (Fallback) route and a message-level permission
   requirement denies a user lacking that permission — this test must fail against the
   pre-task code (proving the gap is real) and pass after this task (automated).
2. A handler-specific additional requirement is enforced in addition to the
   message-level requirement (AND) — a user with one but not the other is denied either
   way (automated).
3. The aggregate-aware authorization extension point receives the actual rehydrated
   aggregate state and runs after rehydration, before the decision; a denial from it
   prevents any append (automated).
4. Permission resolution for a Fallback-routed command does not depend on
   `HandlerDescription.Method` being the domain operation method (automated —
   regression-proves the specific defect this task fixes).
5. A pre-existing non-ES command's handler-level `[AllowPermission]` enforcement is
   unchanged (regression test against `NEvo.Web.Authorization.Tests`'s existing
   coverage, automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Web.Authorization.Tests
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- A full permission expression/policy DSL.
- Redesigning `IDataScopeMessageValidator`'s validation contract.
- Retrofitting message-level attributes onto every existing non-ES command in the
  repository.
