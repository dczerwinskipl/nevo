---
id: packages.nevo-orchestrating-entityframework
type: package
title: NEvo.Orchestrating.EntityFramework
status: experimental
dependencies:
  - NEvo.Orchestrating
summary: >
  EF entity shape and table configuration for orchestrator state. Does not itself
  implement IOrchestratorStateRepository — see Limitations.
---

# NEvo.Orchestrating.EntityFramework

**Status: experimental.** Carried from [`NEvo.Orchestrating`](NEvo.Orchestrating.md)'s
own `experimental` status, since this package exists purely to support it.

## Purpose

`NEvo.Orchestrating.EntityFramework` provides an EF Core entity shape
(`OrchestratorStateEf`) and table configuration for persisting orchestrator state in a
relational database. **It is small and incomplete** — see "Limitations" before assuming
it's a drop-in persistence solution.

## Responsibilities

- Define the EF-mapped entity `OrchestratorStateEf` (a flattened, EF-friendly shape:
  `DataJson` as a `string?` rather than a generic `TData` property).
- Configure the `OrchestratorStates` table (`OrchestratorStateTypeConfiguration`: table
  name, schema `"nEvo"`, non-clustered primary key on `Id`).

## Dependencies

Depends only on `NEvo.Orchestrating` — confirmed against
`src/NEvo.Orchestrating.EntityFramework/NEvo.Orchestrating.EntityFramework.csproj`'s
single `ProjectReference`. **Not** a dependency of `NEvo.EntityFramework` — this is one
of three parallel EF integrations in the repository (see
[`NEvo.EntityFramework.md`](NEvo.EntityFramework.md) § Related packages), not built on
top of it.

## Public surface

Grounded directly in `src/NEvo.Orchestrating.EntityFramework/**/*.cs` — this is the
entire package (3 files).

```csharp
public class OrchestratorStateEf
{
    public Guid Id { get; set; }
    public string OrchestratorType { get; set; }
    public OrchestratorStatus Status { get; set; }
    public string? LastStep { get; set; }
    public string? LastCompensatedStep { get; set; }
    public string? DataJson { get; set; }
}

public class OrchestratorStateTypeConfiguration : IEntityTypeConfiguration<OrchestratorState>
{
    public void Configure(EntityTypeBuilder<OrchestratorState> builder);
    // ToTable("OrchestratorStates", "nEvo"); HasKey(x => x.Id).IsClustered(false);
}
```

Note the mismatch: `OrchestratorStateTypeConfiguration` configures
`NEvo.Orchestrating`'s own `OrchestratorState` (the non-generic base class), not
`OrchestratorStateEf` — the two types in this package are not wired to each other in
source. See "Limitations".

## Configuration

**No DI registration helper exists.**
`src/NEvo.Orchestrating.EntityFramework/ServiceCollectionExtensions.cs` is an empty
`public static class ServiceCollectionExtensions { }`.

## Basic usage

There is no complete, working usage to show — see "Limitations". At most, a consumer
could apply the table configuration in their own `DbContext`:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.ApplyConfiguration(new OrchestratorStateTypeConfiguration());
}
```

## Advanced usage

Not applicable — this package has no registered services or documented extension
points beyond the EF configuration above.

## Limitations

- **No `IOrchestratorStateRepository` implementation exists in this package, or
  anywhere in this repository.** Confirmed: no class in `src/` implements the
  interface (`grep -rn "class.*IOrchestratorStateRepository" src/` — zero matches
  outside compiled binaries). `NEvo.Orchestrating`'s `PersistentStepExecutor` (see
  [`NEvo.Orchestrating.md`](NEvo.Orchestrating.md)) needs an
  `IOrchestratorStateRepository` to do anything — this package does not supply one.
- **`OrchestratorStateTypeConfiguration` configures the wrong type for this package's
  own `OrchestratorStateEf` entity** — it implements `IEntityTypeConfiguration
  <OrchestratorState>` (from `NEvo.Orchestrating`), not `IEntityTypeConfiguration
  <OrchestratorStateEf>`. `OrchestratorStateEf` has no EF configuration of its own in
  this package, and nothing here maps between the two shapes.
- In short: this package currently amounts to scaffolding — an entity class and a table
  configuration for a *different* type — not a usable EF persistence layer for
  orchestration state. Building real persistence requires writing an
  `IOrchestratorStateRepository` implementation and reconciling the entity mismatch
  above yourself.

## Related packages

- [`NEvo.Orchestrating`](NEvo.Orchestrating.md) — the package this one is meant to
  extend with EF persistence (see "Limitations" for how incomplete that support
  currently is).

## Examples and tests

No dedicated `tests/NEvo.Orchestrating.EntityFramework.Tests/` project exists in this
repository today.
