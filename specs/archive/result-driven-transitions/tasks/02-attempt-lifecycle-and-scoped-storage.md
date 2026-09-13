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
    - tools/specs/workflow/finish-operation.mjs
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
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/validation.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - tools/tests/workflow-operation-record.test.mjs
  - tools/tests/workflow-human-verification.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-multi-step-e2e.test.mjs
  - tools/tests/workflow-next-step.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: []
  constraints: [C1, C6, C7, C8, C9, C10]
---

# Task: Attempt lifecycle, attempt-scoped storage, and atomic API migration

## Goal

Implement attempt identity derivation, position resolution, and integrity validation alongside attempt-scoped durable storage and human verification signoffs in a single coherent slice. Atomically migrate all production and test callers of `loadOperationRecord`, `saveOperationRecord`, and operation path helpers to require explicit `(step, attempt)` scoping so the entire repository remains fully green without broken callers deferred to later tasks.

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
  - Update `loadOperationRecord`, `saveOperationRecord`, and operation file path helpers to require `step` and `attempt`.
  - Implement `findInFlightOperationRecord(repoRoot, changeSlug, taskId)` scanning for uncompleted records; fail closed with `MULTIPLE_IN_FLIGHT_OPERATIONS` if $\ge 2$ uncompleted records exist.
- In `tools/specs/workflow/finish-operation.mjs`:
  - Update all calls to `loadOperationRecord(repoRoot, changeSlug, taskId, step, attempt)` in `planFinish` and `finishStep` to pass the authoritative attempt.
  - Ensure in-flight operation lookup (`findInFlightOperationRecord`) identifies authoritative `(step, attempt)` prior to checking active step position.
- In `tools/specs/workflow/human-verification-store.mjs`:
  - Scope human verification signoffs to:
    `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  - Ensure `FileHumanVerificationStore.getSignoff` only matches signoffs for the specified attempt.
  - Update `workflow verify-human` in `tools/specs/workflow/cli.mjs` to resolve the active step and attempt before recording signoff.
- In all existing test suites:
  - Update all callers of `loadOperationRecord` and `saveOperationRecord` across `tools/tests/workflow-finish-operation.test.mjs`, `tools/tests/workflow-e2e.test.mjs`, `tools/tests/workflow-multi-step-e2e.test.mjs`, and `tools/tests/workflow-next-step.test.mjs` to supply the `attempt` parameter.
  - Ensure zero test failures across the test suite upon completing this task.

## Acceptance criteria

1. `resolveWorkflowPosition` correctly resolves position, attempt counter, and target step across initial activation, resumption, and loop cycles. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
2. `ensureStepActivated` increments `current_attempt` when re-entering a previously visited step and preserves attempt when resuming an active step. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
3. `validateWorkflowProgress` rejects manifests with duplicate attempts, non-contiguous attempt sequences, or incoherent active/completed attempt counts. `automated: node --test tools/tests/workflow-step-runner.test.mjs`
4. Operation records are written to and loaded from `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
5. `findInFlightOperationRecord` returns null when no uncompleted records exist, returns the single record when 1 exists, and throws `MULTIPLE_IN_FLIGHT_OPERATIONS` when $\ge 2$ exist. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
6. Human verification signoffs are scoped to `attempt-<attempt>`; a signoff on attempt 1 does not satisfy gate evaluation on attempt 2. `automated: node --test tools/tests/workflow-human-verification.test.mjs`
7. All production callers (`step-context.mjs`, `finish-operation.mjs`, `cli.mjs`) and existing test suites are migrated to `(step, attempt)` scoping with zero regressions. `automated: node --test tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-e2e.test.mjs tools/tests/workflow-multi-step-e2e.test.mjs tools/tests/workflow-next-step.test.mjs`
8. All modified files pass static checks and unit tests. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-runner.test.mjs
node --test tools/tests/workflow-operation-record.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/workflow-multi-step-e2e.test.mjs
node --test tools/tests/workflow-next-step.test.mjs
node tools/specs.mjs check
```
