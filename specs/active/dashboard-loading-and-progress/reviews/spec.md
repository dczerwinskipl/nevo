---
review-of: spec
change: dashboard-loading-and-progress
generated: 2026-08-15
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 278ffac6028e74226fdece85a315ebdd997eeef6c8608a0737b70a499dd118cf
task_fingerprints:
  dashboard-data-loading-contracts: b615f9a39c3409c6bb66237da2c095084e29ec2ffdc7b7b60b94f0fe82457671
  pr-file-manifest-and-diff-hydration: 17d8b78f5eeb35b6c1f1c6668ddf7a7b07717cf3fa00b97b358d1dbf1cb547d0
  changes-grouping-and-filtering: db51f0d8a22eabb2ff863fc4ba4d1de95faa4c7ba924b6cf93b17699c0ca9487
  operation-progress-contract-and-transport: 5586501be6e3b71bd5f81b52befa1b7c9e1ba42ca0db32c43d21c27ad5ab834c
  cli-step-instrumentation-gate-and-verification: 5d8972834ad341f49f87f56db0d844a53d87605eebae05c14a22d667eb9d9fef
  cli-step-instrumentation-tests-and-audits: d7113cc71fb865af726a7b5e417faa6885327c76dee080063794694617a5621a
  dashboard-operation-progress-ui: 72236f9571ccdfd5d81ce03c0919ccb0c0ac8f22f1d6a26007e06a36ba4a4783
---

# Review: dashboard-loading-and-progress

- [x] No unresolved required fix
- [x] No unresolved owner decision
- [x] No unresolved clarification request
- [x] Verdict: ready-for-approval

The owner corrected the spec on one more point from a PR #27 re-review (recorded as D11
in `owner-decisions.md`, plus a wording-precision amendment to D2), on top of D1-D10:
the Dashboard Operation lifecycle now unifies with the actual `verify`/`approve`/
`finalize` action flow. Confirmed against `tools/specs.mjs` and
`tools/dashboard/server/actions.mjs`: `executeSpecificationAction` currently runs a
separate `--check` pre-flight CLI invocation (`taskGate`/`finalizeGate`) before spawning
the real action command for every POST-triggered action — one dashboard click, two CLI
process spawns — while task 05 described that pre-flight call as "a step inside" the
real action's Operation, contradicting task 04's own "Operation = one spawned process"
model. `handleVerify`/`handleApprove` (via `validateTransition`) and `handleFinalize`
(via its existing unconditional `gatherFinalizeFacts`/`validateFinalize` call, the same
one `--check` mode uses) already perform authoritative validation internally, before
mutating, and already refuse to mutate on failure — so the pre-flight was redundant, not
load-bearing. D11 removes it: `executeSpecificationAction` now spawns exactly one real
command per POST, and that command's own existing internal validation becomes the
Operation's first semantic step(s) once instrumented, rather than a separate process.
`GET /api/specs/active/:slug/actions` (D4) is unaffected — it remains a cheap,
synchronous read with no spawn correlated to any Operation. D2 is separately
precision-corrected, in place: "wire all listed operation kinds" → "wire all applicable
existing multi-step CLI operations" — scope is unchanged (every real operation still
gets wired; task 06 already reports, rather than fabricates, any listed kind with no
real CLI-subprocess operation), only the wording no longer reads as a mandate to invent
operations that don't exist.

Applied across `overview.md` (responsibility-boundary flow note, change-wide AC, owner-
decisions summary), `owner-decisions.md` (D11 added; D2 amended in place),
`areas/operation-progress-contract.md` (new one-process requirement bullet, `finalize`
phase-source wording, D2-wording bullet, new area AC), and `tasks/04`/`05`
(`executeSpecificationAction`'s pre-flight-removal instruction, reworded gate-recheck/
`finalize` Goal items, new/reworded acceptance criteria, `semantic_references` gained
D11). Tasks 01/02/03/06/07 needed no changes — 06/07 already treated the underlying
gate/`finalize` results as sourced from the real command's own outcome, not from a
specific process-count assumption, so their acceptance criteria stay accurate under the
corrected model without edits. Re-validated (`node tools/specs.mjs validate`,
`node tools/docs.mjs validate`), re-indexed (`node tools/specs.mjs generate`,
`node tools/docs.mjs generate`), non-gating checks clean (`node tools/specs.mjs check`,
`node tools/docs.mjs check`), and every task fingerprint recomputed from scratch after
the edits (04/05 changed directly; 06/07 changed by fingerprint-folding through their
`dependency_contracts` on 04/05; 01/02/03 unchanged, as expected, since neither their
own content nor any decision they reference was touched).
