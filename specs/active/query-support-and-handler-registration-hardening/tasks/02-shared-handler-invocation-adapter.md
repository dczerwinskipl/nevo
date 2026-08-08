---
id: query-support-and-handler-registration-hardening.shared-handler-invocation-adapter
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D1, D6]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/shared-handler-invocation.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - specs/active/query-support-and-handler-registration-hardening/tasks/01-command-event-adapter-characterization.md
    - src/NEvo.Messaging/Handling/MessageHandlerAdapterBase.cs
    - src/NEvo.Messaging/Handling/IMessageHandler.cs
    - src/NEvo.Messaging/Handling/IMessageHandlerFactory.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapter.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
    - src/NEvo.Messaging/Events/EventHandlerAdapter.cs
    - src/NEvo.Messaging/Events/EventHandlerAdapterFactory.cs
  optional:
    - tests/NEvo.Messaging.Tests/Events/EventHandlerAdapterTests.cs
    - tests/NEvo.Messaging.Tests/Events/EventHandlerAdapterFactoryTests.cs
allowed_paths:
  - src/NEvo.Messaging/Handling/MessageHandlerAdapterBase.cs
  - src/NEvo.Messaging/Handling/MessageHandlerAdapter.cs
  - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapter.cs
  - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
  - src/NEvo.Messaging/Events/EventHandlerAdapter.cs
  - src/NEvo.Messaging/Events/EventHandlerAdapterFactory.cs
  - tests/NEvo.Messaging.Cqrs.Tests/**
  - tests/NEvo.Messaging.Tests/Events/**
forbidden_paths:
  - src/NEvo.Messaging.Cqrs/Queries/**
  - src/NEvo.Messaging/ServiceCollectionExtensions.cs
  - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
  - src/NEvo.Messaging/Events/ServiceCollectionExtensions.cs
  - examples/**
  - docs/**
---

# Task: Shared handler-invocation adapter (composition, not inheritance)

## Goal

Delete `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and
`EventHandlerAdapter`. Replace them with one shared, concrete, non-generic
`MessageHandlerAdapter : IMessageHandler` that both `CommandHandlerAdapterFactory` and
`EventHandlerAdapterFactory` construct in `Create()` (D1). Every characterization test
from task 01 and every existing `EventHandlerAdapter*` test must pass unchanged
afterward — this task changes internal implementation only, not observable behavior.

## Dependencies

- `command-event-adapter-characterization` (task 01) — its tests are the regression
  safety net this task must not break.

## Implementation constraints

- The new `MessageHandlerAdapter` resolves the handler instance via
  `ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType)`
  and invokes `HandlerDescription.Method` (already populated by both existing factories,
  currently unused) reflectively on that instance — this is the mechanism that lets one
  class handle any handler-kind's `HandleAsync` signature without per-kind inheritance.
  Adapting the resulting `Either<Exception, TResult>` (whatever `TResult` is for that
  handler kind) into the `Either<Exception, object>` shape `IMessageHandler.HandleAsync`
  already returns is an internal implementation detail — local method structure and
  helper shape are the implementing agent's call (`AGENTS.md` § "Agent decides
  independently").
- Catch and log exceptions raised during handler resolution or invocation via `ILogger`
  (not `Console.WriteLine`) — this corrects the existing `CommandHandlerAdapter`/
  `EventHandlerAdapter` inconsistency (D1's stated consequence) as part of unifying them.
- **`MethodInfo.Invoke` exception unwrapping (required, see task 01's synchronous-throw
  characterization tests).** `HandlerDescription.Method.Invoke(...)` wraps a
  *synchronous* exception thrown by a non-`async` handler method in
  `TargetInvocationException`. Catch `TargetInvocationException` specifically and unwrap
  to `.InnerException` (falling back to the `TargetInvocationException` itself only if
  `InnerException` is somehow `null`) before treating it as the captured exception — so
  `Left<Exception>` always contains the handler's original exception, never the
  reflection wrapper. An `async` handler's faulted `Task` does not go through this path
  (its exception is already unwrapped by `await`), so this specifically protects the
  non-`async`-handler case.
- `MessageHandlerAdapter` is declared `public` (D6) — it is constructed by
  `CommandHandlerAdapterFactory`/`EventHandlerAdapterFactory` in the separate
  `NEvo.Messaging.Cqrs` assembly; do not introduce `InternalsVisibleTo` as an
  alternative.
- `CommandHandlerAdapterFactory.Create(...)` and `EventHandlerAdapterFactory.Create(...)`
  construct the shared `MessageHandlerAdapter`; their `ForInterface`/
  `GetMessageHandlerDescriptions` are unchanged.
- Do not change `ICommandHandler<TMessage>`, `IEventHandler<TEvent>`,
  `ICommandDispatcher`, `IEventPublisher`, `CommandProcessingStrategy`, or any
  `EventProcessingStrategyBase` subclass — this task touches handler *invocation* only.
- Do not change `IMessageHandler`, `IMessageHandlerFactory`, `IMessageHandlerRegistry`,
  or `MessageHandlerDescription`'s public shape.

## Acceptance criteria

1. `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and
   `EventHandlerAdapter` no longer exist in `src/` (inspection).
2. Every task-01 characterization test passes unchanged (automated:
   `dotnet test tests/NEvo.Messaging.Cqrs.Tests`).
3. Every existing `tests/NEvo.Messaging.Tests/Events/EventHandlerAdapter*Tests.cs` test
   passes unchanged, updated only where it referenced the deleted `EventHandlerAdapter`
   type directly rather than behavior (automated:
   `dotnet test tests/NEvo.Messaging.Tests`).
4. Both Command and Event exception paths log via `ILogger` (automated/inspection).
5. `dotnet build` succeeds with no remaining reference to `MessageHandlerAdapterBase`
   anywhere in `src/` (automated: `dotnet build`).
6. `TargetInvocationException` never leaks into `Left<Exception>` for a non-`async`
   handler that throws synchronously — task 01's synchronous-throw characterization test
   passes unchanged (automated: `dotnet test tests/NEvo.Messaging.Cqrs.Tests`).
7. `MessageHandlerAdapter` is declared `public` (inspection, D6).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
dotnet test tests/NEvo.Messaging.Tests
```

## Documentation impact

None directly from this task — `docs/development/extension-points.md`'s documented
`IMessageHandlerFactory` contract (the third-party extension point) is unchanged;
`MessageHandlerAdapterBase` was never documented there as part of that contract. The
public breaking change this task performs (deleting three public types, adding one) is
documented in task 06, not here — see `overview.md` § "Compatibility and migration" (D6).

## Out of scope

- Query's own factory (`QueryHandlerAdapterFactory`, task 04) — it will construct this
  same shared `MessageHandlerAdapter`, but is not added by this task.
- Registration idempotency (task 03) — independent, no file overlap.
