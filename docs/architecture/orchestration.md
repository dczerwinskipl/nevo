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

### Orchestrator definition

```csharp
interface IOrchestrator<TData>
{
    IEnumerable<IOrchestratorStep<TData>> Steps { get; }
}

interface IOrchestratorStep<TData>
{
    string Name { get; }
    Task<TData> ExecuteAsync(TData data, CancellationToken ct);
    Task<TData> CompensateAsync(TData data, CancellationToken ct);
}
```

### Orchestration lifecycle

```csharp
interface IOrchestrationManager
{
    Task<Either<Exception, Unit>> RunAsync<TData>(IOrchestrator<TData>, TData, CancellationToken);
    Task<Either<Exception, Unit>> CompleteAsync(Guid orchestrationId, CancellationToken);
}
```

### State machine

```
New → Running → Completed
             ↘ Failed → Compensating → Compensated
```

`OrchestratorStatus` enum: `New`, `Running`, `Failed`, `Compensating`, `Compensated`, `Completed`.

### Execution model

`IOrchestrationRunner` executes steps sequentially. On step failure, compensation runs
in reverse order for all previously completed steps (`CompensateAsync`).

`PersistentStepExecutor` persists step state via `IOrchestratorStateRepository` before
and after each step, enabling resumability.

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
