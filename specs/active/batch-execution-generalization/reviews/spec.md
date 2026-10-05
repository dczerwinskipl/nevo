---
review-of: spec
change: batch-execution-generalization
generated: 2026-10-05
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: da3bfa0131e2ed6a2226619973fccd3e3ccf78a67b5a6aa17d9bc3276e035445
task_fingerprints:
  queue-removal-and-reservation-storage-migration: 47af91f69da5d79b43f402c18e041a418efa81f4ebd664f28b70c9a4c47544b0
  batch-admission-generalization: 47e17e75378534246222b89246a0546b74dded9d597764ec001b31ad3c946f8e
  batch-finish-phase-neutral-generalization: 2c2a7bdc9b22322ad1cae262eb292b6efe2685c72bba45d379947baf6ee44b6f
  intra-batch-dependency-consumption-materialization: fea39b7439c1565b4f341dfe756abfaedda898e229e315000354ae09a51a807d
  batch-completion-handover-partitioning: b22a5db73315e67d31cf4f411a542abd3d7287a278b470ad2834cd8626c24b0c
  ui-canonical-dependency-projection: e87120a81cc7414b0533083fac6b13f732042282b855b942530ffb69a09a8cde
  acceptance-initial-implementation-batch: 6ff1256cd0c9b6ada8994a60364d2b9194d8c2395b439a1707942ce9a6d0f6bc
  single-task-convergence-verification: e516de6ab1c206a7fdaff544a98d976c61f4d54dde7431f403514e21d22f274c
  batch-finish-gate-correctness: d413f3ec547d5a90affc6b41bc5020959ba7dbacc0da057f4d894c2e70e66070
  production-batch-admission-generalization: b87e40c5c507fac32a17df1c6c155e72e1095e075a2d8692e15447e289202061
  durable-grouped-handover-dispatch: 825e71a2c9fe05520f2fbc9f3d2fd80ac8bd88dcb65fa3a7a8bdd9cce80b9cd0
  real-end-to-end-corrective-acceptance: f82caf131ef5f398abeca9897f47fab5b54fc6125cc1f3c462c904c94fc4ff83
---

# Review: batch-execution-generalization

## Verdict

`ready-for-approval` — scoped re-review (`--changed`) covering only the 4 newly added
corrective tasks (09-12); no unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION`
findings against any of them. Tasks 01-08 are **not** re-graded by this run — their own
`task_fingerprints` entries above are carried forward unchanged from the prior review,
per the context-vs-review-scope boundary (`references/review-policy.md`); they remain
`verified` in `change.yaml`, untouched by this correction, exactly as the owner
instructed when requesting it.

## Post-implementation correction (this review's own reason for existing)

This spec was previously reviewed and all 8 original tasks were implemented and
individually verified. A separate, change-level review (full diff against the
pre-change baseline) then found that tasks 1-8, while correct against their own scoped
acceptance criteria, did not in aggregate prove two of the change-wide acceptance
criteria in real production behavior, and surfaced two further gaps — one in
already-verified task 05's own file, one in pre-existing, never-generalized production
code (`routes.mjs`). Full writeup: `overview.md` § "Post-implementation review
correction". Tasks 09-12 were added as corrective work in response, to be implemented
in order (09 → 10 → 11 → 12) before this change can be considered ready for final
approval. This review's only job is to confirm tasks 09-12 themselves are ready for
*implementation* to begin — it does not, and cannot, confirm the underlying production
gaps are actually fixed; that is what tasks 09-12's own verification, and task 12
specifically, exists to prove.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are tasks 09-12 `approved` in `change.yaml`? No, all 4 are currently `draft`.
- What has to happen first? Nothing blocking remains — each of tasks 09-12 needs its
  own `/nevo-ai:spec-approve` transition, in order (09 before 10, 10 before 11, 11
  before 12 — enforced by each task's own `depends_on`).

Gating validation: passed (`node tools/specs.mjs validate` — 31 changes, no errors).

## Findings

No findings against tasks 09-12.

Readiness criteria checked directly against the current file contents (`overview.md`'s
new "Post-implementation review correction" section and updated "Implementation
decomposition" list, and `tasks/09-*.md` through `tasks/12-*.md` in full), per
`references/review-policy.md` § "Specification readiness criteria":

- `depends_on` graph resolves and is acyclic, including the new 09→10→11→12 chain
  (`node tools/specs.mjs validate`).
- Each of 09-12 declares specific, non-overlapping-in-intent `allowed_paths`/
  `forbidden_paths`: 09 owns `batch-finish/operation.mjs` and forbids
  `finish-operation.mjs`/`queue/**`/`routes.mjs`/`batch-completion-settlement.mjs`; 10
  owns `routes.mjs` and forbids `tools/specs/workflow/**`/`batch-completion-settlement.mjs`;
  11 owns `batch-completion-settlement.mjs` and forbids `tools/specs/workflow/**`/
  `routes.mjs`; 12 is test-only (new file, no production path in `allowed_paths`),
  forbidding every production file the other three touch — same "report the gap, don't
  patch it" discipline tasks 07/08 already established.
- Every acceptance criterion in 09-12 names a concrete `automated:`/`inspection:` check
  (a specific test file, several of them new and named for this task) — none is
  aspirational.
- No open owner decision blocks 09-12: each explicitly stays within the architecture
  the owner already decided (homogeneous-by-contract batches, no `ExecutionRun`, no
  second scheduler, one session per batch) — each task's own "Implementation
  constraints"/closing paragraph repeats the specific prohibitions (no queue
  reintroduction, no new scheduler) the corrective-task request itself specified, so
  there is nothing new here requiring a fresh option analysis.
- Documentation impact identified: `overview.md`'s new "Post-implementation review
  correction" section is the documentation impact for this correction itself; no
  further ADR impact beyond what the original review already recorded (deferred,
  optional).
- Semantic-reference completeness: none of 09-12 names an owner-decision number in
  prose it fails to declare in `semantic_references.decisions` (all four correctly
  carry `decisions: []` — they reference this change's own existing architecture via
  required `overview.md` context, not a new `D`-numbered decision).

## Architecture and documentation

No existing ADR documents the sequential-queue/batch-reservation architecture
(confirmed in `discovery.md`); tasks 09-12 fix production behavior within that same,
already-decided architecture — no new architectural decision, no ADR impact beyond
what the original review already recorded.
