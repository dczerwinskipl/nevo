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
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/next-step.mjs
  - tools/specs/workflow/definitions/**
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-next-step.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D5, D6, D7]
  constraints: [C3, C4, C7, C8, C9, C10]
---

# Task: Step orchestration and next-step query service

## Goal

Implement declarative step orchestration in `tools/specs/workflow/step-runner.mjs` and build the deterministic "What next?" query service in `tools/specs/workflow/next-step.mjs` that supplies agents with complete, factual next-step guidance directly from runtime state without running verification tests during queries.

## Implementation constraints

- Support composing declarative steps with entry gates, actions, exit gates, finalize actions, and transitions.
- The `getNextStep` service must inspect change state, active step, gate inspection results (via `gate.inspect()`), action checks, and human verification status.
- Return structured payload containing `currentStep`, `availableActions`, `requiredChecks`, `requiredInputs`, `humanVerificationStatus`, `nextAllowedTransitions`, and `blockedReason`.
- Do not bake Standard-specific assumptions into the engine; allow pluggable workflow definitions.

## Acceptance criteria

1. `StepRunner` evaluates entry gates, action readiness, exit gates, and finalize actions for a given step definition. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. `getNextStep` returns complete machine-readable state without requiring the caller to infer workflow rules from prose. `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. If human verification is required, `getNextStep` indicates `blockedReason: 'human-verification-required'` and reflects the blocking gate state. `automated: node --test tools/tests/workflow-next-step.test.mjs`
4. If an action check requires inputs, `getNextStep` surfaces the parameter schemas and runtime context facts while preserving action boundaries. `automated: node --test tools/tests/workflow-next-step.test.mjs`
5. Unit tests verify step progression and next-step resolution across multiple step configurations and states without executing test gates during inspection. `automated: node --test tools/tests/workflow-next-step.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
```
