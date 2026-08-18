# Area: Concrete Actions and Vertical Proof-of-Concept

## Purpose

Implement fail-closed `commit-and-push` and `verify-task-output` actions, validate non-mutating check contracts, enforce strict fail-closed parameter validation (explicit file selection), and demonstrate the multi-action implementation/finalize vertical proof-of-concept alongside the legacy workflow.

## Concrete Action: `commit-and-push` (`tools/specs/workflow/actions/commit-and-push.mjs`)

### 1. Non-Mutating Check (`check(context)`)
- **Required Inputs Schema:**
  - `commitMessage` (`type: "string"`, `required: true`, `description: "Commit message describing task changes"`, `constraints: { minLength: 5 }`)
  - `include` (`type: "array"`, `required: true`, `description: "Explicit file selection array (e.g. ['*'] or ['src/**'])"`)
  - `exclude` (`type: "array"`, `required: false`, `description: "File paths or globs to exclude from staging"`)
- **Context Generation:**
  - `changedFiles`: Uncommitted files from Git status.
  - `stagedFiles`: Files currently staged.
  - `taskAffectedFiles`: Dirty files matching the task's `allowed_paths`.
  - `generatedFiles`: Generated artifacts/indexes.
  - `currentBranch`: Active Git branch.
  - `baseBranch`: Base branch (e.g. `main`).
  - `existingCommits`: Recent commits on this branch.

### 2. Fail-Closed File Selection Invariant (`execute(inputs, context)`)
- **Strict Validation:**
  - If `commitMessage` is missing or empty, throws `PreconditionError('Action commit-and-push requires non-empty commitMessage')`.
  - If `include` is missing or not an array with at least one entry, throws `PreconditionError('Action commit-and-push requires explicit include parameter')`.
  - **No Implicit Fallback:** Execution must NEVER implicitly stage all dirty files when `include` is omitted. The caller must explicitly choose what files to commit.
- **Execution Operations:**
  - Stages files matching `include` (excluding any matching `exclude`).
  - Creates Git commit with the explicit `commitMessage`.
  - Pushes the branch to upstream tracking ref.
  - Returns `ActionExecuteResult` with `commitSha`, `pushedBranch`, and summary.

## Vertical Proof-of-Concept: Implementation/Finalize Fragment

Compose a representative workflow step in a test definition:
```yaml
implementation:
  exitGates:
    - type: command
      action: test
    - type: human
      required: true
  finalize:
    - id: verify-task-output
    - id: commit-and-push
```

### Proof Scenarios to Validate:
- **Scenario A (Introspection):** Run `--check` on the finalize step; verify non-mutating aggregation of both actions' schemas and context.
- **Scenario B (Gate Inspection):** Run `inspect` on exit gates; verify gate metadata and requirements are returned without executing tests.
- **Scenario C (Gate Enforcement):** Attempt to finalize while human verification is unrecorded; verify transition is blocked.
- **Scenario D (Fail-Closed Execution):** Run `commit-and-push` without explicit `include` or `commitMessage`; verify immediate fail-closed rejection without Git mutation.
- **Scenario E (Successful Finalization):** Satisfy gates, provide explicit inputs, and execute finalize actions; verify atomic transition to next status.
- **Scenario F (Coexistence):** Run legacy `specs.mjs finalize` on a legacy specification; verify 100% legacy flow continuity.
