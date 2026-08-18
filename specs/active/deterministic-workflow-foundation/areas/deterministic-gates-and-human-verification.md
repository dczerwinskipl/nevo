# Area: Deterministic Gates and Human Verification

## Purpose

Define the gate extension model, distinguishing exit criteria from workflow actions/side-effects. Model the strict separation between read-only gate inspection (`inspect`) and explicit gate verification (`verify`), automated command/test verification gates, markdown verification artifact gates, and machine-readable human verification state.

## Distinction: Gates vs Actions

- **Actions** execute side-effects (e.g. `commit-and-push`, generate index, create output).
- **Gates** evaluate preconditions and exit criteria (e.g. tests must pass, human verification required, clean working tree, review verdict ready).
- Gates answer: *"Is the workflow permitted to transition out of the current step or complete the current task?"*

## Gate Contract (`GateContract`)

Each gate implements `GateContract` with separate inspection and execution methods:
```javascript
export class GateContract {
  /** Unique gate identifier (e.g. 'command', 'markdown', 'human') */
  get type() { throw new Error('Not implemented'); }

  /**
   * Introspect gate status without running expensive verification commands.
   * @param {GateConfig} config - Gate configuration
   * @param {GateContext} context - Evaluation context (change, task, repo root)
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context) { throw new Error('Not implemented'); }

  /**
   * Explicitly execute the gate's verification check and record results.
   * @param {GateConfig} config - Gate configuration
   * @param {GateContext} context - Evaluation context
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context) { throw new Error('Not implemented'); }
}
```

## Gate Types

### 1. `CommandGate` (Automated Command / Test Verification)
- **`inspect(config, context)`**: Returns the verification target (e.g. `action: "test"`), execution scope, current known pass/fail status, and whether verification is required or stale, **without running tests**.
- **`verify(config, context)`**: Explicitly invokes the logical test runner (e.g. `npm test` or `dotnet test`) and records the result.
- **Invariant:** Introspection commands (`status`, `next-step`, `--check`) invoke `inspect`, never `verify`.

### 2. `MarkdownGate` (Verification Artifact Gate)
- **`inspect(config, context)`**: Checks for the existence of the referenced verification artifact (e.g. `verification.md` or task `## Verification` section) and inspects required checklist items.
- **`verify(config, context)`**: Evaluates recorded evidence and validates that all checklist criteria are marked verified. Reading the file alone does not pass the gate; explicit evidence/sign-off is checked.

### 3. `HumanVerificationGate` (First-Class Machine-Readable Human Verification)
- Human verification is never represented solely as prose instructions in markdown files.
- **`inspect(config, context)`**: Returns the machine-readable blocking state:
  ```json
  {
    "status": "blocked",
    "reason": "human-verification-required",
    "gateType": "human",
    "message": "Step 'implementation' requires explicit human verification",
    "signoff": {
      "requiredRole": "owner",
      "scope": "task",
      "targetId": "04-concrete-action-commit-and-push"
    }
  }
  ```
- **`verify(config, context)`**: Checks if an explicit operator confirmation has been recorded in workflow state via `node tools/specs.mjs workflow verify-human <change> <task> --confirm`.
- **Invariant:** The deterministic workflow engine strictly prevents the agent from self-authorizing or marking human verification as completed.
