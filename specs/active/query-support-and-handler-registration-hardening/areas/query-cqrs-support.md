# Area: Query CQRS support

## Responsibility

Add first-class Query abstractions, handler discovery, dispatch, and pipeline
integration — the feature this whole change exists to deliver.

## Current state

- `NEvo.Messaging.Cqrs` provides only the command side. The `.csproj` carries an empty
  `<Folder Include="Queries\" />` placeholder.
- `Message<TResult> : Message, IMessage<TResult>` already exists
  (`src/NEvo.Messaging/Message.cs`) — a ready-made base for a typed-result message type.
- `IMessageProcessingStrategyWithResult` (generic `ShouldApply<TResult>`/
  `ProcessMessageWithResultAsync<TResult>` methods on a non-generic interface) exists and
  is unit-tested at the factory-selection level, but has no concrete implementation
  anywhere in `src/` — calling it in production throws `InvalidOperationException` today.
- `IMessageHandlerRegistry.GetMessageHandler` (singular) already throws
  `NoHandlerFoundException`/`MoreThanOneHandlerFoundException` deterministically for any
  message type — this is reused as-is, not reimplemented for Query.
- `MessageHandlerExtractor` is already generic over registered `IMessageHandlerFactory`
  instances, keyed by `ForInterface` — no change needed here for a new handler kind.

## Requirements

1. `Query<TResult> : Message<TResult>` (abstract record, `NEvo.Messaging.Cqrs.Queries`
   namespace) — D4.
2. `IQueryHandler<TQuery, TResult> where TQuery : Query<TResult>` — one handler method,
   `Task<Either<Exception, TResult>> HandleAsync(TQuery query, IMessageContext
   messageContext, CancellationToken cancellationToken)`, mirroring
   `ICommandHandler<TMessage>`'s shape.
3. `QueryHandlerAdapterFactory : IMessageHandlerFactory` — `ForInterface =>
   typeof(IQueryHandler<,>)`; `GetMessageHandlerDescriptions` reflects the actual closed
   `TResult` from the handler's implemented `IQueryHandler<TQuery, TResult>` interface
   (never hardcodes `Unit`); `Create()` constructs the shared `MessageHandlerAdapter` from
   the `shared-handler-invocation` area.
4. `QueryProcessingStrategy : IMessageProcessingStrategyWithResult` — the first
   production implementation of this interface. `ShouldApply<TResult>` matches `message
   is Query<TResult>`; `ProcessMessageWithResultAsync<TResult>` resolves exactly one
   handler via `IMessageHandlerRegistry.GetMessageHandler`, runs handler-level middleware,
   and returns the typed result. One registered instance serves every `Query<TResult>`
   regardless of `TResult`.
5. `IQueryDispatcher` — `Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult>
   query, CancellationToken cancellationToken)`. Default implementation
   (`QueryDispatcher`) resolves/creates `IMessageContext` the same way `CommandDispatcher`
   does, and calls `IMessageProcessor.ProcessMessageAsync<TResult>`.
6. `AddQueries()` (`Microsoft.Extensions.DependencyInjection` namespace,
   `NEvo.Messaging.Cqrs`) registers `QueryHandlerAdapterFactory`, `QueryProcessingStrategy`,
   `IQueryDispatcher` → `QueryDispatcher`, using the idempotent shape from the
   `registration-hardening` area.
7. Middleware (message-level and handler-level) requires no change — both chains already
   operate on `IMessage`/boxed `object` and are not `Unit`-hardcoded.

## Constraints

- No Query notifications, no multi-handler Query semantics (owner request, restated from
  the original scope).
- No new project reference, no new external package.
- Query does not require any change to `MessageHandlerExtractor` — if implementation
  reveals otherwise, stop and report it as a signal the classification/option analysis
  needs to be revisited, per `docs/ai/specification-workflow.md` § "Escalation is
  explicit and one-way".

## Interfaces and boundaries

Depends on: the shared `MessageHandlerAdapter` (`shared-handler-invocation` area) and the
idempotent registration shape (`registration-hardening` area).

Exposes: `Query<TResult>`, `IQueryHandler<TQuery, TResult>`, `IQueryDispatcher`,
`AddQueries()` — new public surface, additive only.

## Area-specific acceptance criteria

Mirrors `overview.md` § "Change-wide acceptance criteria" items 1–5, 10–12 at this area's
scope (typed result, DI resolution, no-handler failure, multiple-handler failure,
multiple `TResult` types simultaneously, explicit discovery only, middleware ordering,
cancellation propagation).

## Dependencies

Depends on `shared-handler-invocation` (task 02) for the shared adapter, and on
`registration-hardening` (task 03) for the idempotent registration pattern `AddQueries()`
follows.

## Out of scope

- Typed/generic-over-`TResult` middleware — Query reuses the existing untyped chain.
- Any composing registration method beyond `AddQueries()` itself (D3).
