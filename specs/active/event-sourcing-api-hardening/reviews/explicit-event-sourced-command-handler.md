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

Fourth re-review (2026-08-11, three small owner findings on the previous pass).
Baseline: this file's prior content (`pass`). Task fingerprint unchanged
(`c2bb7a58f177719c16e0ed18d11421defd394cb802f68c45ac4e3bd18ae95e66`) — no spec
refinement; `implementation.review_revision`/`self_check.revision` refreshed to
current HEAD (`b1730c643d9b12fbf1421f20d98283d093bb4c9c`), same process fix noted in
`es-command-executor-and-ambiguity-resolution`'s review.

- **`IEventSourcedCommandHandler<,,>`'s doc shortened.** It still told readers "inject
  `Deciding.IDecider` only when genuinely decider-mechanism-agnostic" — a path with no
  actual reason to exist now that `IAggregateMethodDecider` gives application code an
  unambiguous contract; `IDecider` remains what `IDeciderRegistry` collects and may
  have several implementations, so suggesting it to a Level 2 handler author at all
  just reopens the ambiguity `IAggregateMethodDecider` exists to close. Cut down to:
  "An explicit Event Sourced handler may return events directly or delegate domain
  decision logic to `IAggregateMethodDecider`." No `IDecider` mention remains anywhere
  in this doc.
- **DI registration simplified** (see `es-command-executor-and-ambiguity-resolution`'s
  review for the full before/after and rationale) — `ServiceCollectionExtensions.cs`
  is shared/attributed across this task and that one; the concrete `AggregateDecider`
  type is no longer registered at all, so it is not resolvable as a dependency by any
  path (stricter than the previous round, which registered it so two factories could
  share its instance).

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 50/50 — including
`Adapter_ResolvesTheHandlerThroughDI_WithOnlyIAggregateMethodDeciderRegistered_NoConcreteAggregateDeciderNeeded`,
which was already asserting the concrete type is absent from that test's own
hand-rolled container and needed no change.

---

Third re-review (2026-08-11, final API cleanup pass — narrow implementation
correction, no spec refinement; task fingerprint unchanged at
`c2bb7a58f177719c16e0ed18d11421defd394cb802f68c45ac4e3bd18ae95e66`, confirming this —
matches task 04's own text, which already asked for "a helper the handler can call...
so the transition logic itself is written once," without naming a concrete type, so
introducing this interface implements that existing requirement rather than changing
it). Baseline: this file's prior content (`pass`). The previous pass's fix (inject the
concrete `AggregateDecider` directly) corrected the ambiguity risk but turned a
reflection/discovery implementation detail into the Level 2 public dependency — the
public use case is "execute the aggregate-method decision convention," not "give me
this concrete class." Fixed:

- Added `IAggregateMethodDecider` (`Deciding/`) — a small, purpose-specific interface
  for exactly the aggregate-method convention capability, distinct from `IDecider`
  (the general, possibly-multi-implementation registry abstraction). `AggregateDecider`
  now implements both; its own `DecideAsync<TAggregate,TId>` signature already matched
  what `IAggregateMethodDecider` needed, so no new method was written, only the
  additional interface declaration.
- `IEventSourcedCommandHandler<,,>`'s doc, and the `ApproveDocumentEventSourcedHandler`/
  `CreateDocumentEventSourcedHandler` test fixtures, now reference
  `IAggregateMethodDecider` — never the concrete `AggregateDecider`, never the general
  `IDecider`.
- `AddEventSourcing` registers `AggregateDecider` as itself only so
  `IAggregateMethodDecider`'s and `IDecider`'s factories can resolve the same
  instance — not as a public dependency (see
  `es-command-executor-and-ambiguity-resolution`'s review for the DI registration
  shape and why the delegate-covariance factory approach was needed).
- New test
  (`Adapter_ResolvesTheHandlerThroughDI_WithOnlyIAggregateMethodDeciderRegistered_NoConcreteAggregateDeciderNeeded`)
  builds a `ServiceProvider` registering only `IAggregateMethodDecider` (no concrete
  `AggregateDecider` anywhere in that container) and resolves
  `IEventSourcedCommandHandler<CreateDocument,Document,Guid>` successfully — proving
  consumer code genuinely does not need the concrete type, not just asserting it by
  inspection.
- Separately, `AllowAllAggregateAuthorization<,,>` (this task's own prior rename) is
  now `internal sealed` — the earlier pass investigated this and kept it `public`
  reasoning there was no `internal`/`InternalsVisibleTo` precedent in `src/`; the owner
  has since decided the default-Null-Object-as-public-dependency concern outweighs
  that precedent gap. Every test that previously constructed
  `AllowAllAggregateAuthorization<,,>` directly (four files, same reason as
  `IAggregateMethodDecider` above — a stub needed to satisfy a constructor parameter,
  not testing authorization itself) was moved to a new test-only
  `AlwaysAllowAuthorization<,,>` fixture instead of adding `InternalsVisibleTo` — this
  proves the internal type's own behavior only through the public
  `IAggregateAuthorization<,,>` registration/resolution path
  (`AllowAllAggregateAuthorizationTests.cs`), matching this task's own established
  "prove through public execution" pattern rather than depending on the concrete
  default. No `InternalsVisibleTo` was added anywhere.

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 50/50.

---

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
