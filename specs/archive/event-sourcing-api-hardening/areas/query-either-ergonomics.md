# Area: Query/Either ergonomics cleanup

## Responsibility

Give the "load an aggregate, 404 if missing, project to a DTO" read pattern a
correctly-named, correctly-homed helper, replacing the existing `MapAsync` extension
that currently hides stronger-than-`Map` semantics behind a name that looks like plain
`Map`, and lives in `namespace LanguageExt` as if it were first-party library API.

## Current state

`EitherExtensions.MapAsync` (`src/NEvo.Core/EitherExtensions.cs:17-29`):

```csharp
namespace LanguageExt;

public static class EitherExtensions
{
    // ...
    /// <summary>
    /// Collapses the common "found or not found" repository-read shape in one step:
    /// <c>Some</c> maps to the result, <c>None</c> becomes a <c>Left</c> via <paramref name="None"/>
    /// (an existing <c>Left</c> passes through unchanged).
    /// </summary>
    public static EitherAsync<TLeft, TResult> MapAsync<TLeft, TRight, TResult>(
        this EitherAsync<TLeft, Option<TRight>> self,
        Func<TRight, TResult> Some,
        Func<TLeft> None
    ) => self.Bind(option => option.Match(
        Some: value => RightAsync<TLeft, TResult>(Some(value)),
        None: () => LeftAsync<TLeft, TResult>(None())
    ));
}
```

It already has a correct XML summary describing its real behavior, but the member name
(`MapAsync`) reads as an ordinary two-argument `Map`, and the whole class lives in
`namespace LanguageExt` — indistinguishable, from a consuming file's `using` list, from
first-party LanguageExt API. `EitherAsync<L,R>` itself already has its own, differently-
shaped instance `MapAsync<R2>(Func<R, Task<R2>> f)` (confirmed present in the installed
LanguageExt 4.4.8 package's own XML member list) — a same-named-but-different-shape
extension in the same namespace as the type it extends is exactly the kind of confusion
this area removes, independent of the "looks like first-party API" concern.

Current consumer, `GetDocumentQueryHandler`
(`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/Domain/DocumentQueries.cs:23-27`):

```csharp
public class GetDocumentQueryHandler(IAggregateRepository repository) : IQueryHandler<GetDocumentQuery, DocumentDto>
{
    public async Task<Either<Exception, DocumentDto>> HandleAsync(GetDocumentQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
        => await repository.LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
            .MapAsync(Some: loaded => ToDto(loaded.Aggregate), None: () => new DocumentNotFoundException(query.DocumentId));
    // ...
}
```

**LanguageExt 4.4.8 API surface check** (inspected via the installed package's shipped
XML doc-comment member list — the most reliable non-guessing source available without a
decompiler): no built-in LanguageExt 4.4.8 member operates directly on an already-wrapped
`EitherAsync<TLeft, Option<TRight>>` (outer `Either`, inner `Option`) doing "unwrap
`Some`, convert `None` to the supplied `Left`, preserve an existing `Left`" in one step.
The closest built-ins (`OptionAsyncExtensions.ToEitherAsync`,
`TaskOptionAsyncExtensions.ToEitherAsync`) operate one level down, converting a bare
`Option<R>`/`Task<Option<R>>` into an `EitherAsync<L,R>` — not the same shape, since
NEvo's case starts from an `EitherAsync` that may already be `Left` and must preserve it
unchanged. A small NEvo-owned extension remains justified; only its name, namespace, and
documentation need to change.

## Requirements

- Rename the existing extension to communicate its real semantics — `RequireSome` (this
  specification's chosen name; reads correctly at the call site, is not already used by
  LanguageExt for anything, and does not collide with any existing NEvo member found
  during discovery). Target call-site shape:

  ```csharp
  return await repository
      .LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
      .RequireSome(() => new DocumentNotFoundException(query.DocumentId))
      .Map(loaded => ToDto(loaded.Aggregate));
  ```

  i.e. `RequireSome` unwraps `Option<TRight>` → `TRight` (converting `None` to the
  supplied `Left`, preserving an existing `Left`), returning a plain
  `EitherAsync<TLeft, TRight>` — ordinary LanguageExt `.Map`/`.Bind` then compose
  normally afterward, rather than folding the DTO projection into the same call as the
  not-found conversion.
- Move it out of `namespace LanguageExt` into a NEvo namespace (e.g. `NEvo.Core`, where
  the file already lives) so it is discoverable as NEvo's own extension, not mistaken for
  first-party LanguageExt API.
- Keep it generic (`TLeft`, `TRight`, no NEvo-specific type constraint) — this is a
  general `EitherAsync<TLeft, Option<TRight>>` helper, not something Event-Sourcing- or
  Documents-specific, even though the motivating call site is a query handler.
- Give it focused XML documentation describing exactly: preserves an existing `Left`
  unchanged; converts `Right(Some(value))` to `Right(value)`; converts `Right(None)` to
  `Left(the supplied factory's result)`.
- Preserve expected short-circuit behavior: an already-`Left` input must not evaluate the
  `Some`/`None`-equivalent branches at all (the existing `.Bind(...)` structure already
  guarantees this — carry it forward, prove it with a test).

## Constraints

- Do not migrate to LanguageExt v5 in this task or as a side effect of it.
- Do not replace the public `Task<Either<Exception, T>>` handler contract
  (`IQueryHandler<TQuery, TResult>.HandleAsync`) with `EitherAsync` or any other new
  async abstraction — `RequireSome`/`.Map` compose inside the existing method body; the
  method's own return type/signature is unchanged (`GetDocumentQueryHandler.HandleAsync`
  already returns via `await ...` today and continues to).
- Do not create a new Result/monad abstraction — this is one focused extension method
  addition (replacing the existing one, not adding a second), not a new type.
- Do not build a general "handle any nested-Option-in-Either shape" toolkit — one method,
  the one shape this repository's read pattern actually needs.

## Interfaces and boundaries

- Consumes: `IAggregateRepository.LoadAggregateAsync` (task 02), which already returns
  `EitherAsync<Exception, Option<TLoaded>>`-shaped results consistent with the pattern
  this helper targets.
- Produces: the renamed/relocated helper, consumed by `GetDocumentQueryHandler` (task 10)
  and available to any future NEvo query handler with the same "found or not found" read
  shape.

## Area-specific acceptance criteria

1. The renamed extension is not declared inside `namespace LanguageExt` (inspection).
2. `Left(error)` input produces the identical `Left(error)` output, and the `Some`/`None`
   branches are never evaluated for it (test, e.g. via a spy/counter on the `None`
   factory).
3. `Right(Some(value))` input produces `Right(value)` (test).
4. `Right(None)` input produces `Left(...)`, using the caller-supplied factory (test).
5. `GetDocumentQueryHandler` is updated to the new call shape (`RequireSome(...).Map(...)`
   or equivalent), and its existing behavior (found → DTO, not found →
   `DocumentNotFoundException`) is unchanged (inspection + existing manual walkthrough).
6. The new/renamed member has XML documentation stating its exact three-case behavior
   (inspection).
7. `dotnet build` and `dotnet test tests/NEvo.Core.Tests` succeed.

## Dependencies

- `documents-example-es-and-auth-demo` (task 10) — the only current call site
  (`GetDocumentQueryHandler`) that needs updating to the new shape.

## Out of scope

- LanguageExt v5 migration.
- Any change to `IAggregateRepository`/`IEventStreamStore` contracts.
- A general Result/monad abstraction beyond the one renamed extension.
- Any other `EitherExtensions` member (`Do` is unaffected).
