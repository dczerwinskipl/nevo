---
id: deterministic-workflow-foundation.cli-integration-and-vertical-poc
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/concrete-actions-and-vertical-poc.md
    - specs/active/deterministic-workflow-foundation/areas/workflow-engine-and-next-step.md
    - tools/specs.mjs
    - tools/specs/workflow/index.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/workflow/**
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - docs/development/workflow-engine.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D6, D8, D9, D10, D11, D12, D13, D14, D15, D16]
  constraints: [C1, C2, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16]
---

# Task: CLI integration, `step start`/`step finish` vertical PoC, and coexistence verification

## Goal

Integrate the deterministic workflow engine into `tools/specs.mjs` behind the two-call
agent-facing surface `workflow step start <change> [task]` / `workflow step finish
<change> [task] [--check]` (D9), execute the vertical proof-of-concept end-to-end —
including an interrupted-and-resumed finish — and verify full coexistence and zero
regressions with the legacy workflow. Document the engine architecture and the
legacy/deterministic migration map (D16) in `docs/development/workflow-engine.md`.

## Implementation constraints

- In `tools/specs.mjs`, delegate cleanly to `tools/specs/workflow/` without expanding
  existing handlers with large branch logic.
- Expose exactly the agent-facing surface from D9 — `node tools/specs.mjs workflow step
  start <change> [task]` and `node tools/specs.mjs workflow step finish <change> [task]
  [--check]` — as the primary PoC surface. An explicit step id remains available as an
  optional diagnostic/override argument, never required in the normal flow. Do not also
  expose the original `next-step`/`execute-step` commands as separate agent-facing
  entries — those were superseded before implementation (D9).
- Execute the vertical PoC multi-action implementation/finalize flow end-to-end against
  fixture repositories, proving in sequence:
  1. `step start` returns useful context and the finish contract (requirements known in
     advance),
  2. agent work changes files,
  3. `step finish`/`step finish --check` surfaces current files/commits and missing
     semantic inputs without mutation,
  4. gates execute deterministically (`inspect` during planning, `verify` only during
     actual finalize execution),
  5. task/spec status is updated,
  6. the resulting progress — implementation plus the task/spec status update — is
     committed together (D13),
  7. push is confirmed,
  8. the workflow transitions,
  9. the next step is returned,
  10. retrying `step finish` after a simulated interruption does not duplicate completed
      side effects (covering all four interruption points from Task 06's acceptance
      criteria 6-9).
- Verify that legacy specifications and commands (`start`, `complete`, `verify`,
  `approve`, `finalize`, `self-check`, `batch-*`) execute their existing behavior without
  alteration.
- Document in `docs/development/workflow-engine.md`: the engine architecture, action/gate
  contracts, the `StepContext`/finish-contract/finish-planning shapes, the durable
  finish-operation model, the source-control capability boundary (local Git vs. remote
  provider), and the legacy/deterministic migration map from `overview.md` § "Legacy
  Lifecycle: Operational, Explicitly Superseded" (D16), transcribed faithfully rather than
  re-derived.

## Acceptance criteria

1. CLI exposes `node tools/specs.mjs workflow step start <change> [task]` and `node
   tools/specs.mjs workflow step finish <change> [task] [--check]`, returning the
   `StepContext`/finish-planning JSON shapes defined in `areas/workflow-engine-and-next-step.md`.
   `automated: node --test tools/tests/workflow-cli.test.mjs`
2. Multi-step finalize vertical PoC executes end-to-end under deterministic mode: `step
   start` returns the finish contract in advance, `step finish --check` aggregates
   non-mutating planning facts, fail-closed rejects missing `commit.title`/`include` via
   `input-required` (never a partial mutation), human verification blocks until confirmed,
   and valid execution completes the finalize step with the implementation and task/spec
   status update in one commit. `automated: node --test tools/tests/workflow-e2e.test.mjs`
3. An interrupted-and-resumed `step finish` is exercised for each of the four points
   required by specification requirement 6 (after task-metadata update, after commit
   creation, with an ambiguous push result, after successful push but before transition)
   and, in each case, retrying completes the remaining stages without duplicating a
   completed side effect. `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. A `step finish` call repeated after a fully successful run returns the already-completed
   result and current next step without repeating any finalize action. `automated: node --test tools/tests/workflow-e2e.test.mjs`
5. Legacy specifications without `workflow.mode` execute legacy `finalize` and lifecycle
   commands without interference. `automated: node --test tools/tests/workflow-e2e.test.mjs`
6. `docs/development/workflow-engine.md` documents the engine architecture, action
   contracts, input schemas, gate types, the `StepContext`/finish-planning/durable-finish
   model, the source-control capability boundary, and the legacy/deterministic migration
   map. `automated: node tools/docs.mjs check`
7. The full repository test suite `node --test tools/tests/*.test.mjs` passes with zero
   failures. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
