# Area: Composable Actions and Contracts

## Purpose

Define the extensible plugin architecture for workflow actions, establishing the non-mutating `check` contract, structured `requiredInputs` parameter schemas, read-only `context` facts, aggregated multi-action step checking, and fail-closed `execute` semantics.

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
   * Authoritative execution boundary: validates inputs against requiredInputs prior to mutation.
   * @param {Record<string, any>} inputs - Caller-supplied input parameters
   * @param {ActionContext} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async execute(inputs, context) {
    // Validates inputs against check(context).requiredInputs, throws PreconditionError on failure,
    // and delegates only validated inputs to executeValidated(inputs, context).
  }

  /**
   * Subclass hook for domain operations executed only after strict input validation.
   * @param {Record<string, any>} inputs - Validated inputs
   * @param {ActionContext} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async executeValidated(inputs, context) { throw new Error('Not implemented'); }
}
```

## Non-Mutating `check` Contract

The `check` operation must strictly satisfy:
1. **Zero Side Effects Invariant:** Never write files, execute Git commits/pushes, modify manifest files, change branch refs, or run commands that alter state.
2. **`requiredInputs` Specification:**
   Returns an array of parameter definition objects describing expectations rather than guessed values:
   ```json
   {
     "name": "commitMessage",
     "type": "string",
     "required": true,
     "description": "Commit message describing the completed task",
     "constraints": {
       "minLength": 5
     }
   }
   ```
   Supported parameter types: `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`.
3. **`context` Facts Specification:**
   Returns read-only factual state gathered from the local environment to assist the agent/user in providing required input values:
   ```json
   {
     "changedFiles": ["src/index.js", "tests/index.test.js"],
     "stagedFiles": [],
     "taskAffectedFiles": ["src/index.js"],
     "generatedFiles": [],
     "branch": "feature/workflow-foundation",
     "baseBranch": "main",
     "existingCommits": ["825bebc Add initial contracts"]
   }
   ```
4. **Boundary Isolation:** `requiredInputs` and `context` remain distinct properties. Context provides facts; required inputs define schema.

## Fail-Closed `execute` Contract

The `execute` operation strictly adheres to:
1. **Schema Validation:** Every input in `inputs` is validated against `requiredInputs`. If any required parameter is missing or violates type/constraints, execution aborts immediately with a `PreconditionError`.
2. **Never Guess Missing Inputs:** The action must never attempt to infer, auto-complete, or synthesize missing parameters. The agent or human caller must supply explicit values.
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

When a workflow step comprises multiple actions (e.g. `finalize: [verify-task-output, commit-and-push]`):
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
        "context": { "verifiedArtifacts": ["dist/bundle.js"] }
      },
      "commit-and-push": {
        "actionId": "commit-and-push",
        "requiredInputs": [
          { "name": "commitMessage", "type": "string", "required": true, "description": "Commit message" },
          { "name": "include", "type": "array", "required": true, "description": "Explicit file selection" }
        ],
        "context": {
          "changedFiles": ["src/index.js"],
          "branch": "feature/workflow-foundation"
        }
      }
    }
  }
  ```
- No action's inputs or context are flattened or merged into an ambiguous root payload.
