# Area: Characterization and reorganization

## Responsibility

Get `feature/event-sourcing` building again, lock down today's decider/evolver/
repository/registration behavior with characterization tests, then reorganize
`NEvo.Ddd.EventSourcing` into core vs. integration folders and complete the
`ICreateAggregateCommand<TAggregate,TId>` marker interface — all before any other area
changes this package's behavior.

## Current state

`dotnet build NEvo.sln` fails with 5 errors on this branch:

- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/InMemoryDocumentEventStore.cs:18` — does not implement `IEventStore.AppendEventsAsync<TAggregate,TId>`/`LoadEventsStreamAsync<TAggregate,TId>` (CS0535). Its own header comment already calls it a workaround pending "PR #10 (real event-sourcing repository)."
- `tests/NEvo.Ddd.EventSourcing.Tests/Evolving/AggregateEvolverTests.cs:14,35` and `tests/NEvo.Ddd.EventSourcing.Tests/AggregateDeciderEvolverIntegrationTests.cs:21` — `new AggregateEvolver([typeof(Document)])` (CS9174): `AggregateEvolver`'s only constructor takes `IOptions<AggregateExtractorConfiguration>` (`Evolving/AggregateEvolver.cs:15`), not a `Type[]`; a collection expression cannot construct that interface.

Existing ES tests (`tests/NEvo.Ddd.EventSourcing.Tests/`) cover: decider resolution
(create/mutate success and error paths, `Deciding/AggregateDeciderTests.cs`),
`DeciderCommandHandler.HandleAsync` (`Deciding/DeciderCommandHandlerTests.cs`), evolve
success/error (`Evolving/AggregateEvolverTests.cs`, currently non-compiling), and one
end-to-end decide+evolve integration test. **Gaps**: no test for two state types both
declaring a decider/evolver for the same command/event (the ambiguity behavior task 04
will change), no test of `AggregateRepository`/`FakeEventStore`'s concurrency-conflict
path, no test of `AddEventSourcing`'s DI wiring, no test touching `ApprovedDocument`
(terminal state, zero deciders) at all.

`ICreateAggregateCommand<TAggregate,TId>` (`ICreateAggregateCommand.cs:3-6`) is declared,
documented in `docs/development/event-sourcing.md` as "creation commands," and used in
one test fixture (`DeciderCommandHandlerTests.cs:105`) — but never branched on in any
production code. Today's create-vs-mutate dispatch is inferred entirely from
`Option<TAggregate>` being `None` (`DeciderCommandHandler.HandleAsync`,
`Handling/DeciderCommandHandler.cs:14-34`).

Package layout today (`src/NEvo.Ddd.EventSourcing/`): root (`IAggregateRoot.cs`,
`IAggregateRepository.cs`, `IAggregateEvent.cs`, `IAggregateCommand.cs`,
`ICreateAggregateCommand.cs`, `ServiceCollectionExtensions.cs`), `Evolving/`, `Deciding/`,
`Handling/` (`DeciderCommandHandler`, `DeciderCommandHandlerAdapter`,
`DeciderCommandHandlerProvider`). `Handling/` is the only subfolder whose types reference
`NEvo.Messaging`/`NEvo.Messaging.Cqrs` concepts (`IMessageHandler`,
`ActivatorUtilities.CreateInstance`, message adaptation) — everything under `Evolving/`
and `Deciding/` operates purely on `IAggregateRoot<TId>`/`IAggregateEvent<TAggregate,TId>`/
reflection.

## Requirements

- Task 01 fixes the 5 compile errors listed above using the current, real interfaces
  (not by reverting them) and adds characterization tests proving today's decider/
  evolver/repository/`AddEventSourcing` behavior, before any behavior in this package
  changes.
- Task 02 reorganizes the package so that types depending on
  `NEvo.Messaging`/`NEvo.Messaging.Cqrs` live under a clearly named integration
  boundary, and types expressible purely in terms of `IAggregateRoot`/
  `IAggregateEvent`/`IAggregateCommand`/reflection do not (D10) — a namespace/folder
  change, not a project-reference change.
- Task 02 also wires `ICreateAggregateCommand<TAggregate,TId>` into create-vs-mutate
  resolution so it is no longer dead code (D11), preserving current behavior for
  commands that don't implement it.

## Constraints

- No behavior change is permitted without a preceding characterization test proving the
  prior behavior, per `docs/development/testing-strategy.md` and
  `docs/development/event-sourcing.md`'s own "characterization tests are needed before
  changes" instruction.
- The folder reorganization (D10) must not change the project's external dependency
  graph — `NEvo.Ddd.EventSourcing`'s `ProjectReference` to `NEvo.Messaging.Cqrs` is
  unchanged; only internal namespace/folder structure moves.
- Fixing the 5 compile errors is mechanical repair, not a design decision — do not use
  it as an opportunity to redesign `IEventStore`/`AggregateEvolver`'s public shape (that
  redesign is task 03/04's job, sequenced after characterization).

## Interfaces and boundaries

- Consumes: current `src/NEvo.Ddd.EventSourcing/**`, `examples/ExampleApp/.../Documents/*`,
  `tests/NEvo.Ddd.EventSourcing.Tests/**`.
- Exposes to every later area: the fixed, building baseline and the reorganized
  core/integration folder layout that tasks 03-11 target.

## Area-specific acceptance criteria

1. `dotnet build NEvo.sln` succeeds with zero errors.
2. `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes, including new
   characterization tests for: decider/evolver resolution success, `DeciderCommandHandler`
   create and mutate paths, `AddEventSourcing`'s DI registrations, and the current (soon
   to change) first-match ambiguity behavior — documented as characterizing the
   *pre-hardening* state, superseded by task 04's own tests.
3. Every type under the reorganized package still compiles against its existing public
   callers (the example app, once task 10 lands) with no unintended public-surface
   change beyond what D11 introduces.
4. `ICreateAggregateCommand<TAggregate,TId>` is referenced by production dispatch logic;
   a characterization test proves a command implementing it and a command not
   implementing it both still resolve create-vs-mutate identically to before this
   change.

## Dependencies

None — this area is the change's starting point. Every other area depends on it (task
01 at minimum).

## Out of scope

- Any change to `IEventStore`/`IAggregateRepository`'s member shape (area
  `persistence-boundary`).
- Any change to ambiguity resolution's actual algorithm beyond characterizing today's
  behavior (area `shared-es-execution-and-explicit-handler`, task 04).
- Removing `InMemoryDocumentEventStore` (area `documents-example-service`, task 10) —
  task 01 only needs it to compile against the current `IEventStore` interface,
  reproducing (not redesigning) its existing behavior, since example-app removal is a
  separate, later, larger change.
