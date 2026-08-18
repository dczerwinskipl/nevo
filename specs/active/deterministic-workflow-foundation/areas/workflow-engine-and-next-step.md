# Area: Workflow Engine and Next-Step Query Service

## Purpose

Define the workflow engine that evaluates declarative step definitions, coordinates action execution, enforces entry and exit gates, and exposes the "What next?" query service allowing agents to receive deterministic operational instructions from the CLI rather than encoding process sequences in prompt instructions.

## Step Lifecycle and Orchestration

A workflow step defines:
- **`id`**: Unique step identifier (e.g. `specification.review`, `implementation.start`, `implementation.finalize`).
- **`entryGates`**: Array of gates evaluated before entering or beginning work on the step.
- **`actions`**: Array of composable actions attached to the step.
- **`exitGates`**: Array of gates that must be satisfied before the step can transition to the next state.
- **`transitions`**: Valid target transitions upon step completion.

```yaml
steps:
  implementation.finalize:
    entryGates:
      - type: command
        action: test
    actions:
      - id: verify-task-output
      - id: commit-and-push
    exitGates:
      - type: human
        required: true
    transitions:
      - to: verified
```

## Deterministic "What Next?" Query Service (`tools/specs/workflow/next-step.mjs`)

The CLI exposes a query command:
`node tools/specs.mjs workflow next-step <change> [task]`

The engine inspects:
1. Manifest state and task state.
2. Current active step and its configuration.
3. Status of entry/exit gates.
4. Available composable actions and their `--check` outputs.
5. Whether human verification is required.

It returns a structured JSON payload:
```json
{
  "change": "deterministic-workflow-foundation",
  "task": "04-concrete-action-commit-and-push",
  "workflowMode": "deterministic",
  "currentStep": "implementation.finalize",
  "stepStatus": "in-progress",
  "availableActions": [
    {
      "id": "commit-and-push",
      "description": "Commit changed files and push branch to origin",
      "requiredInputs": [
        {
          "name": "commitMessage",
          "type": "string",
          "required": true,
          "description": "Conventional commit message"
        }
      ],
      "context": {
        "changedFiles": ["src/index.js"],
        "branch": "feature/workflow-foundation"
      }
    }
  ],
  "gates": [
    { "id": "test-suite", "type": "command", "status": "passed" },
    { "id": "human-review", "type": "human", "status": "blocked", "reason": "human-verification-required" }
  ],
  "blockedReason": "human-verification-required",
  "nextAllowedTransitions": ["verify"],
  "recommendedCommand": "node tools/specs.mjs workflow execute-step deterministic-workflow-foundation 04-concrete-action-commit-and-push finalize --inputs-file=inputs.json"
}
```

## Multi-Workflow Support

The engine supports composing different steps, actions, and gates for different specification classes:
- **Standard**: Lean review, single-step implementation, automated test gate.
- **Architectural**: Full specification review, multi-task decomposition, human verification gate, multi-action finalize.
- **Small**: Review-exempt, fast-track implementation, automated test gate.
- **Exploratory**: Discovery step, report gate, owner decision transition.

The core engine remains class-neutral; workflow definitions declare the pipeline.
