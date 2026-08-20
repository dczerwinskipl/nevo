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

### `inspect` vs `verify` — precise contract

- **`inspect(config, context)`** is a read-only query of the *authoritative current gate state*.
  - **May:** inspect repository artifacts; read trusted recorded verification/evidence/signoff state (e.g. via `CommandVerificationReader`, `MarkdownEvidenceReader`, `HumanVerificationReader`). Reading trusted recorded state is non-mutating and therefore does not violate inspection/execution separation.
  - **Must never:** execute verification commands, create evidence, record approval, or otherwise mutate repository or workflow state.
- **`verify(config, context)`** is an explicit verification operation. Depending on gate type it may execute the verification check and/or confirm trusted evidence, but it must return the *same semantic notion* of whether the complete gate is satisfied that `inspect` would report for the resulting state.
- **Required cross-gate invariant:** `GateInspectionResult.status === 'passed'` has one generic meaning across `CommandGate`, `MarkdownGate`, and `HumanVerificationGate` — the complete gate condition (including any trusted evidence or recorded state, not merely structural or superficial completeness) is currently satisfied. Callers, including the step orchestration/next-step service, must never need gate-type-specific exceptions to interpret `status: 'passed'`.

## Gate Types

### 1. `CommandGate` (Automated Command / Test Verification)
- **`inspect(config, context)`**: Returns the verification target (e.g. `action: "test"`), execution scope, known recorded result from trusted `CommandVerificationReader`, and staleness, **without running tests**.
- **`verify(config, context)`**: Explicitly invokes the logical test runner (e.g. `npm test` or `dotnet test`) via injected runner or process execution and returns strict verification results.
- **Invariant:** Introspection commands (`status`, `next-step`, `--check`) invoke `inspect`, never `verify`. Capabilities (`runner`, `commandCatalog`, `verificationReader`) are injected via constructor/factory, never trusted from runtime context.

### 2. `MarkdownGate` (Verification Artifact Gate)
- **`inspect(config, context)`**: Reports `status: 'passed'` only when the referenced verification artifact is both structurally complete (required sections present, no unchecked checklist items) *and* trusted evidence matching the artifact's current content hash exists via `MarkdownEvidenceReader`. Reading evidence is read-only and therefore permitted in `inspect`.
  - missing or structurally incomplete artifact → `blocked`
  - structurally complete but no matching trusted evidence for the current content hash → `blocked`/`pending` (`reason: 'evidence-required'` or `'evidence-hash-mismatch'`)
  - structurally complete with matching trusted evidence for the current content hash → `passed`
- **`verify(config, context)`**: Re-evaluates the same structural completeness and trusted evidence condition as `inspect`, sharing the read-only evaluation path so the two can never semantically drift. Editing markdown checkbox text alone in the repository does not pass verification without trusted evidence.
- **Invariant:** Verification evidence must be supplied by trusted composition boundaries, never by caller-controlled runtime JSON. `inspect` and `verify` always agree on whether the gate is currently satisfied.

### 3. `HumanVerificationGate` (First-Class Machine-Readable Human Verification)
- Human verification is never represented solely as prose instructions in markdown files or caller-provided JSON context.
- **`inspect(config, context)`**: Returns the machine-readable blocking state or validated sign-off from trusted `HumanVerificationReader`:
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
- **`verify(config, context)`**: Checks if an explicit operator confirmation has been recorded via trusted `HumanVerificationReader`.
- **Invariant:** The deterministic workflow engine strictly prevents the agent from self-authorizing or marking human verification as completed via runtime context.
