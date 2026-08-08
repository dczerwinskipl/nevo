---
review-of: spec
change: query-support-and-handler-registration-hardening
generated: 2026-08-08
verdict: changes-required
ready_for_approval: false
implementation_allowed: false
unresolved_required_fixes: 9
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: "e8aac11d6546278cfdf57dd05ec57f681ee67a24b1415f74d0c880b1a4cea7f9"
task_fingerprints:
  command-event-adapter-characterization: "756a9440b10011be5d8ea9d6aca1544786663800825fd3690bb5b0a294d3dd2b"
  shared-handler-invocation-adapter: "998c2ff3dbbf3a57e5922c5cda5ea5c205260f68a2392ee5393d69ba8302b19a"
  registration-idempotency-hardening: "96d6e37224d90ec022a108b16867dcfec8629ffc8ce0972faf0c7b7626b30619"
  query-abstractions-and-discovery: "b06fecf33ab2c669770720f511ae6cee5118f6b0a419d1cb4296174accc3781c"
  query-dispatch-and-registration: "12260abeb4b4160e6fba5cf6a3df8672bf2f31589f9b9d6c1b8b5965701d63ad"
  documentation-and-example: "d8fb91940bf5f209529022816195789a7444e6d1b270b10a973d3e513c614911"
---

# Review: query-support-and-handler-registration-hardening

## Verdict

`changes-required` — 9 unresolved `AUTO_FIX` findings (3 broken cross-references in
`owner-decisions.md`, 6 missing `semantic_references.decisions` declarations, one per
task) block readiness; no owner decision is open.

No reliable previous-file baseline is available. Performing a fresh review of the
current specification.

## Implementation readiness

- May implementation start now? No.
- Are the relevant tasks `approved` in `change.yaml`? No — all six tasks
  (`command-event-adapter-characterization` through `documentation-and-example`) are
  `status: draft`.
- What has to happen first? Resolve F1–F9 below (all mechanical/`AUTO_FIX`), then
  `/nevo-ai:spec-approve` can run.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | D1's "Affected artifacts" names an existing task file | `tasks/03-query-abstractions-and-discovery.md` does not exist — the real file for that task is `tasks/04-query-abstractions-and-discovery.md` (task 03 is `registration-idempotency-hardening`). Fix the filename in D1. | Directory listing: `tasks/03-registration-idempotency-hardening.md`, `tasks/04-query-abstractions-and-discovery.md`; `owner-decisions.md` D1 "Affected artifacts" line reads `tasks/03-query-abstractions-and-discovery.md` | `owner-decisions.md` (D1) |
| F2 | AUTO_FIX | first-review | D2's "Affected artifacts" names an existing task file | `tasks/04-registration-idempotency-hardening.md` does not exist — the real file for that task is `tasks/03-registration-idempotency-hardening.md` (task 04 is `query-abstractions-and-discovery`). Fix the filename in D2. | Directory listing (as above); `owner-decisions.md` D2 "Affected artifacts" line reads `tasks/04-registration-idempotency-hardening.md` | `owner-decisions.md` (D2) |
| F3 | AUTO_FIX | first-review | D4's "Affected artifacts" names an existing task file | `tasks/03-query-abstractions-and-discovery.md` does not exist — same broken reference as F1, from a different decision. Fix the filename in D4. | Directory listing (as above); `owner-decisions.md` D4 "Affected artifacts" line reads `tasks/03-query-abstractions-and-discovery.md` | `owner-decisions.md` (D4) |
| F4 | AUTO_FIX | first-review | Task 01's content relies on an owner decision it does not declare in `semantic_references.decisions` | Task 01's own Goal cites `(D5)` by number ("Create `tests/NEvo.Messaging.Cqrs.Tests` (D5)") but the task's frontmatter has no `semantic_references` block at all — add `semantic_references: { decisions: [D5] }` | Read `tasks/01-command-event-adapter-characterization.md` line 37 and full frontmatter (no `semantic_references` key present) | `tasks/01-command-event-adapter-characterization.md` |
| F5 | AUTO_FIX | first-review | Task 02's content relies on an owner decision it does not declare in `semantic_references.decisions` | Task 02's own Goal cites `(D1)` by number ("Replace them with one shared... `MessageHandlerAdapter`... (D1)") but the task's frontmatter has no `semantic_references` block — add `semantic_references: { decisions: [D1] }` | Read `tasks/02-shared-handler-invocation-adapter.md` line 45 and full frontmatter (no `semantic_references` key present) | `tasks/02-shared-handler-invocation-adapter.md` |
| F6 | AUTO_FIX | first-review | Task 03's content relies on an owner decision it does not declare in `semantic_references.decisions` | Task 03's own Goal cites `(D2)` by number ("Make `AddCommands()` and `AddEvents()` safe to call more than once... (D2)") but the task's frontmatter has no `semantic_references` block — add `semantic_references: { decisions: [D2] }` | Read `tasks/03-registration-idempotency-hardening.md` line 31 and full frontmatter (no `semantic_references` key present) | `tasks/03-registration-idempotency-hardening.md` |
| F7 | AUTO_FIX | first-review | Task 04's content relies on owner decisions it does not declare in `semantic_references.decisions` | Task 04's own Goal cites `(D1, D4)` by number ("...zero changes required to `MessageHandlerExtractor` (D1, D4)") but the task's frontmatter has no `semantic_references` block — add `semantic_references: { decisions: [D1, D4] }` | Read `tasks/04-query-abstractions-and-discovery.md` line 36 and full frontmatter (no `semantic_references` key present) | `tasks/04-query-abstractions-and-discovery.md` |
| F8 | AUTO_FIX | first-review | Task 05's content relies on an owner decision it does not declare in `semantic_references.decisions` | Task 05's own Implementation constraints cite `(D3)` by number ("No new composing method is introduced (D3)") but the task's frontmatter has no `semantic_references` block — add `semantic_references: { decisions: [D3] }` | Read `tasks/05-query-dispatch-and-registration.md` line 71 and full frontmatter (no `semantic_references` key present) | `tasks/05-query-dispatch-and-registration.md` |
| F9 | AUTO_FIX | first-review | Task 06's content relies on an owner decision it does not declare in `semantic_references.decisions` | Task 06's own Implementation constraints require updating `docs/development/testing-strategy.md` to add `NEvo.Messaging.Cqrs.Tests` — a direct, load-bearing consequence of D5 (which itself names `tasks/06-documentation-and-example.md` under "Affected artifacts"), but the task's frontmatter has no `semantic_references` block — add `semantic_references: { decisions: [D5] }` | Read `tasks/06-documentation-and-example.md` lines 59–61 and full frontmatter (no `semantic_references` key present); `owner-decisions.md` D5 "Affected artifacts" already names this task | `tasks/06-documentation-and-example.md` |

None of F4–F9 are caught by `node tools/specs.mjs validate` — `semantic_references` is an
optional frontmatter block, so its complete absence produces no schema error; this is
exactly the omission-detection gap `references/review-policy.md` § "Semantic-reference
completeness (model review)" exists to close. The practical consequence of leaving F4–F9
unresolved: `computeTaskFingerprint` folds `semantic_references.decisions` text into a
task's fingerprint (D18) — with the block absent, a future edit to D1–D5's own text
(e.g. a superseding decision) will **not** change any of these six tasks' fingerprints,
so a stale review could still appear fresh under the fingerprint check.

## Specification readiness criteria — summary

- Task graph: `depends_on` resolves and is acyclic (`node tools/specs.mjs validate`,
  clean).
- `allowed_paths`/`forbidden_paths`: present and non-overlapping for every task
  (inspected all six; no ambiguity found).
- Acceptance criteria: testable throughout — each carries or is covered by an explicit
  `Verification` command block, or an `inspection:`-appropriate manual check (e.g. the
  ExampleApp walkthrough in task 06).
- Owner decisions: D1–D5 all recorded in `owner-decisions.md` with a real ≥2-option
  analysis, rationale, and consequences (`references/solution-option-analysis.md`
  satisfied) — no gated decision left as a single proposed approach.
- Documentation impact: identified and scoped to task 06
  (`docs/usage/queries.md`, `docs/reference/packages/NEvo.Messaging.Cqrs.md`,
  `docs/development/architecture-overview.md`, `docs/development/testing-strategy.md`).
- Semantic-reference completeness: **not satisfied** — see F4–F9.

## Gating validation

- `node tools/specs.mjs validate` — passed (`Validated 7 changes — no errors.`).
- `node tools/docs.mjs validate` — passed (`Validated 60 documents — no errors.`, run
  because this change touches `docs/**` in task 06).

## Non-gating repository check

- `node tools/specs.mjs check` — passed (`Specs valid and indexes are current.`).
- `node tools/docs.mjs check` — failed: `stale: docs/index.generated.md`. This is
  **not** self-caused by this change — this change has not yet touched any file under
  `docs/` (`git status --porcelain -- docs/` is empty; the last commit to touch
  `docs/index.generated.md` was PR #16, unrelated and already merged). Recorded here as
  informational context only; it does not affect this review's verdict.

## Architecture and documentation

No conflict found between this spec's proposed architecture and
`docs/development/architecture-overview.md`, `docs/development/package-boundaries.md`,
or `docs/development/coding-conventions.md`. The one documented behavior change flagged
in `overview.md` § Compatibility (repeated `AddCommands()`/`AddEvents()` calls becoming
safe instead of throwing) is correctly scoped to task 06's documentation update.
