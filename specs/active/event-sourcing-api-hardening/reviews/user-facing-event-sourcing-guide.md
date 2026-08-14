---
review-of: task
change: event-sourcing-api-hardening
task: user-facing-event-sourcing-guide
generated: 2026-08-15
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: docs/index.generated.json
    reason: Mechanical output of `node tools/docs.mjs generate`, required for the task's own `docs.mjs check` verification step to pass — never hand-edited. Not declared in the task's `consequential_paths`.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-13
    task_fingerprint: "1d2630b1cd7b6a8c075117075e8170daaaf1c52e7112c91c4dc32be2b02b092e"
  - finding: F2
    path: docs/index.generated.md
    reason: Mechanical output of `node tools/docs.mjs generate`, required for the task's own `docs.mjs check` verification step to pass — never hand-edited. Not declared in the task's `consequential_paths`.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-13
    task_fingerprint: "1d2630b1cd7b6a8c075117075e8170daaaf1c52e7112c91c4dc32be2b02b092e"
  - finding: F3
    path: docs/routing.generated.json
    reason: Mechanical output of `node tools/docs.mjs generate`, required for the task's own `docs.mjs check` verification step to pass — never hand-edited. Not declared in the task's `consequential_paths`.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-13
    task_fingerprint: "1d2630b1cd7b6a8c075117075e8170daaaf1c52e7112c91c4dc32be2b02b092e"
---

# Review: event-sourcing-api-hardening/user-facing-event-sourcing-guide

Re-review: a prior report exists at this path (generated 2026-08-13, verdict `pass`).
Re-verified against current file contents, per policy, rather than trusted from git
status or memory. Working tree is clean; `git diff aa381dfc..HEAD` (task
`baseline_revision`) for the task's `allowed_paths` shows exactly the same 4 files the
prior report described, unchanged since. `node tools/specs.mjs fingerprint
event-sourcing-api-hardening --task user-facing-event-sourcing-guide` was recomputed and
found to differ from the value recorded in F1-F3's prior `task_fingerprint` field
(`063b2f45...` vs. the correct `1d2630b1...`, reproduced identically both at `HEAD` and
at the guide's own landing commit `d7e2e3f` via a throwaway worktree) — the prior value
was never a genuine output of that command. This is a provenance-recording defect in the
prior review artifact, not a scope or content change: the task's own file, its
dependency task files, `owner-decisions.md`, and `overview.md` are all byte-identical to
the guide's landing commit, so the exceptions' substance is unchanged and remains valid;
only the recorded `task_fingerprint` values (F1-F3) are corrected here.

## Verdict

`pass` — every acceptance criterion is met, the only scope deviation is an
owner-accepted, mechanically-generated exception (fingerprint corrected above), and no
unresolved finding remains.

## Checklist

- [x] Acceptance criteria: 7/7
- [x] Scope: resolved
  - 3 owner-approved exceptions recorded
- [x] Findings: none unresolved

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | `docs/index.generated.json` is outside task's `allowed_paths`/`consequential_paths` (`classifyScopeFinding` → `outside-allowed`) | *(accepted — owner-approved exception, not an active blocker)* Regenerated via `node tools/docs.mjs generate` after the guide's front matter/link additions | `scope_exceptions` frontmatter entry F1, `confirmed_by: owner`, `confirmed_at: 2026-08-13` | `docs/index.generated.json` |
| F2 | OWNER_DECISION | accepted | `docs/index.generated.md` is outside task's `allowed_paths`/`consequential_paths` (`classifyScopeFinding` → `outside-allowed`) | *(accepted — owner-approved exception, not an active blocker)* Same generator run as F1 | `scope_exceptions` frontmatter entry F2, `confirmed_by: owner`, `confirmed_at: 2026-08-13` | `docs/index.generated.md` |
| F3 | OWNER_DECISION | accepted | `docs/routing.generated.json` is outside task's `allowed_paths`/`consequential_paths` (`classifyScopeFinding` → `outside-allowed`) | *(accepted — owner-approved exception, not an active blocker)* Same generator run as F1 | `scope_exceptions` frontmatter entry F3, `confirmed_by: owner`, `confirmed_at: 2026-08-13` | `docs/routing.generated.json` |

## Scope compliance

`docs/usage/event-sourcing.md` (new), `docs/usage/README.md`, `docs/usage/queries.md`,
and `docs/usage/example-app-walkthrough.md` are all within the task's declared
`allowed_paths`. No `forbidden_paths` path (`src/**`, `examples/**`,
`docs/development/**`) was touched. `docs/index.generated.json`,
`docs/index.generated.md`, and `docs/routing.generated.json` classify `outside-allowed`
— resolved as owner-accepted exceptions F1-F3 above (mechanical `docs.mjs generate`
output, not hand-authored content).

## Verification

- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 7 acceptance criteria covered, including every "required reader question"
  listed in the task (verified by locating a direct answer to each in
  `docs/usage/event-sourcing.md`).

## Architecture and documentation

`docs/usage/queries.md` now points to `MapQueryEndpoint` (task 08) as the recommended
HTTP Query pattern instead of the stale, now-removed `ServiceA.Api` `GetDocumentQuery`
hand-wiring. `docs/usage/example-app-walkthrough.md`'s Scenario 3 and its
Troubleshooting entry, which described the pre-refactor Document flow inside
`ServiceA.Api`, are corrected to point to the standalone
`NEvo.ExampleApp.Documents.Api` project and its own `WALKTHROUGH.md` — `ServiceA.Api`
maps no Document routes today (confirmed by reading its current `Routes.cs`/`Program.cs`).
No mutable-aggregate, static/functional-decider, or persisted-projection capability is
documented as implemented.

## Tests

Documentation-only task — no automated test coverage required beyond the task's own
declared `node tools/docs.mjs validate`/`check` verification, both passed.
