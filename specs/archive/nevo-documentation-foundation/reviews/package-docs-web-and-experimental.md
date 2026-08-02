---
review-of: task
change: nevo-documentation-foundation
task: package-docs-web-and-experimental
generated: 2026-08-02
verdict: pass
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-foundation/package-docs-web-and-experimental

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — no unresolved blocking findings; all acceptance criteria met and verified.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | first-review | `docs/packages/NEvo.Orchestrating.md` (written task 4) accurately describes what `NEvo.Orchestrating.EntityFramework` provides | It didn't: claimed an EF-based `IOrchestratorStateRepository` implementation exists; no class anywhere in `src/` implements that interface — the package provides only an EF entity shape and (mismatched) table configuration | `grep -rn "class.*IOrchestratorStateRepository" src/` — zero matches outside compiled binaries, this run | `owner-decisions.md` D11 (extended to package-doc-to-package-doc corrections, logged as an instance rather than a fresh decision — same rationale as the architecture-doc cases) |
| F2 | INFORMATIONAL | — | — | `NEvo.Ddd.EventSourcing`'s `AddEventSourcing()` registers a default `IEventStore` literally named `FakeEventStore` whose methods are no-ops (append does nothing and reports success; both load methods always return "not found") — confirmed no other `IEventStore` implementation exists in `src/` | Direct read of `ServiceCollectionExtensions.cs`, this run | `docs/packages/NEvo.Ddd.EventSourcing.md` § Limitations |
| F3 | INFORMATIONAL | — | — | `AggregateEvolver`'s evolver map is a `static` field, lazily built once via `??=` — a second instance constructed with different aggregate types silently reuses the first instance's map (source has an acknowledging `// TODO` comment) | Direct read of `Evolving/AggregateEvolver.cs`, this run | `docs/packages/NEvo.Ddd.EventSourcing.md` § Limitations |
| F4 | INFORMATIONAL | — | — | `NEvo.Orchestrating.EntityFramework`'s `OrchestratorStateTypeConfiguration` configures `IEntityTypeConfiguration<OrchestratorState>` (from `NEvo.Orchestrating`), not `IEntityTypeConfiguration<OrchestratorStateEf>` (this package's own entity) — the two types in this package are unconnected in source | Direct read of both files, this run | `docs/packages/NEvo.Orchestrating.EntityFramework.md` § Public surface, Limitations |
| F5 | INFORMATIONAL | — | — | `NEvo.Web.md`'s "Basic usage" example is grounded in real interfaces; a real inconsistency was found and documented rather than smoothed over: `RestClientServiceBase.GetAsync` puts `queryParams` in the request body (`FormUrlEncodedContent`) while `PostAsync` correctly appends them to the URL query string | Direct read of `Rest/RestClientServiceBase.cs`, this run | `docs/packages/NEvo.Web.md` § Limitations |
| F6 | INFORMATIONAL | — | — | `NEvo.Ddd.EventSourcing.md`'s "Basic usage" example is adapted from a real repository fixture (`tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs`), not invented, after an initial draft used a hypothetical example — corrected before commit | Self-caught during this run | `docs/packages/NEvo.Ddd.EventSourcing.md` § Basic usage |
| F7 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — 37 documents, no errors | Command output, this run | — |
| F8 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — 4 changes, no errors | Command output, this run | — |
| F9 | INFORMATIONAL | — | — | Full tools test suite: 144/144 passing | `node --test tools/tests/*.test.mjs`, this run | — |
| F10 | INFORMATIONAL | — | — | Gating validation: passed. Non-gating repository check: passed — both indexes regenerated as part of this diff | `node tools/docs.mjs check` / `node tools/specs.mjs check`, this run | — |

F1 is resolved as part of this task's own diff (corrected `NEvo.Orchestrating.md`
directly).

## Scope compliance

Diff touches: `docs/packages/NEvo.Web.md`, `docs/packages/NEvo.Ddd.EventSourcing.md`,
`docs/packages/NEvo.Orchestrating.EntityFramework.md` (all new, in `allowed_paths`),
`docs/packages/NEvo.Orchestrating.md` (amended into `allowed_paths` per the D11
extension — see F1), `specs/active/nevo-documentation-foundation/**` (`change.yaml`
status transition, `owner-decisions.md` D11 log entry, the task file itself), plus
regenerated `docs/index.generated.*` and `specs/index.generated.json`. `forbidden_paths`
(`src/**`, `tests/**`, `examples/**`) were read extensively for verification but not
modified — confirmed by `git status --porcelain`.

## Acceptance-criteria coverage

- All 3 docs pass `node tools/docs.mjs validate` under the `package` type — **met**.
- After this task, `docs/packages/` contains exactly 13 per-package documents (plus the
  separate `classification.md` index, not counted in "the 13-package set" per the
  task's own goal statement — "completing the full 13-package set") — **met**;
  confirmed via `node tools/docs.mjs find --type package --format json`: 14 entries
  total, 13 named after real `src/` packages plus `classification.md`.
- Neither experimental package is presented as production-ready — **met**;
  `NEvo.Ddd.EventSourcing.md` and `NEvo.Orchestrating.EntityFramework.md` both carry
  `status: experimental` and lead with explicit stability caveats, and both document
  concrete, verified reasons not to treat them as usable out of the box (F2, F4).

Additional task-specific constraints, verified directly:
- `NEvo.Web.md` describes the real `Client/` contents (HTTP/OAuth/REST client
  helpers), matching `README.md`'s corrected description from task
  `architecture-corrections`, and does not describe middleware/routing capability.
- `NEvo.Ddd.EventSourcing.md` covers `Handling/`, `Deciding/`, `Evolving/`
  (deciders, evolvers, `IEventStore`, `IAggregateRoot`), carries `experimental` status,
  and states the `NEvo.Messaging.Cqrs`/`NEvo.Messaging` dependency.
- `NEvo.Orchestrating.EntityFramework.md` covers `OrchestratorStateEf`, carries
  `experimental` status, cross-references `NEvo.Orchestrating.md`, and confirms
  (re-verified) it depends only on `NEvo.Orchestrating`, not `NEvo.EntityFramework`.

## Architecture and documentation

No `docs/architecture/**` content changed by this task. `event-sourcing.md` and
`orchestration.md` were cross-referenced without being found stale this time (unlike
task 4, which found and fixed `orchestration.md` drift).

## Tests

No behavior change — documentation-only task. `NEvo.Ddd.EventSourcing.md`'s "Basic
usage" and "Examples and tests" cite real, directly-confirmed fixture and test files
rather than invented ones (F6). Neither `NEvo.Web` nor `NEvo.Orchestrating.
EntityFramework` has a dedicated test project in this repository; both docs' "Examples
and tests" sections state this rather than fabricating a citation.
