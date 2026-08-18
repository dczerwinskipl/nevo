# Area: Concrete Actions and Vertical Proof-of-Concept

## Purpose

Implement `commit-and-push` as the primary vertical proof-of-concept for the deterministic workflow engine, demonstrate multi-action step aggregation, validate non-mutating check contracts, enforce fail-closed execution, and prove coexistence alongside the existing legacy workflow.

## Concrete Action: `commit-and-push` (`tools/specs/workflow/actions/commit-and-push.mjs`)

### 1. Non-Mutating Check (`check(context)`)
- **Required Inputs Schema:**
  - `commitMessage` (`type: "string"`, `required: true`, `description: "Commit message describing task changes"`, `constraints: { minLength: 5 }`)
  - `include` (`type: "array"`, `required: false`, `description: "Explicit file paths or globs to stage (defaults to task allowed_paths or all dirty files)"`)
  - `exclude` (`type: "array"`, `required: false`, `description: "File paths or globs to omit from staging"`)
- **Context Generation:**
  - `changedFiles`: Uncommitted files from `git status --porcelain=v1 -z`.
  - `stagedFiles`: Staged files in index.
  - `currentBranch`: Active Git branch.
  - `baseBranch`: Base branch (e.g. `main`).
  - `existingCommits`: Recent commits on this branch.
  - `taskAffectedFiles`: Filtered dirty files overlapping the task's `allowed_paths`.

### 2. Fail-Closed Execution (`execute(inputs, context)`)
- Validates `inputs.commitMessage` is present, non-empty, and satisfies constraints.
- If `commitMessage` is missing, throws `PreconditionError('Action commit-and-push requires non-empty commitMessage')`.
- Stages requested files matching `include` (and excluding `exclude`).
- Creates Git commit with the explicit `commitMessage`.
- Pushes the branch to upstream `origin`.
- Returns `ActionExecuteResult` with `commitSha`, `pushedBranch`, and summary.

## Vertical Proof-of-Concept: Multi-Step Finalize

Compose a multi-action step `finalize`:
1. Gate: `CommandGate` ensuring tests pass (`npm test` / `dotnet test`).
2. Action 1: `verify-task-output` (non-mutating output inspection).
3. Action 2: `commit-and-push` (staging, committing, and pushing).

### Proof Scenarios to Validate:
- **Scenario A (Introspection):** Run `--check` on the finalize step; verify non-mutating aggregation of both actions' schemas and context.
- **Scenario B (Fail-Closed):** Run `execute` without `commitMessage`; verify immediate rejection without Git state mutation.
- **Scenario C (Successful Execution):** Run `execute` with valid parameters; verify all actions execute in sequence and state is cleanly updated.
- **Scenario D (Coexistence):** Run legacy `specs.mjs finalize` on a legacy specification; verify 100% legacy flow continuity.
