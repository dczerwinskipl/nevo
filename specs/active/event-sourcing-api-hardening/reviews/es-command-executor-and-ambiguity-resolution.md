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

Re-review (2026-08-11, implementation-correction pass). Baseline: this file's prior
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
