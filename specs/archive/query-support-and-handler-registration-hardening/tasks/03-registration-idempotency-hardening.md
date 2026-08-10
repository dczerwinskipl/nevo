---
id: query-support-and-handler-registration-hardening.registration-idempotency-hardening
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D2]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/registration-hardening.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
    - src/NEvo.Messaging/Events/ServiceCollectionExtensions.cs
    - src/NEvo.Messaging/ServiceCollectionExtensions.cs
  optional: []
allowed_paths:
  - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
  - src/NEvo.Messaging/Events/ServiceCollectionExtensions.cs
  - tests/NEvo.Messaging.Cqrs.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/Handling/**
  - src/NEvo.Messaging.Cqrs/Queries/**
  - src/NEvo.Messaging/ServiceCollectionExtensions.cs
  - examples/**
  - docs/**
---

# Task: Registration idempotency hardening (AddCommands/AddEvents)

## Goal

Make `AddCommands()` and `AddEvents()` safe to call more than once, matching the
`TryAdd*` shape `AddMessages()` already uses, without changing what a single call
registers (D2).

## Dependencies

- `command-event-adapter-characterization` (task 01) — regression safety net; this task
  must not change single-call registration behavior, which those tests exercise
  indirectly (resolving `ICommandDispatcher`/handlers from DI).

## Implementation constraints

- `AddCommands()`: `AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>`
  → `TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory,
  CommandHandlerAdapterFactory>())` (multiple factories must coexist —
  `TryAddEnumerable`, not plain `TryAdd`, which would only keep the first). Same for
  `AddScoped<IMessageProcessingStrategy, CommandProcessingStrategy>`. `ICommandDispatcher`
  and `IMessageDispatchStrategyFactory<Command>` are singular per-type — plain
  `TryAddScoped` is correct there.
- `AddEvents()`: same treatment — `IMessageHandlerFactory` and both
  `IMessageProcessingStrategy` registrations (`Parallel`/`SequentialEventProcessingStrategy`)
  via `TryAddEnumerable`; `IEventPublisher`/`IMessagePublishStrategyFactory<Event>` via
  `TryAddScoped`.
- Use `Microsoft.Extensions.DependencyInjection.Extensions`'
  `TryAddEnumerable(ServiceDescriptor.Singleton/Scoped<TService, TImplementation>())` —
  the same namespace `AddMessages()` already imports.
- Do not touch `AddMessages()` itself or its `AddMessageProcessingMiddleware`/
  `AddMessageProcessingHandlerMiddleware` helpers — out of scope per `overview.md`.

## Acceptance criteria

1. Calling `AddCommands()` twice on the same `IServiceCollection` does not throw
   (automated).
2. Calling `AddEvents()` twice does not throw (automated).
3. After a double `AddCommands()` call, exactly one `IMessageHandlerFactory` for
   `ICommandHandler<>` and exactly one `IMessageProcessingStrategy` of type
   `CommandProcessingStrategy` are resolvable (automated).
4. After a double `AddEvents()` call, both `ParallelEventProcessingStrategy` and
   `SequentialEventProcessingStrategy` remain resolvable exactly once each — proving
   `TryAddEnumerable` was used, not plain `TryAdd` (automated).
5. `AddMessages()+AddCommands()+AddEvents()` composed together still resolve every
   service a single call to each would (automated).
6. Every task-01 characterization test still passes (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None — `docs/reference/packages/NEvo.Messaging.Cqrs.md`'s "Configuration" section already
just shows the call shape (`AddMessages(); AddCommands();`), which is unchanged.

## Out of scope

- `AddQueries()` — added with this same idempotent shape directly in task 05, not
  retrofitted here.
- Any change to `AddMessages()` itself.
