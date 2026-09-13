# Area: Attempt-Scoped Runtime Storage for Operations & Verification

## Purpose

Eliminate attempt-related collisions, race conditions, and false completion short-circuits in local runtime state (`.nevo-ai-local/`). Ensure that durable finish operations and human verification signoffs are strictly scoped to the concrete attempt in which they occur.

## Durable Finish Operation Scoping (`tools/specs/workflow/operation-record.mjs`)

### Previous Defect & Collision
Previously, finish operations were keyed as:
`.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`
When a step (e.g. `implementation`) was revisited in attempt 2, the existing file for `implementation.json` was already marked `status: 'completed'`. `planFinish()` would immediately detect `lastRecord?.status === 'completed'` and return `already-completed`, making it impossible to perform attempt 2!

### Target Directory Layout
Operation records are strictly scoped by step and attempt:
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
    "commit.title": "review: request revisions"
  },
  "operations": [
    { "id": "verify-gates", "status": "completed", "result": { "gates": [] } },
    { "id": "update-task", "status": "completed", "intent": { "fromState": "active", "toState": "completed" }, "result": { "toStep": "implementation", "result": "fail" } },
    { "id": "commit", "status": "completed", "intent": { "preCommitHead": "..." }, "result": { "sha": "...", "status": "completed" } },
    { "id": "push", "status": "completed", "result": { "remote": "origin", "branch": "...", "expectedSha": "...", "status": "completed" } },
    { "id": "transition", "status": "completed", "result": { "transition": { "from": { "step": "review", "attempt": 1 }, "result": "fail", "to": { "step": "implementation" } } } }
  ]
}
```

### In-Flight Record Lookup
`findInFlightOperationRecord(repoRoot, changeSlug, taskId)` scans:
`.nevo-ai-local/workflow-operations/<changeSlug>/<taskId>/**/*.json`
and returns any record where `record.status !== 'completed'`. Because a task can only have at most one in-flight operation across all steps and attempts at any given time, this scan deterministically identifies unfinalized operations regardless of crash points.

## Human Verification Store Scoping (`tools/specs/workflow/human-verification-store.mjs`)

### Previous Defect & Premature Approval
Previously, human verification was stored as:
`.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate>.json`
If an operator confirmed a gate on attempt 1, but downstream review failed and forced a loop back to the same step for attempt 2, the signoff from attempt 1 remained on disk. Attempt 2 would silently treat the gate as satisfied without human review!

### Target Directory Layout
Human verification records are scoped by step and attempt:
```text
.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json
```

### Signoff Record Schema:
```json
{
  "scope": "task",
  "targetId": "my-task",
  "role": "owner",
  "confirmedBy": "owner",
  "confirmed": true,
  "stepId": "human-verification",
  "attempt": 1,
  "gateId": "owner-acceptance",
  "timestamp": "2026-09-13T10:30:00.000Z"
}
```

### Operator Confirmation CLI Contract:
```bash
node tools/specs.mjs workflow verify-human <change> <task> --confirm [--gate <id>]
```
- Resolves the active step and current attempt of the task.
- Writes the confirmation scoped to `attempt-<attempt>/<gate>.json`.
- A previous attempt's signoff never satisfies a subsequent attempt's gate evaluation.
