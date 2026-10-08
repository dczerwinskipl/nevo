---
review-of: spec
change: batch-execution-generalization
generated: 2026-10-08T14:09
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 3eff00c2ae9de18b46402c02f4758a314b52f835b92afcbe382e734a6e400fd0
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
  durable-grouped-handover-resume-generalization: d0f211868582f8248f24d0d142b9b77c813002faeee3f905c0a8ab500d517e0e
  real-end-to-end-automatic-resume-proof: b1f0f0f185970488078a705760dfb4549afd7fc1483ee62132eb84951902aa42
  resume-trigger-scope-guard-and-coverage-hardening: 7263041294483c85b09ba0e36d204b22453034c46066656d6cd6f1fb57f38d78
  worktree-wide-pending-handover-sweep: 148b8a809d2f91506ffbf21ad58e4e3868eea21daa709b28faf2f50834b75a57
  settlement-serialization-and-live-sweep-completion: 8e6125fb1d74a5f8f06e9f8f1d1bf52719ba794faf89906c22d6c0bc67474548
  live-sweep-failure-path-completion: eea208f08d7a7348eee5d50bdd19a02a6fe719392894f7d4122ce30657ce82ef
---

# Review: batch-execution-generalization

## Verdict

`ready-for-approval` — scoped re-review (`--changed`) covering only the 1 newly added
sixth-round corrective task (18); no unresolved `AUTO_FIX`/`OWNER_DECISION`/
`NEEDS_CLARIFICATION` findings against it. Tasks 01-17 are **not** re-graded by this
run — their own `task_fingerprints` entries above are carried forward unchanged from
the prior review, per the context-vs-review-scope boundary
(`references/review-policy.md`); they remain `verified` in `change.yaml`, untouched by
this correction, exactly as the owner instructed when requesting it.

## Post-implementation correction (this review's own reason for existing)

This spec was previously reviewed and tasks 01-17 were each implemented and
individually verified, including five rounds of corrective tasks (09-12, then 13-14,
then 15, then 16, then 17). A sixth review round, run after task 17 landed, confirmed
task 17's mutex fix and provenance correction are both correct, but found: (1) the
`handleHumanStep`/`handlePublishTask` live sweep (task 17) only ran on the success
path — both operations can resolve their own workspace-request/claim lifecycle to a
terminal state and *then* throw, which a try-only sweep silently misses;
`handleBatchPublish` already had this right via its own `finally` block; (2) task 16's
own file still contradicted task 17's claimed scope-boundary fix — task 17 said it
would correct task 16's "Explicit, honest scope boundary" framing but never actually
edited it. Full writeup: `overview.md` § "Sixth-round review correction". Task 18 was
added as corrective work in response, before this change can be considered ready for
final approval. This review's only job is to confirm task 18 itself is ready for
*implementation* to begin — it does not, and cannot, confirm the underlying production
gaps are actually fixed; that is what task 18's own verification exists to prove.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Is task 18 `approved` in `change.yaml`? No, currently `draft`.
- What has to happen first? Nothing blocking remains — task 18 needs its own
  `/nevo-ai:spec-approve` transition.

Gating validation: passed (`node tools/specs.mjs validate` — 31 changes, no errors).

## Findings

No findings against task 18.

Readiness criteria checked directly against the current file contents (`overview.md`'s
new "Sixth-round review correction" section and updated "Implementation decomposition"
list, and `tasks/18-*.md` in full), per `references/review-policy.md`
§ "Specification readiness criteria":

- `depends_on` graph resolves and is acyclic, including the new 17→18 chain
  (`node tools/specs.mjs validate`).
- Task 18 declares specific `allowed_paths`/`forbidden_paths`: it owns
  `tools/dashboard/server/specs/routes.mjs`, one test file, and task 16's own `.md`
  file (for the scope-boundary correction note), and forbids
  `tools/specs/workflow/**`, `admission.mjs`, `reconciliation.mjs`,
  `batch-completion-settlement.mjs`, and the other orchestration test files — same
  "report the gap, don't patch it" discipline already established.
- Every acceptance criterion in task 18 names a concrete `automated:`/`inspection:`
  check — none is aspirational.
- No open owner decision blocks task 18: it explicitly stays within the architecture
  the owner already decided (no new scheduler, no cross-spec work selection, a
  `finally`-block restructuring matching `handleBatchPublish`'s own already-correct
  pattern, and a documentation-only correction to task 16's own superseded text).
- Documentation impact identified: `overview.md`'s new "Sixth-round review correction"
  section is the documentation impact for this correction itself; no further ADR
  impact beyond what the original review already recorded (deferred, optional).
- Semantic-reference completeness: task 18 does not name an owner-decision number in
  prose it fails to declare in `semantic_references.decisions` (it correctly carries
  `decisions: []`).

## Architecture and documentation

No existing ADR documents the sequential-queue/batch-reservation architecture
(confirmed in `discovery.md`); task 18 fixes production behavior and documentation
within that same, already-decided architecture — no new architectural decision, no
ADR impact beyond what the original review already recorded.
