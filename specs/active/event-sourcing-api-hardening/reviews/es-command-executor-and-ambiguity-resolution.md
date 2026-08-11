---
review-of: task
change: event-sourcing-api-hardening
task: es-command-executor-and-ambiguity-resolution
generated: 2026-08-11
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/es-command-executor-and-ambiguity-resolution

Third re-review (2026-08-11, final API cleanup pass — narrow implementation
correction, no spec refinement; task fingerprint unchanged at
`d954fe7b2fc230a6c80e80ef03af1653f16e19c238053f6bfa2d22df1bfbefd3`, confirming this).
Baseline: this file's prior content (`pass`). Two corrections, neither changing
executor behavior:

- `AggregateDecider` now also implements the new `IAggregateMethodDecider` (added
  under `explicit-event-sourced-command-handler`'s review — see that file), alongside
  its existing `IDecider`. `AddEventSourcing`'s registration for `IDecider` changed
  from a typed `TryAddEnumerable(ServiceDescriptor.Singleton<IDecider, AggregateDecider>())`
  to a factory sharing the same singleton `AggregateDecider` instance the
  `IAggregateMethodDecider` registration also resolves to
  (`Func<IServiceProvider, AggregateDecider>` passed to `ServiceDescriptor.Singleton<IDecider>(...)` —
  C#/CLR delegate covariance keeps the factory's actual `Method.ReturnType` as
  `AggregateDecider`, which is what lets `TryAddEnumerable`'s distinguishability check
  accept it; a directly `IDecider`-typed lambda does not survive that check, confirmed
  by hitting exactly that `ArgumentException` before landing on this shape). One
  physical `AggregateDecider` instance now backs all three of `AggregateDecider`,
  `IAggregateMethodDecider`, and `IDecider` — proven by a new idempotency test
  (`AddEventSourcing_IAggregateMethodDecider_IsResolvableAndSharesTheSameInstanceAsIDecider`).
  No change to the executor itself, ambiguity resolution, or `IDecider`'s own contract.
- `AggregateRepository.ApplyEvents` (task 02's file, not this task's, but the same
  correctness class the owner grouped with this review) was further simplified from
  the prior pass's explicit `IEnumerator`/`MoveNext`/`Current` loop to a plain
  `foreach` over an `Either<Exception, Option<TAggregate>>` accumulator — the actual
  domain semantics (start with no state, evolve per event, short-circuit on the first
  error, empty stream is `Right(None)`) expressed directly rather than through
  first-event-special-cased enumerator mechanics. Same single-enumeration,
  short-circuit-on-failure guarantee as before, now provable without an explicit
  enumerator. New tests in `AggregateRepositoryApplyEventsTests.cs` cover empty/one/
  multiple events and prove a failure on event N leaves the remaining lazy events
  unenumerated.

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 50/50 (46 + 4 new
`ApplyEvents` tests). `IAggregateEvent<TAggregate,TId>` itself was not touched —
confirmed messaging-agnostic, unchanged.

---

Second re-review (2026-08-11, owner code review of the pushed correction). Baseline:
this file's prior content (`pass`). Owner found a real correctness gap:
`IAggregateEvent<TAggregate,TId>` only requires `StreamId` — nothing constrains an
implementer to also derive from `Event` — yet `EventSourcedCommandExecutor` cast every
produced event to `Event` unconditionally (`(Event)@event`) before publishing. A
compile-time-valid `IAggregateEvent` implementation that isn't an `Event` would only
fail at first publish, as an opaque `InvalidCastException`. Owner chose the
non-breaking fix (a compile-time contract change was the alternative, rejected as
requiring a spec amendment and touching an already-stabilized public type). Fixed in
two places: (1) the executor now checks `@event is not Event` and returns a clear
`InvalidOperationException` via `Either.Left` instead of an unchecked cast — this is
the only guard covering a hand-written Level 2 handler, since those aren't discovered
via reflection; (2) `AggregateDeciderExtractor.WithValidReturnType` now rejects, at
decider-discovery time, a decision method whose declared event type implements
`IAggregateEvent<,>` but isn't `Event`-derived, naming the method and type in the
exception, instead of silently excluding it (which would have surfaced later as an
opaque "no decider found"). New tests:
`EventSourcedCommandExecutorTests.ExecuteAsync_ProducedEventIsNotAnEvent_ReturnsLeftWithClearError_NeverThrows`
and
`AggregateDeciderExtractorTests.ExtractDeciders_DecisionMethodProducesAnIAggregateEventThatIsNotAnEvent_ThrowsWithAClearMessage`.
`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 46/46 (44 + these 2).

---

First re-review (2026-08-11, implementation-correction pass). Baseline: this file's prior
content (`pass`). Owner code review requested a documentation-hygiene pass only —
`IEventSourcedCommandExecutor`, `EventSourcedCommandExecutor`,
`MostSpecificCandidateResolver`, `ExpectedStreamState`, `AggregateConcurrencyException`,
and the `AggregateDeciderExtractor`/`AggregateEvolverExtractor` `DeclaredOnly` comments
no longer cite decision IDs (`D2`, `D7`, `D13`, `D17`, `D23`, `D24`, `D25`, `D29`, `D30`)
or "Level 1/Level 2" — they describe the durable contracts and invariants (append-before-
publish ordering, most-specific-wins resolution, the `NoStream`/`Exact` mapping)
directly. No functional change; `dotnet test tests/NEvo.Ddd.EventSourcing.Tests`
continues to pass (43/43 after this pass's other, task 05-attributed fixes).

## Verdict

`pass` — `IEventSourcedCommandExecutor`/`EventSourcedCommandExecutor` (`Executing/`)
extracted: load → authorize (`IAggregateAuthorization<TCommand,TAggregate,TId>`, a new
no-op-by-default hook, D5/D24-D25) → decide (a supplied delegate, no reflection, D30) →
append (`NoStream`/`Exact(loaded.Version)` mapping, D29) → publish (via `IEventPublisher`,
newly wired — previously never called), with append ordered strictly before publish so
a synchronous downstream handler observes the just-appended state (D7/D23).
`DeciderCommandHandler`/`DeciderCommandHandlerAdapter` now route through the executor
and pass `IMessageContext` through. `AggregateDecider`/`AggregateEvolver` now resolve
state-methods deterministically (`MostSpecificCandidateResolver`, D2): most-specific
declaring type wins, an equally-specific tie fails with a named error. Along the way,
found and fixed a real latent bug in `AggregateDeciderExtractor`/`AggregateEvolverExtractor`:
inherited instance methods were re-extracted once per subclass (missing
`BindingFlags.DeclaredOnly`), producing duplicate same-declaring-type candidates that
the old first-match resolution silently tolerated but the new resolver would
misclassify as a false tie for any three-level-deep state hierarchy — fixed by scoping
each type's extraction to its own declared members only (behavior-preserving for every
existing two-level fixture; verified via full solution build + test run before and
after). `dotnet build NEvo.sln` succeeds (0 errors); `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` passes 26/26 (23 carried forward + 3 net new:
executor ordering/concurrency/authorization/mapping tests replace what
`DeciderCommandHandlerTests` used to assert directly, since that responsibility moved
to the executor).

- [x] Acceptance criteria: 10/10
- [x] Scope: compliant (`src/NEvo.Ddd.EventSourcing/**`, `tests/NEvo.Ddd.EventSourcing.Tests/**` only)
- [x] Findings: none unresolved
