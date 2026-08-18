# Area: Deterministic Gates and Human Verification

## Purpose

Define the gate extension model, distinguishing exit criteria from workflow actions/side-effects. Model machine-readable human verification state, automated command/test verification gates, and markdown verification artifact gates.

## Distinction: Gates vs Actions

- **Actions** execute side-effects (e.g. `commit-and-push`, generate index, create pull request).
- **Gates** evaluate preconditions and exit criteria (e.g. tests must pass, human verification required, clean working tree, review verdict ready).
- Gates answer: *"Is the workflow permitted to transition out of the current step or complete the current task?"*

## Gate Contract (`GateContract`)

Each gate implements `GateContract`:
```javascript
export class GateContract {
  /** Unique gate identifier (e.g. 'command', 'markdown', 'human') */
  get type() { throw new Error('Not implemented'); }

  /**
   * Evaluate whether the gate conditions are satisfied.
   * @param {GateConfig} config - Declarative gate configuration
   * @param {GateContext} context - Evaluation context (change, task, repo root)
   * @returns {Promise<GateEvaluationResult>}
   */
  async evaluate(config, context) { throw new Error('Not implemented'); }
}
```

## Gate Types

### 1. `CommandGate` (Automated Command / Test Verification)
- Evaluates whether an automated verification command passes without embedding raw shell commands across specifications.
- Maps logical actions (e.g. `action: "test"` or `action: "build"`) to repo-configured verification runners.
- Returns `{ status: 'passed' }` or `{ status: 'failed', reason: 'Test suite failed with exit code 1', details: '...' }`.

### 2. `MarkdownGate` (Verification Artifact Gate)
- Validates the existence, structure, and completed status of a markdown verification artifact (e.g. `verification.md` or a task's `## Verification` section).
- Verifies that all required verification criteria have recorded passing results.
- Returns `{ status: 'passed' }` or `{ status: 'failed', reason: 'Verification artifact missing or contains unresolved checklist items' }`.

### 3. `HumanVerificationGate` (First-Class Machine-Readable Human Verification)
- Human verification is never represented solely as prose instructions in markdown files.
- When a step or task requires human verification (e.g. architectural review sign-off, visual inspection, sensitive migration confirmation), the gate returns a structured, machine-readable blocked state:
  ```json
  {
    "status": "blocked",
    "reason": "human-verification-required",
    "gateType": "human",
    "message": "Step 'implementation.complete' requires explicit human verification",
    "signoff": {
      "requiredRole": "owner",
      "scope": "task",
      "targetId": "04-concrete-action-commit-and-push"
    }
  }
  ```
- **Invariant:** The deterministic workflow engine strictly prevents the agent from self-authorizing or marking human verification as completed. Human verification can only be recorded via an explicit operator command (`node tools/specs.mjs workflow verify-human <change> <task> --confirm`).
