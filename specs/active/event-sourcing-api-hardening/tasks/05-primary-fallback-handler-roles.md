---
id: event-sourcing-api-hardening.primary-fallback-handler-roles
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
  - explicit-event-sourced-command-handler
semantic_references:
  decisions: [D3]
  dependency_contracts:
    - es-command-executor-and-ambiguity-resolution
    - explicit-event-sourced-command-handler
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/handler-registration-and-options.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Messaging/Handling/IMessageHandler.cs
    - src/NEvo.Messaging/Handling/MessageHandlerExtractor.cs
    - src/NEvo.Messaging/Handling/MessageHandlerRegistry.cs
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandlerProvider.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
  optional:
    - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
allowed_paths:
  - src/NEvo.Messaging/Handling/**
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Messaging.Tests/**
  - tests/NEvo.Messaging.Cqrs.Tests/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging.Web/**
  - src/NEvo.Messaging.Authorization/**
  - examples/**
---

# Task: Primary/Fallback handler roles

## Goal

Give the messaging registration model a way to distinguish an intentional convention
fallback from a genuine duplicate-handler conflict, using semantic roles
(`Primary`/`Fallback`, no numeric priority) with the exact resolution rules D3 specifies
(overview.md § Proposed architecture, item 4).

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — the convention route this
  task marks Fallback.
- `explicit-event-sourced-command-handler` (task 04) — the Level 2 route this task marks
  Primary.

## Implementation constraints

- Add role metadata to the smallest coherent point in the existing model — evaluate
  whether a new field on `MessageHandlerDescription`
  (`NEvo.Messaging/Handling/IMessageHandler.cs:8`), a wrapping registration record, or
  another shape is least invasive to `IMessageHandlerFactory`/`IMessageHandlerProvider`/
  `MessageHandlerRegistry`'s existing contracts, and use that. `MessageHandlerRegistry`'s
  `SelectMessageHandler` (`MessageHandlerRegistry.cs`) is the resolution point to change
  — it currently throws `MoreThanOneHandlerFoundException` on any `Count > 1` for a
  message type; it must instead apply the role rules before concluding a conflict.
- `DeciderCommandHandlerProvider` (`Handling/DeciderCommandHandlerProvider.cs`) marks
  its descriptions `Fallback`. `CommandHandlerAdapterFactory`
  (`NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs`) and task 04's new
  explicit-handler factory mark their descriptions `Primary`.
- Prefer failing at registration/startup time over first-request time where the DI
  container's own validation hooks make that practical — do not force a runtime-only
  check if a startup check is straightforward.
- Do not weaken `MoreThanOneHandlerFoundException`'s existing behavior for any
  non-ES command with two ordinary `ICommandHandler<T>` registrations — that must still
  fail exactly as it does today (both are Primary).
- **Role resolution applies only to command handler-selection flows where a single
  effective handler is expected — Query and Event resolution are explicitly untouched**
  (review issue 6). `MessageHandlerRegistry.SelectMessageHandler`'s change must be
  scoped so it only alters behavior for message types that actually have a
  Primary/Fallback-tagged handler registered; a message type where every registered
  handler carries no role tag (or the same default role) must resolve exactly as
  before this task. `QueryHandlerAdapterFactory`-produced descriptions and event
  handler fan-out (`SequentialEventProcessingStrategy`/`ParallelEventProcessingStrategy`,
  which intentionally invoke *every* registered handler) must not be affected by this
  change at all — do not introduce a code path that could make Query resolution or
  Event fan-out role-aware "for free" without an explicit test proving it wasn't
  accidentally coupled in.

## Acceptance criteria

1. A command with only a Fallback handler resolves and executes it (automated).
2. A command with one Primary and the convention Fallback resolves to the Primary
   (automated).
3. Two Primary candidates for the same command (e.g. an explicit ES handler and an
   ordinary `ICommandHandler<T>`) fail as a configuration error (automated).
4. Two competing Fallback candidates for the same route fail as a configuration error
   (automated).
5. A pre-existing two-ordinary-`ICommandHandler<T>` duplicate registration (unrelated to
   ES) still fails exactly as `MoreThanOneHandlerFoundException` does today — regression
   test against `NEvo.Messaging.Cqrs.Tests`'s existing coverage (automated).
6. **(Review issue 6 regression coverage, all automated):**
   - A Query type with exactly one registered handler still resolves and dispatches
     correctly, unaffected by this task's changes (regression test against
     `NEvo.Messaging.Cqrs.Tests`'s existing Query coverage).
   - A Query type with two registered handlers still fails with
     `MoreThanOneHandlerFoundException` exactly as today — Query never gains
     Primary/Fallback semantics from this task.
   - An Event with multiple registered handlers still dispatches to *every* handler
     (fan-out unchanged) — regression test against `NEvo.Messaging.Tests`'s existing
     Event coverage.
   - `AddCommands()`/`AddEvents()`/`AddQueries()`'s existing idempotency guarantees
     (repeated registration does not throw or duplicate) are unaffected.

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Tests
dotnet test tests/NEvo.Messaging.Cqrs.Tests
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- `AddEventSourcing(options => {...})`'s enable/disable toggle (task 06) — this task
  only makes role resolution correct once both a Primary and Fallback (or either alone)
  are registered; whether the Fallback is registered at all is task 06's concern.
- `ValidatePermissionMiddleware`'s attribute-reading logic (task 07).
