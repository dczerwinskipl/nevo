---
id: result-driven-transitions.standard-workflow-review-loop-and-e2e-proof
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - .nevo-ai/workflows/standard.yaml
    - tools/specs/workflow/templates/standard.yaml
    - docs/development/workflow-engine.md
    - tools/specs/workflow/cli.mjs
    - tools/specs.mjs
  optional:
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - .nevo-ai/workflows/standard.yaml
  - tools/specs/workflow/templates/standard.yaml
  - docs/development/workflow-engine.md
  - tools/tests/workflow-e2e-loop.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16]
---

# Task: Production standard workflow review loop and end-to-end multi-attempt proof

## Goal

Update `.nevo-ai/workflows/standard.yaml` and `tools/specs/workflow/templates/standard.yaml` to implement an iterative review loop with conditional transitions (`pass`/`fail`), update workflow engine documentation in `docs/development/workflow-engine.md` to document declarative transitions, attempt scoping, and generic CLI transport, and build a comprehensive end-to-end integration test proving the multi-attempt workflow lifecycle from initial activation through repeated attempts to terminal verification.

## Implementation constraints

- In `.nevo-ai/workflows/standard.yaml` and `tools/specs/workflow/templates/standard.yaml`:
  - Update `review` step transitions:
    ```yaml
    transitions:
      - value: pass
        to: human-verification
      - value: fail
        to: implementation
    ```
- In `docs/development/workflow-engine.md`:
  - Document unconditional vs result-driven conditional transitions.
  - Document the closed transition enum in v1 (`pass`, `fail`, `blocked`) and extensible engine design.
  - Document attempt identity, monotonic attempt derivation, and history invariants.
  - Document attempt-scoped runtime storage (`.nevo-ai-local/workflow-operations/...` and `human-verifications/...`).
  - Document the canonical `finishContract.parameters` schema and generic CLI transport (`--input <json>` / `--input-file <path>`).
  - Document discriminated transition output structure.
- In `tools/tests/workflow-e2e-loop.test.mjs`:
  - Implement an end-to-end integration test driving a task through the complete loop:
    1. Start `implementation` (attempt 1).
    2. Finish `implementation` (attempt 1) with `{"commit.title": "implement task", "include": ["*"]}` -> transitions to `review`.
    3. Start `review` (attempt 1).
    4. Finish `review` (attempt 1) with `{"result": "fail", "commit.title": "review: fail", "include": ["*"], "artifacts": ["docs/audit-1.md"]}` -> transitions back to `implementation`.
    5. Start `implementation` (attempt 2).
    6. Finish `implementation` (attempt 2) with `{"commit.title": "fix implementation", "include": ["*"]}` -> transitions to `review`.
    7. Start `review` (attempt 2).
    8. Finish `review` (attempt 2) with `{"result": "pass", "commit.title": "review: pass", "include": ["*"], "artifacts": ["docs/audit-2.md"]}` -> transitions to `human-verification`.
    9. Start `human-verification` (attempt 1).
    10. Confirm human signoff via `workflow verify-human` for attempt 1.
    11. Finish `human-verification` (attempt 1) with `{"commit.title": "human verified", "include": ["*"]}` -> transitions to terminal `verified`.
  - Verify that each attempt receives isolated storage files and that `workflow_progress.history` captures all distinct attempts with correct results and artifact references.

## Acceptance criteria

1. `.nevo-ai/workflows/standard.yaml` and `tools/specs/workflow/templates/standard.yaml` pass validation with the conditional review loop transitions. `automated: node tools/specs.mjs check`
2. `docs/development/workflow-engine.md` accurately documents declarative transitions, attempt scoping, generic transport, and discriminated output. `automated: node tools/docs.mjs check`
3. End-to-end test completes the full multi-attempt cycle cleanly using generic `--input` JSON transport. `automated: node --test tools/tests/workflow-e2e-loop.test.mjs`
4. Operation records, human verifications, and history entries remain isolated across attempts. `automated: node --test tools/tests/workflow-e2e-loop.test.mjs`
5. All tests across the entire repository pass and `node tools/specs.mjs check` reports zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-e2e-loop.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
