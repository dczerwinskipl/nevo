---
id: deterministic-workflow-foundation.action-registry-and-aggregated-checks
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/composable-actions-and-contracts.md
    - tools/specs/workflow/contracts.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/registry.mjs
  - tools/specs/workflow/engine.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-engine.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D6, D7]
  constraints: [C2, C4, C5, C8, C9, C10]
---

# Task: Action registry, composition, and aggregated check engine

## Goal

Implement the extensible `ActionRegistry` for registering and discovering workflow actions, and build the aggregated check and execution engine in `tools/specs/workflow/registry.mjs` and `tools/specs/workflow/engine.mjs` that evaluates multi-action steps while strictly preserving action boundaries.

## Implementation constraints

- Actions are registered by unique string identifier in `ActionRegistry`.
- An aggregated check across multiple actions in a step must evaluate each action's `check(context)` and return structured results keyed by action ID.
- Aggregation must never flatten or merge inputs/context into an unstructured global dictionary.
- If any action in an aggregated step returns invalid contracts or fails during check, the check engine reports precise action-attributed errors.

## Acceptance criteria

1. `ActionRegistry` allows registering, unregistering, and retrieving action instances by ID, throwing descriptive errors on duplicate registration or missing actions. `automated: node --test tools/tests/workflow-engine.test.mjs`
2. `WorkflowEngine.checkStep(stepDefinition, context)` executes non-mutating checks across all step actions and aggregates results without losing action boundaries. `automated: node --test tools/tests/workflow-engine.test.mjs`
3. `WorkflowEngine.executeStep(stepDefinition, stepInputs, context)` validates step inputs for each action and executes them in sequence, aborting immediately on the first failure. `automated: node --test tools/tests/workflow-engine.test.mjs`
4. Aggregated check output format matches the schema defined in `areas/composable-actions-and-contracts.md`. `automated: node --test tools/tests/workflow-engine.test.mjs`
5. Unit tests verify single-action and multi-action aggregation, missing action handling, and isolated error reporting. `automated: node --test tools/tests/workflow-engine.test.mjs`

## Verification

```text
node --test tools/tests/workflow-engine.test.mjs
```
