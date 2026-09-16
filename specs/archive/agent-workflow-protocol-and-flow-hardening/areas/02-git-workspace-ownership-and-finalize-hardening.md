# Area: Git Workspace Ownership, Finalize Hardening & Review Durability

## Purpose

Define the operational Git invariants for deterministic workflow execution, ensuring that changes from one step or attempt never leak into another, establishing full workspace ownership for standard deterministic workflows, and guaranteeing durable persistence of review evidence.

## Operational Git Invariants

### 1. Clean Baseline Before Allocating a NEW Attempt
When `ensureStepActivated` activates a new logical attempt:
- **New Attempt Allocation:** Moving from `completed -> active` (e.g. `implementation` attempt 2 after review fail) or initializing attempt 1 (`new -> active`).
- **Invariant:** The repository working tree must be strictly clean before the new attempt is activated. If any untracked or modified files exist that are not committed or ignored, activation fails closed with a `PreconditionError` / `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`.
- **Rationale:** Prevents uncommitted scratch files or lingering edits from an earlier failed attempt from silently contaminating a new attempt baseline.

### 2. Idempotent Resume on ACTIVE Attempt
When `workflow step start` is called on a step that is already in `runtimeState === 'active'`:
- **Resume Operation:** The agent or operator is re-reading context or resuming an attempt already in progress.
- **Invariant:** A dirty working tree is expected and permitted. The engine returns the current `StepContext` without error.
- **Distinction:** The clean-worktree invariant applies when *allocating* a new attempt, never when *resuming* an active one.

### 3. Whole-Attempt Workspace Ownership in Standard Workflows
In the shipped standard deterministic workflow:
- The agent establishes a clean baseline at attempt start.
- During `workflow step finish`, the agent is not required to manually enumerate every touched file in an `include` array.
- The workflow owns the entire step workspace:
  - `include` defaults to all changes in the working tree (`['*']`), filtered through the task's `allowed_paths`.
  - An explicit `include` and `exclude` parameter remains supported in the contract for custom workflows or targeted staging.
  - If unexpected files outside `allowed_paths` were modified, finish fails closed before staging.

### 4. Graceful Zero-Modification Handling (Noop Commit)
In steps such as `review` (when no code fixes are needed) or `human-verification` (pure sign-off):
- The working tree may have zero modified files.
- In `CommitAndPushAction`:
  - If the working tree is clean (`dirtyPaths.length === 0`), `executeValidated` does not throw `EMPTY_FILE_SELECTION`.
  - Instead, it logs a noop commit (`Committed 0 file(s); working tree clean`), outputs `{ commit: { status: 'noop', sha: currentSha } }`, and allows the step to finish cleanly.

### 5. Postcondition Verification: Clean Tree After Successful Finish
- Upon successful execution of `workflow step finish` where `commit-and-push` is configured:
  - All modified files belonging to the attempt have been committed.
  - The working tree must be clean.
  - If uncommitted files remain (e.g. untracked files not matched by include or excluded by policy), the operation raises an alert so the developer/agent can resolve before next step.

## Review Step Durability

### Problem
A review failure represented solely by `result: 'fail'` loses the actual auditor findings inside an ephemeral chat transcript. The subsequent implementation agent (attempt N+1) would have no actionable evidence describing what went wrong.

### Durable Review Evidence Contract
1. **Review Artifact:**
   - The review step produces a durable markdown review artifact, conventionally located at:
     `specs/active/<change>/reviews/task-<taskId>-attempt-<attempt>.md`
   - The file documents findings, severity, affected files, and recommended fixes.
2. **Finish Contract Integration:**
   - In `workflow step finish`, the review agent provides:
     ```json
     {
       "result": "fail",
       "artifacts": ["specs/active/<change>/reviews/task-01-attempt-1.md"],
       "feedback": "Add crash recovery test for dirty tree during finalize."
     }
     ```
   - The `artifacts` array and `feedback` string are recorded into the `workflow_progress.history` entry for that step and attempt.
3. **StepContext Projection for Next Attempt:**
   - When implementation attempt 2 starts, `compileStepContext` inspects the prior review entry and enriches `StepContext`:
     ```json
     "previousTransition": {
       "from": "review",
       "attempt": 1,
       "result": "fail",
       "requestedChanges": "Add crash recovery test for dirty tree during finalize.",
       "artifacts": ["specs/active/<change>/reviews/task-01-attempt-1.md"]
     }
     ```
   - The implementation agent directly accesses these review findings without relying on chat history.
