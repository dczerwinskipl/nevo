# Area: Source-Control Capability and Vertical Proof-of-Concept

## Purpose

Implement the minimal source-control capability boundary — local Git actions plus a
separately configured remote provider — required by deterministic workflow finalization
(D12), and demonstrate the multi-action implementation/finalize vertical proof-of-concept
through the `workflow step start` / `workflow step finish` agent-facing surface (D9),
alongside the legacy workflow.

This area was originally scoped around a single `commit-and-push` action. It now covers
the full source-control capability boundary that action sits on top of — see D12 in
`owner-decisions.md` for why the scope grew and why Task 04 was renamed.

## Two Layers: Local Git Capability vs. Remote Provider

- **Local Git capability**, built on the existing `tools/lib/git.mjs` (already used by the
  legacy `finalize`/`archive` paths for `commitAll`/`push` — extended, not replaced):
  repository/worktree state, changed files, staged files, current branch, base branch,
  existing commits, commit, push, and a new reconciliation primitive answering "is commit
  `X` already present on the configured remote branch" (needed by Task 06's durable finish
  operation to reconcile an `unknown` push result — see `areas/workflow-engine-and-next-step.md`).
- **Remote provider**, built on the existing `tools/lib/github.mjs` (the repository's one
  GitHub integration — no second GitHub abstraction is introduced): configured explicitly
  via `remote.provider`, used only when `remote.enabled`. `github` is the only implemented
  provider; GitLab remains unimplemented — only the boundary that could later accept one
  exists.

## Configuration Boundary

```yaml
sourceControl:
  enabled: true
  git:
    enabled: true
    push: true
  remote:
    enabled: true
    provider: github
```

Source control, local push, and the remote provider are each independently
enable/disable-able. The exact schema location (workflow definition file vs. per-change
manifest) is a Task 04 implementation decision; the semantics above (independent
enable/disable at each level, explicit provider naming when remote operations are
enabled) are fixed by D12/C13. If source control is disabled, the commit/push action
contributes no `requiredInputs` to a step's aggregated finish contract.

## Concrete Action: Source-Control Commit/Push (`tools/specs/workflow/actions/commit-and-push.mjs`)

### 1. Non-Mutating Check (`check(context)`)
- **Required Inputs Schema:**
  - `commit.title` (`type: "string"`, `required: true`, `description: "Conventional commit title describing the change"`, `constraints: { minLength: 5 }`)
  - `commit.message` (`type: "string"`, `required: false`, `description: "Extended commit body"`)
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
  - `unpushedCommits`: Commits on `currentBranch` not yet present on its remote-tracking branch (via the reconciliation primitive above) — `null`/absent when `sourceControl.enabled` or `git.push` is `false`.

### 2. Fail-Closed File Selection Invariant (`execute(inputs, context)`)
- **Strict Validation:**
  - If `commit.title` is missing or empty, throws `PreconditionError('Action commit-and-push requires non-empty commit.title')`.
  - If `include` is missing or not an array with at least one entry, throws `PreconditionError('Action commit-and-push requires explicit include parameter')`.
  - **No Implicit Fallback:** Execution must NEVER implicitly stage all dirty files when `include` is omitted. The caller must explicitly choose what files to commit.
- **Execution Operations:**
  - Stages files matching `include` (excluding any matching `exclude`).
  - Creates a Git commit with the explicit `commit.title`/`commit.message`.
  - Pushes the branch to upstream tracking ref when `git.push` is enabled.
  - Returns `ActionExecuteResult` with outputs shaped for durable persistence (D15):
    ```json
    {
      "commit": { "sha": "abc123", "status": "completed" },
      "push": { "remote": "origin", "branch": "feature/workflow-foundation", "expectedSha": "abc123", "status": "completed" }
    }
    ```

This action is invoked as one stage of Task 06's durable finish operation (see
`areas/workflow-engine-and-next-step.md`), not called directly by the agent — the agent
never runs Git/`gh` commands itself (specification requirement 3).

## Vertical Proof-of-Concept: `workflow step start` / `workflow step finish`

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
- **Scenario A (Compiled `StepContext`):** Run `workflow step start`; verify the returned
  `StepContext` aggregates both finalize actions' schemas, factual context, and the
  step-level finish contract, without requiring a separate per-action inspection call.
- **Scenario B (Non-Mutating Finish Planning):** Run `workflow step finish --check` before
  supplying inputs; verify it aggregates current changed files, staged/untracked state,
  commits, branch/HEAD, push status, planned operations, and missing inputs, and mutates
  nothing.
- **Scenario C (Gate Inspection):** Run `inspect` on exit gates (as part of `step start`'s
  aggregation); verify gate metadata and requirements are returned without executing tests.
- **Scenario D (Gate Enforcement):** Attempt `workflow step finish` while human
  verification is unrecorded; verify the transition is blocked.
- **Scenario E (Fail-Closed Execution / `input-required`):** Run `workflow step finish`
  without explicit `include` or `commit.title`; verify it returns `status: "input-required"`
  with zero mutation, never a partial commit.
- **Scenario F (Successful Finalization):** Satisfy gates, provide explicit inputs, and run
  `workflow step finish`; verify the resulting commit contains both the implementation and
  the task/spec completion-state update (D13), push is confirmed, and the workflow
  transitions to the next step.
- **Scenario G (Interrupted and Resumed Finish):** Simulate an interruption at each of the
  four points required by specification requirement 6 (after task-metadata update, after
  commit creation, with an ambiguous push result, after successful push but before
  transition); verify a retried `workflow step finish` reconciles `unknown` stages against
  real repository/remote state, never repeats a completed side effect (in particular never
  creates a second commit), and completes the remaining stages.
- **Scenario H (Idempotent Repeat):** Call `workflow step finish` again after a fully
  successful run; verify it returns the already-completed result and current next step
  without repeating any finalize action.
- **Scenario I (Coexistence):** Run legacy `specs.mjs finalize` on a legacy specification;
  verify 100% legacy flow continuity.
