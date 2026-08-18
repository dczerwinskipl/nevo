---
id: deterministic-workflow-foundation.composable-actions-and-contracts
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/composable-actions-and-contracts.md
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/contracts.mjs
  - tools/specs/workflow/errors.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-contracts.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D4, D6]
  constraints: [C2, C3, C4, C6, C9, C10]
---

# Task: Composable action contracts, input schema, and context interfaces

## Goal

Define the core `ActionContract` interface, error classes (`PreconditionError`, `WorkflowError`), input schema specification and validation helpers, and context data models in `tools/specs/workflow/contracts.mjs` and `errors.mjs`.

## Implementation constraints

- Separate parameter schema definition (`requiredInputs`) from runtime facts (`context`).
- Support parameter types `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'` and constraint validation (e.g. `minLength`, `pattern`, `allowedValues`).
- Implement fail-closed input validation helper `validateActionInputs(schema, inputs)` that rejects missing required fields or type mismatches.
- Ensure all types and validation functions are pure and independently unit-testable.

## Acceptance criteria

1. `ActionContract` base class defines `id`, `description`, `check(context)`, and `execute(inputs, context)`. `automated: node --test tools/tests/workflow-contracts.test.mjs`
2. `validateActionInputs` validates caller inputs against a parameter schema array and returns clean validation errors when required fields are missing or type constraints are violated. `automated: node --test tools/tests/workflow-contracts.test.mjs`
3. `PreconditionError` is thrown when required inputs are omitted, providing structured field-level error details. `automated: node --test tools/tests/workflow-contracts.test.mjs`
4. `ActionCheckResult` and `ActionExecuteResult` models maintain distinct separation between `requiredInputs` (schema) and `context` (facts). `automated: node --test tools/tests/workflow-contracts.test.mjs`
5. Unit test suite verifies contract validation across valid, missing, and malformed inputs. `automated: node --test tools/tests/workflow-contracts.test.mjs`

## Verification

```text
node --test tools/tests/workflow-contracts.test.mjs
```
