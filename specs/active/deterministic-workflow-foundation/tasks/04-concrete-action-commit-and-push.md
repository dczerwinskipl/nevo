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

# Task: Concrete action implementation: commit-and-push

## Goal

Implement the `commit-and-push` action in `tools/specs/workflow/actions/commit-and-push.mjs` as the reference action implementation, providing non-mutating check with parameter schema (`commitMessage`, `include`, `exclude`) and runtime Git facts, and fail-closed execution.

## Implementation constraints

- `check(context)` must not stage, commit, push, or mutate Git state under any circumstances.
- Context extraction must report `changedFiles`, `stagedFiles`, `currentBranch`, `baseBranch`, `existingCommits`, and `taskAffectedFiles`.
- `execute(inputs, context)` must validate `inputs.commitMessage` and reject missing or blank values with `PreconditionError`.
- Execute stages files matching `include` (respecting `exclude`), commits with the provided message, and pushes to upstream.
- Auto-register `commit-and-push` in the default action registry.

## Acceptance criteria

1. `CommitAndPushAction` implements `ActionContract` with ID `'commit-and-push'`. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
2. `check` produces `requiredInputs` with `commitMessage` marked `required: true` and `include`/`exclude` marked `required: false`. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
3. `check` returns factual Git context without altering the repository or worktree. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
4. `execute` throws `PreconditionError` if `commitMessage` is missing, empty, or whitespace-only. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
5. `execute` stages matching files, commits with the specified message, and pushes when valid inputs are provided against a test repository fixture. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`

## Verification

```text
node --test tools/tests/workflow-action-commit-push.test.mjs
```
