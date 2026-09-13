# Area: Attempt Identity, Workflow Position, and History Persistence

## Purpose

Define the lifecycle, allocation, derivation, and persistence of step attempts and historical execution records. Ensure that re-entering previously completed steps creates distinct attempt identities and avoids state confusion or deadlocks across loops.

## State Representation in `change.yaml`

A task's deterministic workflow position is tracked via `workflow_progress` on its task record in `change.yaml`:

```yaml
workflow_progress:
  current_step: implementation
  current_attempt: 2
  state: active
  history:
    - step: implementation
      attempt: 1
      transitioned_to: review
      completed_at: "2026-09-13T10:00:00.000Z"
    - step: review
      attempt: 1
      result: fail
      transitioned_to: implementation
      completed_at: "2026-09-13T10:15:00.000Z"
```

### Fields:
- `current_step`: (string) Logical identifier of the current step in the workflow definition.
- `current_attempt`: (integer >= 1) Monotonic 1-based attempt counter for the current step.
- `state`: (`'active'` | `'completed'`) Runtime progress axis:
  - `'active'`: In-progress work on `current_step` (attempt `current_attempt`).
  - `'completed'`: `current_step`'s attempt finished; awaiting next `workflow step start` to activate target.
- `history`: (array of objects) Completed historical attempts.

## Attempt Lifecycle & Derivation

1. **Step Activation (`ensureStepActivated` in `step-context.mjs`):**
   - **Fresh Task (`phase: 'new'`):**
     - Activated step: `definition.entryStep`.
     - Derived attempt: `1`.
     - Persists: `{ current_step: entryStep, current_attempt: 1, state: 'active', history: [] }`.
   - **Advancing to Next Step (`phase: 'completed'`):**
     - Target step `targetStep` is read from `history[history.length - 1].transitioned_to`.
     - Derived attempt:
       ```javascript
       const priorAttempts = history.filter(h => h.step === targetStep).length;
       const currentAttempt = priorAttempts + 1;
       ```
     - Persists: `{ current_step: targetStep, current_attempt: currentAttempt, state: 'active', history }`.
   - **Resuming Active Step (`phase: 'active'`):**
     - No mutation; returns existing `current_step` and `current_attempt`.
   - **Terminal State (`phase: 'terminal'`):**
     - No mutation; reports workflow complete.

2. **Step Completion (`ensureUpdateTask` in `finish-operation.mjs`):**
   - Atomically records the completed attempt into `history`:
     ```javascript
     const entry = {
       step: currentStep,
       attempt: currentAttempt,
       completed_at: new Date().toISOString(),
       transitioned_to: targetStep,
       ...(result !== undefined ? { result } : {}),
       ...(artifacts?.length ? { artifacts } : {})
     };
     const newHistory = [...history, entry];
     ```
   - Persists `{ current_step: currentStep, current_attempt: currentAttempt, state: 'completed', history: newHistory }`.
   - If `targetStep` is terminal (`TERMINAL_STATUSES`), atomically sets `task.status = targetStep` in the same write.

## Position Resolution (`resolveWorkflowPosition` in `step-runner.mjs`)

Position is a pure function of `(workflow_progress, definition)`:
- No `workflow_progress` -> `{ phase: 'new' }`.
- `state: 'active'` -> `{ phase: 'active', step: current_step, attempt: current_attempt }`.
- `state: 'completed'`:
  - Inspects `lastEntry = history[history.length - 1]`.
  - Target `to = lastEntry.transitioned_to`.
  - If `to` is a step in `definition.steps` -> `{ phase: 'completed', step: current_step, attempt: current_attempt, nextStep: to }`.
  - If `to` is terminal -> `{ phase: 'terminal', step: current_step, attempt: current_attempt }`.

## Validation Rules (`tools/specs/validation.mjs`)

`validateWorkflowProgress` enforces:
- `current_attempt` must be a positive integer (>= 1).
- `history` must be an array of valid attempt records:
  - `step`: string, matching a declared step name in definition.
  - `attempt`: positive integer (>= 1).
  - `transitioned_to`: string, matching a declared step name or `TERMINAL_STATUSES`.
  - `completed_at`: valid ISO timestamp string.
  - `result`: optional safe identifier string.
  - `artifacts`: optional array of artifact references.
