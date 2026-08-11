---
review-of: task
change: event-sourcing-api-hardening
task: harden-event-store-and-repository-contracts
generated: 2026-08-11
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - path: examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/InMemoryDocumentEventStore.cs
    finding_id: F1
    reason: >
      D29's IEventStreamStore signature change (ExpectedStreamState param,
      Option-wrapped read result) is mandatory and applies to every implementer.
      InMemoryDocumentEventStore (examples/**, forbidden for this task) also
      implements this interface and is actively DI-registered in Program.cs — the
      task's own forbidden_paths and area doc ("FakeEventStore is the only
      implementation this change ships") did not account for it. Reported to the
      owner mid-implementation; owner chose the minimal mechanical fix (signature-only
      update, no behavior/logic change, no early removal) over leaving IEventStore
      duplicated or leaving the build broken.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-11
    task_fingerprint: f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b
  - path: examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Program.cs
    finding_id: F1
    reason: >
      Same D29 signature change — Program.cs:51 explicitly typed the DI registration
      as IEventStore, which no longer exists post-rename (IEventStreamStore). One-line
      type-name update, same accepted exception as InMemoryDocumentEventStore.cs.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-11
    task_fingerprint: f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b
---

# Review: event-sourcing-api-hardening/harden-event-store-and-repository-contracts

Fourth re-review (2026-08-11, final API cleanup pass — narrow implementation
correction, no spec refinement; task fingerprint unchanged at
`f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b`, confirming this).
`ApplyEvents`'s explicit `IEnumerator`/`MoveNext`/`Current` loop (the previous pass's
fix for multiple enumeration) was replaced with a plain `foreach` over an
`Either<Exception, Option<TAggregate>>` accumulator — same single-enumeration/
short-circuit guarantee, expressed as the actual fold instead of an
enumerator-mechanics workaround. See `es-command-executor-and-ambiguity-resolution`'s
review for the full detail and the new `AggregateRepositoryApplyEventsTests.cs`
coverage (empty/one/multiple events, plus a failure-short-circuits-without-enumerating-
the-remainder proof). `IEventStreamStore`'s doc (this task's own prior fix, below) was
re-checked and remains correct, no further change needed.

---

Third re-review (2026-08-11, owner code review of the pushed correction). Baseline:
this file's prior content (`pass`). Owner found the doc-hygiene pass below had
introduced a factual error: `IEventStreamStore`'s doc said it "does not rehydrate
aggregates and does not load projections — that is `IAggregateRepository`'s
responsibility," which is only half right — `IAggregateRepository` does rehydrate, but
projection loading was intentionally removed from the design entirely (per this task's
own D6 requirement), not relocated to the repository. Fixed: the doc now states
rehydration is `IAggregateRepository`'s responsibility and projection loading is
nobody's responsibility in this design, distinctly. Also fixed, same pass, unrelated to
this doc bug: `AggregateRepository.ApplyEvents()` called `events.Any()`, `.First()`,
then `.Skip(1)` — three separate enumerations of the same `IEnumerable`, harmless for
`FakeEventStore`'s in-memory list but an unnecessary assumption for a future streaming
provider. Rewritten to a single `IEnumerator` pass. No behavior change; `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` passes 46/46 (44 + 2 new, both from the separate
event-cast-safety fix under `es-command-executor-and-ambiguity-resolution`'s review).

---

Second re-review (2026-08-11, implementation-correction pass). Baseline: this file's
prior content (`pass`, F2/F3 resolved below). Owner code review requested a
documentation-hygiene pass only this time: `IAggregateRepository.cs`/`IEventStreamStore`
no longer cite decision IDs (`D6`, `D29`) — they document the storage boundary directly
(`IEventStreamStore` reads/appends raw streams and does not rehydrate or load
projections; `None` means missing, `Some` carries events and observed version;
`IAggregateRepository` composes a store with an evolver). No functional change.

---

First re-review (2026-08-11). Baseline: this file's prior content (`pass`). Owner code
review found two unresolved `FakeEventStore` defects this task's own acceptance criteria
(2, 9, 10) should have caught:

- **F2 (resolved)**: the version check (`TryGetValue` → compare) and the mutation
  (`AddRange`) were two separate steps, not one atomic unit — two genuinely concurrent
  `Exact(1)` appends could both observe version 1 and both pass the check;
  `List<dynamic>` itself is also not thread-safe for concurrent mutation. The only
  existing concurrency test was sequential (writer 1 completes, then writer 2 uses a
  stale `Exact`), which cannot expose this. Fixed: a single `lock` now guards every
  read/append as one atomic critical section. New test
  (`AppendEventsAsync_TwoConcurrentAppendsAtTheSameExpectedVersion_ExactlyOneSucceeds`,
  `FakeEventStoreExpectedStreamStateTests.cs`) uses a `Barrier` to force two threads into
  the critical section simultaneously and asserts exactly one `Right`/one
  `AggregateConcurrencyException`; stable across 5 repeated runs.
- **F3 (resolved)**: the store was keyed by `streamId` alone
  (`ConcurrentDictionary<object, List<dynamic>>`), so two different aggregate types
  sharing the same id value (e.g. `Document(Guid X)` and `OtherAggregate(Guid X)`)
  collided into a single stream — silently mixing incompatible event types (and risking
  a bad cast on load), despite `IEventStreamStore`'s own contract already being generic
  per `TAggregate`. Fixed: keyed by `(Type AggregateType, object StreamId)`. New test
  (`AppendEventsAsync_SameStreamIdValue_DifferentAggregateTypes_DoNotCollide`) proves two
  aggregate types with the same id value get independent streams.

Both fixes are confined to `FakeEventStore` (`ServiceCollectionExtensions.cs`) — no
`IEventStreamStore`/`IAggregateRepository` contract change. `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` passes 38/38 after the fix (up from 21; the
remaining growth is later tasks' own tests, already accounted for in their own review
files).

## Verdict

`pass` — `IEventStore` renamed to `IEventStreamStore` (D6) with `ExpectedStreamState`
(`NoStream`/`Exact(version)`, D29) replacing the bare `expectedVersion: int`;
`AggregateConcurrencyException` (D13) returned — never thrown — on mismatch;
`IAggregateRepository.LoadProjectionAsync` removed entirely; `FakeEventStore`'s
read-creates-a-stream side effect fixed (`TryGetValue` instead of `GetOrAdd` on read,
`Option`-wrapped result distinguishing missing vs. existing streams). No envelope/
correlation/causation/persistence-metadata type introduced (D20-D22); no
`Any`/`IgnoreVersion` case or retry/rebase logic (D29); no call site constructs
`ExpectedStreamState` from a bare `0` literal. `dotnet build NEvo.sln` succeeds (0
errors); `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 21/21 (15 pre-existing
+ 6 new: missing-stream read, no-side-effect-on-read, NoStream success/conflict,
Exact success/conflict).

- [x] Acceptance criteria: 12/12
- [x] Scope: accepted exception (2 entries above — `examples/**` mechanical signature
      fix, owner-approved mid-implementation; no other file outside
      `src/NEvo.Ddd.EventSourcing/**`/`tests/NEvo.Ddd.EventSourcing.Tests/**` touched)
- [x] Findings: none unresolved
