# Area: Result-Driven Finish Execution, Transition Resolution, and CLI Surface

## Purpose

Define the public CLI surface for `workflow step finish`, the non-mutating planning phase, durable execution under attempt scoping, transition discrimination between internal steps and terminal statuses, and input conflict reconciliation.

## Public CLI Contract (`tools/specs/workflow/cli.mjs`, `tools/specs.mjs`)

```bash
node tools/specs.mjs workflow step finish <change> [task] \
  [--check] \
  [--result <value>] \
  [--artifact <ref>] \
  [--artifacts <ref1,ref2...>] \
  [--title <text>] \
  [--message <text>] \
  [--include <patterns>] \
  [--exclude <patterns>]
```

### Options:
- `--result <value>`: Explicit semantic workflow result (e.g. `pass`, `fail`, `blocked`). Required for conditional steps; rejected for unconditional steps.
- `--artifact <ref>` / `--artifacts <refs>`: Artifact reference strings (e.g. file paths or URI identifiers) associated with this completion attempt.
- `--check`: Non-mutating finish planning only; reports missing inputs, blockers, and resolved transition without mutating state.
- `--title`, `--message`, `--include`, `--exclude`: Finalize source-control inputs.

## Non-Mutating Finish Planning (`planFinish` in `finish-operation.mjs`)

1. **Step & Attempt Identification:**
   - Detects active step and attempt from in-flight record or `resolveWorkflowPosition(definition, task)`.
   - If no active step exists, returns `already-complete` or `already-completed`.
2. **Result Validation:**
   - **For Conditional Steps:**
     - If `--result` is missing -> `status: 'input-required'`, `missingInputs: ['result']`.
     - If `--result` is not one of `step.transitions.map(t => t.value)` -> throws `PreconditionError` (`INVALID_TRANSITION_RESULT`).
     - Resolves matching transition: `matched = step.transitions.find(t => t.value === inputs.result)`.
   - **For Unconditional Steps:**
     - If `--result` is supplied -> throws `PreconditionError` (`UNEXPECTED_TRANSITION_RESULT`).
     - Matched transition is `step.transitions[0]`.
3. **Input Conflict Policy (Resumption):**
   - If an in-flight operation already exists for `(step, attempt)`:
     - Inputs are merged via `mergeResolvedInputs`.
     - Supplying the identical `result`, `title`, or `artifacts` is a safe no-op (resumption).
     - Supplying conflicting values throws `PreconditionError` (`RESOLVED_INPUT_CONFLICT`).

## Durable Finish Execution (`finishStep` in `finish-operation.mjs`)

Drives the 5-stage pipeline under the attempt-scoped operation record (`<step>/attempt-<attempt>.json`):

```text
verify-gates -> update-task -> commit -> push -> transition
```

1. **`verify-gates`**: Runs `verify()` on exit gates; blocks if any gate fails.
2. **`update-task`**:
   - Reconciles attempt state (`ensureUpdateTask`).
   - Atomically updates `change.yaml`:
     - Appends structured history entry:
       ```javascript
       {
         step: stepName,
         attempt: currentAttempt,
         completed_at: new Date().toISOString(),
         transitioned_to: matchedTransition.to,
         ...(result !== undefined ? { result } : {}),
         ...(artifacts?.length ? { artifacts } : {})
       }
       ```
     - Sets `workflow_progress = { current_step: stepName, current_attempt: currentAttempt, state: 'completed', history: newHistory }`.
     - If `matchedTransition.to` is terminal (`TERMINAL_STATUSES`), sets `task.status = matchedTransition.to` in the same atomic write.
3. **`commit`**: Creates Git progress commit.
4. **`push`**: Pushes commit to remote branch when enabled.
5. **`transition`**: Emits resolved, discriminated transition.

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

This discriminated output is unambiguous and ready for consumption by future automated orchestration layers.
