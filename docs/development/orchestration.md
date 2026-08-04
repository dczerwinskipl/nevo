---
id: development.orchestration
type: development
title: Orchestration
status: experimental
read_when:
  - working on NEvo.Orchestrating
summary: >
  Experimental saga orchestration implementation. In progress. Decoupled from messaging.
  Do not use as basis for refactoring other modules.
related:
  - development.package-boundaries
---

# Orchestration

## Subsystem responsibility

**Status: experimental and in progress.** `NEvo.Orchestrating` depends only on `NEvo.Core`,
intentionally decoupled from the messaging layer. This is a deliberate architectural choice.

## Core abstractions (`NEvo.Orchestrating`)

Signatures below are grounded directly in source (`src/NEvo.Orchestrating/*.cs`).

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

## Control and data flow

`IOrchestrationRunner` executes steps sequentially via an injected `IStepExecutor`. On
step failure, compensation runs in reverse order for all previously completed steps
(`CompensateAsync`), tracked via `OrchestratorState.LastStep`/`LastCompensatedStep`.

`PersistentStepExecutor` decorates `IStepExecutor`, persisting state via
`IOrchestratorStateRepository` (`LockAsync` → inner execute/compensate → `SaveAsync`,
wrapped in a `TransactionScope`) before and after each step — this is what makes
per-step progress resumable, *if* `PersistentStepExecutor` is the `IStepExecutor`
supplied to `OrchestrationRunner` **and** a real `IOrchestratorStateRepository`
implementation is supplied — see "Persistence" below, neither exists today.

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

## Persistence (`NEvo.Orchestrating.EntityFramework`)

**No `IOrchestratorStateRepository` implementation exists anywhere in this
repository** — not in `NEvo.Orchestrating`, not in `NEvo.Orchestrating.EntityFramework`.
`NEvo.Orchestrating.EntityFramework` provides only: an EF entity shape
(`OrchestratorStateEf`) and a table configuration
(`OrchestratorStateTypeConfiguration`) — and that configuration itself targets the wrong
type (`IEntityTypeConfiguration<OrchestratorState>`, `NEvo.Orchestrating`'s own
non-generic base class, not `IEntityTypeConfiguration<OrchestratorStateEf>`); nothing in
the package maps between the two shapes. `PersistentStepExecutor` cannot be used for real
persistence today without writing an `IOrchestratorStateRepository` implementation and
reconciling this entity mismatch yourself. See
`docs/reference/packages/NEvo.Orchestrating.EntityFramework.md` for the full detail.

## Forbidden or unsafe extension approaches

Do not supply `PersistentStepExecutor` to `OrchestrationRunner` expecting working
persistence — see "Persistence" above and
`docs/development/extension-points.md` § "Forbidden or unsafe extension approaches".

## Known unresolved decisions

- How orchestrations are triggered (directly or via messaging)
- Retry policy for failed steps
- Timeout and deadline handling
- Whether orchestration integrates with the inbox/outbox pattern
- Idempotency for step execution
- How orchestrations are discovered and registered
- How `OrchestrationManager` is meant to wire up `IOrchestratorStateRepository` for
  initial-state persistence and resumption — both paths are present in source but not
  connected yet (see "Control and data flow" above)
