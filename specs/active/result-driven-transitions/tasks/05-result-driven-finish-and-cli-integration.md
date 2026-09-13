---
id: result-driven-transitions.result-driven-finish-and-cli-integration
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/05-finish-execution-and-cli.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs.mjs
  optional:
    - tools/specs/workflow/operation-record.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2]
  constraints: [C1, C6, C7, C8, C11, C12, C13]
---

# Task: Result-driven finish planning, attempt-aware reconciliation, and discriminated transitions

## Goal

Extend `finish-operation.mjs`, `cli.mjs`, and `tools/specs.mjs` to accept `--result` and `--artifact` parameters, validate completion results during non-mutating planning and durable execution, perform attempt-aware crash reconciliation for `update-task`, enforce input conflict rejection, and return a structured transition object discriminating internal steps from terminal statuses.

## Implementation constraints

- In `cli.mjs` and `specs.mjs`:
  - Add `--result <value>` and optional `--artifact <ref>` / `--artifacts <refs>` options to `workflow step finish`.
  - Pass resolved `result` and `artifacts` into finish inputs.
- In `finish-operation.mjs`:
  - `planFinish`:
    - If step is conditional and `inputs.result` is missing, return `status: 'input-required'` with `missingInputs: ['result']`.
    - If step is conditional and `inputs.result` is invalid, throw `PreconditionError`.
    - If step is unconditional and `inputs.result` is provided, throw `PreconditionError`.
    - Input conflict policy: re-supplying identical values for an in-flight operation resumes execution; conflicting values throw `PreconditionError`.
  - `finishStep`:
    - Create attempt-scoped operation record using `current_attempt`.
    - `ensureUpdateTask`: implement attempt-aware crash reconciliation verifying write definitely happened, definitely did not happen, or requires reconciliation using exact `(step, attempt)` and history evidence.
    - Atomically append structured history entry `{ step, attempt, result, transitioned_to, completed_at, artifacts }`.
    - If target transition is terminal, atomically set `task.status = to`.
    - `ensureTransition`: return discriminated transition `{ from: { step, attempt }, result, to: { kind: 'step', step } | { kind: 'terminal', status } }`.

## Acceptance criteria

1. `workflow step finish --check` on a conditional step reports `input-required` when `--result` is omitted. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
2. `workflow step finish --check` rejects invalid `--result` values not declared in the step's transitions. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
3. `workflow step finish` on an unconditional step succeeds without `--result`, and fails closed if `--result` is unexpectedly supplied. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. Attempt-aware crash reconciliation in `update-task` correctly identifies completed writes versus pending writes for the specific `(step, attempt)`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
5. Resuming an in-flight operation with conflicting inputs throws `PreconditionError`, while identical inputs resume execution. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. Successful `workflow step finish` returns a discriminated `transition` object showing `{ from, result, to: { kind: 'step'|'terminal', ... } }` and records `artifacts` in history. `automated: node --test tools/tests/workflow-cli.test.mjs`
7. Repository check passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs check
```
