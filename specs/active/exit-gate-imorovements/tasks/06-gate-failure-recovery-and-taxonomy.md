---
id: exit-gate-imorovements.gate-failure-recovery-and-taxonomy
status: draft
change: exit-gate-imorovements
depends_on: [transition-aware-exit-gates]
context:
  required:
    - specs/active/exit-gate-imorovements/overview.md
    - specs/active/exit-gate-imorovements/areas/02-transition-aware-gates.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
    - tools/specs/workflow/gates/command-gate.mjs
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
node --test tools/tests/
node tools/specs.mjs validate
```

## Out of scope

`ask_user` tool internals; non-blocking evidence recording.
