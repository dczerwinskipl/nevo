---
review-of: spec
change: exit-gate-improvements
generated: 2026-10-11
verdict: approved-for-implementation
ready_for_approval: true
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 105605e6ac666b6c684ee43b80ea2ca00a965bd48e98633c26180232706f03c4
task_fingerprints:
  derived-registry-and-deterministic-generators: 4a3fd7f56d0caeff6b49d53412b1fa9af2207b5687907ff6f596327e7c029f51
  finish-derived-sync: 031f5fbe6763fbbe85398f4c67ec78ab1c0ecfca303ef0added81d4f096516f5
  publish-and-batch-derived-sync: b248de07ca0eb96c4a2f64ee1a7980a985c61cc745508eed727588338646b01c
  specs-index-projection-stability: 08fb14f1b07beeaaf55d7fbe4ccf21b841bd71094647ea758d02bcb9e80c7ad3
  transition-aware-exit-gates: 3a1f732017b171bf805c4d3da9e2b3304ca3bfe668d7a4603893094d601e7851
  gate-failure-recovery-and-taxonomy: 26ed36780fbf84c4e072685e7716228f3b5d49a8719b6e570802276ba7f4fa2d
  workflow-documentation-and-adr: 8c4431e311031deb593d777b451512d03a753434b3e4f9358587d7a90467465e
  explicit-task-verification-action: 20b0bf898adee33da8a8fe9bd013620a85f1cc3458b0c30cd84e425cf59a3e24
---

# Review: exit-gate-improvements

Complete specification re-review evaluating the refined specification, recorded owner decisions D1–D8, resolution of the batch shared commit staging contradiction, re-evaluation of D5 repo-wide validation, strengthened Task 06 recovery contract, and regenerated repository indexes.

## Verdict

`approved-for-implementation` — all mechanical fixes (F1–F4, F6) applied, owner decisions D1–D8 recorded in `owner-decisions.md`, batch staging contradiction resolved, Task 06 recovery contract fully specified, and all repository validations pass cleanly.

## Implementation readiness

- May implementation start now? Yes (`implementation_allowed: true`).
- Are the relevant tasks approved? Ready for owner approval in `change.yaml` (`tasks: approved`).
- Dedicated branch configured: `feature/exit-gate-improvements` (avoids colliding with PR #53's `feature/ai-spec-history`).

## Scope

`--all` — full specification review: `change.yaml`, `overview.md`, `discovery.md`, `owner-decisions.md`, `areas/01-derived-artifacts.md`, `areas/02-transition-aware-gates.md`, and all 8 tasks in `tasks/`.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — Validated 32 changes — no errors.
  node tools/docs.mjs validate — Validated 77 documents — no errors.
Non-gating repository checks: passed
  node tools/specs.mjs check — Specs valid and indexes are current.
  node tools/docs.mjs check — Indexes are current.
```

## Summary of Findings & Resolutions

| ID | Category | Status | Summary & Resolution |
|---|---|---|---|
| F1 | `AUTO_FIX` | `RESOLVED` | Branch collision: `change.yaml` branch configured to `feature/exit-gate-improvements`. |
| F2 | `AUTO_FIX` | `RESOLVED` | Broken test commands: tasks 02, 05, 06, 08 declare explicit runnable test files. |
| F3 | `AUTO_FIX` | `RESOLVED` | Semantic references: all tasks declare `semantic_references` (decisions and dependency contracts). |
| F4 | `AUTO_FIX` | `RESOLVED` | Context requirements: `context.required` completed across all tasks. |
| F5 | `OWNER_DECISION` | `RESOLVED` | Owner decisions: D1–D8 decided, documented, and cross-referenced in `owner-decisions.md`. |
| F6 | `NON_BLOCKING` | `RESOLVED` | Typo: slug and title renamed to `exit-gate-improvements`. |
| F7 | `SPEC_DEFECT` | `RESOLVED` | Batch staging contradiction: Task 03, Area A, and Overview updated to define explicit staging ownership for the batch shared commit (`(∪ allowed_paths) ∪ workflowOwnedPaths ∪ derivedOwnedPaths`), replacing unconstrained `include: ['*']`. |
| F8 | `OWNER_DECISION` | `EVALUATED` | D5 repo-wide validation: conflict with `review fail` analyzed; trade-offs documented in Overview, Area A, and `owner-decisions.md`; D5 preserved per owner decision policy. |
| F9 | `SPEC_DEFECT` | `RESOLVED` | Task 06 recovery contract: exact replayability predicate for `isFinishOperationReplayable`, result retargeting in `mergeResolvedInputs`, gate invalidation on replay, and post-mutation safeguards specified. |
| F10 | `MAINTENANCE` | `RESOLVED` | Repository index drift: indexes regenerated as separate maintenance, restoring green `specs check` for PR #53. |

## Detailed Finding Evaluations

### F7: Batch Shared Commit Staging Ownership
- **Context:** Task 03 stated that unrelated dirty files must not be staged, while the existing batch finish implementation defaulted to `include: ['*']`. Overview and Task 03 had marked batch scope enforcement as an unconstrained out-of-scope follow-up.
- **Resolution:** Explicit staging ownership is now formally specified in Task 03, Area A, and Overview. Stage 5 shared commit constructs an explicit commit set from the union of member tasks' `allowed_paths`, workflow-owned paths (`change.yaml`, `reviews/**`), and `derivedOwnedPaths` from generators that ran. No foreign dirty files can be swept into the batch commit.

### F8: Re-evaluation of D5 (Repo-Wide Validation)
- **Context:** D5 requires running repo-wide `specs.mjs validate` and `docs.mjs validate` inside `ensureCommit`. Because `ensureCommit` runs for all transitions, an unrelated validation error anywhere in the repository blocks `review fail`, recreating the original problem that motivated Area B.
- **Evaluation & Trade-offs:**
  1. *Option 1 (Current D5 Decision — Strictest):* Unconditional repo-wide validation on all commits. Unlocks an absolute guarantee of repository health at git HEAD, but forecloses change isolation and reviewer autonomy during rework.
  2. *Option 2 (Scoped Validation on Rework):* Generator-specific `check()` runs unconditionally; repo-wide validation is required for forward transitions (`pass`, terminal completion), but bypassed for rework transitions (`fail`).
  3. *Option 3 (Change-Scoped Validation):* Validate only the active change and touched docs on task finish; defer repo-wide validation to PR finalization and CI.
- **Status:** In accordance with repository decision policy, Owner Decision D5 is preserved as accepted unless explicitly reconsidered by the owner. The trade-offs are documented for owner visibility.

### F9: Task 06 Recovery Contract Specification
- **Context:** In `tools/specs/workflow/operation-record.mjs`, `isFinishOperationReplayable` returned `false` if any stage in `record.operations` had status `failed`. A finish record with `record.status = 'running'` and `verify-gates.status = 'failed'` was therefore classified as non-replayable, conflicting with the desired recovery flow.
- **Resolution:** The recovery contract is now explicitly defined in Task 06, Area B, and Overview:
  1. `isFinishOperationReplayable(record)` returns `true` when `record.status === 'running'`, `verify-gates.status === 'failed'`, and all subsequent stages (`update-task`, `commit`, `push`, `transition`) are strictly `'pending'`.
  2. While `update-task` is `'pending'`, `mergeResolvedInputs` permits revising completion inputs (`result`, `feedback`, `commit.title`, `commit.message`, `artifacts`) without raising `RESOLVED_INPUT_CONFLICT`.
  3. On replay with retargeted inputs, gate results in `verify-gates` are invalidated and re-evaluated against the newly applicable gates for the revised `result`.
  4. Once `update-task` begins, all inputs are permanently pinned and crash reconciliation is enforced.

### F10: Specification Index Synchronization
- **Context:** PR #53 was failing `tools/specs.mjs check` due to stale committed indexes (`specs/index.generated.json`, `specs/active.generated.md`).
- **Resolution:** Generated indexes rebuilt cleanly via `node tools/specs.mjs generate`. `specs.mjs check` and `cli-smoke.test.mjs` pass.
