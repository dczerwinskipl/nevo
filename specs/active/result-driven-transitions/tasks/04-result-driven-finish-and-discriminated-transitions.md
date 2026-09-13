---
id: result-driven-transitions.result-driven-finish-and-discriminated-transitions
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/03-attempt-scoped-runtime-storage.md
    - specs/active/result-driven-transitions/areas/05-finish-execution-and-cli.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/specs/workflow/step-runner.mjs
  optional:
    - docs/development/workflow-engine.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/step-runner.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D4]
  constraints: [C1, C7, C8, C9, C11, C12, C13, C15]
---

# Task: Result-driven finish planning, attempt-aware reconciliation, and discriminated transitions

## Goal

Implement result-driven finish planning and durable execution in `tools/specs/workflow/finish-operation.mjs`. Enforce in-flight durable operation precedence over completed workflow progress so crashed operations resume rather than short-circuiting, implement attempt-aware crash reconciliation in `ensureUpdateTask` by comparing persisted state against exact logical write intent, pass full resolved inputs (`include`/`exclude`) to finalize actions without duplicating validation, and emit structured discriminated transitions cleanly separating internal steps from terminal statuses.

## Implementation constraints

- In `tools/specs/workflow/finish-operation.mjs`:
  - In `planFinish`:
    - Check for an existing in-flight operation record for the task (`findInFlightOperationRecord`).
    - **Step Authority & Precedence:**
      - If an in-flight operation exists: its recorded `(step, attempt)` is authoritative for this finish execution, taking precedence over `workflow_progress.state === 'completed'`.
      - If no in-flight operation exists: resolve active step and attempt from `workflow_progress`. If the logical attempt is already completed (or terminal), return `status: 'already-completed'` without mutation.
    - Resolve `finishContract` for the authoritative step.
    - Validate supplied inputs against `finishContract.parameters`:
      - For conditional steps: if `inputs.result` is missing, return `status: 'input-required'`, `missingInputs: ['result']`. If `inputs.result` is invalid, throw `PreconditionError` (`INVALID_TRANSITION_RESULT`). Match transition: `matched = step.transitions.find(t => t.value === inputs.result)`.
      - For unconditional steps: if `inputs.result` is supplied, throw `PreconditionError` (`UNEXPECTED_TRANSITION_RESULT`). Match transition: `matched = step.transitions[0]`.
    - Discriminate destination target:
      - If `matched.to` is in `definition.steps` -> `{ kind: 'step', step: matched.to }`.
      - If `matched.to` is in `TERMINAL_STATUSES` -> `{ kind: 'terminal', status: matched.to }`.
    - In-flight input merging and conflict detection:
      - Merge supplied inputs with persisted `resolvedInputs` via `mergeResolvedInputs`. If conflicting values are provided for previously recorded inputs, throw `PreconditionError` (`RESOLVED_INPUT_CONFLICT`).
  - In `finishStep`:
    - Drive the 5-stage pipeline under the attempt-scoped record: `verify-gates` -> `update-task` -> `commit` -> `push` -> `transition`.
    - In `ensureUpdateTask`:
      - Record exact logical write intent in `stage.intent`: `{ step, attempt, result, transitioned_to, artifacts, terminalStatus }`.
      - Crash reconciliation rules:
        - **Write Definitely Happened:** `current_step === stage.intent.step`, `current_attempt === stage.intent.attempt`, `state === 'completed'`, latest history record matches `(step, attempt)` and has exact matching `result`, `transitioned_to`, and `artifacts`. If `terminalStatus` is non-null, `task.status === terminalStatus`.
        - **Write Definitely Did Not Happen:** `current_step === stage.intent.step`, `current_attempt === stage.intent.attempt`, `state === 'active'`, no record in history for `(step, attempt)`, and `task.status` has not been set to `terminalStatus`.
        - **Inconsistency:** Discrepancy marks stage `unknown`, halts execution, and throws `reconciliation-required`.
      - On execute write: append history record `{ step, attempt, completed_at, transitioned_to, result?, artifacts? }`, set `workflow_progress.state = 'completed'`, and if `matched.to` is terminal, update `task.status = matched.to`.
    - In `ensureCommit`:
      - Execute finalize action (e.g. `commit-and-push`) by passing relevant resolved inputs (`commit.title`, `commit.message`, `include`, `exclude`) and context to `ActionContract.execute(...)`.
      - Do not duplicate commit-and-push validation or file staging logic inside the workflow engine.
    - Push when enabled.
    - Return discriminated transition output:
      ```javascript
      {
        status: 'completed',
        operationId,
        transition: {
          from: { step, attempt },
          ...(inputs.result !== undefined ? { result: inputs.result } : {}),
          to: discriminatedTarget
        },
        commit,
        push
      }
      ```

## Acceptance criteria

1. In-flight operation lookup precedes contract validation and `already-completed` check; `planFinish` matches declared transitions on valid result inputs and rejects missing or invalid results for conditional steps. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
2. `planFinish` rejects result inputs for unconditional steps. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
3. Resuming an in-flight operation with identical inputs succeeds; conflicting inputs throw `RESOLVED_INPUT_CONFLICT`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. `ensureUpdateTask` reconciles crashes against exact `stage.intent`; corrupted or mismatched state fails closed with `reconciliation-required`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
5. Process interruption recovery: when `update-task` has persisted `state: 'completed'` but subsequent stages have not completed, retrying `workflow step finish` recovers and resumes the in-flight operation rather than short-circuiting to `already-completed`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. `finishStep` delegates finalize action execution with full resolved inputs (`include`/`exclude`), records attempt-scoped completion in `workflow_progress.history`, and updates `task.status` on terminal transition. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
7. Successful finish emits discriminated transition payload distinguishing step targets from terminal statuses. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
8. All unit tests pass and `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-step-runner.test.mjs
node tools/specs.mjs check
```
