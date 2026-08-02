---
review-of: task
change: nevo-documentation-foundation
task: developer-and-extension-guides
generated: 2026-08-02
verdict: pass
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-foundation/developer-and-extension-guides

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — no unresolved blocking findings; all acceptance criteria met and verified.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | `docs/packages/NEvo.Messaging.md` (task 6) covers `NEvo.Messaging`'s public surface completely | It doesn't: `NEvo.Messaging.Events` (`Event`, `IEventPublisher`, `IEventHandler<T>`, `AddEvents()`) is part of `NEvo.Messaging` itself but was never mentioned in that doc — discovered while grounding "Adding an event type" in this task | `grep -n "Event\|AddEvents" docs/packages/NEvo.Messaging.md` — zero matches, this run | Not fixed here — `docs/packages/NEvo.Messaging.md` is outside this task's `allowed_paths` and this is a missing-section gap (not a false claim, unlike the D9-D11 pattern), so it's logged for task `navigation-and-validation`'s planned systematic doc-quality audit rather than triggering another scope widening this task |
| F2 | INFORMATIONAL | — | — | `extending-nevo.md`'s "Adding a persistence mechanism" section explicitly contrasts a complete example (`NEvo.Messaging.EntityFramework`) with an incomplete one (`NEvo.Orchestrating.EntityFramework`, from task 9) as a "what to avoid" reference, rather than only showing the happy path | Cross-referenced against both packages' already-committed docs | `docs/guides/extending-nevo.md` § "Adding a persistence mechanism" |
| F3 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — 42 documents, no errors | Command output, this run | — |
| F4 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — 4 changes, no errors | Command output, this run | — |
| F5 | INFORMATIONAL | — | — | Full tools test suite: 144/144 passing | `node --test tools/tests/*.test.mjs`, this run | — |
| F6 | INFORMATIONAL | — | — | Gating validation: passed. Non-gating repository check: passed — both indexes regenerated as part of this diff | `node tools/docs.mjs check` / `node tools/specs.mjs check`, this run | — |

F1 is a punch-list item for task `navigation-and-validation`, not a blocker for this
task's own verdict — it doesn't affect either of this task's two deliverables' own
correctness.

## Scope compliance

Diff touches: `docs/guides/extending-nevo.md`, `docs/development/coding-conventions.md`
(both new, both in `allowed_paths`), `specs/active/nevo-documentation-foundation/**`
(`change.yaml` status transition only), plus regenerated `docs/index.generated.*` and
`specs/index.generated.json`. Confirmed via `git status --porcelain --
docs/development/`: only `coding-conventions.md` changed under `docs/development/` —
`commit-conventions.md`, `git-workflow.md`, `local-setup.md`, `pull-requests.md`, and
`testing.md` were read (required/cross-linked) but not modified.
`forbidden_paths` (`src/**`, `tests/**`, `examples/**`, and the 5 named
`docs/development/*.md` files) were respected.

## Acceptance-criteria coverage

- `docs/guides/extending-nevo.md` passes `node tools/docs.mjs validate` under the
  `guide` type; every extension-point claim cites an existing package by name and file
  — **met**: transport → `NEvo.Messaging.Web` (`RestExternalMessageDispatchStrategy`,
  `RoutesExtensions`), persistence → `NEvo.Messaging.EntityFramework`
  (`IInboxDbContext`/`IOutboxDbContext`, `EntityFrameworkMessageInbox`/`Outbox`,
  `InboxEntityTypeConfiguration`/`OutboxEntityTypeConfiguration`), handler →
  `NEvo.Messaging.Cqrs` (`ICommandHandler<T>`), event type → `NEvo.Messaging.Events`
  (`Event`, `IEventHandler<T>`, `IEventPublisher`, `AddEvents`) — no invented
  extension point.
- `docs/development/coding-conventions.md` passes `node tools/docs.mjs validate` under
  the `development` type — **met**.
- Neither document duplicates the other's core content — **met**: `extending-nevo.md`
  cross-links `coding-conventions.md` for standing rules instead of restating them;
  `coding-conventions.md` cross-links `extending-nevo.md` for process instead of
  including step-by-step instructions.
- No file under `docs/development/` other than `coding-conventions.md` is modified by
  this task — **met** (see Scope compliance).

Additional task-specific constraint, verified directly:
- `coding-conventions.md` covers `Either<Exception, T>` (citing
  `docs/ai/specification-workflow.md:179`'s passing reference as the gap this fills)
  and cross-links, rather than duplicates, `package-boundaries.md`'s
  dependency-direction rule.

## Architecture and documentation

No `docs/architecture/**` content changed by this task. `package-boundaries.md` was
cross-referenced, not duplicated.

## Tests

No behavior change — documentation-only task. `extending-nevo.md`'s "Verification"
section points to each worked-example package's own test project and to
`testing.md`'s characterization-tests guidance, rather than asserting untested claims.
