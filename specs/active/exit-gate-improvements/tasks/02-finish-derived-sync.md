---
id: exit-gate-improvements.finish-derived-sync
status: draft
change: exit-gate-improvements
depends_on: [derived-registry-and-deterministic-generators]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - specs/active/exit-gate-improvements/areas/01-derived-artifacts.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/actions/commit-and-push.mjs
    - tools/specs/derived/registry.mjs
allowed_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/actions/commit-and-push.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/errors.mjs
  - tools/tests/finish-derived-sync.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - src/**
  - .github/**
semantic_references:
  decisions: [D2, D5]
  dependency_contracts:
    - derived-registry-and-deterministic-generators
---

# Task: Derived-artifact sync inside the finish transaction

## Goal

Call `syncDerivedArtifacts` from `ensureCommit` (inside the Git finalize lock, after
`update-task`, before `commit-and-push`), accept derived outputs as exact workflow-owned
paths, and surface typed infrastructure errors.

## Implementation constraints

- No change to `FINISH_STAGE_IDS` or the record schema (decision D2 option b).
- Errors thrown before `stage.intent` is written; never `reconciliation-required`.
- `finish --check` may preview the plan but must write nothing; `step start` untouched.
- `allowed_paths` semantics unchanged; no glob grants for outputs.

## Acceptance criteria

- Finish commits `change.yaml` + triggered indexes together. `automated: node --test tools/tests/finish-derived-sync.test.mjs`
- Repeated finish: `already-completed`, no new commit, no diff.
- Generator failure ⇒ `DERIVED_ARTIFACT_SYNC_FAILED`, `commit` stage `pending`; rerun succeeds.
- Crash before commit and after commit/before stage save resume without duplicate commit.
- Out-of-scope dirty file and non-triggered generated file still rejected; foreign dirty
  input ⇒ `DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION`, nothing staged.
- `DERIVED_INTEGRITY_FAILED` and `REPO_INTEGRITY_FAILED` (repo-wide specs/docs validate after sync, D5) are distinct from gate `failed` and from each other.
- `step start` after finish does not hit `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`.
- Settlement treats registered generator outputs as owned.

## Verification

```bash
node --test tools/tests/finish-derived-sync.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/derived-artifacts.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Publish and batch (task 03); legacy lifecycle migration.
