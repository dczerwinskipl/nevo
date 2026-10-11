---
id: workspace-claim-recovery-core
status: draft
change: workspace-claim-self-recovery
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md
    - tools/specs/workflow/workspace-writer.mjs
    - tools/specs/workflow/execution-settlement.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
allowed_paths:
  - tools/specs/workflow/workspace-claim-recovery.mjs
  - tools/tests/workspace-claim-recovery.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/workspace-writer.mjs
semantic_references:
  decisions: [D1]
---

# Task: Workspace claim recovery core

## Goal

Add a pure-ish module that decides whether a `recovery-required` agent claim is safe to
release, using the existing settlement classifier, and releases it if so.

## Requirements

- Export `recoverWorkspaceClaim({ repoRoot, claim, activeDir, assess })`:
  - Only acts on a claim with `kind: 'agent'` and `status: 'recovery-required'` that has a
    resolvable task scope (`scope.kind === 'task'`, or legacy `taskId`) and a `changeSlug`.
    Any other claim (batch scope, corrupt, non-agent, missing identity) returns
    `{ recovered: false, reason }` without touching the lock.
  - Calls `assess` (default: `assessExecutionSettlement`) for the claim's change and task.
  - On `outcome: 'completed'` with `settled: true`, or `outcome: 'resumable'`, calls
    `releaseWorkspaceWriterIfOwned` with the claim's exact `ownerId`, `kind`, `specId`,
    `changeSlug`, scope, `taskId`, `sessionId`, and `turnId`, and returns
    `{ recovered: true, outcome }`.
  - Any other outcome returns `{ recovered: false, reason, outcome, holder }` where
    `holder` is `{ changeSlug, taskId, sessionId }`; the lock is left untouched.
  - Never throws on assessment failure; an assessment error is `recovered: false` with the
    error message as `reason` (fail-closed).

## Implementation constraints

- Import `assessExecutionSettlement` lazily or take it via the `assess` parameter so this
  module does not create an import cycle with `workspace-writer.mjs` (task 02 will import
  this module from there). `workspace-writer.mjs` itself is not edited in this task.
- Do not reimplement settlement rules (ADR-0009: single shared classifier).

## Acceptance criteria

- A `recovery-required` agent claim for a task whose settlement is `completed` is
  released. `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`
- A `resumable` outcome releases the claim.
  `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`
- A `recovery-required` outcome from assessment leaves the lock file byte-identical and
  returns `recovered: false` with `holder`.
  `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`
- A batch-scope, corrupt, or non-agent claim is never released.
  `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`
- An assessment that throws returns `recovered: false` and leaves the lock untouched.
  `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`
- A claim whose owner changed between read and release is not released (conditional
  release is honoured).
  `automated: node --test tools/tests/workspace-claim-recovery.test.mjs`

## Verification

```bash
node --test tools/tests/workspace-claim-recovery.test.mjs
node --test tools/tests/workspace-writer.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Wiring into `acquireWorkspaceWriter` (task 02), the CLI command (task 03), and any
dashboard code.
