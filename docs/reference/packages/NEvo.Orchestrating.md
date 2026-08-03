---
id: packages.nevo-orchestrating
type: package
title: NEvo.Orchestrating
status: experimental
dependencies:
  - NEvo.Core
summary: >
  Saga-style orchestration: sequential step execution with automatic reverse-order
  compensation on failure. Experimental and in progress — deliberately decoupled from
  the messaging pipeline (depends only on NEvo.Core).
---

# NEvo.Orchestrating

**Status: experimental.** Carried from `docs/development/orchestration.md`'s front
matter — do not treat this package as more stable or complete than that document.

## Purpose

`NEvo.Orchestrating` runs a saga: a sequence of steps executed in order, with automatic
compensation (undo, in reverse order) of already-completed steps if a later step fails.
It is deliberately independent of `NEvo.Messaging` — orchestration here is a standalone
state machine, not a messaging pattern.

## When to use

Experimental — only for exploratory work on multi-step, compensable workflows, not
production use. See `docs/development/orchestration.md` before starting any change
here. No state persistence exists today (see "Limitations"), so anything beyond an
in-process, single-run orchestration isn't usable as shipped.

## When not to use

For any production or resumable-across-restarts use case — no working
`IOrchestratorStateRepository` implementation exists (see "Limitations"). For simple
sequential operations without compensation semantics, plain code is simpler than
adopting this package.

## Responsibilities

- Define the shape of an orchestration (`IOrchestrator<TData>`: an ordered list of
  steps).
- Execute steps sequentially and track progress (`IOrchestrationRunner`,
  `OrchestrationRunner`).
- Run compensation in reverse order when a step fails (`OrchestrationRunner`).
- Track orchestration status and per-step progress (`OrchestratorStatus`,
  `OrchestratorState<TData>`).
- Provide a persistence seam for step-level resumability (`IOrchestratorStateRepository`,
  `PersistentStepExecutor`) — intended to be backed by a concrete (e.g. EF)
  implementation, but no such implementation exists yet anywhere in this repository,
  including in `NEvo.Orchestrating.EntityFramework` — see "Limitations" below.

## Dependencies

Depends only on `NEvo.Core` — see `src/NEvo.Orchestrating/NEvo.Orchestrating.csproj`'s
`ProjectReference` and `docs/development/package-boundaries.md`. No dependency on
`NEvo.Messaging` or any other NEvo package — this is rule 3 of `package-boundaries.md`:
*"`NEvo.Orchestrating` depends only on `NEvo.Core` — orchestration does not require
messaging."*

`NEvo.Orchestrating.EntityFramework` depends on `NEvo.Orchestrating` (not the reverse) —
see "Related packages" below.

## Public surface

Grounded directly in `src/NEvo.Orchestrating/*.cs`.

### Defining an orchestration

```csharp
public interface IOrchestrator<TData> where TData : new()
{
    public IEnumerable<IOrchestratorStep<TData>> Steps { get; }
}

public interface IOrchestratorStep<TData>
{
    public string Name { get; }
    public Task<Either<Exception, Unit>> ExecuteAsync(TData data, CancellationToken cancellationToken);
    public Task<Either<Exception, Unit>> CompensateAsync(TData data, CancellationToken cancellationToken);
}
```

`Either<Exception, Unit>` is `LanguageExt`'s functional error type — the same convention
used throughout NEvo (see [`NEvo.Core.md`](NEvo.Core.md)).

### Running an orchestration

```csharp
public interface IOrchestrationManager
{
    public Task<Either<Exception, Unit>> RunAsync<TData>(
        IOrchestrator<TData> orchestrator, TData data, CancellationToken cancellationToken
    ) where TData : new();

    public Task<Either<Exception, Unit>> CompleteAsync(
        Guid orchestrationId, CancellationToken cancellationToken
    );
}
```

`OrchestrationManager` is the default `IOrchestrationManager`. `RunAsync` builds a fresh
`OrchestratorState<TData>` (`Status = New`) and delegates to `IOrchestrationRunner`.
`CompleteAsync` is meant to resume a previously-persisted orchestration — see
"Limitations" below before relying on it.

### State and status

```csharp
public enum OrchestratorStatus
{
    New = 0, Running = 1, Completed = 2, Failed = 3,
    CompensationCompleted = 5, CompensationFailed = 6,
}

public abstract class OrchestratorState
{
    public Guid Id { get; set; }
    public required string OrchestratorType { get; set; }
    public OrchestratorStatus Status { get; set; }
    public string? LastStep { get; set; }
    public string? LastCompensatedStep { get; set; }
    public abstract object JsonData { get; set; }
}

public class OrchestratorState<TData> : OrchestratorState where TData : new()
{
    public required TData Data { get; set; }
}
```

State machine (`OrchestrationRunner.RunAsync`):

```
New/Running ──(all steps succeed)──────────────► Completed
     │
     └──(a step fails)──► Failed ──(compensation succeeds)──► CompensationCompleted
                                └──(compensation fails)──────► CompensationFailed
```

`Completed`, `CompensationCompleted`, `CompensationFailed` are terminal. Re-running an
orchestration whose state is `CompensationFailed` resets it to `Failed`, retrying
compensation.

### Execution and persistence

`OrchestrationRunner` (the default `IOrchestrationRunner`) executes steps sequentially
via an injected `IStepExecutor`, tracking `LastStep`/`LastCompensatedStep`. On failure it
runs `CompensateAsync` for previously-executed steps in reverse order.

`PersistentStepExecutor` decorates `IStepExecutor`: for each step, it
`LockAsync`s the state via `IOrchestratorStateRepository`, runs the inner executor, then
`SaveAsync`s the result — wrapped in a `TransactionScope`. Supplying
`PersistentStepExecutor` (instead of the plain `StepExecutor`) to `OrchestrationRunner`
is what makes per-step progress resumable, **if** a real `IOrchestratorStateRepository`
implementation is supplied — see "Limitations".

## Configuration

No DI/`IServiceCollection` registration extension exists in this package (unlike, e.g.,
`NEvo.Web.Authorization` or `NEvo.Messaging`). A consumer wires up
`OrchestrationManager`/`OrchestrationRunner`/`StepExecutor` (or `PersistentStepExecutor`
+ an `IOrchestratorStateRepository` implementation) manually.

## Limitations

- **`OrchestrationManager.CompleteAsync` and `RunAsync` are not wired to persistence,
  and no `IOrchestratorStateRepository` implementation exists anywhere in this
  repository** — see `docs/project/known-issues.md` § "No orchestration-state
  persistence implementation exists". The reflection-based resumption mechanism
  (`OrchestrationRunnerReflectionHelper.RunAsync`) is itself implemented and real —
  only the persistence wiring is missing.
- Retry policy, timeout/deadline handling, idempotency for step execution, how
  orchestrations are triggered, and how they're discovered/registered are all
  unspecified — see `docs/development/orchestration.md` § "Known unresolved decisions".
- `IOrchestrator<TData>`, `OrchestratorState<TData>`, and `IOrchestrationManager.RunAsync`
  all constrain `TData : new()` — a parameterless constructor is required (needed for
  `Activator.CreateInstance` during reflection-based resumption).

## Related packages

- [`NEvo.Orchestrating.EntityFramework`](NEvo.Orchestrating.EntityFramework.md) —
  provides an EF entity shape and table configuration for orchestrator state, but
  **not** a working `IOrchestratorStateRepository` implementation — see its own doc
  and "Limitations" above.

## Examples and tests

- `tests/NEvo.Orchestrating.Tests/OrchestrationRunnerTests.cs` — the primary coverage:
  full-success and fail-then-compensate scenarios, using
  `tests/NEvo.Orchestrating.Tests/Stubs/OrchestratorStub.cs` and `StepExecutorStub.cs`.
- No example-app usage of this package exists today; unit tests are the only current
  coverage. Note: "orchestration" also appears elsewhere in this repo referring to
  .NET Aspire service-topology orchestration (running multiple services together
  locally) — an unrelated meaning. Don't confuse the two when looking for a real-world
  usage example.
