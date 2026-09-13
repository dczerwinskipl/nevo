---
id: result-driven-transitions.attempt-scoped-operation-and-verification-stores
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/03-attempt-scoped-runtime-storage.md
    - tools/specs/workflow/operation-record.mjs
    - tools/specs/workflow/human-verification-store.mjs
    - tools/specs/workflow/gates/human-gate.mjs
  optional:
    - tools/specs/workflow/finish-operation.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/gates/human-gate.mjs
  - tools/tests/workflow-operation-record.test.mjs
  - tools/tests/workflow-human-verification.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3]
  constraints: [C6, C7, C8]
---

# Task: Attempt-scoped durable operation records and human verification store

## Goal

Refactor `operation-record.mjs` and `human-verification-store.mjs` to incorporate attempt identity into on-disk storage paths and query contracts, eliminating all collisions, premature gate satisfaction, and completion deadlocks across workflow step re-entry.

## Implementation constraints

- Update `operation-record.mjs`:
  - Scopes file path to `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`.
  - `loadOperationRecord(repoRoot, changeSlug, taskId, stepName, attempt)` loads the record for that specific attempt.
  - `saveOperationRecord(repoRoot, record)` writes to the attempt-scoped path.
  - `findInFlightOperationRecord(repoRoot, changeSlug, taskId)` recursively searches the task's operations directory for any record where `status !== 'completed'`.
- Update `human-verification-store.mjs`:
  - Scopes signoff file path to `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  - `getSignoff({ scope, targetId, requiredRole, stepId, attempt, gateId })` checks signoff for the specific attempt.
  - `confirm({ scope, targetId, role, stepId, attempt, gateId })` records signoff for the specific attempt.
- Update `HumanVerificationGate` in `tools/specs/workflow/gates/human-gate.mjs` to thread `context.attempt` into the verification query.

## Acceptance criteria

1. Durable finish operations for attempt 1 and attempt 2 of the same step are stored in separate files and do not overwrite or collide with each other. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
2. An attempt 1 `completed` operation record does not cause attempt 2 to report `already-completed`. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
3. `findInFlightOperationRecord` detects an unfinalized operation across any step and attempt subdirectory. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
4. Human verification signoff confirmed in attempt 1 is rejected as unsatisfied when queried for attempt 2 of the same step. `automated: node --test tools/tests/workflow-human-verification.test.mjs`
5. Human verification signoff confirmed for attempt 2 is accepted as valid for attempt 2. `automated: node --test tools/tests/workflow-human-verification.test.mjs`
6. Repository validation passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-operation-record.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs check
```
