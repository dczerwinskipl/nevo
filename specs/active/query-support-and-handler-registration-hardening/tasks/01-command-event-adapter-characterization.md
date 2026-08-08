---
id: query-support-and-handler-registration-hardening.command-event-adapter-characterization
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D5]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/shared-handler-invocation.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - src/NEvo.Messaging/Handling/MessageHandlerAdapterBase.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapter.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandProcessingStrategy.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandDispatcher.cs
    - docs/development/testing-strategy.md
  optional:
    - tests/NEvo.Messaging.Tests/Events/EventHandlerAdapterTests.cs
    - tests/NEvo.Messaging.Tests/Events/EventHandlerAdapterFactoryTests.cs
allowed_paths:
  - tests/NEvo.Messaging.Cqrs.Tests/**
  - nevo.sln
forbidden_paths:
  - src/**
  - examples/**
  - docs/**
  - .claude/**
  - tests/NEvo.Core.Tests/**
  - tests/NEvo.Messaging.Tests/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
  - tests/NEvo.Orchestrating.Tests/**
  - tests/NEvo.Web.Authorization.Tests/**
---

# Task: Command/Event adapter characterization tests

## Goal

Create `tests/NEvo.Messaging.Cqrs.Tests` (D5) and add characterization tests that pin
down the *current* behavior of `CommandHandlerAdapter`, `CommandHandlerAdapterFactory`,
`CommandProcessingStrategy`, and `CommandDispatcher` — none of which have any test
coverage today. This task must land and pass **before** task 02's adapter refactor
begins; it changes no production behavior.

## Dependencies

None — first task in the change.

## Implementation constraints

- New project: `tests/NEvo.Messaging.Cqrs.Tests/NEvo.Messaging.Cqrs.Tests.csproj`,
  matching the existing test stack (xUnit, FluentAssertions, FluentAssertions.LanguageExt,
  Moq, coverlet) and project-reference shape used by `tests/NEvo.Messaging.Tests`. Add it
  to `nevo.sln`.
- Cover, for `CommandHandlerAdapter`/`CommandHandlerAdapterFactory`: successful dispatch
  to a single handler resolved via DI; the handler-not-found path
  (`NoHandlerFoundException`, via the registry — not the adapter itself); the
  multiple-handlers path (`MoreThanOneHandlerFoundException`); an exception thrown inside
  the handler being captured as `Left<Exception>` rather than propagating.
- Cover, for `CommandDispatcher`: that `DispatchAsync` creates an `IMessageContext` when
  none is set on `IMessageContextAccessor`, and reuses one when already set.
- Cover, for `CommandProcessingStrategy`: `ShouldApply` returns true only for `Command`
  instances; `ProcessMessageAsync` resolves the handler through
  `IMessageHandlerRegistry.GetMessageHandler` and returns `Unit` on success.
- Do not test `MessageHandlerAdapterBase<TMessageGroup>` directly by name/type — task 02
  deletes it. Test through the public/internal-package surface
  (`CommandHandlerAdapterFactory.Create(...)` → `IMessageHandler.HandleAsync(...)`) so
  these tests remain valid unchanged after task 02's refactor.
- Follow `docs/development/testing-strategy.md` conventions: `<SubjectClass>Tests` class
  names, behavior-described method names, Arrange/Act/Assert, `FluentAssertions`/
  `FluentAssertions.LanguageExt` for `Either` assertions.

## Acceptance criteria

1. `tests/NEvo.Messaging.Cqrs.Tests` exists, is referenced in `nevo.sln`, and builds
   (automated: `dotnet build`).
2. Successful single-handler Command dispatch is covered (automated).
3. No-handler-found and multiple-handlers-found Command failures are covered (automated).
4. An exception thrown inside a Command handler is captured as `Left<Exception>`
   (automated).
5. `CommandDispatcher`'s context creation/reuse behavior is covered (automated).
6. `CommandProcessingStrategy.ShouldApply`/`ProcessMessageAsync` behavior is covered
   (automated).
7. All new tests pass against the current (pre-task-02) implementation.

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None — `docs/development/testing-strategy.md`'s "Test projects" list is updated in task
06, once the project's final scope (post Query) is known.

## Out of scope

- Any change to `src/` — this task is test-only.
- `EventHandlerAdapter`/`EventHandlerAdapterFactory` characterization — already covered
  by existing `tests/NEvo.Messaging.Tests/Events/*` tests; not duplicated here.
- Query tests (tasks 04–05).
