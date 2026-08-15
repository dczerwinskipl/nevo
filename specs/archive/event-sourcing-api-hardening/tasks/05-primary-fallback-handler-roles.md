---
id: event-sourcing-api-hardening.primary-fallback-handler-roles
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
  - explicit-event-sourced-command-handler
semantic_references:
  decisions: [D3, D32]
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

- `HandlerRole` (`NEvo.Messaging/Handling/HandlerRole.cs`) is a non-nullable enum
  (`Primary`/`Fallback`, no numeric priority). `MessageHandlerDescription.Role`
  (`NEvo.Messaging/Handling/IMessageHandler.cs:8`) is a normal `init` property
  defaulting to `HandlerRole.Primary` — not a new positional constructor parameter — so
  the existing six-parameter positional constructor (`Key, HandlerType, MessageType,
  InterfaceType, ReturnType, Method`) keeps compiling unchanged for every existing call
  site (D32). Do not add `Unspecified`/`Legacy`/a nullable role — absence is not a real
  semantic state here (D32).
- `MessageHandlerRegistry`'s `SelectMessageHandler` (`MessageHandlerRegistry.cs`) is the
  resolution point to change, implementing D3's rules directly against `Role` — no
  branch for "all untagged," "mixed tagged/untagged," or "role-aware activated because a
  tag exists" (D32): zero handlers → existing no-handler behavior; one handler → use it;
  multiple handlers → more than one Primary is `MoreThanOneHandlerFoundException`,
  exactly one Primary wins over any Fallback present, no Primary + exactly one Fallback
  uses it, no Primary + multiple Fallback is `MoreThanOneHandlerFoundException`. No
  registration-order tiebreaker.
- `DeciderCommandHandlerProvider` (`Handling/DeciderCommandHandlerProvider.cs`)
  explicitly sets `Role = HandlerRole.Fallback`. `CommandHandlerAdapterFactory`
  (`NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs`) and the explicit
  Event Sourced handler factory get `Primary` from the property default and must not
  restate `Role: HandlerRole.Primary` merely because task 05 introduced the property
  (D32) — remove any such explicit assignment that exists only for that reason.
- Prefer failing at registration/startup time over first-request time where the DI
  container's own validation hooks make that practical — do not force a runtime-only
  check if a startup check is straightforward.
- Do not weaken `MoreThanOneHandlerFoundException`'s existing behavior for any
  non-ES command with two ordinary `ICommandHandler<T>` registrations — that must still
  fail exactly as it does today (both are Primary by default).
- **Query and Event resolution are unaffected by construction, not by a role-detection
  branch** (review issue 6, sharpened by D32). Query behavior is preserved because a
  Query type's handlers are all Primary by default: one Query handler → one Primary →
  selected (unchanged); two Query handlers → two Primary →
  `MoreThanOneHandlerFoundException` (same conflict as today). No Query-specific role
  handling is added anywhere. Event fan-out (`GetMessageHandlers`,
  `SequentialEventProcessingStrategy`/`ParallelEventProcessingStrategy`, which
  intentionally invoke *every* registered handler) never calls `SelectMessageHandler` at
  all, so it is unaffected regardless of what `Role` an Event handler's description
  carries — do not add role filtering to the fan-out path.

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
7. **(D32)** `MessageHandlerDescription`'s pre-existing six-parameter positional
   constructor (`Key, HandlerType, MessageType, InterfaceType, ReturnType, Method`,
   omitting `Role`) still compiles and produces `Role == HandlerRole.Primary` by default
   — proven by a construction test, not merely by inspection (automated).
8. **(D32)** An ordinary explicit command handler description
   (`CommandHandlerAdapterFactory`) and the explicit Event Sourced handler description
   are each `Primary` without any factory restating it explicitly (automated).

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

- `AddEventSourcing`'s additive options overload and enable/disable toggle (task 06) —
  this task only makes role resolution correct once both a Primary and Fallback (or
  either alone) are registered; whether the Fallback is registered at all is task 06's
  concern.
- `ValidatePermissionMiddleware`'s attribute-reading logic (task 07).
