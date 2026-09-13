# Area: Result-Driven Finish Execution & CLI Surface

## Purpose

Define the public CLI interface for `workflow step finish`, the non-mutating planning phase, durable finish execution, transition resolution, and structured completion response.

## Public CLI Contract (`tools/specs/workflow/cli.mjs`, `tools/specs.mjs`)

```bash
node tools/specs.mjs workflow step finish <change> [task] \
  [--check] \
  [--result <value>] \
  [--evidence <ref1,ref2...>] \
  [--title <text>] \
  [--message <text>] \
  [--include <patterns>] \
  [--exclude <patterns>]
```

### Options:
- `--result <value>`: Explicit semantic workflow result (e.g. `pass`, `fail`, `approved`). Required for conditional steps; rejected for unconditional steps.
- `--evidence <refs>`: Comma-separated artifact or file references supporting the completion result.
- `--check`: Non-mutating finish planning only; evaluates gates and required inputs without executing side effects or persisting state.
- `--title`, `--message`, `--include`, `--exclude`: Source-control parameters for the `commit-and-push` finalize action.

## Non-Mutating Finish Planning (`planFinish` in `finish-operation.mjs`)

1. **Step Identification:**
   - Detects active step from in-flight record or `resolveActiveStepName(definition, task)`.
   - If no active step exists, returns `already-complete` or `already-completed`.
2. **Result Validation:**
   - **For Conditional Steps:**
     - If `--result` is missing -> plan returns `status: 'input-required'`, `missingInputs: ['result']`.
     - If `--result` is not one of `step.transitions.map(t => t.value)` -> throws `PreconditionError` (unrecognized result).
     - Resolves matching transition: `matched = step.transitions.find(t => t.value === inputs.result)`.
     - Target is `matched.to`.
   - **For Unconditional Steps:**
     - If `--result` is provided -> throws `PreconditionError` ("Step does not accept a completion result; transition is unconditional").
     - Target is `step.transitions[0].to`.
3. **Gate Inspection & Input Aggregation:**
   - Evaluates exit gates (`inspect()`).
   - Checks required inputs for finalize actions.
   - Status resolves to `blocked`, `input-required`, `input-conflict`, or `ready`.

## Durable Finish Execution (`finishStep` in `finish-operation.mjs`)

When plan is `ready`, drives the durable 5-stage pipeline under the attempt-scoped operation record:

```text
verify-gates -> update-task -> commit -> push -> transition
```

1. **`verify-gates`**: Runs `verify()` on exit gates; blocks if any gate fails.
2. **`update-task`**:
   - Persists `workflow_progress.state = 'completed'`.
   - Appends structured attempt record to `history`:
     ```javascript
     {
       step: stepName,
       attempt: currentAttempt,
       result: resolvedResult,
       transitioned_to: targetStep,
       completed_at: new Date().toISOString(),
       artifacts: resolvedArtifacts
     }
     ```
   - If `targetStep` is terminal, sets `task.status = targetStep` in the same atomic write.
3. **`commit`**: Stages task files and `change.yaml`, creates progress commit.
4. **`push`**: Pushes commit to remote branch when enabled.
5. **`transition`**: Idempotent transition resolution; records final transition payload.

## Structured Return Payload

Upon successful completion, `workflow step finish` emits a structured, machine-readable object:

```json
{
  "status": "completed",
  "operationId": "e6a0d24c-1e24-4f8e-908a-b152dcf0e234",
  "transition": {
    "from": {
      "step": "review",
      "attempt": 1
    },
    "result": "fail",
    "to": {
      "step": "implementation"
    }
  },
  "commit": {
    "sha": "9a8b7c6d...",
    "status": "completed"
  },
  "push": {
    "remote": "origin",
    "branch": "feature/...",
    "status": "completed"
  },
  "nextStep": "implementation"
}
```

This clean output provides all necessary information for manual operator continuation today, and direct programmatic input for future orchestration layers.
