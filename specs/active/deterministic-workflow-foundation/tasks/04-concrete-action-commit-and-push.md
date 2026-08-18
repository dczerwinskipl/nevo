---
id: deterministic-workflow-foundation.concrete-action-commit-and-push
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/concrete-actions-and-vertical-poc.md
    - tools/specs/workflow/contracts.mjs
    - tools/lib/git.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/actions/commit-and-push.mjs
  - tools/specs/workflow/actions/index.mjs
  - tools/specs/workflow/index.mjs
  - tools/lib/git.mjs
  - tools/tests/workflow-action-commit-push.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D4, D6, D8]
  constraints: [C2, C3, C4, C6, C9, C10]
---

# Task: Concrete action implementation: fail-closed commit-and-push

## Goal

Implement the `commit-and-push` action in `tools/specs/workflow/actions/commit-and-push.mjs` as the reference action implementation, providing non-mutating check with parameter schemas (`commitMessage`, `include`, `exclude`) and runtime Git facts, and fail-closed execution requiring explicit file selection.

## Implementation constraints

- `check(context)` must not stage, commit, push, or mutate Git state under any circumstances.
- Context extraction must report `changedFiles`, `stagedFiles`, `currentBranch`, `baseBranch`, `existingCommits`, and `taskAffectedFiles`.
- `execute(inputs, context)` must validate both `inputs.commitMessage` and `inputs.include`.
- **Fail-Closed File Selection Invariant:** If `inputs.include` is missing, empty, or not an array, execution must throw `PreconditionError`. The action must NEVER implicitly stage all dirty files without explicit caller instruction.
- Execute stages files matching `include` (respecting `exclude`), commits with the provided message, and pushes to upstream.
- Auto-register `commit-and-push` in the default action registry.

## Acceptance criteria

1. `CommitAndPushAction` implements `ActionContract` with ID `'commit-and-push'`. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
2. `check` produces `requiredInputs` with `commitMessage` (`required: true`) and `include` (`required: true`, describing explicit file selection). `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
3. `check` returns factual Git context without altering the repository or worktree. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
4. `execute` throws `PreconditionError` if `commitMessage` is missing, empty, or whitespace-only. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
5. `execute` throws `PreconditionError` if `include` is omitted, refusing to guess or stage dirty files implicitly. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
6. `execute` stages matching files, commits with the specified message, and pushes when valid explicit inputs are provided against a test repository fixture. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`

## Verification

```text
node --test tools/tests/workflow-action-commit-push.test.mjs
```
