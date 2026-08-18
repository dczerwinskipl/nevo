---
id: deterministic-workflow-foundation.deterministic-gates-and-human-verification
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/deterministic-gates-and-human-verification.md
    - tools/specs/workflow/contracts.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/gates/contracts.mjs
  - tools/specs/workflow/gates/command-gate.mjs
  - tools/specs/workflow/gates/markdown-gate.mjs
  - tools/specs/workflow/gates/human-gate.mjs
  - tools/specs/workflow/gates/index.mjs
  - tools/specs/workflow/registry.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-gates.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D5, D6]
  constraints: [C7, C8, C9, C10]
---

# Task: Deterministic gate abstraction and gate types

## Goal

Implement the `GateContract` interface, gate registry, and concrete gates (`CommandGate`, `MarkdownGate`, `HumanVerificationGate`) under `tools/specs/workflow/gates/`, establishing first-class machine-readable human verification state.

## Implementation constraints

- Gates answer whether a workflow step can be transitioned, separating evaluation from action side effects.
- `HumanVerificationGate` must return a structured machine-readable result `{ status: 'blocked', reason: 'human-verification-required' }` when human sign-off is needed.
- `CommandGate` maps logical verification actions (`test`, `build`, `lint`) to configured command runners.
- `MarkdownGate` verifies the existence and completeness of specified markdown verification artifacts.
- An AI agent must never be able to programmatically self-satisfy or bypass a human verification gate.

## Acceptance criteria

1. `GateContract` base interface and `GateRegistry` support registering and evaluating gates by type. `automated: node --test tools/tests/workflow-gates.test.mjs`
2. `CommandGate` executes logical test/build verification commands and returns passing or failing status with process output details. `automated: node --test tools/tests/workflow-gates.test.mjs`
3. `MarkdownGate` inspects markdown verification artifacts and detects missing files or incomplete checklist items. `automated: node --test tools/tests/workflow-gates.test.mjs`
4. `HumanVerificationGate` returns `{ status: 'blocked', reason: 'human-verification-required' }` when required human verification is not recorded. `automated: node --test tools/tests/workflow-gates.test.mjs`
5. Unit tests verify that a failing gate blocks step exit while a passing gate allows progression. `automated: node --test tools/tests/workflow-gates.test.mjs`

## Verification

```text
node --test tools/tests/workflow-gates.test.mjs
```
