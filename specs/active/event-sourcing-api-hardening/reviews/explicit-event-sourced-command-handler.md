---
review-of: task
change: event-sourcing-api-hardening
task: explicit-event-sourced-command-handler
generated: 2026-08-11
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/explicit-event-sourced-command-handler

Second re-review (2026-08-11, owner code review of the pushed correction). Baseline:
this file's prior content (`pass`). Owner found `IEventSourcedCommandHandler<,,>`'s own
doc instructed callers to "inject `Deciding.IDecider` and call `DecideAsync`" to
delegate to the aggregate-method convention — but `IDecider` is the *general* decision-
mechanism abstraction `IDeciderRegistry` collects as `IEnumerable<IDecider>`, not a
stable name for the convention specifically. This resolves correctly today only because
`AggregateDecider` is the sole registered `IDecider`; it silently stops being
unambiguous the moment a second decision mechanism is ever registered — exactly the
kind of accidental coupling D17/D30 exist to prevent (the convention becoming
indistinguishable from the core abstraction). Fixed, non-breaking (additive DI
registration only): `AddEventSourcing` now also registers the concrete
`AggregateDecider` as itself (`TryAddSingleton<AggregateDecider>()`), alongside its
existing `IDecider` collection registration — a Level 2 handler can now inject
`AggregateDecider` directly, unambiguous regardless of how many decision mechanisms
exist. `IEventSourcedCommandHandler<,,>`'s doc, the `ApproveDocumentEventSourcedHandler`/
`CreateDocumentEventSourcedHandler` test fixtures, and their constructing test now use
the concrete type. Also cleaned up stale task/AC-number comments in the touched test
files, matching this task's earlier documentation-hygiene pass but extended to tests
this time (owner: code should be understandable without the spec, tests included).
`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 46/46.

---

First re-review (2026-08-11, implementation-correction pass). Baseline: this file's prior
content (`pass`). Owner code review requested a documentation-hygiene pass and one
naming fix, no correctness bugs in this task's own diff:

- The default aggregate-aware authorization implementation was renamed
  `NoOpAggregateAuthorization` → `AllowAllAggregateAuthorization` — its prior name and
  doc comment ("works before task 07 adds real policy logic; task 07 replaces this
  registration") made a legitimate default policy read as temporary scaffolding.
  Investigated making it `internal` (the codebase has no existing `internal`
  type/`InternalsVisibleTo` precedent anywhere in `src/`, and several tests construct it
  directly) — kept it `public`, matching the codebase's existing convention, and
  documented it as what it is: the default aggregate-aware authorization used when no
  command-specific policy is supplied. DI registration and every test reference updated
  (mechanical rename).
- `IEventSourcedCommandHandler<,,>`, `EventSourcedCommandHandlerAdapter`, and
  `IAggregateAuthorization<,,>`'s XML docs no longer cite decision IDs (`D1`, `D24`,
  `D31`) or "Level 1/Level 2" — they describe the durable contract (what
  `Option<TAggregate>` means, the single-managed-write-target constraint, when the
  authorization hook runs and what returning `Left` does) instead of the task graph that
  produced them.

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 43/43 after this pass (no test
assertions changed, only the type rename).

## Verdict

`pass` — `IEventSourcedCommandHandler<TCommand,TAggregate,TId>` (Level 2, D1) added:
receives `Option<TAggregate>` (`Some` rehydrated / `None` creation, D24, never `null`),
may inject any orchestration dependency, may delegate to Level 1's own decision-method
discovery by injecting `IDecider` directly (no new discovery mechanism). Manages exactly
one stream per invocation by construction (D31) — its own shape offers no second
executor-managed write target. `EventSourcedCommandHandlerAdapter` routes it through
task 03's shared executor exactly as `DeciderCommandHandlerAdapter` does for Level 1, so
load/append/publish is never duplicated; handler registration/discovery is explicitly
task 05's concern, not wired here. Example fixtures
(`ApproveDocumentEventSourcedHandler`/`CreateDocumentEventSourcedHandler`) prove
delegation-not-duplication for both the mutate and create paths, and an injected
`IReviewNotesProvider` proves the orchestration-dependency case. Along the way, found
and fixed a second pre-existing dormant bug: `EditableDocument.Approve` (test fixture)
recursively called itself — dead code that happened to never execute in any test before
this task's handler became the first caller of the `Approve` path; fixed by removing the
self-call. `dotnet build NEvo.sln` succeeds (0 errors); `dotnet test
tests/NEvo.Ddd.EventSourcing.Tests` passes 31/31 (26 carried forward + 5 new).

- [x] Acceptance criteria: 8/8
- [x] Scope: compliant (`src/NEvo.Ddd.EventSourcing/**`, `tests/NEvo.Ddd.EventSourcing.Tests/**` only)
- [x] Findings: none unresolved
