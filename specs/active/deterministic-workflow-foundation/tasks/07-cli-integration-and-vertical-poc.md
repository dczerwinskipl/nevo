---
id: deterministic-workflow-foundation.cli-integration-and-vertical-poc
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/concrete-actions-and-vertical-poc.md
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
  decisions: [D1, D6, D8]
  constraints: [C1, C2, C5, C6, C7, C9, C10]
---

# Task: CLI integration, vertical finalize PoC, and coexistence verification

## Goal

Integrate the deterministic workflow engine and commands into `tools/specs.mjs`, execute the multi-step `finalize` vertical proof-of-concept (`verify-task-output` + `commit-and-push` + test gate), and verify full coexistence and zero regressions with the legacy workflow.

## Implementation constraints

- In `tools/specs.mjs`, delegate cleanly to `tools/specs/workflow/` without expanding existing handlers with large branch logic.
- Expose deterministic workflow commands (e.g. `node tools/specs.mjs workflow next-step <change>` and `--check` on step actions).
- Execute the vertical PoC multi-step `finalize` flow end-to-end against fixture repositories.
- Verify that legacy specifications and commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) execute their existing behavior without alteration.
- Document the new deterministic workflow engine architecture in `docs/development/workflow-engine.md`.

## Acceptance criteria

1. CLI exposes `node tools/specs.mjs workflow next-step <change> [task]` and returns formatted deterministic next-step JSON. `automated: node --test tools/tests/workflow-cli.test.mjs`
2. Multi-step finalize vertical PoC executes end-to-end under deterministic mode: non-mutating check aggregates contracts, fail-closed rejects missing commit messages, and valid execution completes the finalize step. `automated: node --test tools/tests/workflow-e2e.test.mjs`
3. Legacy specifications without `workflow.mode` execute legacy `finalize` and lifecycle commands without interference. `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. `docs/development/workflow-engine.md` documents the engine architecture, action contracts, input schemas, gate types, and migration roadmap. `automated: node tools/docs.mjs check`
5. The full repository test suite `node --test tools/tests/*.test.mjs` passes with zero failures. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
