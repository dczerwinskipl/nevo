---
review-of: task
change: nevo-documentation-architecture
task: usage-commands-and-events
generated: 2026-08-03
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-architecture/usage-commands-and-events

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — commit `39d6f9d` stays within `allowed_paths`; both new guides meet acceptance
criteria, and every section of the retired `extending-nevo.md` was cross-checked as
migrated somewhere (maintainer half already in `docs/development/`, consumer half here).

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — clean; no live reference to `extending-nevo.md` remains outside spec/task/archive files | Command output + repo-wide grep, this run | — |

## Scope compliance

Confirmed. Commit touches `docs/guides/extending-nevo.md` (deleted), `docs/usage/
commands.md` (new), `docs/usage/events.md` (new), `change.yaml`. All match
`allowed_paths`.

## Acceptance-criteria coverage

- `commands.md`/`events.md` exist, pass validate, each ends in a stated working result
  — **met**: `commands.md` verifies via observing a `Right` dispatch result;
  `events.md` verifies via observing every registered handler's side effect.
- `docs/guides/extending-nevo.md` no longer exists — **met**.
- No content from `extending-nevo.md` unaccounted for — **met and cross-checked**:
  "Adding a transport"/"Adding a persistence mechanism" (maintainer-facing) already
  present in `docs/development/transport-development.md`/`persistence-development.md`;
  "Adding a handler"/"Adding an event type" (consumer-facing), including the
  `[AllowPermission]` cross-reference and sequential/parallel processing detail, are
  present in `commands.md`/`events.md`.
- `events.md` links to `failure-semantics.md` rather than restating fan-out/failure
  semantics — **met**.

## Architecture and documentation

No architecture/ADR conflict; correctly defers to the single authoritative
`failure-semantics.md` for fan-out semantics.

## Tests

No behavior change; N/A.
