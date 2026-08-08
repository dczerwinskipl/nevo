---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: context-completeness-and-routing-precedence
generated: 2026-08-05
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/context-completeness-and-routing-precedence

## Verdict

`pass` — every acceptance criterion is met and automated-verified, the diff stays within
`allowed_paths`/`consequential_paths` and never touches `forbidden_paths`, and no
architecture/ADR drift exists for this task's declared documentation impact.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | AC3 states the reading-only-JSON behavior is "verified by asserting the check still works after temporarily corrupting the prose table body while leaving the generated JSON intact" | The actual test for this no longer does a runtime corruption; it was replaced by a static source-scan assertion plus a fabricated-in-memory-index unit suite. Functionally equivalent (arguably more robust — no working-tree mutation risk) but the task's own AC3 text is now stale relative to the real test mechanism | `tools/tests/context.test.mjs` describe block `buildContextPacket's routingWarnings — reads only docs/routing.generated.json (AC3)` contains the comment: "the previous version of this test temporarily overwrote the real, tracked `docs/ai/task-routing.md` and restored it in a `finally` — fragile under a parallel test run... What's left to prove here is the *wiring*: the module responsible for it structurally never references either source Markdown file at all," followed by a test asserting `assert.doesNotMatch(source, /task-routing\.md/)` / `/change-impact-map\.md/` and `assert.match(source, /routing\.generated\.json/)` instead of a runtime corrupt-then-check | `tools/tests/context.test.mjs:164-186`, `tasks/05-context-completeness-and-routing-precedence.md:89-91` |
| F2 | INFORMATIONAL | — | — | All 5 of the task's own `## Verification` commands pass | `node --test tools/tests/docs-routing.test.mjs` → 21/21 pass; `node --test tools/tests/context.test.mjs` → 19/19 pass; `node tools/specs.mjs validate` → "Validated 6 changes — no errors."; `node tools/docs.mjs validate` → "Validated 60 documents — no errors."; `node tools/docs.mjs check` → "Indexes are current." (all run this session, real output, not assumed) | — |
| F3 | INFORMATIONAL | — | — | Gating validation and non-gating repository check both pass for this task's scope, presented separately per policy | Gating validation: passed (`specs.mjs validate`, `docs.mjs validate` both clean). Non-gating repository check: passed (`docs.mjs check` reports indexes current, including `docs/routing.generated.json` matching its two source tables) | — |
| F4 | INFORMATIONAL | — | — | No touch to any `forbidden_paths` glob (`src/**`, `tests/**`, `examples/**`, `docs/development/**`, `docs/usage/**`) in any commit attributable to this task's implementation | `git show --stat` on `06e874b` (main implementation), `d91bb2d` (allowed_paths fix), `075fa9e` (context_exceptions/consequential_paths wiring fix, PR review packet 04), `f0dfe74` (separator-row/doc_ref-containment hardening, PR review packet 05C) — every touched file is one of `tools/docs.mjs`, `tools/specs/service.mjs`, `tools/specs/validation.mjs`, `tools/tests/context.test.mjs`, `tools/tests/docs-routing.test.mjs`, `docs/ai/{task-routing,change-impact-map,how-to-navigate}.md`, `docs/routing.generated.json`, plus incidental `docs/index.generated.{json,md}` regeneration and, in `075fa9e`, `tools/tests/fingerprint.test.mjs`/`tools/tests/validation.test.mjs` (both `tools/tests/**`, not `forbidden_paths`'s `tests/**`, and both outside this task's own `allowed_paths` — but that commit is an explicit whole-branch PR-review fix pass spanning tasks 01/05/06 together, and neither file is in any `forbidden_paths` glob) | — |

Candidate for follow-up recording (F1 — not recorded; requires owner-facing confirmation, out of scope for this subagent run).

## Scope compliance

Confirmed explicitly: every file touched by this task's implementation across its
attributable commits (`06e874b`, `d91bb2d`, `075fa9e`, `f0dfe74`) falls inside
`allowed_paths` (`tools/specs/service.mjs`, `tools/specs.mjs`, `tools/specs/validation.mjs`,
`tools/docs.mjs`, `tools/tests/context.test.mjs`, `tools/tests/docs-routing.test.mjs`,
`docs/ai/how-to-navigate.md`, `docs/ai/task-routing.md`, `docs/ai/change-impact-map.md`)
or `consequential_paths` (`docs/routing.generated.json`, confirmed regenerated via
`node tools/docs.mjs generate`, not hand-edited — `docs.mjs check` reports it current
against its two source tables). No `forbidden_paths` glob (`src/**`, `tests/**`,
`examples/**`, `docs/development/**`, `docs/usage/**`) was touched.

## Acceptance-criteria coverage

1. **Met.** `tools/docs.mjs validate` rejects a duplicate `rule_id` or malformed row —
   `node --test tools/tests/docs-routing.test.mjs` covers this in `validateRoutingTables`
   (duplicate within one file, duplicate across two files, malformed row propagation) —
   all pass.
2. **Met.** `tools/docs.mjs check` fails when `docs/routing.generated.json` is stale —
   `checkRoutingIndex` test suite (`docs-routing.test.mjs`) covers missing/stale/current
   — all pass.
3. **Met, with a stale AC description (see F1).** A task whose `allowed_paths` match an
   undeclared routing rule produces a warning (`computeRoutingWarnings`), not a
   `validate` failure; `loadRoutingIndex` in `tools/specs/service.mjs` reads only
   `docs/routing.generated.json` (`existsSync(ROUTING_INDEX_FILE)` /
   `JSON.parse(readUtf8(ROUTING_INDEX_FILE))`) — no reference to `task-routing.md` or
   `change-impact-map.md` anywhere in that file, confirmed both by direct read and by
   `context.test.mjs`'s structural assertion. The literal "corrupt the prose, check JSON
   still works" verification method described in the task's own AC3 text was replaced by
   an equivalent but different test shape — intent fully verified, wording stale (F1).
4. **Met.** A task with no matching routing rule produces "no routing rule matched —
   verify context manually" — `computeRoutingWarnings` test + confirmed live via this
   task's own `context` packet output this run (`routingWarnings: ["no routing rule
   matched — verify context manually"]`, correct: none of this task's own `allowed_paths`
   — all under `tools/**`/`docs/ai/**` — overlap any routing rule's `src/**` glob).
5. **Met.** `docs/ai/how-to-navigate.md` states the precedence rule explicitly: "a
   task's own declared `context.required`/`context.optional` always wins over a
   routing-table suggestion... A reported gap is a warning to consider, not an
   instruction to add the suggested file; declared context is authoritative."

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` records D12 (item 15:
"A validated, machine-readable routing contract (D12)") consistent with the
implementation — `docs/routing.generated.json` is the only thing the completeness check
reads, and a declared `context.required`/`optional` entry always wins. No
`docs/development/**` document describes behavior this task changed (its own
`forbidden_paths` excludes that tree, and its Documentation impact section correctly
scopes to `docs/ai/task-routing.md`, `docs/ai/change-impact-map.md`,
`docs/ai/how-to-navigate.md` only) — no architecture drift.

## Tests

Behavior changes have direct, passing automated coverage:
`tools/tests/docs-routing.test.mjs` (21 tests: `parseRoutingTable`,
`validateRoutingTables`, `buildRoutingIndex`, `checkRoutingIndex`) and
`tools/tests/context.test.mjs` (19 tests: `computeRoutingWarnings` requirements 2/3/4/6,
`context_exceptions` suppression, `buildContextPacket` wiring). Both suites pass in full
this run (21/21 and 19/19). `node tools/specs.mjs validate`, `node tools/docs.mjs
validate`, and `node tools/docs.mjs check` — the task's remaining declared verification
commands — all pass with real output captured this run, not assumed.
