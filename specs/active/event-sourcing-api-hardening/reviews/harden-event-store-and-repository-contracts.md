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
