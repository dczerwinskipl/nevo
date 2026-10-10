---
id: exit-gate-imorovements.publish-and-batch-derived-sync
status: draft
change: exit-gate-imorovements
depends_on: [finish-derived-sync]
context:
  required:
    - specs/active/exit-gate-imorovements/overview.md
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
---

# Task: Derived-artifact sync for publish and batch finish

## Goal

Run the shared sync before the `task publish` commit (widening its commit set to the
written outputs) and before the batch stage-5 shared commit.

## Acceptance criteria

- Publish commits `change.yaml` + specs index together; index fresh afterwards. `automated: node --test tools/tests/publish-batch-derived-sync.test.mjs`
- Batch finish shared commit includes regenerated outputs; resume after
  `_crashAfterSharedCommit` produces no duplicate commit.
- Unrelated dirty file is not staged in either path.

## Verification

```bash
node --test tools/tests/publish-batch-derived-sync.test.mjs
node --test tools/tests/workflow-task-publish.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Adding scope enforcement to the batch shared commit (recorded follow-up).
