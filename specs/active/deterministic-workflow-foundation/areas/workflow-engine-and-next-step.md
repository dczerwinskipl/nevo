# Area: Workflow Engine and Next-Step Query Service

## Purpose

Define the workflow engine that evaluates declarative step definitions, coordinates action execution, enforces entry and exit gates (using non-mutating inspection for query commands), and exposes the deterministic "What next?" query service allowing agents to receive exact operational instructions from the CLI rather than encoding process sequences in prompt instructions.

## Step Lifecycle and Orchestration

A workflow step defines:
- **`id`**: Unique step identifier (e.g. `implementation`, `finalize`).
- **`entryGates`**: Array of gates evaluated before entering or beginning work on the step.
- **`actions`**: Array of composable actions attached to the step.
- **`exitGates`**: Array of gates that must be satisfied before the step can transition to the next state.
- **`finalize`**: Array of actions executed when finalizing the step.
- **`transitions`**: Valid target transitions upon step completion.

```yaml
steps:
  implementation:
    entryGates: []
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: test
      - type: human
        required: true
    finalize:
      - id: verify-task-output
      - id: commit-and-push
    transitions:
      - to: verified
```

## Deterministic "What Next?" Query Service (`tools/specs/workflow/next-step.mjs`)

The CLI exposes a query command:
`node tools/specs.mjs workflow next-step <change> [task]`

The engine inspects:
1. Manifest state and active task.
2. Configured workflow definition and current active step.
3. Status of entry/exit gates (using non-mutating `gate.inspect()`, never executing tests).
4. Available composable actions and their non-mutating `action.check()` outputs.
5. Whether human verification is blocking progression.

It returns a structured JSON payload:
```json
{
  "change": "deterministic-workflow-foundation",
  "task": "01-workflow-schema-and-compatibility",
  "workflowMode": "deterministic",
  "currentStep": "implementation",
  "stepStatus": "in-progress",
  "availableActions": [
    {
      "id": "implement-task",
      "description": "Implement task within declared allowed_paths"
    },
    {
      "id": "finalize-step",
      "description": "Execute finalize actions after exit gates pass"
    }
  ],
  "gates": [
    {
      "id": "test-suite",
      "type": "command",
      "status": "passed",
      "detail": "Test suite verified at revision 2ae8454"
    },
    {
      "id": "human-review",
      "type": "human",
      "status": "blocked",
      "reason": "human-verification-required"
    }
  ],
  "blockedReason": "human-verification-required",
  "nextAllowedTransitions": ["verify"],
  "recommendedCommand": "node tools/specs.mjs workflow verify-human deterministic-workflow-foundation 01-workflow-schema-and-compatibility --confirm"
}
```

## Multi-Workflow Support

The engine evaluates declarative step definitions without baking Standard-specific or Architectural-specific logic into code:
- Changing the step order or adding new gates is done purely in the definition YAML.
- The engine enforces the configured sequence dynamically.
