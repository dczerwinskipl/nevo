---
review-of: spec
change: dashboard-loading-and-progress
generated: 2026-08-15
verdict: changes-required
ready_for_approval: false
implementation_allowed: false
unresolved_required_fixes: 3
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 58527c6f613ba3279cd3f685087350de1cf6b28bc31bf707fdf42c15c553f1d2
task_fingerprints:
  dashboard-data-loading-contracts: 694a7b21fd498580a13339f2c4f061b77f45bca47426f4d7f439b447baa336d5
  pr-file-manifest-and-diff-hydration: beb5ff1f4eae123959c7c5bd56eb17a2d874181bb8a292044b897de723043e1b
  changes-grouping-and-filtering: 400c2f42d81ee0d8942640e4982f11b78932be981bb9fa083bd237d184e64b99
  operation-progress-contract-and-transport: 2a9d97bfb30869c8bcc731d8602e0fbb447157a813ea74abe6b8a6c38eb423e8
  cli-step-instrumentation-gate-and-verification: b29aa717985937d58ce35fcc284a601acb916d5a5dbac77abb35fba34dd87e31
  cli-step-instrumentation-tests-and-audits: a973f361f52c45bc0edadeb768c04da16a7ea8022834bd36d367cb78b8d9600d
  dashboard-operation-progress-ui: b5783db594725943b9b9605a6d5dd2070f71441c94c497e5f7e63e144621a91a
---

# Review: dashboard-loading-and-progress

No reliable previous-file baseline is available. Performing a fresh review of the
current specification.

## Verdict

`changes-required` — three unresolved `AUTO_FIX` findings (row 3 of the decision table);
no unresolved owner decisions or clarifications, and `node tools/specs.mjs validate`
passes, so nothing here rises to `blocked` or requires the owner.

## Implementation readiness

- May implementation start now? No.
- Are the relevant tasks `approved` in `change.yaml`? No — all 7 tasks are `status:
  draft`.
- What has to happen first? F1, F2, F3 below.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | Every task's `semantic_references` declares the owner decisions, constraints, and dependency contracts its own content actually relies on (D26/D29) | No task in this change declares `semantic_references` at all, and `overview.md`'s "Constraints" section is unnumbered prose, so `semantic_references.constraints` entries couldn't resolve even if added (`validateSemanticReferences` resolves against a numbered `C<n>.` list, per `tools/specs/validation.mjs:205`). Every task's own prose already cites D1/D2/D3 by number, and every `depends_on` entry is an uncited dependency contract. Fix: number `overview.md`'s Constraints bullets (C1: no gate/status/workflow-semantics change; C2: breaking changes to the dashboard's own HTTP contract are acceptable; C3: new external dependencies need owner approval, see D1; C4: Node 22.x runtime), then add `semantic_references` to each task: `01` → `decisions:[D3]`, `constraints:[C1,C2]`; `02` → `decisions:[D3]`, `constraints:[C2]`, `dependency_contracts:[dashboard-data-loading-contracts]`; `03` → `decisions:[D1]`, `constraints:[C3]`, `dependency_contracts:[pr-file-manifest-and-diff-hydration]`; `04` → `constraints:[C1]`; `05` → `decisions:[D2]`, `constraints:[C1]`, `dependency_contracts:[operation-progress-contract-and-transport]`; `06` → `decisions:[D2]`, `constraints:[C1]`, `dependency_contracts:[operation-progress-contract-and-transport]`; `07` → `decisions:[D2]`, `dependency_contracts:[operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]`. | Read every task's front matter just now — no task has a `semantic_references` key; read `overview.md`'s "## Constraints" section — four bullets, none prefixed `C1.`/`C2.`/etc. (contrast `specs/active/ai-sessions-live-chat-integration/overview.md:50-69`, which numbers every constraint `C1.`-`C20.` for exactly this mechanism) | `overview.md`, `tasks/01`-`07` |
| F2 | AUTO_FIX | first-review | The spec establishes, for every piece of client-visible data, how it reaches the frontend (a route, or an existing payload it's folded into) | `areas/changes-grouping-and-filtering.md` and `tasks/03-changes-grouping-and-filtering.md` require a "per-project config" (`changeView.groups`/`generatedFiles`) that must live in the target repo's filesystem (stated requirement: "usable by a consumer repo other than NEvo itself," i.e. not something the browser bundle can embed at build time) but never state that the server reads and serves it — no route, no mention of folding it into an existing response (e.g. the task-02 files-manifest, or `/api/dashboard`). Task 03's `allowed_paths` includes `tools/dashboard/server/**`, which only makes sense if some server change is needed, but nothing in the task's Goal/Implementation constraints/Acceptance criteria says what that change is. Every other data flow in this spec names at least the existence of a route (exact naming left flexible, e.g. "an implementation detail — e.g. `GET .../content/:docId`") — this one names none at all. Fix: add one sentence to the area and task stating the server reads the project config file and exposes it to the frontend, exact route/shape left flexible like every other route in this spec. | Read `areas/changes-grouping-and-filtering.md` Requirements/Interfaces sections and `tasks/03-changes-grouping-and-filtering.md` Goal/Implementation constraints/Acceptance criteria just now — no route, response field, or server-read step is named anywhere in either file | `areas/changes-grouping-and-filtering.md`, `tasks/03-changes-grouping-and-filtering.md` |
| F3 | AUTO_FIX | first-review | For a decision touching an `AGENTS.md` owner-approval gate (D1: new external dependency), the spec's own persisted artifacts — not just conversation history — contain a real option analysis (≥2 options, trade-off dimensions, sizing, consequences), per `references/solution-option-analysis.md`'s "Use `templates/solution-options.md` as the artifact shape when writing options to the spec" | `owner-decisions.md`'s D1 entry has only a compact one-line "Options considered: (A) ... \| (B) ..." with no persisted trade-off dimensions, t-shirt sizing, or consequences-at-equal-cost writeup; the fuller analysis (implementation cost, maintenance cost, reversibility, consistency with NEvo's own posture) exists only in this conversation's transcript, not in a spec artifact. Compare `specs/active/ai-sessions-live-chat-integration/solution-options.md`, which this repo's own precedent change created for its own gated decisions. Fix: add `specs/active/dashboard-loading-and-progress/solution-options.md` (per `templates/solution-options.md`) capturing D1's full analysis. | Read `owner-decisions.md` D1 just now — no `solution-options.md` file exists under this change's directory (`Glob specs/active/dashboard-loading-and-progress/**` at spec-create time listed no such file) | `owner-decisions.md`, (missing) `solution-options.md` |

## Gating and non-gating checks

```
Gating validation: passed — node tools/specs.mjs validate: "Validated 12 changes — no errors."
Non-gating repository check: passed — node tools/specs.mjs check: "Specs valid and indexes are current."
Non-gating repository check: failed — node tools/docs.mjs check: "stale: docs/index.generated.md" — pre-existing, unrelated to this change (this change touches no files under docs/; `git status --porcelain -- docs/` is clean, and `node tools/docs.mjs validate` passes, confirming the staleness predates this spec and belongs to some other change's pending docs work, not a self-caused failure this review must block on).
```

## Specification readiness criteria — other checks performed, nothing further to report

- Task dependency graph: acyclic, resolves (`validate` above; also confirmed by
  `resolveSpecReviewScope(change, { all: true })` returning all 7 task ids cleanly).
- `allowed_paths`/`forbidden_paths`: present on every task; scoped narrowly enough to be
  unambiguous once F2 is resolved (task 03's `tools/dashboard/server/**` entry is the
  one path list this review couldn't fully justify from the task's own text — see F2).
- Acceptance criteria: each task's criteria carry `automated:`/`inspection:` tags and
  describe an observable behavior, not aspirational language.
- Documentation/ADR impact: identified — `overview.md` § "ADR impact" and task 04's
  "Documentation impact" section record the recommendation to add an ADR once the
  Operation/Steps pattern lands, correctly deferred rather than written now.
- D2 (operation-progress wiring scope): presented with two real options and trade-offs
  in conversation; not itself an `AGENTS.md`-gated item (effort/scope, not public API/
  dependency/persistence/breaking-change), so the stricter persisted-option-analysis
  requirement checked for F3 does not apply to it the same way.
