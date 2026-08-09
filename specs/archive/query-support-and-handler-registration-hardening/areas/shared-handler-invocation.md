# Area: Shared handler-invocation adapter

## Responsibility

Replace the inheritance-based `MessageHandlerAdapterBase<TMessageGroup>` (hardcoded to
`Unit`) with one shared, composed adapter that Command, Event, and (later) Query all use
— protected by characterization tests written before the refactor, since Command's
adapter path has zero existing test coverage today.

## Current state

- `MessageHandlerAdapterBase<TMessageGroup>` (`src/NEvo.Messaging/Handling/MessageHandlerAdapterBase.cs`)
  caches a `MethodInfo` for its own abstract `InternalHandleAsync<TMessage>` (closed over
  `MessageHandlerDescription.MessageType`) and invokes it reflectively, force-casting the
  result to `Task<Either<Exception, Unit>>`.
- `CommandHandlerAdapter`/`EventHandlerAdapter` each override `InternalHandleAsync` with
  near-identical logic: `ActivatorUtilities.CreateInstance(context.ServiceProvider,
  HandlerDescription.HandlerType)` cast to the handler interface, then
  `handler.HandleAsync(...)`. `CommandHandlerAdapter` logs exceptions via
  `Console.WriteLine`; `EventHandlerAdapter` uses a real `ILogger` — an existing
  inconsistency, corrected as part of unifying the two.
- `MessageHandlerDescription.Method` (the actual handler-interface `MethodInfo`, from
  `GetInterfaceMap`) is already populated by both `CommandHandlerAdapterFactory` and
  `EventHandlerAdapterFactory` but is not read by either adapter today.
- Zero tests exist for `CommandHandlerAdapter`, `CommandHandlerAdapterFactory`,
  `CommandProcessingStrategy`, or `CommandDispatcher`. `EventHandlerAdapter`/
  `EventHandlerAdapterFactory` do have existing coverage in `tests/NEvo.Messaging.Tests/`.

## Requirements

1. A new `tests/NEvo.Messaging.Cqrs.Tests` project (D5) exists before any refactor, with
   characterization tests proving current `CommandHandlerAdapter`/
   `CommandHandlerAdapterFactory`/`CommandProcessingStrategy`/`CommandDispatcher`
   behavior — success, handler-not-found, multiple-handlers, and exception-in-handler
   cases at minimum.
2. `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and
   `EventHandlerAdapter` are deleted.
3. One new, non-generic, concrete, **`public`** `MessageHandlerAdapter : IMessageHandler`
   (composition, not inheritance; `public` because `CommandHandlerAdapterFactory`/
   `EventHandlerAdapterFactory` construct it from the separate `NEvo.Messaging.Cqrs`
   assembly and no `InternalsVisibleTo` is introduced — D6) replaces all three: resolves
   the handler instance via `ActivatorUtilities.CreateInstance`, invokes
   `HandlerDescription.Method` reflectively, adapts the arbitrary
   `Either<Exception, TResult>` result into `Either<Exception, object>`, and logs
   exceptions via `ILogger` (both Command and Event paths — resolving the existing
   `Console.WriteLine` inconsistency).
4. Reflective invocation via `MethodInfo.Invoke` wraps a *synchronous* exception thrown by
   a non-`async` handler method in `TargetInvocationException` — the adapter must catch
   and unwrap this to the original `InnerException` so `Left<Exception>` always contains
   the handler's actual exception, never a reflection wrapper. Proven by task 01's
   synchronous-throw characterization test continuing to pass unchanged after the
   refactor.
5. `CommandHandlerAdapterFactory` and `EventHandlerAdapterFactory` construct the shared
   `MessageHandlerAdapter` in `Create()` instead of their own bespoke adapter type. Their
   `ForInterface`/`GetMessageHandlerDescriptions` are otherwise unchanged.
6. Command and Event's public contracts (`ICommandHandler<TMessage>`,
   `IEventHandler<TEvent>`, `ICommandDispatcher`, `IEventPublisher`,
   `CommandProcessingStrategy`, `EventProcessingStrategyBase` subclasses) are unchanged —
   this is an internal implementation swap behind `IMessageHandlerFactory.Create()`.
   `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, and
   `EventHandlerAdapter` themselves are `public` today and their removal **is** a public
   breaking change (D6) — see `overview.md` § "Compatibility and migration".

## Constraints

- Do not change behavior and add tests in the same commit/task — characterization tests
  (task 01) land and pass against the *current* implementation before the refactor (task
  02) begins.
- No change to `IMessageHandler`, `IMessageHandlerFactory`, `IMessageHandlerRegistry`, or
  `MessageHandlerDescription`'s public shape.
- No new `InternalsVisibleTo` — `MessageHandlerAdapter` is `public`, not `internal` (D6).

## Interfaces and boundaries

Consumed by: `query-cqrs-support` area (the new `QueryHandlerAdapterFactory` constructs
this same shared adapter — see that area's Requirements).

Exposes: the shared `MessageHandlerAdapter` class — a **public** type (D6, required
because it is constructed cross-assembly with no `InternalsVisibleTo`), but **not** a
documented extension point — third-party handler-kind authors still implement
`IMessageHandlerFactory` per `docs/development/extension-points.md`, unchanged. Do not
document `MessageHandlerAdapter` itself as an extension point in task 06's docs work.

## Area-specific acceptance criteria

1. Every characterization test from task 01 passes unchanged after task 02's refactor
   (automated).
2. `CommandHandlerAdapter` and `EventHandlerAdapter` no longer exist in `src/`
   (inspection).
3. Command and Event exception handling both go through `ILogger` (automated/inspection).
4. `dotnet build` succeeds with no reference to `MessageHandlerAdapterBase` remaining
   anywhere in `src/`.
5. `TargetInvocationException` never leaks into `Left<Exception>` — task 01's
   synchronous-throw characterization test still passes after the refactor (automated).
6. `MessageHandlerAdapter` is declared `public` (inspection, D6).

## Dependencies

None — this area is the foundation the `query-cqrs-support` area builds on.

## Out of scope

- Any change to `EventProcessingStrategyBase`/`CommandProcessingStrategy`'s own
  `ShouldApply`/strategy-selection logic — only handler *invocation* is unified here.
- Query's own factory/strategy/dispatcher (`query-cqrs-support` area).
