---
id: dashboard-loading-and-progress.approve-post-action-sync-and-git
status: draft
change: dashboard-loading-and-progress
depends_on:
  - operation-progress-contract-and-transport
  - cli-step-instrumentation-gate-and-verification
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/operation-progress-contract.md
    - tools/specs.mjs
    - tools/specs/gates.mjs
    - tools/specs/service.mjs
    - tools/lib/git.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D2, D9, D10, D11, D12]
  constraints: [C1]
  dependency_contracts: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
---

# Task: Approve and Verify post-action sync and Git integration

## Goal

Expand task approval (`handleApprove` in `tools/specs.mjs`) and task verification (`handleVerify`) into full, genuine multi-step CLI operations:

### For `approve`:
1. `validate-approval` — validate approval preconditions via `evaluateGate('task.approve', ...)`;
2. `approve-task` — set task status to `approved`;
3. `rebuild-metadata` — rebuild canonical derived specification indexes (`specs/active.generated.md`, `specs/archive.generated.md`, `specs/index.generated.json`);
4. `commit-approval` — create a Git commit containing only the files modified by approval and index generation (`chore(specs): approve <taskId>`), skipped when `gitIntegration` is false;
5. `push-approval` — push the current branch to its remote upstream, skipped when `gitIntegration` is false.

### For `verify` (D12):
1. `validate-transition` — validate verification preconditions via `evaluateGate('task.verify', ...)`;
2. `verify-task` — set task status to `verified`;
3. `rebuild-metadata` — rebuild canonical derived specification indexes;
4. `commit-verification` — create a Git commit containing only the files modified by verification and index generation (`chore(specs): verify <changeSlug>/<taskId>`), skipped when `gitIntegration` is false;
5. `push-verification` — push the current branch to its remote upstream, skipped when `gitIntegration` is false.

This provides safe, reproducible, non-destructive multi-step operations for both CLI users and the dashboard frontend.

## Dependencies

- Depends on task 04 (`operation-progress-contract-and-transport`) and task 05 (`cli-step-instrumentation-gate-and-verification`).

## Implementation constraints

- Git integration defaults to `true`. CLI option `--no-git` disables commit and push for both `approve` and `verify`.
- Safe strict delta staging: only stage files directly modified by this specific operation (the change's `change.yaml`, `specs/active.generated.md`, `specs/archive.generated.md`, `specs/index.generated.json`).
- If pre-existing uncommitted modifications in `change.yaml` exist, or unrelated dirty files exist anywhere in the working tree (outside the spec or other task files within the same spec), fail closed safely with an explicit error instead of performing an indiscriminate commit.
- Postcondition-based idempotency and retry: if an earlier attempt succeeded in status change and metadata rebuild but failed during push, retrying inspects postconditions and performs the missing push without creating duplicate commits.
- Full idempotent no-op: when all postconditions are already satisfied (task is in terminal/target status, metadata current, branch clean and pushed), the operation completes successfully with idempotent status.

## Verification

```text
node --test tools/tests/approve-git-sync.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```
