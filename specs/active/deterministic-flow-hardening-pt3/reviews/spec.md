---
review-of: spec
change: deterministic-flow-hardening-pt3
generated: 2026-10-03
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 53ac73c4773b76ee6e5e2c8b22cf85add67e78f2a3a984e0c43bb16567d1a07a
task_fingerprints:
  session-visibility-on-creation: c72f936e29645d8d611c1d5ae66059794c5ea66fbd4a82b17a9f584ea732778a
  execution-policy-provider-selection-fix: 4dc308a597f961e180a8e8c351c56105c7e94c33f46102ac35f39d8f2f87287f
---

# Review: deterministic-flow-hardening-pt3

No reliable previous-file baseline is available. Performing a fresh review of the
current specification.

## Verdict

`ready-for-approval` — no unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION`
findings remain, but neither task is yet `status: approved` in `change.yaml` (both are
`draft`), per decision-table row 4.

## Implementation readiness

- May implementation start now? No (`implementation_allowed: false`).
- Are the relevant tasks `approved` in `change.yaml`? No — both `session-visibility-on-creation`
  and `execution-policy-provider-selection-fix` are currently `draft`.
- What has to happen first? Nothing but approval — no unresolved finding of any kind;
  `/nevo-ai:spec-approve` is the next step.

## Findings

No findings.

Gating validation: passed (`node tools/specs.mjs validate` — 30 changes, no errors).
Non-gating repository check: passed (`node tools/specs.mjs check`, `node tools/docs.mjs check` —
indexes current after this change's own `specs/*.generated.*` regeneration).

Notes from this review pass (already corrected in the artifacts, not left as open
findings): the two task files initially lacked `semantic_references.decisions`
entries for the owner decisions (D2, D3) their own prose names, and both tasks'
`automated:`/`Verification` commands initially referenced a test command
(`npm --prefix tools/dashboard test -- <pattern>`) that does not exist — that npm
script only runs the `node --test` suite over `tests/*.test.mjs` and has no `--`
pattern-filter behavior; the dashboard's `.tsx` UI tests run under `vitest` via
dedicated `package.json` scripts (`test:ui-stable`, and a new `test:ui-provider-selector`
task 02 must add). Both were fixed before this review ran, so they do not appear as
active findings — verified directly against the current file contents, not asserted.

## Specification readiness criteria check

- Every task intended to start next: neither is `approved` yet (expected pre-approval;
  see verdict above) — not a blocking finding, just not yet actioned.
- `depends_on`: neither task declares one; both are independent per D4 — `node tools/specs.mjs validate`
  confirms no cyclic/unresolved reference.
- `allowed_paths`/`forbidden_paths`: present and disjoint between the two tasks on both
  dimensions — no overlap.
- Acceptance criteria: each task's criteria carry an `automated:` tag pointing to a
  real, verified-working command (confirmed by running `npm --prefix tools/dashboard run
  test:ui-stable` directly during this review — passed, 4/4 tests).
- Owner decisions: D1-D5 all recorded in `owner-decisions.md` with question, options,
  decision, rationale, consequences — none open.
- Documentation/ADR impact: checked `docs/development/` (including `ai-sessions.md`,
  `agent-workflow-protocol.md`) and `docs/decisions/` for any described behavior this
  change would contradict or need to update — found none; the specific client-side
  retry/cache/provider-selector behavior being fixed is not documented architecture,
  only implementation. No documentation update is required by this change.
- Gated-decision option analysis: D2, D3, D5 each record ≥2 real options with
  trade-offs and an explicit rationale for the one chosen (D1 recorded 3 options and
  explicitly chose none). Satisfied.
- Semantic-reference completeness: both tasks now declare `semantic_references.decisions`
  for the one decision (D2 / D3 respectively) their own content relies on. No other
  owner decision, shared constraint, or dependency contract is referenced in either
  task's prose without being declared.

## Scope and task-decomposition quality

Two tasks, no file overlap: task 01 touches `specification-detail-content.tsx`,
`queries.ts`, `agent-session-screen.tsx`, `agent-session-screen-navigation.test.tsx`;
task 02 touches `create-agent-session-dialog.tsx`, a new
`execution-policy-selection-dialog.test.tsx`, and `package.json` (to add its own new
test script). Neither task's `forbidden_paths` conflicts with the other's
`allowed_paths`. Matches D4's decision to decompose into two independent tasks.
