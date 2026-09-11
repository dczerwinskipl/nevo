---
id: deterministic-workflow-foundation.production-multi-step-standard-workflow
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - .nevo-ai/workflows/standard.yaml
    - tools/specs/workflow/definitions/schema.mjs
    - docs/ai/specification-workflow.md
  optional:
    - docs/development/workflow-engine.md
allowed_paths:
  - .nevo-ai/workflows/standard.yaml
  - tools/specs/workflow/templates/standard.yaml
  - docs/development/workflow-engine.md
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-compatibility.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D7, D18, D19, D20, D25, D26, D27, D31, D37, D39, D40]
  constraints: [C9, C21, C22, C25, C26, C28]
  dependency_contracts: [multi-step-workflow-progression, fail-closed-workflow-definition-resolution, step-active-completed-lifecycle]
---

# Task: Production-quality multi-step standard workflow definition

## Goal

Replace `.nevo-ai/workflows/standard.yaml`'s current single-step placeholder
(`implementation -> verified`) and its initialization template
(`tools/specs/workflow/templates/standard.yaml`) with a real, three-step sequence for
Nevo's primary (Standard) specification class, proving the schema and the generalized
engine (Tasks 08-10, 12) genuinely support N independently-gated steps with rich behavior
contracts.

Per **D31** and **D39**, the Standard workflow decomposition is an owner-approved product
decision consisting of exactly three real work phases:
1. `implementation` (`implementing` -> `implemented`)
2. `review` (`reviewing` -> `reviewed`)
3. `human-verification` (`awaiting-human-verification` -> `completed`)

Visible lifecycle progression:
`new` -> `implementing` -> `implemented` -> `reviewing` -> `reviewed` -> `awaiting-human-verification` -> `completed`.

The final step transitions to `verified`, preserving the strict boundary between the
semantic workflow status axis (`completed`) and the repository's canonical coarse
`task.status` axis (`verified`).

Each step declares:
- an explicit `entryStep: implementation` (D27)
- exactly one transition per step (D27)
- its own distinct `status: { active, completed }` semantic-status pair (D37, Task 10)
- an authored behavior contract (`purpose`/`expectedWork`/`hints`, D25, Task 12)
  referencing real existing repository documentation
- independently declared `entryGates` and `exitGates` using existing registered gate types
- finalize actions using existing registered capabilities (`commit-and-push`)

## Implementation constraints

- **Pure configuration and documentation task**: This task modifies only
  `.nevo-ai/workflows/standard.yaml`, `tools/specs/workflow/templates/standard.yaml`,
  `docs/development/workflow-engine.md`, and `tools/tests/workflow-e2e.test.mjs`.
  **No changes to any `tools/specs/workflow/**` engine code**.
- **Approved 3-step decomposition (D39)**:
  1. **`implementation`**:
     - `status`: `{ active: implementing, completed: implemented }`
     - `purpose`: "Perform the approved implementation work for the task within declared scope."
     - `expectedWork`: `{ summary: "Modify code, tests, and documentation within allowed_paths to satisfy task acceptance criteria." }`
     - `hints`: real doc references (e.g. `docs/development/workflow-engine.md`, `docs/ai/task-execution-policy.md`)
     - `entryGates`: `[]`
     - `exitGates`: `[{ type: command, action: test }]`
     - `finalize`: `[{ id: commit-and-push }]`
     - `transitions`: `[{ to: review }]`
  2. **`review`**:
     - `status`: `{ active: reviewing, completed: reviewed }`
     - `purpose`: "Perform an independent quality review of the implementation against task acceptance criteria, applying corrective fixes if gaps are found."
     - `expectedWork`: `{ summary: "Audit implementation and test coverage, apply corrective edits within allowed_paths, and confirm automated verification passes." }`
     - `hints`: real doc references (e.g. `docs/ai/specification-workflow.md`, `docs/development/testing-strategy.md`)
     - `entryGates`: `[]`
     - `exitGates`: `[{ type: command, action: test }]`
     - `finalize`: `[{ id: commit-and-push }]`
     - `transitions`: `[{ to: human-verification }]`
  3. **`human-verification`**:
     - `status`: `{ active: awaiting-human-verification, completed: completed }`
     - `purpose`: "Explicit owner/user acceptance sign-off after automated implementation and independent review have completed."
     - `expectedWork`: `{ summary: "Confirm readiness with the repository owner and record explicit human verification sign-off." }`
     - `hints`: real doc references (e.g. `docs/ai/specification-workflow.md`, `docs/development/workflow-engine.md`)
     - `entryGates`: `[]`
     - `exitGates`: `[{ type: human, required: true, id: owner-acceptance }]`
     - `finalize`: `[{ id: commit-and-push }]`
     - `transitions`: `[{ to: verified }]`
- **Active review requirement**: The `review` step is not a ceremonial human click. The
  agent audits the implementation against task acceptance criteria, applies corrective
  edits within `allowed_paths` if defects or gaps are found, and re-runs test verification
  before finishing the step. No separate synthetic "quality-gate" step is created.
- **Human verification gate**: The `human-verification` step requires explicit human
  sign-off via the operator-facing `workflow verify-human --confirm` mechanism before
  `workflow step finish` can complete. It must never be auto-satisfied.
- **Terminal transition**: The final step's transition targets canonical `verified`
  (`TERMINAL_STATUSES`). Coarse `task.status` is never replaced with `completed`.
- **Terminal finalize commit-and-push (D39)**: `human-verification` retains
  `finalize: [{ id: commit-and-push }]` because finishing the terminal step mutates
  tracked workflow/task state (`workflow_progress.state: completed` + canonical
  `task.status: verified`). That terminal state must participate in the normal
  commit/push lifecycle rather than remain as an uncommitted tracked mutation.
- **Existing registered capabilities only**: Use only registered action IDs
  (`commit-and-push`) and gate types (`command`, `human`). Do not invent new actions or
  gates. Preserve Task 09 fail-closed validation.
- **Template parity**: `tools/specs/workflow/templates/standard.yaml` must match
  `.nevo-ai/workflows/standard.yaml` exactly so newly scaffolded repositories receive the
  identical production workflow definition.
- **Documentation**: Update `docs/development/workflow-engine.md` to document the 3-step
  Standard workflow shape.

## Acceptance criteria

1. **Precondition satisfied (D31, D39):** `owner-decisions.md` contains the approved
   decision D39 establishing the concrete 3-step Standard workflow decomposition
   (`implementation` -> `review` -> `human-verification` -> `verified`), its semantic
   statuses, gate composition, behavioral metadata, and finalize actions.
   `manual: verify D39 exists and is recorded as approved in owner-decisions.md before running task-start`
2. `.nevo-ai/workflows/standard.yaml` and `tools/specs/workflow/templates/standard.yaml`
   declare the exact three-step sequence (`implementation`, `review`, `human-verification`)
   approved in D39, each with its own gates, distinct `status: { active, completed }` pair,
   `entryStep: implementation`, exactly one transition per step, and final transition `to: verified`.
   `automated: node tools/specs.mjs validate`
3. Loading the new definition succeeds under Task 09's fail-closed validation (every
   action id and gate type referenced is registered), Task 08's version-compatibility
   check (`version: 1`), and Task 10's required-`status`-per-step schema check (D37).
   `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. Every step declares an authored, step-specific `purpose`, `expectedWork.summary`, and
   `hints` referencing existing repository documents (`docs/development/workflow-engine.md`,
   `docs/ai/specification-workflow.md`, `docs/ai/task-execution-policy.md`,
   `docs/development/testing-strategy.md`).
   `automated: node --test tools/tests/workflow-e2e.test.mjs`
5. `docs/development/workflow-engine.md` reflects the real 3-step shape (no stale
   single-step example left as if it were current).
   `automated: node tools/docs.mjs check`
6. Existing tests in the test suite remain unaffected except for the explicitly
   identified stale assertion in `tools/tests/workflow-compatibility.test.mjs` against the
   production Standard definition, which is updated to validate the D39 shape (D40),
   proving the new Standard workflow definition integrates cleanly without regressing
   earlier engine or fixture behaviors.
   `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node tools/specs.mjs validate
node tools/docs.mjs check
node --test tools/tests/*.test.mjs
```
