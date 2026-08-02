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

**Status: experimental.** Carried from `docs/architecture/orchestration.md`'s front
matter — do not treat this package as more stable or complete than that doc (and this
one) document.

## Purpose

`NEvo.Orchestrating` runs a saga: a sequence of steps executed in order, with automatic
compensation (undo, in reverse order) of already-completed steps if a later step fails.
It is deliberately independent of `NEvo.Messaging` — orchestration here is a standalone
state machine, not a messaging pattern.

## Responsibilities

- Define the shape of an orchestration (`IOrchestrator<TData>`: an ordered list of
  steps).
- Execute steps sequentially and track progress (`IOrchestrationRunner`,
  `OrchestrationRunner`).
- Run compensation in reverse order when a step fails (`OrchestrationRunner`).
- Track orchestration status and per-step progress (`OrchestratorStatus`,
  `OrchestratorState<TData>`).
- Provide a persistence seam for step-level resumability (`IOrchestratorStateRepository`,
  `PersistentStepExecutor`) — the concrete (e.g. EF) implementation lives in
  `NEvo.Orchestrating.EntityFramework`.

## Dependencies

Depends only on `NEvo.Core` (verified directly against
`src/NEvo.Orchestrating/NEvo.Orchestrating.csproj`'s `ProjectReference`, and against
`docs/architecture/package-boundaries.md`). No dependency on `NEvo.Messaging` or any
other NEvo package — this is rule 3 of
`package-boundaries.md`: *"`NEvo.Orchestrating` depends only on `NEvo.Core` —
orchestration does not require messaging."*

`NEvo.Orchestrating.EntityFramework` depends on `NEvo.Orchestrating` (not the reverse) —
see "Related packages" below.

## Public surface

Signatures below are copied directly from `src/NEvo.Orchestrating/*.cs`, not
paraphrased.

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
used throughout NEvo (see `docs/architecture/overview.md` § "Design philosophy").

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
is what makes per-step progress resumable.

## Configuration

No DI/`IServiceCollection` registration extension exists in this package (unlike, e.g.,
`NEvo.Web.Authorization` or `NEvo.Messaging`). A consumer wires up
`OrchestrationManager`/`OrchestrationRunner`/`StepExecutor` (or `PersistentStepExecutor`
+ an `IOrchestratorStateRepository` implementation) manually.

## Basic usage

```csharp
public record OrderData();

public class OrderOrchestrator : IOrchestrator<OrderData>
{
    public IEnumerable<IOrchestratorStep<OrderData>> Steps { get; } =
    [
        new ReserveInventoryStep(),
        new ChargePaymentStep(),
        new ShipOrderStep(),
    ];
}

var state = new OrchestratorState<OrderData>
{
    OrchestratorType = typeof(OrderOrchestrator).AssemblyQualifiedName!,
    Status = OrchestratorStatus.New,
    Data = new OrderData(),
};

var runner = new OrchestrationRunner(new StepExecutor());
await runner.RunAsync(new OrderOrchestrator(), state, cancellationToken);

// state.Status is now Completed, or CompensationCompleted/CompensationFailed
// if a step failed and compensation ran.
```

## Advanced usage

No advanced usage beyond the above is documented yet. In particular, resuming a
previously-persisted orchestration through `IOrchestrationManager.CompleteAsync` is not
usable as shipped — see "Limitations".

## Limitations

- **`OrchestrationManager.CompleteAsync` is not wired to persistence.**
  `OrchestrationManager.cs` assigns its `OrchestratorState` from a literal `null!` with
  a `// get from DB` comment; calling `CompleteAsync` as written throws a
  `NullReferenceException`. The reflection-based resumption mechanism it's meant to use
  (`OrchestrationRunnerReflectionHelper.RunAsync`, which resolves the concrete
  `IOrchestrator<TData>` type from `OrchestratorState.OrchestratorType` and invokes the
  generic `RunAsync<TData>` via reflection) is itself implemented and real — only the
  DB fetch is missing.
- **`OrchestrationManager.RunAsync` does not persist the initial state.** The call to
  save the freshly-created `OrchestratorState` is commented out in source
  (`// save state in db` / `// await _stateRepository.SaveAsync(orchestrationState);`).
  Only `PersistentStepExecutor` (see "Execution and persistence") actually calls
  `IOrchestratorStateRepository`, and only if a caller supplies it in place of the plain
  `StepExecutor`.
- Retry policy, timeout/deadline handling, idempotency for step execution, how
  orchestrations are triggered, and how they're discovered/registered are all
  unspecified — see `docs/architecture/orchestration.md` § "What is not yet specified"
  for the full list.
- **No `IOrchestratorStateRepository` implementation exists anywhere in this
  repository** — not in this package, not in `NEvo.Orchestrating.EntityFramework`
  (confirmed: no class implements the interface; that package provides only an EF
  entity shape and table configuration — see
  [`NEvo.Orchestrating.EntityFramework.md`](NEvo.Orchestrating.EntityFramework.md)).
  `PersistentStepExecutor` cannot be used for real persistence today without writing
  this implementation yourself.
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
