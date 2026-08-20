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
- **Inspection vs Execution Separation:** `GateContract` defines `inspect(config, context)` and `verify(config, context)` with the following contract:
  - **`inspect`** is a read-only query of the *authoritative current gate state*. It may inspect repository artifacts and read trusted recorded verification/evidence/signoff state (e.g. via `CommandVerificationReader`, `MarkdownEvidenceReader`, `HumanVerificationReader`) — reading trusted state is non-mutating and does not violate inspection separation. It must never execute verification commands, create evidence, record approval, or mutate repository/workflow state.
  - **`verify`** is an explicit verification operation. Depending on gate type it may execute the verification check and/or confirm trusted evidence, but it must return the same semantic notion of whether the complete gate is satisfied as `inspect` does.
  - **Cross-gate invariant (required for Task 06):** `GateInspectionResult.status === 'passed'` means the complete gate condition — including any trusted evidence/recorded state, not merely structural or superficial completeness — is currently satisfied. This has one generic meaning across `CommandGate`, `MarkdownGate`, and `HumanVerificationGate`; callers (including the Task 06 step orchestrator) must never need gate-type-specific exceptions to interpret `status: 'passed'`.
- `CommandGate` maps logical verification actions (`test`, `build`) via trusted `CommandCatalog`. `inspect` reports the target command and queries `CommandVerificationReader` for the last recorded result without executing anything.
- `MarkdownGate` evaluates both structural completeness and trusted evidence in `inspect`, since reading trusted evidence is a read-only operation:
  - missing or structurally incomplete artifact → `blocked`
  - structurally complete artifact without matching trusted evidence for the current content hash → `blocked`/`pending` (machine-readable `reason: 'evidence-required'` or `'evidence-hash-mismatch'`)
  - structurally complete artifact with matching trusted evidence for the current content hash → `passed`
  `verify` re-evaluates the same structural/evidence condition (never trusting editable markdown checkbox text alone) so `inspect` and `verify` cannot semantically drift.
- `HumanVerificationGate` returns machine-readable `{ status: 'blocked', reason: 'human-verification-required' }` when human sign-off is not recorded in trusted `HumanVerificationReader`.
- An AI agent must never be able to programmatically self-satisfy or bypass human verification or markdown verification gates through caller-controlled runtime JSON context or editing repository files.
- Trusted capabilities (`runner`, `commandCatalog`, `verificationReader`, `evidenceReader`) are injected via constructor/factory DI; runtime context contains only deterministic facts (`repoRoot`, `taskId`, `stepId`, `changeId`).
- Command verification storage identity binds the exact resolved concrete command together with any logical action alias (never one alone), using a collision-free composite representation — never delimiter-joined strings that untrusted alias/command text could be crafted to collide.

## Acceptance criteria

1. `GateContract` base interface defines `type`, `inspect(config, context)`, and `verify(config, context)`. `automated: node --test tools/tests/workflow-gates.test.mjs`
2. `CommandGate.inspect` returns target verification command and staleness from trusted reader without executing commands or child processes. `automated: node --test tools/tests/workflow-gates.test.mjs`
3. `CommandGate.verify` executes logical test/build verification commands, and only reports authoritative `passed` status after successfully recording the result in `CommandVerificationStore`; it fails closed (non-passed, machine-readable reason) when no store is configured or recording fails. `automated: node --test tools/tests/workflow-gates.test.mjs`
4. `MarkdownGate.inspect` and `MarkdownGate.verify` agree on `status`: both return `passed` only when the artifact is structurally complete *and* trusted evidence matches the current content hash; otherwise both return `blocked`/`pending`. `automated: node --test tools/tests/workflow-gates.test.mjs`
5. `HumanVerificationGate` queries trusted `HumanVerificationReader` and blocks when required sign-off is absent. `automated: node --test tools/tests/workflow-gates.test.mjs`
6. Command verification storage identity is bound to the exact (action alias, resolved concrete command) pair or exact raw command, using a collision-free key encoding; changing the resolved command invalidates prior recorded results, and distinct action/command pairs cannot be crafted to collide into the same stored record. `automated: node --test tools/tests/workflow-gates.test.mjs`
7. Unit tests verify that `inspect` never executes commands, creates evidence, or records approval; that blocked gates prevent transition; and that caller context cannot forge verification passes. `automated: node --test tools/tests/workflow-gates.test.mjs`

## Verification

```text
node --test tools/tests/workflow-gates.test.mjs
```
