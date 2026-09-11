---
review-of: spec
change: deterministic-workflow-foundation
generated: 2026-09-11
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 190655e8a94e71805583135da9984626f95558a7cb0d735d176907652de3e93f
task_fingerprints:
  workflow-schema-and-compatibility: d738c1893138d7d069d04b9a419830f1895d7cb89a1a22eeb36b189fbb7c74f7
  composable-actions-and-contracts: 6a2a04e45ad6608eaaec3f1bc97ad11858471f515d02b8c77fc70efae5ec001a
  action-registry-and-aggregated-checks: 01b344de2df410fc722b37bc37b7b394af569447cfd1f70bdfd91b9d72666023
  source-control-capability: 7b750b45138e12727fe8b3d86161198f4dcbcd365972e30849a276edbde7e8f7
  deterministic-gates-and-human-verification: 04887f1a2aa260440ac97cf4c13e6e7d58edaa08bcda8c4919d600f1bfbb42fe
  step-orchestration-and-next-step-service: 78744830bff2637879160b613824fb1a3c984b2342aba54580ce41d00055e727
  cli-integration-and-vertical-poc: 08f3891e54d23998af597eb5454049fc02eae44f5f6d1532db44918a4a9933d8
  multi-step-workflow-progression: fc922dd0a2ec4b2da397db6cb1e8d4c9f9011f311d6b8d7786f1daeffdc1aa95
  fail-closed-workflow-definition-resolution: 2c2fb175e443013df08e28cc279e6596394c8978ee3fb597edc01bc0e4cf2609
  step-active-completed-lifecycle: c43e5fa80380647192ae1cf9a8925a2a01ee4e6d1d29697e23184106f6b3d762
  production-multi-step-standard-workflow: e09098f60ba9e68534d7b2c94166374f3a4e5d1a053b6d920b54bacf95fc2c3d
  step-context-knowledge-hints: 0ace8b373149b3cd1cab8c145195b488c10c069f1e7aebc34db0e7b2da2cdb88
  multi-step-workflow-e2e-proof: cb2ca7c4c74cb00d2680233650d7d0bbb048cb570d03237ed6a75821a52e25c8
---

# Review: deterministic-workflow-foundation

## Verdict

`ready-for-approval` — re-read of the specification following Task 12 verification
and Task 11 refinement under owner-approved decision D39. Zero findings this run.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — Tasks 11 and 13 remain `status: draft`. Tasks 01-10 and Task 12 are all `verified`.
- What has to happen first? Owner approval of Task 11 — its D31 precondition has been
  explicitly satisfied by Decision D39 (approved 3-step sequence: `implementation` -> `review` -> `human-verification` -> `verified`). Task 11 is now ready for owner approval and start.

## Findings

No findings.

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`).
Non-gating repository check: passed (`node tools/specs.mjs check`, `node tools/docs.mjs check`).

## Specification quality assessment

Re-read `change.yaml`, `overview.md`, `owner-decisions.md` (D1-D37), both `areas/` files,
and all thirteen task files in full, fresh, this run — full `--all` scope, not `--changed`,
given how broadly D37 and its correction touched the specification.

- **D37's model is now internally consistent.** `overview.md`'s C22/C27 state the
  corrected active/completed semantics (internal `finish` never advances `current_step`;
  only `step start` does; position resolution never consults `task.status`); the new C29
  states `step start`'s four-case activation contract explicitly. No remaining prose
  anywhere in `overview.md`, `owner-decisions.md`, or the area doc describes the
  superseded immediate-advance/`task.status`-first model as current — every historical
  mention is annotated as corrected (D19, D28's own entries; D37's Consequences list).
- **Exploratory migration mapping is truthful.** D37, the area doc §17, and Task 10's
  Goal item 9/AC13 all correctly state `exploratory` declares a `discovery` step (not
  `implementation`) and map it to `status: { active: discovering, completed:
  discovered }`, distinct from `standard`/`architectural`/`small`'s `implementation:
  { active: implementing, completed: implemented }`. No `refining`/`ready` pair
  introduced.
- **Task renumbering is complete and unambiguous.** Every "Task 10/11/12" reference in
  D22, D25, D27, D31, D36, D28, D8, D18, D21, and the already-implemented Tasks 07/08
  now names the current task number, with historical annotation ("originally Task 10
  before D37") where the surrounding sentence is itself historical narrative. D31
  explicitly states the owner-approved Standard decomposition is a precondition of
  **Task 11**, not the new Task 10, via its own renumbering note plus every normative
  occurrence in its body.
- **D37's heading matches its own body.** Retitled to name D18/D19/D28 (semantics
  corrected) and D14/C18 (`update-task` reconciliation corrected), with D23 explicitly
  stated unaffected — consistent with the Consequences section, which already said the
  same thing.
- **Task 10's own scope is narrow and coherent**: schema (`status` per step),
  store (`workflow_progress.state`), resolution (position/semantic-status as a pure
  function of `workflow_progress`+definition), the `step start` mutation path, `finish`'s
  corrected internal-transition write, crash-reconciliation intent, `StepContext`
  additions, and the four-file shipped-definition/template migration — all traceable to
  D37 and cross-referenced correctly. `allowed_paths`/`forbidden_paths` correctly exclude
  `gates/**` (beyond `human-gate.mjs`, not touched by this task), `actions/**`,
  `.nevo-ai/workflows/**` beyond the four exact files the migration needs, matching the
  D33-D36 precedent this task cites for that exact-file exception.
- **Dependency chain is truthful**: Task 10 depends on 08, 09 (both `verified`); Task 11
  depends on 08, 09, 10; Task 12 depends on 08, 10; Task 13 depends on 09, 10, 11, 12 —
  matches `change.yaml` exactly, and matches the prose in `overview.md`'s Implementation
  Decomposition and the area doc.

## Semantic-reference completeness

Task 10: `decisions` (D9, D10, D13, D14, D18, D19, D22, D23, D25, D28, D30, D32, D37),
`constraints` (C6, C11, C14, C15, C17, C18, C19, C21, C22, C27, C28, C29), and
`dependency_contracts` (multi-step-workflow-progression, fail-closed-workflow-definition-
resolution) all resolve and are load-bearing against the task's own Goal/constraints
text — nothing missing, nothing declared-but-unused. Tasks 11-13's own semantic
references (re-checked this run, full scope) resolve identically to the prior review's
already-recorded assessment, now against their current (post-renumbering) content.

## Next steps

Approve Task 10 (`/nevo-ai:spec-approve deterministic-workflow-foundation
step-active-completed-lifecycle`).
