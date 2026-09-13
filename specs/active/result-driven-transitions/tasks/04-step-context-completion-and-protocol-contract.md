---
id: result-driven-transitions.step-context-completion-and-protocol-contract
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/04-step-context-and-ai-protocol.md
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/step-runner.mjs
  optional:
    - tools/specs/workflow/definitions/schema.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/tests/workflow-step-context.test.mjs
  - tools/tests/workflow-next-step.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D5]
  constraints: [C1, C4, C9, C10]
---

# Task: StepContext completion contract, transition projection, and AI protocol

## Goal

Update `tools/specs/workflow/step-context.mjs` to expose a machine-readable `completion` contract, an authoritative `protocol` specification, available transitions, and the current attempt number in `StepContext`. Ensure the AI agent receives explicit instructions and schema requirements upon `workflow step start`.

## Implementation constraints

- `compileStepContext`:
  - Include `attempt: currentAttempt` directly in the compiled `StepContext`.
  - Pass `attempt` into `gateContext` so that `HumanVerificationGate.inspect()` queries the correct attempt.
  - For conditional steps: build `completion.parameters.result` with `type: 'enum'`, `required: true`, and `allowedValues` populated from the step's declared transitions.
  - For unconditional steps: build `completion.parameters.result` with `required: false` (or omit).
  - Include `completion.protocol` with authoritative execution rules (`authoritative: true`, `singleFinish: true`, `noDirectStateMutation: true`, `doNotInferNextStep: true`, `stopOnHumanGate: true`).
  - Project `availableTransitions` as a list of `{ result?: string, to: string }`, replacing static `nextStepGuidance`.
- Ensure step activation (`ensureStepActivated`) checks the settled status of prior finish operations using attempt-scoped records.

## Acceptance criteria

1. `compileStepContext` includes `attempt: 1` on initial step activation, and reflects incremented attempt numbers on subsequent loops. `automated: node --test tools/tests/workflow-step-context.test.mjs`
2. `compileStepContext` exposes `completion.parameters.result` containing the step's exact transition values in `allowedValues`. `automated: node --test tools/tests/workflow-step-context.test.mjs`
3. `compileStepContext` for unconditional steps exposes an unconditional finish contract without required result values. `automated: node --test tools/tests/workflow-step-context.test.mjs`
4. `compileStepContext` includes the standard `completion.protocol` block. `automated: node --test tools/tests/workflow-step-context.test.mjs`
5. `availableTransitions` accurately lists all declared outbound routes and targets. `automated: node --test tools/tests/workflow-step-context.test.mjs`
6. Repository check passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-next-step.test.mjs
node tools/specs.mjs check
```
