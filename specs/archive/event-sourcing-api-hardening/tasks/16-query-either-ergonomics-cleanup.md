---
id: event-sourcing-api-hardening.query-either-ergonomics-cleanup
status: draft
change: event-sourcing-api-hardening
depends_on:
  - documents-example-es-and-auth-demo
semantic_references:
  decisions: [D37]
  dependency_contracts:
    - documents-example-es-and-auth-demo
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/query-either-ergonomics.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Core/EitherExtensions.cs
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/DocumentQueries.cs
  optional: []
allowed_paths:
  - src/NEvo.Core/**
  - tests/NEvo.Core.Tests/**
  - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Messaging.Web/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/**
  - examples/ExampleApp/NEvo.ExampleApp.ServiceB.Api/**
---

# Task: Query/Either ergonomics cleanup

## Goal

Replace `EitherExtensions.MapAsync` (`src/NEvo.Core/EitherExtensions.cs:17-29`) — which
has stronger-than-`Map` semantics (unwraps `Option`, converts `None` to `Left`) but a
plain-`Map`-looking name, and lives in `namespace LanguageExt` as if first-party — with a
correctly named, correctly homed, directly tested helper: `RequireSome`.

## Dependencies

- `documents-example-es-and-auth-demo` (task 10) — `GetDocumentQueryHandler` is the only
  current call site and needs updating to the new shape.

## Implementation constraints

- Rename `MapAsync` to `RequireSome` and move it out of `namespace LanguageExt` into a
  NEvo namespace (the file already lives in `NEvo.Core`). Change its shape from a
  two-callback `Map`-alike into a single-responsibility unwrap:

  ```csharp
  public static EitherAsync<TLeft, TRight> RequireSome<TLeft, TRight>(
      this EitherAsync<TLeft, Option<TRight>> self,
      Func<TLeft> None
  ) => self.Bind(option => option.Match(
      Some: value => RightAsync<TLeft, TRight>(value),
      None: () => LeftAsync<TLeft, TRight>(None())
  ));
  ```

  Target call-site shape, composing with ordinary LanguageExt `.Map` afterward:

  ```csharp
  return await repository
      .LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
      .RequireSome(() => new DocumentNotFoundException(query.DocumentId))
      .Map(loaded => ToDto(loaded.Aggregate));
  ```

- Give it focused XML documentation stating exactly: an existing `Left` passes through
  unchanged (its `Some`/`None` handling is never evaluated); `Right(Some(value))` becomes
  `Right(value)`; `Right(None)` becomes `Left(the supplied factory's result)`.
- Keep it generic — no NEvo-specific type constraint, no Event-Sourcing- or
  Documents-specific coupling.
- Update `GetDocumentQueryHandler`
  (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/DocumentQueries.cs:26-27`)
  to the new `RequireSome(...).Map(...)` call shape; its observable behavior (found → DTO,
  not found → `DocumentNotFoundException`) is unchanged.
- Do not migrate to LanguageExt v5.
- Do not change `IQueryHandler<TQuery,TResult>.HandleAsync`'s public
  `Task<Either<Exception, T>>` return contract, or introduce any new async
  Result/monad abstraction — `RequireSome`/`.Map` compose inside the existing method
  body only.
- Do not touch `EitherExtensions.Do` — unrelated, unaffected.

## Acceptance criteria

1. The new member is not declared inside `namespace LanguageExt` (inspection).
2. `Left(error)` input produces the identical `Left(error)` output; the `None` factory is
   never evaluated for it (test, e.g. a call counter).
3. `Right(Some(value))` input produces `Right(value)` (test).
4. `Right(None)` input produces `Left(...)` using the caller-supplied factory (test).
5. `GetDocumentQueryHandler` uses the new call shape and its found/not-found behavior is
   unchanged (inspection + existing manual walkthrough).
6. `RequireSome` has XML documentation stating its three-case behavior (inspection).
7. `dotnet build` succeeds; `dotnet test tests/NEvo.Core.Tests` passes.

## Verification

```
dotnet build
dotnet test tests/NEvo.Core.Tests
```

## Documentation impact

None directly — task 11 (user-facing guide, sequenced after this task) references the
final query-handler shape as part of its "Query/read side" section.

## Out of scope

- LanguageExt v5 migration.
- Any change to `IAggregateRepository`/`IEventStreamStore` contracts.
- A general Result/monad abstraction.
- `EitherExtensions.Do`.
