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
  operation-progress-contract-and-transport: a56a8ddf9c46502d97d8c0a0663c95cd5c39336f0500d07de7bdf5ea32a9a336
  cli-step-instrumentation-gate-and-verification: 054cf91e31bb35443f964585b2bb03dfac7e88dfeddb077e33d3b857349b51aa
  cli-step-instrumentation-tests-and-audits: bc7ab39d1aea1028060debbe83ad1c5b3de347fabfad25b0fba81b8e1ac32bfa
  dashboard-operation-progress-ui: a7c11ca7dfbb1db94cb75476295aa451d4aebd4cc4643514753297014a42b722
---

# Review: dashboard-loading-and-progress

- [x] No unresolved required fix
- [x] No unresolved owner decision
- [x] No unresolved clarification request
- [x] Verdict: ready-for-approval

The owner corrected one internal inconsistency between tasks 04 and 05, introduced by
the prior D11 pass. Confirmed by direct inspection: task 04 both (a) stated in its
Implementation constraints and AC that `finalizeGate` "keeps its existing `GET`-path
caller too, until task 05 replaces it" (deferring the `GET /actions` finalize-probe fix
to task 05), and (b) still carried an unconditional AC3 — "`GET /api/specs/active/:slug/actions`
never invokes `finalize --check` ... to compute finalize's button state" — plus a matching
Implementation-constraints paragraph claiming task 04 itself performs that change. Those
two statements contradicted each other; AC3 and the paragraph predate this change and
were never reconciled with the D11 pass's own "until task 05" framing.

Resolved by removing task 04's ownership entirely: its `GET /api/specs/active/:slug/actions`
paragraph now states plainly that the route is untouched by this task (content and
behavior both stay task 05's job, per D4), AC3 is deleted, the remaining acceptance
criteria renumbered (1-10, no gap), and an explicit "Out of scope" bullet added naming
the `GET`-path `finalize --check` removal as task 05's responsibility, not task 04's.
Task 05 already owned this correctly (Implementation constraints, AC8) and needed no
scope change — only its own Goal-section item numbering was fixed (the list had jumped
1, 3, 4, then 2, because the CLI-only item — self-check — was physically reordered to
the end of the section in the D9/D10 pass while keeping its original number). It now
reads 1 (gate re-check), 2 (task acceptance), 3 (finalize), 4 (self-check, CLI-only),
matching physical order; the one existing "item 1 above" cross-reference still points at
the correct item. `owner-decisions.md`'s D11 consequences line was updated to match
("Goal items 1 and 3," not "1 and 4"). A self-inflicted semantic-reference gap was also
caught and fixed: task 04's Dependencies section names `D7` by number (as the precedent
D8 mirrors) without declaring it in `semantic_references.decisions` — added.

Applied to `owner-decisions.md` (D11's consequences line only — no new decision, no
scope/decision change), `tasks/04-operation-progress-contract-and-transport.md`
(`GET`-path paragraph reworded, AC3 removed and list renumbered, new Out-of-scope
bullet, `D7` added to `semantic_references`), and
`tasks/05-cli-step-instrumentation-gate-and-verification.md` (Goal-section renumbering
only — no content or scope change). No other file needed changes; tasks 01, 02, 03, 06,
07 and every area doc were re-read and confirmed unaffected by this fix. Re-validated
(`node tools/specs.mjs validate`, `node tools/docs.mjs validate`), re-indexed
(`node tools/specs.mjs generate`, `node tools/docs.mjs generate`), non-gating checks
clean (`node tools/specs.mjs check`, `node tools/docs.mjs check`), and every task
fingerprint recomputed from scratch (04 and 05 changed directly; 06 and 07 changed by
fingerprint-folding through their `dependency_contracts` on 04/05; 01/02/03 unchanged, as
expected; the change-level fingerprint is unchanged since neither `overview.md` nor the
task dependency graph's shape moved).
