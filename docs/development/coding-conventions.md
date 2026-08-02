---
id: development.coding-conventions
type: development
title: Coding conventions
status: current
read_when:
  - writing new code in any NEvo package
  - reviewing a pull request
  - deciding how to signal a failure
summary: >
  Standing rules a contributor follows regardless of what they're building: the
  Either<Exception, T> error convention, dependency-direction, DI registration shape,
  and constructor null-checking. Cross-links the extension workflow rather than
  duplicating it.
related:
  - development.testing
---

# Coding conventions

This document covers **standing rules** — patterns you follow no matter what you're
building. For the step-by-step process of adding a new transport, persistence
mechanism, handler, or event type, see
[Extending NEvo](../guides/extending-nevo.md) instead; this page doesn't repeat that
content.

## The `Either<Exception, T>` convention

Every fallible operation across the messaging pipeline returns `LanguageExt.Either
<Exception, T>` rather than throwing — this is deliberate and repository-wide, not
incidental (see [`docs/architecture/overview.md`](../architecture/overview.md) §
"Design philosophy" and [`NEvo.Core`](../packages/NEvo.Core.md) § "The
`Either<Exception, T>` convention" for the supporting helpers:
`EitherExtensions.Do`, `UnitExt.DefaultEitherTask`).

Concretely:

- A handler, middleware, dispatch strategy, or repository method that can fail returns
  `Task<Either<Exception, T>>` (or the synchronous/`EitherAsync` equivalent), not a
  thrown exception and not a nullable/default value.
- Reserve actual `throw` for programmer-error preconditions checked at the boundary of
  a method — `NEvo.Core`'s `Check.Null`/`Check.NullOrEmpty`/`Check.Default` are the
  established way to do this (see below), not a case for `Either`.
- Don't mix the two: a method whose contract is "returns `Either`" should not also
  throw for a *runtime* failure (a failed HTTP call, a validation failure, a database
  error) — wrap it as `Left`, following the pattern in, e.g.,
  `HttpClientServiceBase.SendAsync` (catches and wraps) or
  `RestClientServiceBase`'s `GetAsync`/`PostAsync` (same).
- Callers use `.Match`, `.Bind`, `.Map`, `.BindAsync`/`.MapAsync` to compose — not
  `.IsRight`/unwrapping followed by imperative branching, where a functional
  composition reads more directly (see `CommandDispatcher`, `OrchestrationRunner`, or
  `AggregateExtensions.ExecuteAsync` for examples already in the codebase).

## Constructor null-checking

Guard constructor-injected dependencies with `NEvo.Core`'s `Check.Null(value)` — it
throws `ArgumentNullException` naming the parameter automatically via
`[CallerArgumentExpression]`, so you don't pass the parameter name by hand:

```csharp
private readonly IMyDependency _dependency = Check.Null(dependency);
```

This is the established pattern throughout the codebase (seen in, among others,
`UserClaimsProvider`, `ClaimRoleProvider`, `ClaimUserProvider`, `OrchestrationRunner`,
`OrchestrationManager`, `PersistentStepExecutor`, `ValidatePermissionMiddleware`,
`UserContextMiddleware`) — prefer it over a hand-rolled `?? throw new
ArgumentNullException(...)`.

## Dependency direction between packages

Dependencies between NEvo packages flow **downward only** — see
[Package boundaries](../architecture/package-boundaries.md) (`architecture.
package-boundaries`) for the full rule set and current dependency graph; this document
doesn't restate it. If you're adding a new package or a new cross-package reference,
read that document first — package-boundary changes are an architectural decision
requiring owner approval (see `AGENTS.md`).

## DI registration shape

Every package that registers services follows the same shape, established across
`NEvo.Messaging` (`AddMessages`), `NEvo.Messaging.Cqrs` (`AddCommands`),
`NEvo.Messaging.Web` (`AddRestMessageDispatcher`), `NEvo.Web.Authorization`
(`AddClaimsAuthorization`), `NEvo.EntityFramework` (`AddMigrationWorker`), and others:

- A `static class ServiceCollectionExtensions` in the `Microsoft.Extensions.
  DependencyInjection` namespace (**not** the package's own namespace) — so a consumer
  never needs an extra `using` to find `AddXxx()`.
- An `AddXxx(this IServiceCollection services)` extension method as the entry point.
- Default registrations use `TryAddScoped`/`TryAddSingleton` (not the plain
  `Add*` methods) so a consumer can override any default by registering their own
  implementation first — this is load-bearing, not stylistic: several packages'
  documented "how to override the default" instructions rely on it (e.g.
  [`NEvo.Ddd.EventSourcing`](../packages/NEvo.Ddd.EventSourcing.md)'s `IEventStore`).

Not every package follows this consistently — see each package's own doc for gaps
(e.g. [`NEvo.Messaging.Authorization`](../packages/NEvo.Messaging.Authorization.md)
has no registration helper at all; [`NEvo.Messaging.EntityFramework`](../packages/NEvo.Messaging.EntityFramework.md)
has one for inbox but not outbox). Follow the shape above for anything new regardless.

## Message, command, and event types

Commands and events are `record` types — see
[`NEvo.Messaging.Cqrs`](../packages/NEvo.Messaging.Cqrs.md)'s `Command` and
`NEvo.Messaging`'s `Event` (`NEvo.Messaging.Events` namespace). Prefer a `record`
over a `class` for any new message type, consistent with every existing one in the
codebase.
