# Area: Canonical StepContext Finish Contract & AI Protocol Specification

## Purpose

Define the single canonical machine-readable finish contract and authoritative AI protocol returned by `workflow step start`. Ensure AI agents receive one unified input specification for `workflow step finish`, understand allowed result values without receiving internal transition targets, and operate under clear logical-completion and resumability invariants.

## Canonical `StepContext` Structure (`tools/specs/workflow/step-context.mjs`)

When an agent invokes `workflow step start`, the compiled payload includes `attempt`, the canonical `finishContract`, and the authoritative `protocol`:

```json
{
  "change": "result-driven-transitions",
  "task": "01-workflow-schema",
  "workflowMode": "deterministic",
  "currentStep": "review",
  "attempt": 1,
  "stepStatus": "in-progress",
  "runtimeState": "active",
  "semanticStatus": "reviewing",
  "instructions": "Work within declared allowed_paths; entry gates already satisfied.",
  "finishContract": {
    "parameters": {
      "result": {
        "type": "enum",
        "required": true,
        "allowedValues": ["pass", "fail"],
        "description": "Semantic completion result selecting the next workflow transition."
      },
      "commit.title": {
        "type": "string",
        "required": true,
        "description": "Commit title for the task completion commit."
      },
      "commit.message": {
        "type": "string",
        "required": false,
        "description": "Optional extended commit message."
      },
      "include": {
        "type": "array",
        "items": { "type": "string" },
        "required": false,
        "description": "Optional file path patterns to stage for commit."
      },
      "exclude": {
        "type": "array",
        "items": { "type": "string" },
        "required": false,
        "description": "Optional file path patterns to exclude from commit."
      },
      "artifacts": {
        "type": "array",
        "items": { "type": "string" },
        "required": false,
        "description": "Optional list of artifact reference strings (e.g. file paths) associated with this completion."
      }
    },
    "gates": [
      { "id": "test", "gateType": "command", "status": "pending" }
    ]
  },
  "protocol": {
    "authoritative": true,
    "noDirectStateMutation": true,
    "doNotInferNextStep": true,
    "logicalCompletionPerAttempt": true,
    "resumableFinish": true,
    "stopOnHumanGate": true
  },
  "entryState": { "blockers": [] },
  "expectedWork": {
    "allowedPaths": ["tools/specs/workflow/**"],
    "forbiddenPaths": ["src/**"]
  },
  "relevantDocs": [],
  "context": { "sourceControl": { "currentBranch": "feature/..." } }
}
```

### Parameter Canonicalization:
All parameters needed for finish execution live directly under `finishContract.parameters`:
- For conditional steps, `result` is a required enum containing only the `allowedValues` declared for that step.
- For unconditional steps, `result` is omitted (or marked `{ "type": "none", "required": false }`).
- Commit metadata (`commit.title`, `commit.message`), staging controls (`include`, `exclude`), and artifacts (`artifacts`) are specified in the same schema.
- The AI does not need to know internal destination routing or how the engine decomposes inputs to internal stages (`update-task` vs `commit`).

### No Internal Routing Exposure:
- `StepContext` does NOT expose destination step mappings (such as `availableTransitions: [{ result: 'fail', to: 'implementation' }]` or `nextStepGuidance`).
- The agent only receives `allowedValues` for `result`.
- Nevo owns destination routing deterministically based on the workflow definition.

## Authoritative AI Protocol Contract

The `protocol` block establishes strict execution boundaries:

1. **StepContext is Authoritative (`authoritative: true`):**
   - The AI must treat `StepContext` as the sole source of truth for current step, attempt, allowed paths, and required exit criteria.
   - The AI must not infer workflow position from natural language prose, git history, or assumption.
2. **No Direct State Mutation (`noDirectStateMutation: true`):**
   - The AI must never edit `change.yaml`, `workflow_progress`, task statuses, or `.nevo-ai-local` directly.
3. **No Agent Step Selection (`doNotInferNextStep: true`):**
   - The AI reports its semantic result (e.g. `pass`), but does not decide, predict, or declare the destination step.
4. **Logical Single Completion per Attempt (`logicalCompletionPerAttempt: true`):**
   - Exactly one logical completion is permitted per `(step, attempt)`.
   - Once a step attempt is completed in `workflow_progress.history`, invoking finish for that attempt fails closed. Advancing requires `workflow step start` to activate the target step.
5. **Physically Resumable Finish (`resumableFinish: true`):**
   - `workflow step finish` is a durable, multi-stage operation.
   - If finish encounters an unexpected exit or error mid-execution, re-invoking finish with identical or compatible inputs safely resumes and reconciles the in-flight operation.
   - Supplying conflicting values for an in-flight operation fails closed with `RESOLVED_INPUT_CONFLICT`.
6. **Stop on Human Gates (`stopOnHumanGate: true`):**
   - If a step transition targets a human gate or requires operator verification, the AI must halt and yield execution to the operator.
