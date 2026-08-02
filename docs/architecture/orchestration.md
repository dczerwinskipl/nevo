---
id: architecture.orchestration
type: architecture
title: Orchestration
status: experimental
scope:
  - orchestration
  - sagas
read_when:
  - working on NEvo.Orchestrating
summary: >
  Experimental saga orchestration implementation. In progress. Decoupled from messaging.
  Do not use as basis for refactoring other modules.
related:
  - architecture.package-boundaries
---

# Orchestration

**Status: experimental and in progress.** `NEvo.Orchestrating` depends only on `NEvo.Core`,
intentionally decoupled from the messaging layer. This is a deliberate architectural choice.

## Core abstractions (`NEvo.Orchestrating`)

Signatures below are copied directly from source (`src/NEvo.Orchestrating/*.cs`), not
paraphrased — verified 2026-08-02.

### Orchestrator definition

```csharp
interface IOrchestrator<TData> where TData : new()
{
    IEnumerable<IOrchestratorStep<TData>> Steps { get; }
}

interface IOrchestratorStep<TData>
{
    string Name { get; }
    Task<Either<Exception, Unit>> ExecuteAsync(TData data, CancellationToken ct);
    Task<Either<Exception, Unit>> CompensateAsync(TData data, CancellationToken ct);
}
```

### Orchestration lifecycle

```csharp
interface IOrchestrationManager
{
    Task<Either<Exception, Unit>> RunAsync<TData>(IOrchestrator<TData>, TData, CancellationToken) where TData : new();
    Task<Either<Exception, Unit>> CompleteAsync(Guid orchestrationId, CancellationToken);
}
```

### State machine

Real `OrchestratorStatus` enum values (`src/NEvo.Orchestrating/OrchestratorStatus.cs`):
`New`, `Running`, `Completed`, `Failed`, `CompensationCompleted`, `CompensationFailed`.
There is no `Compensating` in-progress status — compensation happens while `Status` is
still `Failed`.

```
New/Running ──(all steps succeed)──────────────► Completed
     │
     └──(a step fails)──► Failed ──(compensation succeeds)──► CompensationCompleted
                                └──(compensation fails)──────► CompensationFailed
```

`Completed`, `CompensationCompleted`, and `CompensationFailed` are the terminal states
(`OrchestrationRunner.FinalStates`). Re-running an orchestration whose state is
`CompensationFailed` resets it to `Failed`, retrying compensation.

### Execution model

`IOrchestrationRunner` executes steps sequentially via an injected `IStepExecutor`. On
step failure, compensation runs in reverse order for all previously completed steps
(`CompensateAsync`), tracked via `OrchestratorState.LastStep`/`LastCompensatedStep`.

`PersistentStepExecutor` decorates `IStepExecutor`, persisting state via
`IOrchestratorStateRepository` (`LockAsync` → inner execute/compensate → `SaveAsync`,
wrapped in a `TransactionScope`) before and after each step — this is what makes
per-step progress resumable, *if* `PersistentStepExecutor` is the `IStepExecutor`
supplied to `OrchestrationRunner`.

`OrchestrationManager` (the `IOrchestrationManager` implementation) does not itself wire
up persistence: `RunAsync` constructs the initial `OrchestratorState` but its call to
save it is commented out in source
(`OrchestrationManager.cs`: `// save state in db` /
`// await _stateRepository.SaveAsync(orchestrationState);`), and `CompleteAsync` — meant
to resume a previously-persisted orchestration — assigns `orchestrationState` from a
literal `null!` with a `// get from DB` comment, which would throw at runtime if called
as written. The reflection-based resumption mechanism this depends on
(`OrchestrationRunnerReflectionHelper.RunAsync(this IOrchestrationRunner,
OrchestratorState, CancellationToken)`, which resolves the concrete `IOrchestrator<TData>`
type from `OrchestratorState.OrchestratorType` via `Activator.CreateInstance` and
invokes the generic `RunAsync<TData>` via reflection) is implemented and real — only the
DB-fetch it needs is not wired in yet.

## EF persistence (`NEvo.Orchestrating.EntityFramework`)

`IOrchestratorStateRepository` stores `OrchestratorState<TData>` (status, completed steps,
current data) using Entity Framework Core / SQL Server.

## What is not yet specified

- How orchestrations are triggered (directly or via messaging)
- Retry policy for failed steps
- Timeout and deadline handling
- Whether orchestration integrates with the inbox/outbox pattern
- Idempotency for step execution
- How orchestrations are discovered and registered
- How `OrchestrationManager` is meant to wire up `IOrchestratorStateRepository` for
  initial-state persistence and resumption — both paths are present in source but not
  connected yet (see "Execution model" above)
