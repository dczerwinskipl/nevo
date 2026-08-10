---
id: event-sourcing-api-hardening.separate-core-and-integration-folders
status: draft
change: event-sourcing-api-hardening
depends_on:
  - fix-build-and-characterize-baseline
semantic_references:
  decisions: [D10, D11]
  dependency_contracts: [fix-build-and-characterize-baseline]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/characterization-and-reorganization.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/IAggregateRepository.cs
    - src/NEvo.Ddd.EventSourcing/ICreateAggregateCommand.cs
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
  optional:
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Evolving/AggregateEvolver.cs
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - examples/**
---

# Task: Separate core and integration folders; wire ICreateAggregateCommand

## Goal

Reorganize `NEvo.Ddd.EventSourcing` so that types requiring `NEvo.Messaging`/
`NEvo.Messaging.Cqrs` concepts live under a clearly named integration boundary,
separated from the pure aggregate/evolve/decide core (D10) — no project-reference
change, folder/namespace only. In the same task, wire
`ICreateAggregateCommand<TAggregate,TId>` into create-vs-mutate resolution so it stops
being dead code (D11), preserving current behavior for commands that don't implement it.

## Dependencies

- `fix-build-and-characterize-baseline` (task 01) — this task's reorganization must
  preserve every characterization test task 01 wrote.

## Implementation constraints

- Ground the actual core/integration boundary in what each type under
  `src/NEvo.Ddd.EventSourcing/` currently references — `Evolving/`, `Deciding/`, and the
  root aggregate-model types (`IAggregateRoot`, `IAggregateEvent`, `IAggregateCommand`,
  `ICreateAggregateCommand`) are expected to land in the core boundary;
  `Handling/` (the `DeciderCommandHandler`/`DeciderCommandHandlerAdapter`/
  `DeciderCommandHandlerProvider` trio) is expected to land in the integration boundary
  — verify this against actual `using` statements/type references before moving
  anything, since this task's own discovery may find an exception.
- This is a namespace/folder move, not a behavior change — every characterization test
  from task 01 must still pass unmodified in what it asserts (only `using`/namespace
  references in the test files may need updating).
- Wire `ICreateAggregateCommand<TAggregate,TId>` into `DeciderCommandHandler`'s (or
  wherever create-vs-mutate is decided post-reorganization) resolution logic: a command
  implementing this interface is treated as a creation command explicitly; a command
  that doesn't continues to rely on `Option<TAggregate>` being `None`, exactly as today.
  Do not require every command to implement it — this must be additive, not a breaking
  requirement on existing commands.
- Do not change `IAggregateRepository`/`IEventStore`'s member shape in this task — that
  is task 03's job. This task only moves files/namespaces and adds the
  `ICreateAggregateCommand` check.

## Acceptance criteria

1. Every type under `src/NEvo.Ddd.EventSourcing/` that references
   `NEvo.Messaging`/`NEvo.Messaging.Cqrs` types lives under one clearly named
   integration folder/namespace; every type that doesn't, doesn't (inspection, cross-
   checked against actual `using` statements).
2. All of task 01's characterization tests still pass unmodified in their assertions
   (automated: `dotnet test tests/NEvo.Ddd.EventSourcing.Tests`).
3. A test proves a command implementing `ICreateAggregateCommand<TAggregate,TId>` is
   resolved as a creation command explicitly through the new check (automated).
4. A test proves a command not implementing it still resolves create-vs-mutate exactly
   as before this task, via the `Option<TAggregate>.None` path (automated — this is the
   regression check for D11's "preserve current behavior" requirement).
5. `dotnet build` succeeds (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None — the package's folder layout is not currently documented at this level of detail;
task 12 documents the resulting public design, not internal folder structure.

## Out of scope

- Any change to `IAggregateRepository`/`IEventStore` (task 03).
- Any change to ambiguity resolution (task 04).
- An actual package/project split (D10 explicitly defers this).
