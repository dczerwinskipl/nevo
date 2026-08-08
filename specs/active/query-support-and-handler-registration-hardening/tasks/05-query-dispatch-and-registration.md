---
id: query-support-and-handler-registration-hardening.query-dispatch-and-registration
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D3]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/query-cqrs-support.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - src/NEvo.Messaging/Handling/IMessageProcessor.cs
    - src/NEvo.Messaging/Handling/MessageProcessor.cs
    - src/NEvo.Messaging/Handling/Strategies/IMessageProcessingStrategyWithResult.cs
    - src/NEvo.Messaging/Handling/Strategies/MessageProcessingStrategyFactory.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandDispatcher.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandProcessingStrategy.cs
    - src/NEvo.Messaging.Cqrs/Commands/DefaultCommandDispatchStrategyFactory.cs
    - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
  optional:
    - tests/NEvo.Messaging.Tests/Handling/MessageProcessorTests.cs
    - tests/NEvo.Messaging.Tests/Handling/Strategies/MessageProcessingStrategyFactoryTests.cs
allowed_paths:
  - src/NEvo.Messaging.Cqrs/Queries/**
  - tests/NEvo.Messaging.Cqrs.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/Handling/IMessageProcessor.cs
  - src/NEvo.Messaging/Handling/MessageProcessor.cs
  - src/NEvo.Messaging/Handling/Strategies/**
  - src/NEvo.Messaging.Cqrs/Commands/**
  - src/NEvo.Messaging/Events/**
  - examples/**
  - docs/**
---

# Task: Query dispatch, pipeline integration, and registration

## Goal

Deliver the first production implementation of `IMessageProcessingStrategyWithResult`
(`QueryProcessingStrategy`), `IQueryDispatcher`/`QueryDispatcher`, and `AddQueries()` —
completing Query end-to-end: dispatch → middleware → strategy → handler → typed result.

## Dependencies

- `query-abstractions-and-discovery` (task 04) — `Query<TResult>`, `IQueryHandler`,
  `QueryHandlerAdapterFactory`.
- `registration-idempotency-hardening` (task 03) — `AddQueries()` follows the same
  `TryAdd*`/`TryAddEnumerable` shape established there.

## Implementation constraints

- `QueryProcessingStrategy : IMessageProcessingStrategyWithResult` — `ShouldApply<TResult>`
  matches `message is Query<TResult>`; `ProcessMessageWithResultAsync<TResult>` resolves
  exactly one handler via `IMessageHandlerRegistry.GetMessageHandler` (the same registry
  method Command already uses — do not add a parallel resolution path), runs
  handler-level middleware the same way `CommandProcessingStrategy` does, and returns the
  typed `Either<Exception, TResult>`. One registered instance must serve every
  `Query<TResult>` regardless of `TResult` — do not register per-`TResult` strategy
  instances.
- `IQueryDispatcher`: `Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult>
  query, CancellationToken cancellationToken)`. `QueryDispatcher` (default
  implementation) resolves/creates the current `IMessageContext` via
  `IMessageContextAccessor`/`IMessageContextProvider` exactly as `CommandDispatcher`
  does, then calls `IMessageProcessor.ProcessMessageAsync<TResult>(query, context,
  cancellationToken)` directly — Query does not need `CommandDispatcher`'s
  `IMessageDispatchStrategyFactory<TMessage>` indirection layer (that layer exists to
  support swapping internal/external dispatch strategies for future transports, which is
  explicitly out of scope for Query per `overview.md`).
- `AddQueries()` (`Microsoft.Extensions.DependencyInjection` namespace,
  `NEvo.Messaging.Cqrs`): `TryAddEnumerable` for `IMessageHandlerFactory` →
  `QueryHandlerAdapterFactory` and for `IMessageProcessingStrategyWithResult` →
  `QueryProcessingStrategy`; `TryAddScoped` for `IQueryDispatcher` → `QueryDispatcher`.
  No new composing method is introduced (D3) — a consumer calls
  `services.AddMessages().AddQueries()`.
- Do not modify message-level or handler-level middleware — both are already
  kind-agnostic; Query reuses them unchanged.

## Acceptance criteria

1. A `Query<TResult>` with exactly one registered handler returns the expected typed
   result via `IQueryDispatcher.DispatchAsync<TResult>` (automated).
2. The handler is resolved through DI, not constructed manually (automated — verifiable
   via a scoped dependency the handler requires).
3. A `Query<TResult>` with no registered handler fails with `NoHandlerFoundException`
   (automated).
4. A `Query<TResult>` with more than one registered handler fails with
   `MoreThanOneHandlerFoundException` (automated).
5. Two different `Query<TResult>` types with different `TResult` values both dispatch
   correctly against one shared `QueryProcessingStrategy` instance (automated).
6. `AddQueries()` is idempotent under a repeated call (automated).
7. `AddMessages()+AddCommands()+AddEvents()+AddQueries()` compose without duplicate
   infrastructure registration; with all four composed, Command dispatch (via
   `ICommandDispatcher`), Event publish (via `IEventPublisher`), and Query dispatch (via
   `IQueryDispatcher`) each independently work correctly (automated).
8. Message-level middleware (e.g. correlation ID) and handler-level middleware execute
   around a Query dispatch in the same relative order as around a Command dispatch
   (automated).
9. Cancellation requested before/during a Query handler's execution propagates through
   `IQueryDispatcher` → `IMessageProcessor` → the handler (automated).
10. `AddQueries()` alone (without `AddCommands()`) is sufficient to dispatch a Query —
    proving Query does not require pulling in Command support (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None — covered in task 06.

## Out of scope

- Any composing registration method beyond `AddQueries()` itself (D3).
- Typed/generic-over-`TResult` middleware.
- Documentation and the ExampleApp example (task 06).
