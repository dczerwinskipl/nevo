---
id: event-sourcing-api-hardening.characterize-event-sourcing-baseline
status: draft
change: event-sourcing-api-hardening
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/characterization-and-baseline.md
    - src/NEvo.Ddd.EventSourcing/IAggregateRepository.cs
    - src/NEvo.Ddd.EventSourcing/Evolving/AggregateEvolver.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
  optional:
    - tests/NEvo.Ddd.EventSourcing.Tests/Deciding/AggregateDeciderTests.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/Deciding/DeciderCommandHandlerTests.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/Evolving/AggregateEvolverTests.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/AggregateDeciderEvolverIntegrationTests.cs
allowed_paths:
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Messaging.Web/**
  - examples/**
---

# Task: Characterize Event Sourcing baseline

## Goal

Add characterization tests that lock down today's decider/evolver/repository/
`AddEventSourcing` behavior — the safety net every later task in this change relies on.
This task changes no `src/NEvo.Ddd.EventSourcing/**` production code.

**Scope note (2026-08-10, spec-refine, discovered mid-refinement):** at spec-create
time, `dotnet build NEvo.sln` failed with 5 errors (`InMemoryDocumentEventStore` not
implementing the versioned `IEventStore`; three test files using a stale
`AggregateEvolver` constructor shape). **An external commit
(`5804bb14b`, "Fix build job compile failures only," `copilot-swe-agent[bot]`,
2026-08-10) already landed the mechanical fix for all 5 errors on this branch, before
this task was ever started** — verified: `dotnet build NEvo.sln` now succeeds with 0
errors, and `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes all 10 existing
tests. That commit made `GetDocumentQueryHandler`'s constructor depend on the concrete
`InMemoryDocumentEventStore` type rather than `IEventStore` (since `LoadProjectionAsync`
was never part of the `IEventStore` interface — only a member the workaround itself
adds) — a fact task 09's own `GetDocumentQueryHandler` rewrite must be grounded in
directly, not assumed from this document. **This task's remaining scope is exactly the
"add characterization tests" half — no compile errors are left to fix.**

## Implementation constraints

- Do not assume the 5 build errors described in earlier discovery still exist — verify
  current build/test state directly (`dotnet build`, `dotnet test
  tests/NEvo.Ddd.EventSourcing.Tests`) before writing anything, and report immediately if
  either fails, since that would mean the branch regressed since this scope note was
  written.
- New characterization tests go in `tests/NEvo.Ddd.EventSourcing.Tests/` alongside the
  existing structure (`Deciding/`, `Evolving/`), and must assert *today's* actual
  behavior, including behavior later tasks intend to change (e.g. the current
  first-match ambiguity resolution) — label such tests clearly as characterizing
  pre-hardening behavior so task 03 knows which ones it supersedes rather than
  preserves.
- Do not touch any file under `src/NEvo.Ddd.EventSourcing/**` or
  `examples/ExampleApp/**` — the build/example-app side of this task's original scope
  is already done; this task is now test-only.

## Acceptance criteria

1. `dotnet build NEvo.sln` succeeds with zero errors (automated: `dotnet build` — a
   regression check now, not new work).
2. `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes, including the three test
   files an external commit already fixed (automated).
3. A characterization test proves `DeciderCommandHandler`'s create path (no existing
   aggregate, `Option<TAggregate>.None`) and mutate path (existing aggregate) both still
   work exactly as today (automated).
4. A characterization test proves today's first-match ambiguity behavior for
   decider/evolver resolution — two state types both matching a command/event resolve
   to whichever the current reflection order produces, documented as the pre-hardening
   baseline task 03 will change (automated).
5. A characterization test proves `AddEventSourcing`'s current DI registrations
   (`IEventStore`, `IAggregateRepository`, `IMessageHandlerProvider`,
   `IEvolverRegistry`, `IDeciderRegistry`, `IDecider`, `IAggregateDeciderProvider`,
   `IEvolver`) resolve as expected from a fresh `ServiceCollection` (automated).
6. A characterization test proves a version-mismatch append returns
   `Either<Exception, Unit>.Left` — never a thrown CLR exception — against the current
   `FakeEventStore.AppendEventsAsync` (automated; this is the baseline task 02 changes
   only the exception *type* of, not the return-vs-throw shape).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None.

## Out of scope

- Any redesign of `IEventStore`/`IAggregateRepository` (task 02).
- Removing `InMemoryDocumentEventStore` (task 09).
- Any change to ambiguity-resolution behavior itself (task 03) — this task only proves
  what it does today.
- Any folder/namespace reorganization, and wiring `ICreateAggregateCommand` into any
  resolution logic — both explicitly out of scope for the whole change (D15, D16).
