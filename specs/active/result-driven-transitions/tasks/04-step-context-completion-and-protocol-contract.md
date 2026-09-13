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
  decisions: [D1, D3]
  constraints: [C1, C3, C8, C10, C11]
---

# Task: Canonical StepContext finish contract and AI protocol

## Goal

Update `tools/specs/workflow/step-context.mjs` to expose a single canonical `finishContract` (combining conditional result, finalize action inputs, artifacts, and exit gates), provide authoritative AI protocol rules, and include attempt identity in `StepContext`, while ensuring internal destination routing is not exposed to the AI agent.

## Implementation constraints

- `compileStepContext`:
  - Include `attempt: currentAttempt` directly in the compiled `StepContext`.
  - Pass `attempt` into `gateContext` so that `HumanVerificationGate.inspect()` queries the correct attempt.
  - Expose ONE canonical `finishContract` containing:
    - `parameters`: unified map containing conditional `result` (when applicable), finalize action inputs (e.g. `commit.title`), and `artifacts`.
    - `gates`: inspected exit gates.
  - For conditional steps: populate `finishContract.parameters.result` with `type: 'enum'`, `required: true`, and `allowedValues` dynamically derived from the step's declared transitions.
  - For unconditional steps: omit `result` or mark `required: false`.
  - Do NOT expose destination routing (such as `result -> to` mappings or `nextStepGuidance`) to the AI agent.
  - Include `protocol` with authoritative execution rules (`authoritative: true`, `noDirectStateMutation: true`, `doNotInferNextStep: true`, `logicalCompletionPerAttempt: true`, `resumableFinish: true`, `stopOnHumanGate: true`).
- Ensure step activation (`ensureStepActivated`) checks the settled status of prior finish operations using attempt-scoped records.

## Acceptance criteria

1. `compileStepContext` includes `attempt: 1` on initial step activation, and reflects incremented attempt numbers on subsequent loops. `automated: node --test tools/tests/workflow-step-context.test.mjs`
2. `compileStepContext` returns a single canonical `finishContract` containing both finalize inputs and the conditional `result` parameter without duplicate completion blocks. `automated: node --test tools/tests/workflow-step-context.test.mjs`
3. `finishContract.parameters.result.allowedValues` contains only the transition values declared for that step, and does not reveal destination step names to the agent. `automated: node --test tools/tests/workflow-step-context.test.mjs`
4. `compileStepContext` includes the standard `protocol` block asserting logical completion and resumability rules. `automated: node --test tools/tests/workflow-step-context.test.mjs`
5. Step activation rejects advancing to the next step if the prior attempt's finish operation remains unsettled. `automated: node --test tools/tests/workflow-step-context.test.mjs`
6. Repository check passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-next-step.test.mjs
node tools/specs.mjs check
```
