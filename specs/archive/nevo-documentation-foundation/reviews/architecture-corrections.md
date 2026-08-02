---
review-of: task
change: nevo-documentation-foundation
task: architecture-corrections
generated: 2026-08-02
verdict: pass
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-foundation/architecture-corrections

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — no unresolved blocking findings; all acceptance criteria met and verified.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | first-review | `docs/packages/classification.md` is outside task 3's original `allowed_paths` but contains the same stale `NEvo.Web` fact D3 corrects | Task 2 ran before task 3 and copied the pre-correction description | Diff-and-grep confirmed `classification.md` line 58 matched the old README wording verbatim before this task's edit; owner chose to fix it now (D9); `allowed_paths` amended | `owner-decisions.md` D9, `tasks/03-architecture-corrections.md` |
| F2 | INFORMATIONAL | — | — | Every flagged `ProjectReference` re-verified directly against `src/*/*.csproj` (not inferred from the old diagram): `NEvo.Messaging.EntityFramework` → `NEvo.Messaging` only (no `NEvo.EntityFramework` edge); `NEvo.Orchestrating.EntityFramework` → `NEvo.Orchestrating` only (no `NEvo.EntityFramework` edge); `NEvo.Web.Authorization` → `NEvo.Authorization` only (no `NEvo.Web` edge); `NEvo.Messaging.Web` → `NEvo.Core`, `NEvo.Messaging`, `NEvo.Messaging.Cqrs`, `NEvo.Web` (four real references, previously only one shown) | `grep ProjectReference` across all 13 `src/*/*.csproj`, this run | `docs/architecture/package-boundaries.md` |
| F3 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — 24 documents, no errors | Command output, this run | — |
| F4 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — 4 changes, no errors | Command output, this run | — |
| F5 | INFORMATIONAL | — | — | Full tools test suite: 144/144 passing | `node --test tools/tests/*.test.mjs`, this run | — |
| F6 | INFORMATIONAL | — | — | Gating validation: passed. Non-gating repository check: passed — both indexes regenerated as part of this diff after the `classification.md`/spec-file edits | `node tools/docs.mjs check` / `node tools/specs.mjs check`, this run | — |

## Scope compliance

Diff touches: `docs/architecture/package-boundaries.md`, `README.md`,
`docs/packages/classification.md` (amended into `allowed_paths` via D9 — see F1),
`specs/active/nevo-documentation-foundation/**` (`change.yaml` status transition,
`owner-decisions.md` D9, the task file itself), plus regenerated
`docs/index.generated.*` and `specs/index.generated.json`.

All within the task's amended `allowed_paths`. `docs/architecture/overview.md` (in
`forbidden_paths`, and explicitly out of scope per D3's maturity-table deferral) was not
touched — confirmed by `git status --porcelain`. No other `forbidden_paths` (`src/**`,
`tests/**`, `examples/**`, `tools/**`) were touched.

## Acceptance-criteria coverage

- `docs/architecture/package-boundaries.md`'s dependency diagram matches the actual
  `ProjectReference` graph for all 13 packages — **met**; every one of the 13 packages'
  `.csproj` files was read directly this run (see F2), and the diagram was corrected to
  remove two false edges (`NEvo.Messaging.EntityFramework`→`NEvo.EntityFramework`,
  `NEvo.Web.Authorization`→`NEvo.Web`), fix `NEvo.Orchestrating.EntityFramework`'s parent
  (was nested under `NEvo.EntityFramework`, now correctly under `NEvo.Orchestrating`),
  add the previously-undocumented `NEvo.Messaging.Web`→`NEvo.Messaging.Cqrs` edge, and
  amend rule 4 to name that edge as an explicit, documented exception rather than a
  silent contradiction.
- `README.md`'s `NEvo.Web` description matches its actual contents — **met**; confirmed
  via `find src/NEvo.Web -name "*.cs"`: every real source file is under
  `src/NEvo.Web/Client/*` (namespace `NEvo.Web.Client`) — an HTTP client wrapper with
  OAuth/no-auth strategies and a REST client base, not ASP.NET Core middleware/routing as
  the old description claimed.
- `node tools/docs.mjs validate` passes — **met**.

## Architecture and documentation

`docs/architecture/overview.md` was correctly left untouched (forbidden, and its
maturity-table conflict with `README.md` is explicitly deferred per D3 — recorded, not
silently dropped). `docs/architecture/package-boundaries.md`'s "Potential concern"
section (`NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Cqrs`) was re-checked against the
same `.csproj` re-verification and remains accurate — no change needed there.

## Tests

No behavior change — documentation-only task; `node tools/docs.mjs validate` and the
direct `.csproj`/source-file re-verification are the acceptance mechanism (see above).
