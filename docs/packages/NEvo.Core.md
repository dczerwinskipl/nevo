---
id: packages.nevo-core
type: package
title: NEvo.Core
status: current
dependencies: []
summary: >
  Root of the dependency graph: functional primitives (Either-based error handling,
  argument checks) and the generic middleware-pipeline abstraction every processing
  pipeline in NEvo (messaging, and by extension its extensions) is built on.
---

# NEvo.Core

## Purpose

`NEvo.Core` provides the small set of primitives every other NEvo package builds on:
argument-checking helpers, `LanguageExt.Either`-based functional error handling
conventions, and a generic, reusable middleware-pipeline abstraction. It has no
dependencies of its own — every other package in this repository depends on it directly
or transitively.

## Responsibilities

- Argument/precondition checking (`Check`).
- Small `LanguageExt` extensions supporting the repository-wide `Either<Exception, T>`
  error convention (`EitherExtensions`, `UnitExt`).
- A generic middleware-chain abstraction (`IMiddleware<TInput, TResult>`,
  `IMiddlewareHandler<TInput, TResult>`, `MiddlewareHandler<TInput, TResult>`) —
  consumed by `NEvo.Messaging`'s processing pipeline (see
  [`docs/architecture/messaging-pipeline.md`](../architecture/messaging-pipeline.md)),
  but defined here as a repository-wide, messaging-independent primitive.

## Dependencies

None — `NEvo.Core` is the root of the dependency graph
(`docs/architecture/package-boundaries.md` rule 2: *"`NEvo.Core` must remain independent
of all other NEvo packages"*), confirmed directly against
`src/NEvo.Core/NEvo.Core.csproj` (no `ProjectReference` entries).

## Public surface

Grounded directly in `src/NEvo.Core/*.cs` — this is the entire package (6 files).

### Argument checking

```csharp
public static class Check
{
    public static TValue Null<TValue>(TValue? value, string? message = null, string? paramName = null);
    public static string NullOrEmpty(string? value, string? message = null, string? paramName = null);
    public static TValue Default<TValue>(TValue value, string? message = null, string? paramName = null) where TValue : struct;
}
```

`paramName` defaults to the caller's argument expression via `[CallerArgumentExpression]`
— you don't need to pass it explicitly in the common case (`Check.Null(myArg)` reports
`myArg` in the exception automatically).

### Either / Unit helpers

```csharp
namespace LanguageExt; // note: extends LanguageExt's own namespace, not NEvo.Core

public static class EitherExtensions
{
    public static Either<TLeft, TRight> Do<TLeft, TRight>(
        this Either<TLeft, TRight> either, Action<TRight> Right, Action<TLeft> Left);
}
```

```csharp
public static class UnitExt
{
    public static readonly Task<Either<Exception, Unit>> DefaultEitherTask;
    // = Task.FromResult(Either<Exception, Unit>.Right(Unit.Default))
}
```

`UnitExt.DefaultEitherTask` is a reusable "successful, no-value" completed task —
avoids allocating a new one at every call site that needs to return
`Task<Either<Exception, Unit>>.Right(Unit.Default)`.

### Middleware pipeline

```csharp
public interface IMiddleware<TInput, TResult>
{
    Task<TResult> ExecuteAsync(TInput input, Func<Task<TResult>> next, CancellationToken cancellationToken);
}

public interface IMiddlewareHandler<TInput, TResult>
{
    Task<TResult> ExecuteAsync(Func<TInput, CancellationToken, Task<TResult>> baseDelegate, TInput input, CancellationToken cancellationToken);
}

public class MiddlewareHandler<TInput, TResult> : IMiddlewareHandler<TInput, TResult>;
```

`MiddlewareHandler` builds the chain by wrapping `baseDelegate` in each configured
middleware's `ExecuteAsync`, innermost-first (constructed via `.Reverse()` on the
supplied middleware list, so the first middleware in the list runs outermost/first).
Each middleware can be paired with a `ShouldApply(TInput) -> bool` predicate
(`MiddlewareConfig<TInput, TResult>`) to be conditionally skipped per-invocation.

## The `Either<Exception, T>` convention

`LanguageExt.Core` is a required dependency of `NEvo.Core` (and therefore everything
downstream). Every fallible operation across the messaging pipeline returns
`Either<Exception, T>` rather than throwing — this is a deliberate, repository-wide
architectural choice (see
[`docs/architecture/overview.md`](../architecture/overview.md) § "Design philosophy" and
[`docs/architecture/messaging-pipeline.md`](../architecture/messaging-pipeline.md) §
"Error model"). `NEvo.Core` itself doesn't enforce this convention mechanically — `Check`
still throws `ArgumentNullException` for precondition failures, which is the accepted
exception to the pattern (invalid arguments are a programmer error, not a runtime
`Either`-modeled failure).

## Configuration

No DI registration extension exists in this package — every type here is either static
(`Check`, `EitherExtensions`, `UnitExt`) or instantiated directly by a consumer/downstream
package (`MiddlewareHandler`).

## Basic usage

```csharp
public class MyService(ISomeDependency dependency)
{
    private readonly ISomeDependency _dependency = Check.Null(dependency);
}
```

## Advanced usage

Composing a middleware chain directly (as `NEvo.Messaging`'s processing pipeline does
internally):

```csharp
IEnumerable<IMiddleware<MyInput, MyResult>> middlewares = [new LoggingMiddleware(), new TimingMiddleware()];
var handler = new MiddlewareHandler<MyInput, MyResult>(middlewares);

MyResult result = await handler.ExecuteAsync(
    baseDelegate: (input, ct) => DoWorkAsync(input, ct),
    input: myInput,
    cancellationToken: ct
);
```

## Limitations

- `IMiddleware<TInput, TResult>.ExecuteAsync`'s `next` parameter is `Func<Task<TResult>>`
  (no input/cancellation token forwarded through `next` itself) — a middleware that needs
  to alter the input or cancellation token for downstream middleware must do so via
  closure state before calling `next`, not by re-invoking with different arguments.
- `MiddlewareConfig` carries a `// TODO: better naming, maybe just options or something
  like that?` comment in source — the type may be renamed in a future change.

## Related packages

Every other package in this repository depends on `NEvo.Core`, directly or
transitively — see [Package classification](classification.md) and
[Package boundaries](../architecture/package-boundaries.md) for the full graph. Its
middleware abstraction is consumed most directly by `NEvo.Messaging`
([`NEvo.Messaging.md`](NEvo.Messaging.md)), which builds its processing pipeline on top
of it.

## Examples and tests

- `tests/NEvo.Core.Tests/CheckTests.cs`
- `tests/NEvo.Core.Tests/MiddlewareHandlerTests.cs`
- `tests/NEvo.Core.Tests/UnitExtTests.cs`
- `tests/NEvo.Core.Tests/Assertions/EitherAssertions.cs` — shared `Either` test
  assertions, reused by other packages' test projects.
