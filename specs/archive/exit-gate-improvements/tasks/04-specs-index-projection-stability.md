---
id: exit-gate-improvements.specs-index-projection-stability
status: draft
change: exit-gate-improvements
depends_on: [derived-registry-and-deterministic-generators]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - tools/specs/indexes.mjs
allowed_paths:
  - tools/specs/indexes.mjs
  - tools/tests/index-generation.test.mjs
  - tools/tests/spec-identity.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - src/**
semantic_references:
  decisions: [D4]
  dependency_contracts:
    - derived-registry-and-deterministic-generators
---

# Task: Stable specs index projection

Implements owner decision D4 option (i).

## Goal

Drop `workflow_progress` from `index.generated.json` task entries (keep
`id`, `order`, `file`, `status`, `depends_on`) so mid-step manifest state does not stale
the index.

## Acceptance criteria

- Changing only `workflow_progress` leaves `checkSpecsIndexes` clean. `automated: node --test tools/tests/index-generation.test.mjs`
- Changing a task `status` still marks the index stale.
- No remaining consumer reads `tasks[].workflow_progress` from the index (per task 01 inventory).

## Verification

```bash
node --test tools/tests/index-generation.test.mjs
node --test tools/tests/spec-identity.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Regenerating the committed index (done by the owning workflow operation / maintenance commit).
