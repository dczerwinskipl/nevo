---
id: query-support-and-handler-registration-hardening.query-abstractions-and-discovery
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D1, D4]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/query-cqrs-support.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - src/NEvo.Messaging/Message.cs
    - src/NEvo.Messaging.Cqrs/Commands/Command.cs
    - src/NEvo.Messaging.Cqrs/Commands/ICommandHandler.cs
    - src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
    - src/NEvo.Messaging/Handling/MessageHandlerAdapter.cs
    - src/NEvo.Messaging/Handling/IMessageHandlerFactory.cs
  optional:
    - src/NEvo.Messaging/Handling/MessageHandlerExtractor.cs
allowed_paths:
  - src/NEvo.Messaging.Cqrs/Queries/**
  - src/NEvo.Messaging.Cqrs/NEvo.Messaging.Cqrs.csproj
  - tests/NEvo.Messaging.Cqrs.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/Handling/**
  - src/NEvo.Messaging.Cqrs/Commands/**
  - src/NEvo.Messaging/Events/**
  - examples/**
  - docs/**
---

# Task: Query abstractions and handler discovery

## Goal

Add `Query<TResult>`, `IQueryHandler<TQuery, TResult>`, and `QueryHandlerAdapterFactory`
so a Query handler can be discovered and adapted through the existing
Extractor→Factory→Adapter pipeline, using the shared `MessageHandlerAdapter` from task
02 — with zero changes required to `MessageHandlerExtractor` (D1, D4).

## Dependencies

- `shared-handler-invocation-adapter` (task 02) — this task's factory constructs that
  shared adapter.

## Implementation constraints

- `Query<TResult> : Message<TResult>` — abstract record, `NEvo.Messaging.Cqrs.Queries`
  namespace, mirroring `Command`'s constructor shape (default + explicit
  `Id`/`CreatedAt`).
- `IQueryHandler<TQuery, TResult> where TQuery : Query<TResult>` — one method,
  `Task<Either<Exception, TResult>> HandleAsync(TQuery query, IMessageContext
  messageContext, CancellationToken cancellationToken)`.
- `QueryHandlerAdapterFactory : IMessageHandlerFactory`: `ForInterface =>
  typeof(IQueryHandler<,>)`. `GetMessageHandlerDescriptions` must determine the actual
  closed `TResult` per handler type by reflecting on its implemented
  `IQueryHandler<TQuery, TResult>` interface (`handlerInterface.GetGenericArguments()[1]`)
  — it must **not** hardcode `ReturnType: typeof(Unit)` the way the Command/Event
  factories do. `Method` is populated the same way as the existing factories
  (`handlerType.GetInterfaceMap(handlerInterface).TargetMethods.First(...)`), since the
  shared `MessageHandlerAdapter` from task 02 relies on it.
- `QueryHandlerAdapterFactory.Create(...)` constructs the shared `MessageHandlerAdapter`
  from task 02 — no new adapter type is introduced for Query (D1).
- Remove the now-obsolete `<Folder Include="Queries\" />` placeholder from
  `NEvo.Messaging.Cqrs.csproj` once real files exist under `Queries/`.
- Registration for `QueryHandlerAdapterFactory` (DI wiring, `AddQueries()`) is task 05's
  concern, not this task's — this task only adds the types and the factory class itself.

## Acceptance criteria

1. `Query<TResult>` compiles as a concrete abstract record extending `Message<TResult>`
   (automated: `dotnet build`).
2. `IQueryHandler<TQuery, TResult>` compiles with the constraint
   `where TQuery : Query<TResult>` (automated).
3. `QueryHandlerAdapterFactory.GetMessageHandlerDescriptions` returns a
   `MessageHandlerDescription` whose `ReturnType` matches the query's actual `TResult`,
   proven for at least two different `TResult` types on two different query types
   (automated).
4. `MessageHandlerExtractor` requires no source change to index `QueryHandlerAdapterFactory`
   alongside the existing Command/Event factories — proven by a test that registers all
   three factory kinds and confirms each is found by its own `ForInterface` (automated).
5. `QueryHandlerAdapterFactory.Create(...)` returns an instance of the shared
   `MessageHandlerAdapter` from task 02, not a new bespoke type (inspection).

## Verification

```
dotnet build
dotnet test tests/NEvo.Messaging.Cqrs.Tests
```

## Documentation impact

None — covered in task 06.

## Out of scope

- `QueryProcessingStrategy`, `IQueryDispatcher`, `AddQueries()` (task 05).
- Any change to `MessageHandlerExtractor` — if this task's implementation reveals one is
  actually required, stop and report it per `areas/query-cqrs-support.md` § Constraints
  rather than silently making the change.
