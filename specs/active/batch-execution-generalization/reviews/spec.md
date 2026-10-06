---
review-of: spec
change: batch-execution-generalization
generated: 2026-10-06
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 64481fc58d6d248c46dd037d7568d3f3702cbc5b12ed5c2d2529c942a536371b
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
---

# Review: batch-execution-generalization

## Verdict

`ready-for-approval` — scoped re-review (`--changed`) covering only the 2 newly added
second-round corrective tasks (13-14); no unresolved `AUTO_FIX`/`OWNER_DECISION`/
`NEEDS_CLARIFICATION` findings against either. Tasks 01-12 are **not** re-graded by
this run — their own `task_fingerprints` entries above are carried forward unchanged
from the prior review, per the context-vs-review-scope boundary
(`references/review-policy.md`); they remain `verified` in `change.yaml`, untouched by
this correction, exactly as the owner instructed when requesting it.

## Post-implementation correction (this review's own reason for existing)

This spec was previously reviewed and tasks 01-12 were each implemented and
individually verified, including a first round of corrective tasks (09-12). A second
review round, run against head `300593a` (tasks 09-12 landed), confirmed tasks 09-10
are correct, but found task 11's own fix still has two real blockers (the pending-
handover resume trigger only fires from a batch settlement's own Stage 2, not from a
singleton's own settlement; only `ACTIVE_EXECUTION_EXISTS` is treated as a transient
admission failure, every other equally-transient reason is recorded as terminal), and
found task 12's own Test D proves durability of the pending record, not that resume is
actually automatic. Full writeup: `overview.md` § "Second-round review correction".
Tasks 13-14 were added as corrective work in response, to be implemented in order
(13 → 14) before this change can be considered ready for final approval. This review's
only job is to confirm tasks 13-14 themselves are ready for *implementation* to begin —
it does not, and cannot, confirm the underlying production gaps are actually fixed;
that is what tasks 13-14's own verification exists to prove.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are tasks 13-14 `approved` in `change.yaml`? No, both are currently `draft`.
- What has to happen first? Nothing blocking remains — each of tasks 13-14 needs its
  own `/nevo-ai:spec-approve` transition, in order (13 before 14 — enforced by task
  14's own `depends_on`).

Gating validation: passed (`node tools/specs.mjs validate` — 31 changes, no errors).

## Findings

No findings against tasks 13-14.

Readiness criteria checked directly against the current file contents (`overview.md`'s
new "Second-round review correction" section and updated "Implementation decomposition"
list, and `tasks/13-*.md`/`tasks/14-*.md` in full), per `references/review-policy.md`
§ "Specification readiness criteria":

- `depends_on` graph resolves and is acyclic, including the new 13→14 chain
  (`node tools/specs.mjs validate`).
- Each of 13-14 declares specific, non-overlapping-in-intent `allowed_paths`/
  `forbidden_paths`: 13 owns `batch-completion-settlement.mjs` and `admission.mjs` and
  forbids `tools/specs/workflow/**`/`routes.mjs`/`reconciliation.mjs`; 14 is test-only
  (existing test file, no production path in `allowed_paths`), forbidding every
  production file 13 touches — same "report the gap, don't patch it" discipline tasks
  07/08/12 already established.
- Every acceptance criterion in 13-14 names a concrete `automated:` check (a specific
  test file) — none is aspirational.
- No open owner decision blocks 13-14: both explicitly stay within the architecture the
  owner already decided (no new scheduler, no cross-spec scan, additive fix only to an
  already-decided mechanism) — each task's own "Implementation constraints"/closing
  paragraph repeats the specific prohibitions the corrective-task request itself
  specified, so there is nothing new here requiring a fresh option analysis.
- Documentation impact identified: `overview.md`'s new "Second-round review correction"
  section is the documentation impact for this correction itself; no further ADR impact
  beyond what the original review already recorded (deferred, optional).
- Semantic-reference completeness: neither 13 nor 14 names an owner-decision number in
  prose it fails to declare in `semantic_references.decisions` (both correctly carry
  `decisions: []`).

## Architecture and documentation

No existing ADR documents the sequential-queue/batch-reservation architecture
(confirmed in `discovery.md`); tasks 13-14 fix production behavior within that same,
already-decided architecture — no new architectural decision, no ADR impact beyond
what the original review already recorded.
