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
