---
id: exit-gate-improvements.publish-and-batch-derived-sync
status: draft
change: exit-gate-improvements
depends_on: [finish-derived-sync]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - specs/active/exit-gate-improvements/areas/01-derived-artifacts.md
    - tools/specs/derived/registry.mjs
    - tools/specs/workflow/publish/operation.mjs
    - tools/specs/workflow/batch-finish/operation.mjs
allowed_paths:
  - tools/specs/workflow/publish/operation.mjs
  - tools/specs/workflow/batch-finish/operation.mjs
  - tools/tests/workflow-task-publish.test.mjs
  - tools/tests/publish-batch-derived-sync.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D2]
  dependency_contracts:
    - finish-derived-sync
---

# Task: Derived-artifact sync for publish and batch finish

## Goal

Run the shared sync before the `task publish` commit (widening its commit set to the
written outputs) and before the batch stage-5 shared commit, replacing the batch commit's
unconstrained default `include: ['*']` with an explicit staging scope.

## Acceptance criteria

- Publish commits `change.yaml` + specs index together; index fresh afterwards. `automated: node --test tools/tests/publish-batch-derived-sync.test.mjs`
- Batch finish shared commit includes regenerated outputs; resume after
  `_crashAfterSharedCommit` produces no duplicate commit.
- Explicit staging ownership in both paths: `publish` stages `[change.yaml, ...writtenDerivedOutputs]`; batch finish stage 5 stages only `(∪ allowed_paths) ∪ workflowOwnedPaths ∪ derivedOwnedPaths`, replacing the unconstrained default `include: ['*']`. Unrelated dirty files outside this explicit set are never staged.

## Verification

```bash
node --test tools/tests/publish-batch-derived-sync.test.mjs
node --test tools/tests/workflow-task-publish.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Individual task scope validation during the batch run (individual tasks are checked during single-task `finishStep`).
