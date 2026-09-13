# Area: Result-Driven Finish Execution, Generic CLI Transport & Discriminated Transitions

## Purpose

Define the generic CLI surface for `workflow step finish`, deterministic input parsing and contract validation, the non-mutating planning phase, durable execution under attempt scoping, transition discrimination between internal steps and terminal statuses, and input conflict reconciliation.

## Public CLI Contract (`tools/specs/workflow/cli.mjs`, `tools/specs.mjs`)

```bash
node tools/specs.mjs workflow step finish <change> [task] \
  [--check] \
  [--input '<json>'] \
  [--input-file <path>]
```

### Options:
- `--input '<json>'`: Inline JSON string supplying the structured input payload defined by `finishContract.parameters`.
- `--input-file <path>`: Path to a file containing the structured JSON input payload.
- `--check`: Non-mutating planning mode; verifies preconditions, validates inputs, checks gate statuses, and reports the resolved transition without executing mutations.

### Mutual Exclusivity and Prohibited Flags:
- Specifying both `--input` and `--input-file` is rejected immediately with a CLI usage error.
- Obsolete parameter-specific CLI flags (`--result`, `--title`, `--message`, `--artifact`, `--artifacts`, `--include`, `--exclude`) are strictly rejected. If supplied, the CLI throws an explicit error directing the user/agent to provide structured inputs via `--input` or `--input-file`.

## Deterministic Input Parsing, In-Flight Resolution & Validation Order

When `workflow step finish` is invoked, inputs and execution context are resolved in strict sequential order:

1. **Transport Layer Parsing:**
   - Parse `--input` inline string or read file at `--input-file` path.
   - Parse JSON syntax. If JSON parsing fails, throw `WorkflowError` (`INVALID_INPUT_JSON`).
2. **Object Structure Check:**
   - Ensure the parsed payload is a non-null, non-array object.
3. **In-Flight Durable Operation Resolution & Step Authority:**
   - Scan for an existing in-flight operation record for the task (`findInFlightOperationRecord`).
   - **If an in-flight operation exists:**
     - The in-flight operation's recorded `(step, attempt)` is authoritative for this finish execution.
     - This takes strict precedence over persisted `workflow_progress.state === 'completed'` (recovering crashes occurring after `update-task` but before later stages or final operation completion).
   - **If no in-flight operation exists:**
     - Derive active step and attempt from `workflow_progress`.
     - If the task's logical attempt is already completed (or in a terminal state), and no in-flight operation exists, return `status: 'already-completed'` without mutation.
4. **Contract Resolution & Schema Validation for the Authoritative Step:**
   - Compile/resolve `finishContract` for the authoritative step.
   - Validate supplied input payload against `finishContract.parameters`:
     - **Unknown Properties:** Reject any property not declared in `finishContract.parameters` (`UNKNOWN_INPUT_PROPERTY`).
     - **Missing Required Properties:** Verify all required parameters in `finishContract.parameters` are present (including finalize action requirements such as `include` and `commit.title`).
     - **Type Conformance:** Validate value types against parameter declarations:
       - `result`: If the step is conditional, `result` must match one of the step's declared transition values (and in v1 belong to `KNOWN_TRANSITION_VALUES`). If the step is unconditional, `result` must NOT be supplied.
       - Action parameters (e.g. `commit.title`, `commit.message`, `include`, `exclude`, and `artifacts`): Validate according to their respective contract declarations.
5. **Resumption & Input Conflict Check:**
   - If resuming an in-flight operation, merge newly supplied inputs with persisted `resolvedInputs` via `mergeResolvedInputs`:
     - Compatible or identical values merge cleanly.
     - Conflicting values for previously recorded inputs throw `PreconditionError` (`RESOLVED_INPUT_CONFLICT`).
6. **Exit Gate Verification:**
   - Run verification commands for pending exit gates declared in `finishContract.gates`.
   - If any gate fails, halt before stage mutations.
7. **Durable Pipeline Execution:**
   - Execute stages: `update-task` -> `commit` -> `push` -> `transition`.

## Non-Mutating Finish Planning (`planFinish` in `finish-operation.mjs`)

`planFinish` evaluates execution readiness without modifying disk state:

1. **In-Flight Precedence & Step Authority:**
   - Checks `findInFlightOperationRecord(repoRoot, changeSlug, taskId)`.
   - If an in-flight record exists: step and attempt are taken directly from the operation record.
   - Else: position is resolved from `task.workflow_progress`. If logical attempt is already completed and no in-flight operation exists, reports `status: 'already-completed'`.
2. **Result & Transition Matching:**
   - **For Conditional Steps:**
     - If `result` is missing in inputs -> returns `status: 'input-required'`, `missingInputs: ['result']`.
     - If `result` does not match any declared transition -> throws `PreconditionError` (`INVALID_TRANSITION_RESULT`).
     - Resolves matching transition: `matched = step.transitions.find(t => t.value === inputs.result)`.
   - **For Unconditional Steps:**
     - If `result` is provided -> throws `PreconditionError` (`UNEXPECTED_TRANSITION_RESULT`).
     - Resolves the single unconditional transition: `matched = step.transitions[0]`.
3. **Transition Discrimination:**
   - If `matched.to` is in `definition.steps` -> `{ kind: 'step', step: matched.to }`.
   - If `matched.to` is in `TERMINAL_STATUSES` -> `{ kind: 'terminal', status: matched.to }`.

## Durable Finish Execution (`finishStep` in `finish-operation.mjs`)

Drives the 5-stage pipeline under the attempt-scoped operation record (`<step>/attempt-<attempt>.json`):

```text
verify-gates -> update-task -> commit -> push -> transition
```

1. **`verify-gates`**: Runs `verify()` on exit gates; blocks if any gate fails.
2. **`update-task`**:
   - Reconciles attempt state (`ensureUpdateTask`) against `stage.intent`.
   - Atomically updates `change.yaml`:
     - Appends structured history entry:
       ```javascript
       {
         step: stepName,
         attempt: currentAttempt,
         completed_at: new Date().toISOString(),
         transitioned_to: matchedTransition.to,
         ...(inputs.result !== undefined ? { result: inputs.result } : {}),
         ...(inputs.artifacts?.length ? { artifacts: inputs.artifacts } : {})
       }
       ```
     - Sets `workflow_progress = { current_step: stepName, current_attempt: currentAttempt, state: 'completed', history: newHistory }`.
     - If `matchedTransition.to` is terminal (`TERMINAL_STATUSES`), sets `task.status = matchedTransition.to` in the same atomic write.
3. **`commit`**: Executes the finalize action (e.g. `commit-and-push`) by passing the relevant resolved inputs (`commit.title`, `commit.message`, `include`, `exclude`) and execution context to `ActionContract.execute(...)`. The workflow engine does not duplicate action-specific file staging or validation logic.
4. **`push`**: Pushes commit to remote branch when configured.
5. **`transition`**: Emits resolved, discriminated transition payload.

## Discriminated Structured Transition Output

The completion payload cleanly discriminates internal steps from terminal statuses:

### 1. Internal Step Transition
```json
{
  "status": "completed",
  "operationId": "e6a0d24c-1e24-4f8e-908a-b152dcf0e234",
  "transition": {
    "from": {
      "step": "review",
      "attempt": 1
    },
    "result": "pass",
    "to": {
      "kind": "step",
      "step": "human-verification"
    }
  },
  "commit": { "sha": "9a8b7c6d...", "status": "completed" },
  "push": { "remote": "origin", "branch": "feature/...", "status": "completed" }
}
```

### 2. Terminal Lifecycle Transition
```json
{
  "status": "completed",
  "operationId": "f7b1e35d-2f35-4a9f-a19b-c263edf1f345",
  "transition": {
    "from": {
      "step": "human-verification",
      "attempt": 1
    },
    "to": {
      "kind": "terminal",
      "status": "verified"
    }
  },
  "commit": { "sha": "1c2d3e4f...", "status": "completed" },
  "push": { "remote": "origin", "branch": "feature/...", "status": "completed" }
}
```
