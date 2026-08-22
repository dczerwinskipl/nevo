---
review-of: spec
change: chat-ux-improvements-pt1
generated: 2026-08-22
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 437a8b46a6833856cc0c5f0bd707b7d7b35218781583f166b1add98021a17edc
task_fingerprints:
  semantic-chat-presentation-model: 3514b799a3b8808695026dded082f0f6979f0ca7a8e51628a07a7f2216c31258
  per-turn-work-presentation: f55d7739d72984f2e7b7e5198d83e8cd1922acb200999cbb8778c7d7866bf6b7
  tool-activity-normalization-and-details: d8bc3f90af1363d99a080208ec2e63b60be06fa984396fe5eeac38db721a60fb
---

# Review: chat-ux-improvements-pt1

Scope: `--tasks 1,3,4` → `semantic-chat-presentation-model`, `per-turn-work-presentation`,
`tool-activity-normalization-and-details`. Baseline: previous `reviews/spec.md` (read in
full before this write), verdict `changes-required`, findings F1/F2/F3 (all `AUTO_FIX`,
missing `semantic_references`).

## Verdict

`ready-for-approval` — F1/F2/F3 are resolved (verified against current file content, not
memory) and no new finding was found on this pass.

## Implementation readiness

- May implementation start now? No.
- Are the relevant tasks `approved` in `change.yaml`? No — all three remain `status:
  draft` (unchanged by this review, which never writes task status).
- What has to happen first? Nothing further for readiness — approval is the next step.

## Findings

No findings.

- [x] Acceptance criteria: n/a (spec review, not task review)
- [x] Scope: compliant — `allowed_paths`/`forbidden_paths` present and unambiguous on all three tasks; task dependency graph acyclic (`node tools/specs.mjs validate`)
- [x] F1 (missing `semantic_references` on `tasks/01-semantic-chat-presentation-model.md`): **resolved** — `decisions: [D6, D7]` now present, verified against current file content
- [x] F2 (missing `semantic_references` on `tasks/03-per-turn-work-presentation.md`): **resolved** — `decisions: [D6, D9]`, `dependency_contracts: [semantic-chat-presentation-model]` now present
- [x] F3 (missing `semantic_references` on `tasks/04-tool-activity-normalization-and-details.md`): **resolved** — `decisions: [D6]`, `dependency_contracts: [semantic-chat-presentation-model, per-turn-work-presentation]` now present
- [x] Gating validation: `node tools/specs.mjs validate` and `node tools/docs.mjs validate` both passed
- [x] Non-gating repository check: `node tools/specs.mjs check` and `node tools/docs.mjs check` both passed (index was regenerated this pass after the prior refinement edited `change.yaml`)
