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
  decisions: [D1, D2, D3, D4]
  constraints: [C1, C4, C5, C6, C11, C12]
---

# Task: Result-driven finish planning, transition resolver, and CLI integration

## Goal

Extend `finish-operation.mjs`, `cli.mjs`, and `tools/specs.mjs` to accept the `--result` parameter, validate completion results during non-mutating planning and durable execution, resolve transitions dynamically, persist structured history entries with attempt and result, and return a machine-readable transition output.

## Implementation constraints

- In `cli.mjs` and `specs.mjs`:
  - Add `--result <value>` and optional `--evidence <refs>` options to `workflow step finish`.
  - Pass resolved `result` and `evidence` into finish inputs.
- In `finish-operation.mjs`:
  - `planFinish`:
    - If step is conditional and `inputs.result` is missing, return `status: 'input-required'` with `missingInputs: ['result']`.
    - If step is conditional and `inputs.result` is invalid, throw `PreconditionError`.
    - If step is unconditional and `inputs.result` is provided, throw `PreconditionError`.
    - Resolve target transition based on matched `value`.
  - `finishStep`:
    - Create attempt-scoped operation record using `current_attempt`.
    - `ensureUpdateTask`: write `workflow_progress.state = 'completed'`, append history entry `{ step, attempt, result, transitioned_to, completed_at, artifacts }`.
    - If target transition is terminal, atomically set `task.status = to`.
    - `ensureTransition`: return resolved transition `{ from: { step, attempt }, result, to: { step: to } }`.
  - Return `{ status: 'completed', transition, commit, push, ... }`.

## Acceptance criteria

1. `workflow step finish --check` on a conditional step reports `input-required` when `--result` is omitted. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
2. `workflow step finish --check` rejects invalid `--result` values not declared in the step's transitions. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
3. `workflow step finish` on an unconditional step succeeds without `--result`, and fails closed if `--result` is unexpectedly supplied. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. `workflow step finish` matches `--result` to the correct transition target and updates `change.yaml` history with attempt, result, and target. `automated: node --test tools/tests/workflow-cli.test.mjs`
5. Successful `workflow step finish` returns a machine-readable `transition` object showing `{ from: { step, attempt }, result, to: { step } }`. `automated: node --test tools/tests/workflow-cli.test.mjs`
6. Repository check passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs check
```
