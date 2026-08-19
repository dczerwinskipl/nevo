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
  - tools/specs/workflow/gates/command-catalog.mjs
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

# Task: Deterministic gate abstraction with inspection/verification separation

## Goal

Implement the `GateContract` interface with distinct non-mutating `inspect` and explicit `verify` operations, gate registry, and concrete gates (`CommandGate`, `MarkdownGate`, `HumanVerificationGate`) under `tools/specs/workflow/gates/`, establishing first-class machine-readable human verification state and authoritative evidence boundaries.

## Implementation constraints

- Gates determine whether a workflow step can be exited, strictly separated from action side effects.
- **Inspection vs Execution Separation:** `GateContract` defines `inspect(config, context)` (returns target, scope, known result from trusted readers, and staleness without executing tests) and `verify(config, context)` (explicitly runs verification checks).
- `CommandGate` maps logical verification actions (`test`, `build`) via trusted `CommandCatalog`. `inspect` reports the target command and queries `CommandVerificationReader`.
- `MarkdownGate` inspects markdown verification artifacts for structural completeness (`inspect`), and verifies authoritative evidence records via `MarkdownEvidenceReader` (`verify`).
- `HumanVerificationGate` returns machine-readable `{ status: 'blocked', reason: 'human-verification-required' }` when human sign-off is not recorded in trusted `HumanVerificationReader`.
- An AI agent must never be able to programmatically self-satisfy or bypass human verification or markdown verification gates through caller-controlled runtime JSON context or editing repository files.
- Trusted capabilities (`runner`, `commandCatalog`, `verificationReader`, `evidenceReader`) are injected via constructor/factory DI; runtime context contains only deterministic facts (`repoRoot`, `taskId`, `stepId`, `changeId`).

## Acceptance criteria

1. `GateContract` base interface defines `type`, `inspect(config, context)`, and `verify(config, context)`. `automated: node --test tools/tests/workflow-gates.test.mjs`
2. `CommandGate.inspect` returns target verification command and staleness from trusted reader without executing commands or child processes. `automated: node --test tools/tests/workflow-gates.test.mjs`
3. `CommandGate.verify` executes logical test/build verification commands and records passing or failing status. `automated: node --test tools/tests/workflow-gates.test.mjs`
4. `MarkdownGate` structurally inspects markdown artifacts (`inspect`) and verifies trusted evidence records beyond mutable file text (`verify`). `automated: node --test tools/tests/workflow-gates.test.mjs`
5. `HumanVerificationGate` queries trusted `HumanVerificationReader` and blocks when required sign-off is absent. `automated: node --test tools/tests/workflow-gates.test.mjs`
6. Unit tests verify that `inspect` is 100% read-only, that blocked gates prevent transition, and that caller context cannot forge verification passes. `automated: node --test tools/tests/workflow-gates.test.mjs`

## Verification

```text
node --test tools/tests/workflow-gates.test.mjs
```
