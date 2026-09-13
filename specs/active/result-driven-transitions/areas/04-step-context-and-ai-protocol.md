# Area: StepContext Completion Contract & AI Protocol Specification

## Purpose

Define the machine-readable completion schema and authoritative AI protocol returned by `workflow step start`. Enable AI agents to know exactly what outputs are expected for step completion, understand available transitions, and strictly adhere to workflow boundaries.

## Compiled `StepContext` Structure (`tools/specs/workflow/step-context.mjs`)

When an agent invokes `workflow step start`, the compiled payload includes first-class `attempt`, `completion`, and `availableTransitions` structures:

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
  "completion": {
    "parameters": {
      "result": {
        "type": "enum",
        "required": true,
        "allowedValues": ["pass", "fail"],
        "description": "Deterministic completion result selecting the next workflow transition."
      },
      "evidence": {
        "type": "array",
        "required": false,
        "description": "Optional artifact/evidence references associated with this attempt completion."
      }
    },
    "protocol": {
      "authoritative": true,
      "singleFinish": true,
      "noDirectStateMutation": true,
      "doNotInferNextStep": true,
      "stopOnHumanGate": true
    }
  },
  "availableTransitions": [
    { "result": "pass", "to": "human-verification" },
    { "result": "fail", "to": "implementation" }
  ],
  "entryState": { "blockers": [] },
  "expectedWork": {
    "allowedPaths": ["tools/specs/workflow/**"],
    "forbiddenPaths": ["src/**"]
  },
  "relevantDocs": [],
  "context": { "sourceControl": { "currentBranch": "feature/..." } },
  "finishContract": {
    "requiredInputs": {
      "commit.title": { "type": "string", "required": true }
    },
    "gates": [
      { "id": "test", "gateType": "command", "status": "pending" }
    ]
  }
}
```

### For Unconditional Steps:
For steps with a single unconditional transition (e.g. `implementation -> review`):
- `completion.parameters.result`: `{ "type": "none", "required": false }` (or omitted).
- `availableTransitions`: `[{ "to": "review" }]`.

## The Authoritative AI Protocol Contract

The `completion.protocol` block establishes the provider-neutral execution boundaries:

1. **StepContext is Authoritative (`authoritative: true`):**
   - The AI must treat the returned `StepContext` as the sole source of truth for its current step, allowed paths, and required exit criteria.
   - The AI must not infer workflow position from natural language, commit messages, or chat history.
2. **No Direct State Mutation (`noDirectStateMutation: true`):**
   - The AI must never edit `change.yaml`, `workflow_progress`, task statuses, or `.nevo-ai-local` directly.
   - All state transitions occur solely via Nevo CLI commands.
3. **Single Finish Invocation (`singleFinish: true`):**
   - The AI completes a step by calling `node tools/specs.mjs workflow step finish` exactly once with all required inputs and result.
4. **No Agent Step Selection (`doNotInferNextStep: true`):**
   - The AI reports its semantic result (e.g. `pass` or `fail`), but Nevo deterministically computes the transition target.
   - The AI must never attempt to choose, declare, or advance to a next step on its own.
5. **Stop on Human Gates (`stopOnHumanGate: true`):**
   - If a step transition leads to a step with an active human gate (e.g. `human-verification`), or exit criteria require human signoff, the AI must halt and yield execution to the operator.
   - The AI cannot self-satisfy or bypass human gates.
