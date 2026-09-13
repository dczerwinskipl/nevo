# Area: Attempt-Scoped Runtime Storage & Crash Reconciliation

## Purpose

Eliminate attempt collisions, false completion short-circuits, and premature gate satisfaction in local runtime storage (`.nevo-ai-local/`). Define attempt-aware crash reconciliation rules for durable stages and enforce a fail-closed multi-record guard.

## Durable Finish Operation Scoping (`tools/specs/workflow/operation-record.mjs`)

### Directory Layout
Durable finish operation records are strictly scoped by step and attempt:
```text
.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json
```

### Operation Record Schema:
```json
{
  "operationId": "e6a0d24c-1e24-4f8e-908a-b152dcf0e234",
  "change": "my-change",
  "task": "my-task",
  "step": "review",
  "attempt": 1,
  "status": "running",
  "resolvedInputs": {
    "result": "fail",
    "commit.title": "review: request revisions",
    "artifacts": ["docs/reviews/audit.md"]
  },
  "operations": [
    { "id": "verify-gates", "status": "completed", "result": { "gates": [] } },
    { "id": "update-task", "status": "completed", "intent": { "fromState": "active", "toState": "completed" }, "result": { "to": { "kind": "step", "step": "implementation" }, "result": "fail" } },
    { "id": "commit", "status": "completed", "intent": { "preCommitHead": "..." }, "result": { "sha": "...", "status": "completed" } },
    { "id": "push", "status": "completed", "result": { "remote": "origin", "branch": "...", "expectedSha": "...", "status": "completed" } },
    { "id": "transition", "status": "completed", "result": { "transition": { "from": { "step": "review", "attempt": 1 }, "result": "fail", "to": { "kind": "step", "step": "implementation" } } } }
  ]
}
```

### In-Flight Record Lookup & Multi-Record Guard
`findInFlightOperationRecord(repoRoot, changeSlug, taskId)` scans:
`.nevo-ai-local/workflow-operations/<changeSlug>/<taskId>/**/*.json`
and filters for records where `record.status !== 'completed'`.

**Invariant: At most one in-flight operation per task.**
- 0 uncompleted records -> returns `null`.
- Exactly 1 uncompleted record -> returns that in-flight record for resumption.
- $\ge 2$ uncompleted records -> fails closed immediately, throwing `WorkflowError` (`MULTIPLE_IN_FLIGHT_OPERATIONS`) listing the conflicting record paths and IDs. The engine never guesses which in-flight operation to execute.

## Attempt-Aware Crash Reconciliation (`ensureUpdateTask`)

When an in-flight operation recovers a stage found in `running` or `unknown` state, it must reconcile against real state using the concrete `(record.step, record.attempt)` identity:

1. **Write Definitely Happened:**
   - `task.workflow_progress.current_step === record.step`
   - `task.workflow_progress.current_attempt === record.attempt`
   - `task.workflow_progress.state === 'completed'`
   - The latest record in `task.workflow_progress.history` matches `{ step: record.step, attempt: record.attempt }`.
   - *Action:* Stage status marked `completed`; recovers `stage.result`; proceeds to `commit`.
2. **Write Definitely Did Not Happen:**
   - `task.workflow_progress.current_step === record.step`
   - `task.workflow_progress.current_attempt === record.attempt`
   - `task.workflow_progress.state === 'active'`
   - No record exists in `task.workflow_progress.history` for `{ step: record.step, attempt: record.attempt }`.
   - *Action:* Safe to execute the atomic `update-task` write.
3. **State Inconsistent / Reconciliation Required:**
   - Any other permutation (e.g. `history` has the attempt but `state` is `active`, or `current_attempt` does not match `record.attempt`, or another step's attempt was written).
   - *Action:* Stage marked `unknown`, operation blocks, returns `reconciliation-required`.

## Human Verification Store Scoping (`tools/specs/workflow/human-verification-store.mjs`)

### Directory Layout
Signoff records are scoped by step, attempt, and gate:
```text
.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json
```

### Invariant:
- `FileHumanVerificationStore.getSignoff({ scope, targetId, requiredRole, stepId, attempt, gateId })` checks only the record under `attempt-<attempt>/<gate>.json`.
- A human verification confirmation recorded during attempt 1 cannot satisfy attempt 2.
- `workflow verify-human <change> <task> --confirm [--gate <id>]` resolves the active step and current attempt of the task and records signoff strictly for that attempt.
