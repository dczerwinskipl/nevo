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

## Recovery and replayability contract

1. **Replayability predicate (`isFinishOperationReplayable`):**
   - A finish-operation record is classified as safely replayable (`true`) if and only if:
     - `record.status === 'running'`; and
     - `verify-gates` stage status is `'completed'` OR (`'failed'` strictly while all subsequent stages `['update-task', 'commit', 'push', 'transition']` remain in status `'pending'`); and
     - No stage has status `'unknown'` or `'blocked'`.
   - Once `update-task` transitions beyond `'pending'` (e.g. `'running'`, `'completed'`), or if any stage is `'unknown'` or `'blocked'`, the function returns `false`, enforcing strict crash-reconciliation.

2. **Result retargeting and input merging (`mergeResolvedInputs`):**
   - While `update-task` is strictly `'pending'` and `verify-gates` has failed, replaying `workflow step finish` allows revising completion inputs (`result`, `feedback`, `commit.title`, `commit.message`, `artifacts`).
   - `mergeResolvedInputs` updates `record.resolvedInputs` on replay without raising `RESOLVED_INPUT_CONFLICT`. When no new inputs are provided, existing resolved inputs are preserved.

3. **Gate-result invalidation on replay:**
   - On replay with retargeted inputs, previously recorded gate failures in `verify-gates` are invalidated and re-evaluated.
   - `ensureVerifyGates` evaluates exit gates applicable to the revised `result` (e.g. `when: [pass]` gates are filtered out when retargeting to `result: 'fail'`). If all newly applicable gates pass, `verify-gates` stage transitions to `'completed'`.

4. **Safeguards once `update-task` has begun:**
   - As soon as `update-task` writes `intent` or transitions to `'running'`, all `resolvedInputs` are permanently pinned. Supplying conflicting inputs throws `RESOLVED_INPUT_CONFLICT`.
   - No result retargeting, input revision, or gate-result invalidation is permitted after `update-task` begins.

## Acceptance criteria

- First `pass` blocked by red gate, then `fail` accepted without `RESOLVED_INPUT_CONFLICT`. `automated: node --test tools/tests/gate-failure-recovery.test.mjs`
- After a red gate, `assessExecutionSettlement` reports `resumable`, not `recovery-required`.
- Runner exception ⇒ `blocked` with reason; red exit code ⇒ `failed`.
- Input change after `update-task` started is still rejected (`RESOLVED_INPUT_CONFLICT`).
- Gate failures are invalidated upon replay with retargeted inputs matching `when` filters.
- `isFinishOperationReplayable` returns `true` for `record.status === 'running'` with `verify-gates.status === 'failed'` when `update-task` is `pending`, and `false` once `update-task` begins.
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
