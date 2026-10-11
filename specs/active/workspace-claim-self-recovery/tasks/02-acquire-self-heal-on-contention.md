---
id: acquire-self-heal-on-contention
status: draft
change: workspace-claim-self-recovery
depends_on: [ workspace-claim-recovery-core ]
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - tools/specs/workflow/workspace-writer.mjs
    - tools/specs/workflow/workspace-claim-recovery.mjs
    - tools/specs/workflow/human-step/operations.mjs
  optional:
    - tools/specs/workflow/cli.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
allowed_paths:
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/workspace-writer-self-heal.test.mjs
  - tools/tests/workflow-human-step-recovery-block.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  decisions: [D1]
  dependency_contracts: [workspace-claim-recovery-core]
---

# Task: Self-heal on contention

## Dependencies

`workspace-claim-recovery-core` (provides `recoverWorkspaceClaim`).

## Goal

Make `acquireWorkspaceWriter` re-assess a `recovery-required` agent claim before declaring
the workspace blocked, and make the remaining block actionable.

## Requirements

- In `acquireWorkspaceWriter`, when the current claim is an agent claim with
  `status: 'recovery-required'`, call `recoverWorkspaceClaim` once (outside the workspace
  control lock, as the existing Phase B reconciliation does for request-backed claims),
  then retry acquisition. If recovery returns `recovered: false`, return
  `blocked: true` as today.
- The returned `currentClaim` for an unresolved block is unchanged in shape except that a
  `holder` summary (`changeSlug`, `taskId`, `sessionId`) is present when known.
- The `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY` error raised by `human-step/operations.mjs`
  (both raise sites) names the holder task, change, and session, and tells the operator to
  run the recovery command from task 03 (command text taken from a shared constant, not
  duplicated).
- The recovery call happens at most once per acquisition attempt; the wait loop in
  `human-step/operations.mjs` must not hammer assessment on every 100 ms iteration.

## Implementation constraints

- Corrupt claims (`reason: 'corrupt-claim'`) stay blocked; they are never auto-recovered.
- Request-backed claim reconciliation keeps its current behavior.
- Assessment cost is paid only on the already-blocked path, never on the happy path.

## Acceptance criteria

- With a lock file holding a `recovery-required` agent claim for a settled task,
  `acquireWorkspaceWriter` returns `acquired: true` and the old claim is gone.
  `automated: node --test tools/tests/workspace-writer-self-heal.test.mjs`
- With an unsettled/ambiguous claim, it returns `blocked: true` and the lock is untouched.
  `automated: node --test tools/tests/workspace-writer-self-heal.test.mjs`
- A corrupt claim stays blocked and is never recovered.
  `automated: node --test tools/tests/workspace-writer-self-heal.test.mjs`
- The human-submit error message for a blocked claim contains the holder task id and
  session id and the recovery command.
  `automated: node --test tools/tests/workflow-human-step-recovery-block.test.mjs`
- Assessment is invoked at most once across the human-submit wait loop.
  `automated: node --test tools/tests/workflow-human-step-recovery-block.test.mjs`
- Existing workspace-writer tests still pass; any test asserting the old unconditional
  block is updated to assert the new behavior for the unsettled case.
  `automated: node --test tools/tests/workspace-writer.test.mjs`

## Verification

```bash
node --test tools/tests/workspace-writer.test.mjs
node --test tools/tests/workspace-writer-self-heal.test.mjs
node --test tools/tests/workflow-human-step-recovery-block.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The operator command (task 03), UI error rendering (task 04), and any change to when the
per-turn hook fires.
