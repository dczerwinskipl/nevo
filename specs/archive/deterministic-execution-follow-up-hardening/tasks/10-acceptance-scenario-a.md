---
id: acceptance-scenario-a
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/acceptance-scenarios-a-through-d.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
  optional:
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
depends_on:
  - non-fatal-admission-for-remediable-blockers
  - remediation-protocol-exception
allowed_paths:
  - tools/tests/scenario-a-dirty-baseline-activation.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/**
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4]
  dependency_contracts: [non-fatal-admission-for-remediable-blockers, remediation-protocol-exception]
---

# Task: Acceptance scenario A — dirty baseline before activation

## Dependencies

`non-fatal-admission-for-remediable-blockers`, `remediation-protocol-exception`.

## Goal

New orchestration-level test proving Scenario A end-to-end through the real
admission/route/readiness call chain (not a direct unit call to a single helper) —
including the abandoned-remediation path (spec-review F1/F4), not only the
immediate-success path.

## Acceptance criteria

- Given a task in `ready`/`waiting-for-step-start` state with a dirty worktree (files
  unrelated to any owned scope), driving a real execution request through the admission
  path results in: a session/turn is created; the structured activation blocker
  (`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`, dirty file list) is present on the created
  session/turn; `workflow_progress` is byte-for-byte unchanged (attempt not activated).
  `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`
- After remediating (committing or removing the dirty files, simulating explicit user
  instruction), retrying `workflow step start` for the same task succeeds and activates the
  attempt normally. `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`
- **Abandoned-remediation variant (spec-review F1/F4):** same setup, but the turn ends
  *without* remediating successfully (the agent diagnosed the blocker but the dirty files
  are still present when the turn terminates). Assert: terminal classification is
  `outcome: 'resumable'`, never `recovery-required`; the workspace-writer claim is
  released; `workflow_progress` remains byte-for-byte unchanged (still unactivated); a
  later execution (same or different session) is admitted again, receives the same
  structured blocker, and — once remediation actually succeeds in that later turn —
  activation succeeds normally.
  `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`
- The same flow (immediate success and abandoned-remediation variants) for a
  *safely-replayable* `FINISH_OPERATION_UNRESOLVED` (an unresolved-but-replayable prior
  finish operation instead of a dirty tree) produces the same shape of result, and the
  remediation action exercised is retrying `workflow step finish` itself — never an ad hoc
  git operation. `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`
- A *non-replayable* unresolved finish operation (`status: 'blocked'`/`'unknown'`) is
  **not** treated as remediable — the session/turn is never created for it, identical to
  any other admission-blocking failure (contrast case proving D2's split is honored, not
  just D2's dirty-worktree half). `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`
- A task blocked by an admission-blocking readiness failure (e.g. `TASK_UNPUBLISHED`)
  still fails to create a session/turn at all — contrast case proving the split is scoped
  correctly. `automated: node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs`

## Verification

```bash
node --test tools/tests/scenario-a-dirty-baseline-activation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Unit-level coverage of the readiness classification itself (task 02's own tests), and of
the shared finish-operation-replayability classifier itself (task 01's own tests).
