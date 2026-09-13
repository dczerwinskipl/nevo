---
id: result-driven-transitions.attempt-identity-and-history-persistence
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/02-attempt-identity-and-history.md
    - tools/specs/workflow/step-runner.mjs
    - tools/specs/validation.mjs
    - tools/specs/store.mjs
  optional:
    - tools/specs/workflow/definitions/schema.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/validation.mjs
  - tools/specs/store.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - tools/tests/store.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C4, C5, C6]
---

# Task: Monotonic attempt allocation, position resolution, and history persistence

## Goal

Extend the workflow runtime and manifest persistence models to track attempt identity (`current_attempt`), derive attempt numbers deterministically across loops, resolve workflow positions from result-driven history, and validate structured history entries in `tools/specs/validation.mjs`.

## Implementation constraints

- Extend `workflow_progress` schema in `change.yaml` to include `current_attempt` (positive integer >= 1).
- In `step-runner.mjs`:
  - `resolveWorkflowPosition` must resolve `{ phase: 'active', step, attempt }`, `{ phase: 'completed', step, attempt, nextStep }`, or `{ phase: 'terminal', step, attempt }`.
  - When `state: 'completed'`, read `nextStep` from the last history entry (`lastEntry.transitioned_to`) rather than hardcoding `step.transitions[0].to`.
- In `validation.mjs`:
  - Update `validateWorkflowProgress` to require that `current_attempt` is a positive integer when present.
  - Validate each entry in `workflow_progress.history`: requires `step`, `attempt`, `transitioned_to`, `completed_at`; validates optional `result` (safe identifier) and optional `artifacts` (array).
- Ensure attempt derivation is strictly monotonic per-step: count matching steps in history + 1.

## Acceptance criteria

1. `resolveWorkflowPosition` correctly resolves the active attempt number for in-progress tasks. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
2. `resolveWorkflowPosition` resolves `nextStep` from the completed attempt's `transitioned_to` in history when transitions are result-driven. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
3. `validateWorkflowProgress` accepts valid `workflow_progress` containing `current_attempt` and structured `history` records. `automated: node --test tools/tests/store.test.mjs`
4. `validateWorkflowProgress` rejects malformed history entries (missing step/attempt/transitioned_to, invalid timestamps, unsafe result values). `automated: node --test tools/tests/store.test.mjs`
5. Manifest validation and repository checks pass with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-runner.test.mjs
node --test tools/tests/store.test.mjs
node tools/specs.mjs check
```
