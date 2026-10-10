---
id: exit-gate-improvements.gate-failure-recovery-and-taxonomy
status: draft
change: exit-gate-improvements
depends_on: [transition-aware-exit-gates]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - specs/active/exit-gate-improvements/areas/02-transition-aware-gates.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/specs/workflow/gates/command-gate.mjs
    - tools/specs/workflow/execution-settlement.mjs
    - tools/specs/workflow/cli.mjs
allowed_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/gates/command-gate.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/gate-failure-recovery.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D3]
  dependency_contracts:
    - transition-aware-exit-gates
---

# Task: Gate-failure recovery and failure taxonomy

## Goal

Make a red required gate a clean, replayable pre-mutation state; allow `result`/`feedback`
revision until `update-task` starts; distinguish `failed` (red check) from `blocked`
(could not evaluate).

## Implementation constraints

- Once `update-task` has started, input pinning and reconciliation are exactly as today.
- Do not weaken `isFinishOperationReplayable` for `unknown`/reconciliation states.

## Acceptance criteria

- First `pass` blocked by red gate, then `fail` accepted without `RESOLVED_INPUT_CONFLICT`. `automated: node --test tools/tests/gate-failure-recovery.test.mjs`
- After a red gate, `assessExecutionSettlement` reports `resumable`, not `recovery-required`.
- Runner exception ⇒ `blocked` with reason; red exit code ⇒ `failed`.
- Input change after `update-task` started is still rejected.
- After an expired/timed-out `ask_user` interaction, `finish --input` with `fail` + `feedback`
  still completes. `automated: same file`

## Verification

```bash
node --test tools/tests/gate-failure-recovery.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/execution-settlement.test.mjs
node --test tools/tests/workflow-gates.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`ask_user` tool internals; non-blocking evidence recording.
