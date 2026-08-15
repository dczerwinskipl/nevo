# Area: Characterization and baseline

## Responsibility

Lock down today's decider/evolver/repository/registration behavior with
characterization tests, before any other area changes this package's behavior.

**Scope note (2026-08-10, spec-refine):** this area originally also owned a
core/integration folder reorganization and wiring `ICreateAggregateCommand<TAggregate,
TId>` into create-vs-mutate resolution. Both were removed from scope per D15/D16
(`owner-decisions.md`) — external review found neither was required by any actual task
in this change, and both were speculative scope ("cleaner for a future package split,"
"complete an abstraction because it exists") this specification's own principles argue
against.

**Second scope note (2026-08-10, discovered mid-refinement):** this area also
originally owned fixing 5 `dotnet build` compile errors present at spec-create time.
**An external commit already fixed them** (`5804bb14b`, "Fix build job compile failures
only," `copilot-swe-agent[bot]`, landed on this branch before this refinement pass) —
verified: `dotnet build NEvo.sln` now succeeds with 0 errors, `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` passes all 10 existing tests. This area is now
characterization-only; no build/compile work remains.

## Current state

`dotnet build NEvo.sln` succeeds (0 errors) — the 5 compile errors present at
spec-create time (`InMemoryDocumentEventStore` not implementing the versioned
`IEventStore`; three test files using a stale `AggregateEvolver` constructor shape)
were fixed by `5804bb14b` before this refinement pass. That commit changed
`GetDocumentQueryHandler`'s constructor to depend on the concrete
`InMemoryDocumentEventStore` type rather than `IEventStore` (`LoadProjectionAsync` was
never part of the `IEventStore` interface — only a member the workaround class itself
adds) — `areas/documents-example-service.md`/task 09 must be grounded in this actual
current shape, not the pre-fix assumption.

Existing ES tests (`tests/NEvo.Ddd.EventSourcing.Tests/`) cover: decider resolution
(create/mutate success and error paths, `Deciding/AggregateDeciderTests.cs`),
`DeciderCommandHandler.HandleAsync` (`Deciding/DeciderCommandHandlerTests.cs`), evolve
success/error (`Evolving/AggregateEvolverTests.cs`), and one end-to-end decide+evolve
integration test — all 10 tests currently pass. **Gaps**: no test for two state types
both declaring a decider/evolver for the same command/event (the ambiguity behavior
task 03 will change), no test of `AggregateRepository`/`FakeEventStore`'s
concurrency-conflict path, no test of `AddEventSourcing`'s DI wiring, no test touching
`ApprovedDocument` (terminal state, zero deciders) at all — this area's remaining work.

`IAggregateRepository.AppendEventsAsync`/`IEventStore.AppendEventsAsync` already return
`EitherAsync<Exception, Unit>` (`IAggregateRepository.cs:7,22`) — concurrency conflicts
already flow through `Either`'s `Left`, never a CLR throw; a characterization test
should lock this in explicitly since D13's own earlier wording was ambiguous about it
(corrected during spec-refine, `owner-decisions.md`).

`ICreateAggregateCommand<TAggregate,TId>` (`ICreateAggregateCommand.cs:3-6`) remains
declared, documented in `docs/development/event-sourcing.md` as "creation commands,"
and used in one test fixture (`DeciderCommandHandlerTests.cs:105`) — but never branched
on in production code. Per D16, this specification does not change that: today's
create-vs-mutate dispatch, inferred entirely from `Option<TAggregate>` being `None`
(`DeciderCommandHandler.HandleAsync`, `Handling/DeciderCommandHandler.cs:14-34`), is
characterized as-is and left unchanged.

## Requirements

- Add characterization tests proving today's decider/evolver/repository/
  `AddEventSourcing` behavior, before any behavior in this package changes. (No compile
  errors remain to fix — see scope note above.)
- Characterize the current first-match ambiguity behavior explicitly (task 03 changes
  it) and the current `Either`-based concurrency-conflict return shape explicitly (task
  02 changes only the exception *type* used, not the return-vs-throw shape).
- Do not reorganize files or wire `ICreateAggregateCommand` — both are explicitly out of
  scope (D15, D16).

## Constraints

- No behavior change is permitted without a preceding characterization test proving the
  prior behavior, per `docs/development/testing-strategy.md` and
  `docs/development/event-sourcing.md`'s own "characterization tests are needed before
  changes" instruction.
- Do not use this area as an opportunity to redesign `IEventStore`/`AggregateEvolver`'s
  public shape (that redesign is task 02/03's job, sequenced after characterization).

## Interfaces and boundaries

- Consumes: current `src/NEvo.Ddd.EventSourcing/**`,
  `tests/NEvo.Ddd.EventSourcing.Tests/**`.
- Exposes to every later area: the characterized baseline every other task starts from.

## Area-specific acceptance criteria

1. `dotnet build NEvo.sln` succeeds with zero errors.
2. `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes, including new
   characterization tests for: decider/evolver resolution success, `DeciderCommandHandler`
   create and mutate paths, `AddEventSourcing`'s DI registrations, the current (soon to
   change) first-match ambiguity behavior — documented as characterizing the
   *pre-hardening* state, superseded by task 03's own tests — and the current
   `Either<Exception, Unit>.Left` (never-throw) shape of a concurrency mismatch.
3. No file under `src/NEvo.Ddd.EventSourcing/**` is moved, renamed, or otherwise
   reorganized by this area (D15).
4. `ICreateAggregateCommand<TAggregate,TId>` is not referenced by any new production
   code in this area (D16).

## Dependencies

None — this area is the change's starting point. Every other area depends on it (task
01 at minimum).

## Out of scope

- Any folder/namespace reorganization (D15).
- Wiring `ICreateAggregateCommand<TAggregate,TId>` into any resolution logic (D16).
- Any change to `IEventStore`/`IAggregateRepository`'s member shape (area
  `persistence-boundary`).
- Any change to ambiguity resolution's actual algorithm beyond characterizing today's
  behavior (area `shared-es-execution-and-explicit-handler`, task 03).
- Removing `InMemoryDocumentEventStore` (area `documents-example-service`, task 09) —
  this area only needs it to compile against the current `IEventStore` interface,
  reproducing (not redesigning) its existing behavior.
