---
review-of: spec
change: exit-gate-imorovements
generated: 2026-10-10
verdict: owner-decision-required
ready_for_approval: false
implementation_allowed: false
unresolved_required_fixes: 4
unresolved_owner_decisions: 6
unresolved_needs_clarification: 0
spec_fingerprint: e210253d1cb2a1d7b4c7e8d447a03a69a5498a374cd6193165e64c2d9668248a
task_fingerprints:
  derived-registry-and-deterministic-generators: c36d628d54e4279a996962375b8c09d6f1173bd204a459e9ba02ac28ddbb6d03
  finish-derived-sync: bfb0b3668353eee0713750cd50bc9faf4afa8b84a9e5a69eb6b463a1e8bb9de9
  publish-and-batch-derived-sync: e97e7d246cb2a0dd422bc5f8e199754e821e2f0a00c2ff36f602ef3a38cbdd8d
  specs-index-projection-stability: 6becfc1c719bf87bf70934ae6ea6714aadd89d5679e2bfee1b07e223b8d46607
  transition-aware-exit-gates: 92def2d439164724963b0f3265de8ea397fca29a68af936cee844970128ccc3a
  gate-failure-recovery-and-taxonomy: b6a376cb050554f30636df9112773e1e8c41054668e7fde4e2d030634b8a078c
  workflow-documentation-and-adr: 1df9b5b411e0926ea129f18810200add4ae98df25d61fea5e57b9e7491f963af
  explicit-task-verification-action: 10c4860d2d8ca12ed414dfe1355f738b5613b2a29075b50bda2f2989bdb31752
---

# Review: exit-gate-imorovements

No reliable previous-file baseline is available. Performing a fresh review of the current specification.

## Verdict

`owner-decision-required` — owner decisions D1–D6 remain open and unrecorded in `owner-decisions.md`, along with 4 required mechanical fixes (including critical branch collision and broken verification test commands).

## Implementation readiness

- May implementation start now? No (`implementation_allowed: false`).
- Are the relevant tasks `approved` in `change.yaml`? No — all 8 tasks are currently `draft`.
- What has to happen first? Owner decisions D1–D6 must be answered and recorded in `owner-decisions.md`, and 4 required mechanical fixes (F1, F2, F3, F4) must be applied.

## Scope

`--all` — full specification review: `change.yaml`, `overview.md`, `discovery.md`, `areas/01-derived-artifacts.md`, `areas/02-transition-aware-gates.md`, and all 8 tasks in `tasks/`.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — Validated 32 changes — no errors.
  node tools/docs.mjs validate — Validated 77 documents — no errors.
Non-gating repository check: failed (repository-wide index drift, non-gating)
  node tools/specs.mjs check — stale: specs/index.generated.json (unrelated active change drift)
  node tools/docs.mjs check — Indexes are current.
```

## Findings

| ID | Category | Lifecycle | File | Predicate / Issue | Evidence |
|---|---|---|---|---|---|
| F1 | `AUTO_FIX` | `first-review` | `change.yaml`, `tasks/*.md` | Incorrect branch name `feature/ai-spec-history` in manifest | `change.yaml:12` points to PR #53 branch instead of this change's branch |
| F2 | `AUTO_FIX` | `first-review` | `tasks/02`, `05`, `06`, `08` | Invalid verification command `node --test tools/tests/` | Throws `Cannot find module '...tools\tests'` and fails exit gate |
| F3 | `AUTO_FIX` | `first-review` | `tasks/01-08` | Missing `semantic_references` block in all tasks (D26/D29) | No task declares `decisions` or `dependency_contracts` |
| F4 | `AUTO_FIX` | `first-review` | `tasks/02`, `03`, `05`, `06` | Incomplete `context.required` for implementation | Tasks consume/modify files missing from declared `context.required` |
| F5 | `OWNER_DECISION` | `first-review` | `overview.md` | Decisions D1–D6 are open and `owner-decisions.md` is missing | `overview.md:11` explicitly states awaiting D1–D6 |
| F6 | `NON_BLOCKING` | `first-review` | `change.yaml`, `overview.md` | Typo in slug/title: `imorovements` vs `improvements` | Title and directory contain `imorovements` with an 'o' |

## Finding details and required actions

### F1: Branch name collision (`AUTO_FIX`)
- **Location:** `specs/active/exit-gate-imorovements/change.yaml` line 12.
- **Problem:** `branch.name` is set to `feature/ai-spec-history`.
- **Consequence:** `node tools/specs.mjs start` will check out and mutate PR #53's branch.
- **Fix:** Update `branch.name` to `feature/exit-gate-improvements` (or `feature/exit-gate-imorovements`).

### F2: Invalid verification command (`AUTO_FIX`)
- **Location:**
  - `tasks/02-finish-derived-sync.md` (line 56)
  - `tasks/05-transition-aware-exit-gates.md` (line 50)
  - `tasks/06-gate-failure-recovery-and-taxonomy.md` (line 51)
  - `tasks/08-explicit-task-verification-action.md` (line 42)
- **Problem:** Contains `node --test tools/tests/`. Node.js test runner cannot resolve a directory ending in `/` as a module and fails with `Error: Cannot find module '...tools\tests'`.
- **Consequence:** The deterministic exit gate executes `## Verification` commands; this will unconditionally break exit gates for tasks 02, 05, 06, and 08.
- **Fix:** Replace with specific test files or `npm test`.

### F3: Missing semantic references (D26, D29) (`AUTO_FIX`)
- **Location:** `tasks/01-derived-registry-and-deterministic-generators.md` through `tasks/08-explicit-task-verification-action.md`.
- **Problem:** Frontmatter lacks `semantic_references:`.
- **Consequence:** Violates repository spec policy (D26, D29). Task fingerprint calculation and review approval gates require load-bearing references to be declared.
- **Fix:** Add `semantic_references:` declaring decisions (`D1`–`D6`) and `dependency_contracts:` matching `depends_on`.

### F4: Incomplete `context.required` (`AUTO_FIX`)
- **Location:** `tasks/02`, `tasks/03`, `tasks/05`, `tasks/06`.
- **Problem:**
  - Task 02 integrates the derived registry, but `tools/specs/derived/registry.mjs` is missing from `context.required`.
  - Task 03 integrates derived sync for publish and batch finish, but lacks `areas/01-derived-artifacts.md` in `context.required`.
  - Task 05 modifies `.nevo-ai/workflows/**` (e.g. `standard.yaml`, `standard-v1.yaml`) and templates, but they are absent from `context.required`.
  - Task 06 modifies `tools/specs/workflow/execution-settlement.mjs` and `cli.mjs`, which are in `allowed_paths` but not `context.required`.
- **Consequence:** Context-restricted agents will lack the necessary files in their context packet during implementation.
- **Fix:** Add these files to `context.required`.

### F5: Open Owner Decisions D1–D6 (`OWNER_DECISION`)
- **Location:** `overview.md` § "Owner decisions required" (lines 215–227).
- **Decisions needed:**
  1. **D1:** Boundary: one change with two areas vs. two changes.
  2. **D2:** Sync execution point: option (b) inside commit stage vs. (a) durable stage vs. (c) post-commit.
  3. **D3:** Definition modification: edit `standard-v1` review in place vs. introduce `standard-v2`.
  4. **D4:** Specs index projection: option (i) drop `workflow_progress` vs. (ii) keep and rely on sync only. (Gates Task 04).
  5. **D5:** Integrity check scope: own outputs only vs. repo-wide validation.
  6. **D6:** `task-verification` alias: defer to follow-up vs. implement now. (Gates Task 08; recommendation is to defer).
  7. **Workflow Mode:** Mode selection (`workflow.mode`) per `AGENTS.md`.
- **Fix:** Obtain owner decisions, create `owner-decisions.md`, and adjust tasks accordingly (e.g. drop Task 08 if D6 is deferred).

### F6: Typo in title and slug (`NON_BLOCKING`)
- **Location:** `change.yaml`, `overview.md`, folder path.
- **Problem:** `imorovements` misspelled.
- **Fix:** Fix `title: "Exit gate improvements"`. Changing the folder slug is optional and owner's choice.
