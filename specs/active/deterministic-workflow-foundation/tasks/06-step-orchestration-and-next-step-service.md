---
id: deterministic-workflow-foundation.step-orchestration-and-next-step-service
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/workflow-engine-and-next-step.md
    - tools/specs/workflow/contracts.mjs
    - tools/specs/workflow/registry.mjs
    - tools/specs/workflow/engine.mjs
    - tools/ai/binding-service.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/next-step.mjs
  - tools/specs/workflow/definitions/**
  - tools/specs/workflow/index.mjs
  - tools/ai/binding-service.mjs
  - tools/tests/workflow-next-step.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D5, D6, D7, D10]
  constraints: [C3, C4, C7, C8, C9, C10, C12]
---

# Task: Step orchestration and next-step query service

## Goal

Implement declarative step orchestration in `tools/specs/workflow/step-runner.mjs` and build the deterministic "What next?" query service in `tools/specs/workflow/next-step.mjs` that supplies agents with complete, factual next-step guidance and bound AI sessions directly from runtime state.

## Implementation constraints

- Support composing declarative steps with entry gates, actions, exit gates, and transitions.
- The `getNextStep` service must inspect change state, active step, gate results, action checks, human verification status, and active bound AI agent sessions.
- Automatically bind incoming session context (`provider`, `sessionId`, `purpose`) to the target `spec_id` and `task_id` during step execution and next-step queries.
- Return structured payload containing `currentStep`, `boundSessions`, `availableActions`, `requiredChecks`, `requiredInputs`, `humanVerificationStatus`, `nextAllowedTransitions`, and `blockedReason`.
- Do not bake Standard-specific assumptions into the engine; allow pluggable workflow definitions.

## Acceptance criteria

1. `StepRunner` evaluates entry gates, action readiness, and exit gates for a given step definition. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. `getNextStep` returns complete machine-readable state including active bound AI sessions (`boundSessions: [...]`). `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. If human verification is required, `getNextStep` indicates `blockedReason: 'human-verification-required'` and reflects the blocking gate state. `automated: node --test tools/tests/workflow-next-step.test.mjs`
4. If an action check requires inputs, `getNextStep` surfaces the parameter schemas and runtime context facts. `automated: node --test tools/tests/workflow-next-step.test.mjs`
5. Unit tests verify step progression and next-step resolution across multiple step configurations and states. `automated: node --test tools/tests/workflow-next-step.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
```
