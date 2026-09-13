---
id: result-driven-transitions.standard-workflow-loop-and-multi-attempt-e2e
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - .nevo-ai/workflows/standard.yaml
    - tools/specs/workflow/templates/standard.yaml
    - docs/development/workflow-engine.md
  optional:
    - tools/tests/workflow-multi-step-e2e.test.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - .nevo-ai/workflows/standard.yaml
  - tools/specs/workflow/templates/standard.yaml
  - docs/development/workflow-engine.md
  - tools/tests/workflow-result-driven-e2e.test.mjs
  - tools/tests/workflow-multi-step-e2e.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14]
---

# Task: Production standard workflow review loop and end-to-end multi-attempt proof

## Goal

Update the production standard workflow definition (`.nevo-ai/workflows/standard.yaml` and template) to incorporate result-driven transitions (`pass` -> `human-verification`, `fail` -> `implementation`), update documentation in `docs/development/workflow-engine.md`, and implement an end-to-end multi-attempt test proving the complete cycle from implementation through rejected review, re-implementation, approved review, human signoff, and terminal verification.

## Implementation constraints

- Update `.nevo-ai/workflows/standard.yaml` and `tools/specs/workflow/templates/standard.yaml`:
  - `implementation`: unconditional transition to `review`.
  - `review`: result-driven transitions with `pass` -> `human-verification` and `fail` -> `implementation`.
  - `human-verification`: transition to `verified`.
- Update `docs/development/workflow-engine.md` documenting the result-driven transition engine, attempt identity and invariants, canonical finish contract, and discriminated transition outputs.
- Create an end-to-end integration test (`tools/tests/workflow-result-driven-e2e.test.mjs`) testing the full loop:
  1. Task starts at `implementation` (attempt 1).
  2. Finishes `implementation` (attempt 1) -> transitions to `review`.
  3. Starts `review` (attempt 1).
  4. Finishes `review` (attempt 1) with `--result fail` -> transitions to `implementation`.
  5. Starts `implementation` (attempt 2) -> confirms attempt 2 identity and separate operation record.
  6. Finishes `implementation` (attempt 2) -> transitions to `review`.
  7. Starts `review` (attempt 2) -> confirms attempt 2 identity.
  8. Finishes `review` (attempt 2) with `--result pass` -> transitions to `human-verification`.
  9. Starts `human-verification` (attempt 1).
  10. Operator confirms via `workflow verify-human --confirm`.
  11. Finishes `human-verification` -> terminal status `verified`.
- Ensure all repository checks and documentation checks pass cleanly.

## Acceptance criteria

1. Standard workflow definition passes validation with review loop transitions. `automated: node tools/specs.mjs validate`
2. End-to-end multi-attempt workflow test executes full loop through rejection and successful resolution with distinct attempt identities. `automated: node --test tools/tests/workflow-result-driven-e2e.test.mjs`
3. All existing unit and e2e workflow test suites pass with zero regressions. `automated: node --test tools/tests/*.test.mjs`
4. Documentation in `docs/development/workflow-engine.md` accurately describes result-driven transitions and attempt scoping. `automated: node tools/docs.mjs check`
5. Repository validation and spec indexes are up to date and clean. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-result-driven-e2e.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
