# Area: Composable Actions and Contracts

## Purpose

Define the extensible architecture for workflow actions, establishing the non-mutating `check` contract, structured `requiredInputs` parameter schemas, read-only `context` facts, aggregated multi-action step checking, and fail-closed `execute` semantics.

## Core Abstraction: `ActionContract`

Each workflow action is an isolated, cohesive module implementing `ActionContract`:
```javascript
export class ActionContract {
  /** Unique action identifier (e.g. 'commit-and-push', 'verify-task-output') */
  get id() { throw new Error('Not implemented'); }

  /** Human-readable description of what this action does */
  get description() { throw new Error('Not implemented'); }

  /**
   * Introspect current state without mutating anything.
   * @param {ActionContext} context - Environmental context (change, task, repo root, etc.)
   * @returns {Promise<ActionCheckResult>}
   */
  async check(context) { throw new Error('Not implemented'); }

  /**
   * Execute the action's operations using explicit input values.
   * @param {Record<string, any>} inputs - Caller-supplied input parameters
   * @param {ActionContext} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async execute(inputs, context) { throw new Error('Not implemented'); }
}
```

## Non-Mutating `check` Contract

The `check` operation must strictly satisfy:
1. **Zero Side Effects:** Never write files, execute Git commit/push, modify manifest files, change branch refs, or mutate remote state.
2. **`requiredInputs` Specification:**
   Returns an array of parameter definition objects:
   ```json
   {
     "name": "commitMessage",
     "type": "string",
     "required": true,
     "description": "Commit message describing the completed task",
     "constraints": {
       "minLength": 10,
       "pattern": "^(feat|fix|docs|refactor|test|chore)(\\(.*\\))?: .+"
     }
   }
   ```
   Supported parameter types: `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`.
3. **`context` Facts Specification:**
   Returns read-only factual state gathered from the local environment to assist the agent/user in providing required input values:
   ```json
   {
     "changedFiles": ["tools/specs/workflow/contracts.mjs"],
     "stagedFiles": [],
     "branch": "feature/workflow-foundation",
     "baseBranch": "main",
     "existingCommits": ["825bebc Add initial contracts"]
   }
   ```
4. **Boundary Isolation:** `requiredInputs` and `context` remain distinct properties. Context provides facts; required inputs define expectations.

## Fail-Closed `execute` Contract

The `execute` operation strictly adheres to:
1. **Schema Validation:** Every input in `inputs` is validated against `requiredInputs`. If any required parameter is missing or violates type/constraints, execution aborts immediately with a `PreconditionError`.
2. **No Heuristic Guessing:** The action must never attempt to infer or auto-generate missing parameters. The agent or human caller must supply explicit values.
3. **Structured Execution Result (`ActionExecuteResult`):**
   ```json
   {
     "success": true,
     "actionId": "commit-and-push",
     "outputs": {
       "commitSha": "3f4a9b2c...",
       "pushedBranch": "feature/workflow-foundation"
     },
     "summary": "Committed 2 files and pushed to origin/feature/workflow-foundation"
   }
   ```

## Aggregated Check Engine

When a workflow step comprises multiple actions (e.g. `[verify-task-output, commit-and-push]`):
- The aggregated check evaluates `check` across all declared actions.
- The output structure preserves action boundaries:
  ```json
  {
    "step": "finalize",
    "ready": true,
    "actions": {
      "verify-task-output": {
        "actionId": "verify-task-output",
        "requiredInputs": [],
        "context": { "artifacts": ["dist/bundle.js"] }
      },
      "commit-and-push": {
        "actionId": "commit-and-push",
        "requiredInputs": [
          { "name": "commitMessage", "type": "string", "required": true, "description": "Commit message" }
        ],
        "context": {
          "changedFiles": ["dist/bundle.js"],
          "branch": "feature/workflow-foundation"
        }
      }
    }
  }
  ```
- No action's inputs or context are flattened or merged into an ambiguous root payload.
