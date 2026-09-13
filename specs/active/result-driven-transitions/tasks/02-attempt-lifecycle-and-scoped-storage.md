---
id: result-driven-transitions.attempt-lifecycle-and-scoped-storage
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/areas/02-attempt-identity-and-history.md
    - specs/active/result-driven-transitions/areas/03-attempt-scoped-runtime-storage.md
    - tools/specs/workflow/step-runner.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/specs/workflow/human-verification-store.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/validation.mjs
  optional:
    - docs/development/workflow-engine.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/validation.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - tools/tests/workflow-operation-record.test.mjs
  - tools/tests/workflow-human-verification.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: []
  constraints: [C1, C6, C7, C8, C9, C10]
---

# Task: Attempt lifecycle, attempt-scoped storage, and activation guard

## Goal

Implement attempt identity derivation, position resolution, and integrity validation alongside attempt-scoped durable storage and human verification signoffs in a single coherent slice. Ensure all runtime storage APIs require explicit `(step, attempt)` scoping and update all caller sites (`step-context.mjs`, `cli.mjs`) so internal contracts and tests remain fully integrated.

## Implementation constraints

- In `tools/specs/workflow/step-runner.mjs`:
  - Update `resolveWorkflowPosition` to return `{ phase, step, attempt, nextStep? }` matching attempt invariants.
  - Verify that when `state === 'completed'`, the target step is resolved from the latest history record.
- In `tools/specs/workflow/step-context.mjs`:
  - Update `ensureStepActivated` to allocate attempt numbers monotonically:
    - Fresh task: step = `definition.entryStep`, attempt = 1.
    - Advancing to target step: attempt = `(count of targetStep in history) + 1`.
    - Resuming active step: preserve current step and current attempt without increment.
  - Call updated `loadOperationRecord(repoRoot, changeSlug, taskId, step, attempt)` using the resolved attempt identity.
- In `tools/specs/validation.mjs`:
  - Enforce attempt integrity invariants in `validateWorkflowProgress`:
    - Strict uniqueness of `(step, attempt)` in `history`.
    - Contiguous 1-based attempt sequence for each step.
    - Current attempt coherence (`count + 1` when active, `count` when completed).
    - Latest record coherence when completed.
- In `tools/specs/workflow/operation-record.mjs`:
  - Scope durable finish operation files to:
    `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`.
  - Update `loadOperationRecord`, `saveOperationRecord`, and `createOperationRecord` signatures to require `step` and `attempt`.
  - Implement `findInFlightOperationRecord(repoRoot, changeSlug, taskId)` scanning for uncompleted records; fail closed with `MULTIPLE_IN_FLIGHT_OPERATIONS` if $\ge 2$ uncompleted records exist.
- In `tools/specs/workflow/human-verification-store.mjs`:
  - Scope human verification signoffs to:
    `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  - Ensure `FileHumanVerificationStore.getSignoff` only matches signoffs for the specified attempt.
  - Update `workflow verify-human` in `tools/specs/workflow/cli.mjs` to resolve the active step and attempt before recording signoff.

## Acceptance criteria

1. `resolveWorkflowPosition` correctly resolves position, attempt counter, and target step across initial activation, resumption, and loop cycles. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
2. `ensureStepActivated` increments `current_attempt` when re-entering a previously visited step and preserves attempt when resuming an active step. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
3. `validateWorkflowProgress` rejects manifests with duplicate attempts, non-contiguous attempt sequences, or incoherent active/completed attempt counts. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
4. Operation records are written to and loaded from `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
5. `findInFlightOperationRecord` returns null when no uncompleted records exist, returns the single record when 1 exists, and throws `MULTIPLE_IN_FLIGHT_OPERATIONS` when $\ge 2$ exist. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
6. Human verification signoffs are scoped to `attempt-<attempt>`; a signoff on attempt 1 does not satisfy gate evaluation on attempt 2. `automated: node --test tools/tests/workflow-human-verification.test.mjs`
7. All modified files pass static checks and unit tests. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-runner.test.mjs
node --test tools/tests/workflow-operation-record.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs check
```
