---
review-of: spec
change: deterministic-workflow-foundation
generated: 2026-09-09
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 0b137a43325434252bf9de0f2cdcb276cd1cab0ff4cc4f28cc7e162b26948a3e
task_fingerprints:
  workflow-schema-and-compatibility: d738c1893138d7d069d04b9a419830f1895d7cb89a1a22eeb36b189fbb7c74f7
  composable-actions-and-contracts: 6a2a04e45ad6608eaaec3f1bc97ad11858471f515d02b8c77fc70efae5ec001a
  action-registry-and-aggregated-checks: 01b344de2df410fc722b37bc37b7b394af569447cfd1f70bdfd91b9d72666023
  source-control-capability: e35b7a1cb750c8754d6275f63d723cd3cd69e94bce1847406eba673c9d93425e
  deterministic-gates-and-human-verification: 04887f1a2aa260440ac97cf4c13e6e7d58edaa08bcda8c4919d600f1bfbb42fe
  step-orchestration-and-next-step-service: ffc4327fd53586199d7bfc2c15b3af3e8a38adc55c635481a724365d6a760aeb
  cli-integration-and-vertical-poc: e16676b7bfb5b03ea8ee83537e1bf9d456316a0a5af73b4ad29691b0229bdef7
  multi-step-workflow-progression: d0cc4632323ede459322424c3dae2e0b91a7b71ef50a2aa3ca179d4de2e9e1df
  fail-closed-workflow-definition-resolution: dd7339beb2324ecaca905f291b3cbba716cb76fb438bc10a5a4b994756105626
  production-multi-step-standard-workflow: fedca0ccdf6fb124ce882f90499bd4b505f7ceed63ac8787cefaa6b2e2280590
  step-context-knowledge-hints: 2e12cad59ef02e2ec57ad09482a36c571fba17de5b29021aded4009848dd6651
  multi-step-workflow-e2e-proof: 0e1b41bea028f7a0a348aa0ea467e4b187d4e5f4305395677684ca7f067b4c2b
---

# Review: deterministic-workflow-foundation

## Verdict

`ready-for-approval` — full fresh re-read of the whole specification (this baseline is
stale: it predates Tasks 04/06/07's implementation and all of Tasks 08-12's addition and
three rounds of correction, D18-D32). One `AUTO_FIX` finding surfaced and was resolved
this run; no other finding remains.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — Tasks 08, 09, 10, 11, 12 are
  `status: draft` (Tasks 01, 02, 03, 05 remain `verified`; Tasks 04, 06, 07 remain
  `implemented`, awaiting owner verification — unaffected by this review).
- What has to happen first? Nothing further from this review — owner approval of Task
  08 (next in dependency order), per the user's explicit sequencing instruction
  (08 → 09 → 11, then Task 10 gated on a separate decomposition-approval step, then 12).

## Findings

- F1 — **resolved this run**: Task 08's `semantic_references.constraints` did not
  declare `C6`, though its own text cites it twice ("fail closed (C6/C20)") as the
  precedent for both the `workflow_progress` validation rule and the legacy fail-closed
  rule. Added `C6` to Task 08's declared constraints.

No other missing, stale, or unnecessary `semantic_references` found across Tasks 08-12.

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`).
Non-gating repository check: passed (`node tools/specs.mjs check`, `node tools/docs.mjs check`).

## Specification quality assessment

Re-read `overview.md`, `owner-decisions.md` (D1-D32), both area docs, `change.yaml`, and
all twelve task files in full, fresh, this run.

- Tasks 01, 02, 03, 05 (`verified`) and Tasks 04, 06, 07 (`implemented`) are unchanged in
  substance; Tasks 06/07 carry small, already-recorded wording corrections (D21 scope
  notes) that moved their own task-file fingerprints since their last `self_check` —
  **informational only**: no `allowed_paths`, acceptance criterion, or behavior changed,
  so this does not reopen their implemented status or block approving new tasks 08-12.
- Tasks 08-12's dependency graph is acyclic and matches the sequencing the owner
  requested: 08 → {09, 11} → 10 (gated on a separate, explicit decomposition approval
  per D31) → 12.
- Task 08's scope (D18/D19/D23/D24/D25-schema/D26/D27/D28/D30/D32) is large but
  internally consistent: every acceptance criterion maps to a `allowed_paths` entry that
  can actually implement it (including `tools/specs/store.mjs` and
  `tools/specs/workflow/gates/human-gate.mjs`, both correctly added across the prior
  correction rounds), and its own non-regression requirement (Task 06/07 tests pass
  unmodified against the real `standard.yaml`) is testable as written.
- Task 09/11's scope is narrow and unaffected by Task 08's expansion; their
  `dependency_contracts` correctly name `multi-step-workflow-progression`.
- Task 10's owner-approval gate (D31) is consistently described in its own file,
  `owner-decisions.md`, and the area doc — its `allowed_paths` correctly excludes
  `owner-decisions.md`, and its AC1 correctly describes the approval as a manual
  precondition, not something `node tools/docs.mjs validate` proves.
- Task 12's scope correctly excludes engine code and depends on 09/10/11.

## Next steps

1. `/nevo-ai:spec-approve deterministic-workflow-foundation multi-step-workflow-progression`
   (Task 08 — first in the requested implementation order).
