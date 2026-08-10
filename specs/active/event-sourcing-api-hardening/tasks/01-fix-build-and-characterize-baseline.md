---
id: event-sourcing-api-hardening.fix-build-and-characterize-baseline
status: draft
change: event-sourcing-api-hardening
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/characterization-and-reorganization.md
    - src/NEvo.Ddd.EventSourcing/IAggregateRepository.cs
    - src/NEvo.Ddd.EventSourcing/Evolving/AggregateEvolver.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/InMemoryDocumentEventStore.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/Evolving/AggregateEvolverTests.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/AggregateDeciderEvolverIntegrationTests.cs
  optional:
    - tests/NEvo.Ddd.EventSourcing.Tests/Deciding/AggregateDeciderTests.cs
    - tests/NEvo.Ddd.EventSourcing.Tests/Deciding/DeciderCommandHandlerTests.cs
allowed_paths:
  - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/InMemoryDocumentEventStore.cs
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - src/NEvo.Messaging.Authorization/**
  - src/NEvo.Messaging.Web/**
---

# Task: Fix build and characterize baseline behavior

## Goal

Get `dotnet build NEvo.sln` passing again (currently 5 errors), and add
characterization tests that lock down today's decider/evolver/repository/
`AddEventSourcing` behavior — the safety net every later task in this change relies on.
This task changes no `src/NEvo.Ddd.EventSourcing/**` production code; the build is fixed
entirely from the example-app and test sides.

## Implementation constraints

- `InMemoryDocumentEventStore.cs` must be fixed to actually implement the current
  `IEventStore` interface (`AppendEventsAsync<TAggregate,TId>(TId, events, int
  expectedVersion, ct)`, `LoadEventsStreamAsync<TAggregate,TId>(TId, ct)`), reproducing
  its existing hand-projection behavior as closely as possible rather than redesigning
  it — it is a workaround scheduled for removal in task 10, not a target for
  improvement here. Read `IAggregateRepository.cs` for the exact current member
  signatures before editing; do not assume the signatures described in
  `docs/development/event-sourcing.md` (that doc is stale and corrected in task 12).
- The three failing test files (`AggregateEvolverTests.cs:14,35`,
  `AggregateDeciderEvolverIntegrationTests.cs:21`) must be fixed by constructing
  `IOptions<AggregateExtractorConfiguration>` correctly (e.g.
  `Options.Create(new AggregateExtractorConfiguration { AggregateTypes = [...] })` or
  the equivalent current shape of that options class) rather than reverting
  `AggregateEvolver`'s constructor signature — the constructor is current, real code;
  the tests are stale.
- New characterization tests go in `tests/NEvo.Ddd.EventSourcing.Tests/` alongside the
  existing structure (`Deciding/`, `Evolving/`), and must assert *today's* actual
  behavior, including behavior later tasks intend to change (e.g. the current
  first-match ambiguity resolution) — label such tests clearly as characterizing
  pre-hardening behavior so task 04 knows which ones it supersedes rather than
  preserves.
- Do not touch any file under `src/NEvo.Ddd.EventSourcing/**` — if fixing the build
  turns out to require a production-code change beyond `InMemoryDocumentEventStore.cs`,
  stop and report it rather than expanding scope silently (this would mean the build
  breakage has a different root cause than discovery found).

## Acceptance criteria

1. `dotnet build NEvo.sln` succeeds with zero errors (automated: `dotnet build`).
2. `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes, including the three
   previously-failing test files (automated: `dotnet test tests/NEvo.Ddd.EventSourcing.Tests`).
3. A characterization test proves `DeciderCommandHandler`'s create path (no existing
   aggregate, `Option<TAggregate>.None`) and mutate path (existing aggregate) both still
   work exactly as today (automated).
4. A characterization test proves today's first-match ambiguity behavior for
   decider/evolver resolution — two state types both matching a command/event resolve
   to whichever the current reflection order produces, documented as the pre-hardening
   baseline task 04 will change (automated).
5. A characterization test proves `AddEventSourcing`'s current DI registrations
   (`IEventStore`, `IAggregateRepository`, `IMessageHandlerProvider`,
   `IEvolverRegistry`, `IDeciderRegistry`, `IDecider`, `IAggregateDeciderProvider`,
   `IEvolver`) resolve as expected from a fresh `ServiceCollection` (automated).
6. `InMemoryDocumentEventStore` compiles against the current `IEventStore` interface
   with no behavior change from its pre-fix hand-projection logic beyond what's strictly
   required to satisfy the interface signature (inspection).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None.

## Out of scope

- Any redesign of `IEventStore`/`IAggregateRepository` (task 03).
- Removing `InMemoryDocumentEventStore` (task 10).
- Any change to ambiguity-resolution behavior itself (task 04) — this task only proves
  what it does today.
