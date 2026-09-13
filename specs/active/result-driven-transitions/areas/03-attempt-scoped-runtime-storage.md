# Area: Attempt-Scoped Runtime Storage & Crash Reconciliation

## Purpose

Eliminate attempt collisions, false completion short-circuits, and premature gate satisfaction in local runtime storage (`.nevo-ai-local/`). Define exact attempt-aware crash reconciliation rules for durable finish stages and enforce a fail-closed multi-record guard.

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
    {
      "id": "update-task",
      "status": "completed",
      "intent": {
        "step": "review",
        "attempt": 1,
        "fromState": "active",
        "toState": "completed",
        "result": "fail",
        "transitioned_to": "implementation",
        "artifacts": ["docs/reviews/audit.md"],
        "terminalStatus": null
      },
      "result": { "to": { "kind": "step", "step": "implementation" }, "result": "fail" }
    },
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

When an in-flight operation recovers a stage found in `running` or `unknown` state, it must reconcile against persisted state using the concrete `(record.step, record.attempt)` identity and the exact logical write intent recorded in `stage.intent`:

1. **Write Definitely Happened:**
   - `task.workflow_progress.current_step === stage.intent.step`
   - `task.workflow_progress.current_attempt === stage.intent.attempt`
   - `task.workflow_progress.state === 'completed'`
   - The latest record in `task.workflow_progress.history` matches `{ step: stage.intent.step, attempt: stage.intent.attempt }`.
   - The latest history record has:
     - `transitioned_to === stage.intent.transitioned_to`
     - `result === stage.intent.result` (or both undefined for unconditional steps)
     - `artifacts` match `stage.intent.artifacts`
   - If `stage.intent.terminalStatus` is non-null, `task.status === stage.intent.terminalStatus`.
   - *Action:* Stage status marked `completed`; recovers `stage.result`; proceeds to subsequent stages.

2. **Write Definitely Did Not Happen:**
   - `task.workflow_progress.current_step === stage.intent.step`
   - `task.workflow_progress.current_attempt === stage.intent.attempt`
   - `task.workflow_progress.state === 'active'`
   - No record exists in `task.workflow_progress.history` for `{ step: stage.intent.step, attempt: stage.intent.attempt }`.
   - If `stage.intent.terminalStatus` is non-null, `task.status` has not been modified to that status.
   - *Action:* Safe to execute the atomic `update-task` write.

3. **State Inconsistent / Reconciliation Required:**
   - Any discrepancy (e.g. `state === 'completed'` but persisted `result` or `transitioned_to` differs from `stage.intent`, or `state === 'active'` but history already contains the attempt, or current attempt does not match `stage.intent.attempt`).
   - *Action:* Stage marked `unknown`, operation halts, fails closed with `reconciliation-required` error blocking further execution.

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
