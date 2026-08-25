---
id: refaktoring-tooli.specs-service-and-lifecycle-decomposition
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/specs-core-and-lifecycle.md
    - docs/development/node-tooling-guidelines.md
    - tools/specs/lifecycle.mjs
    - tools/specs/service.mjs
    - tools/specs/lifecycle-primitives.mjs
    - tools/specs/gates.mjs
    - tools/specs/validation.mjs
  optional: []
allowed_paths:
  - tools/specs/**
  - tools/tests/specs/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C2, C4, C6]
---

# Task: Specs service and lifecycle decomposition

## Goal

Decompose the oversized modules `tools/specs/lifecycle.mjs` (1745 LOC) and `tools/specs/service.mjs` (1042 LOC) into small, cohesive single-responsibility modules in `tools/specs/lifecycle/` and `tools/specs/store/` / `tools/specs/`, preserving backward-compatible re-exports.

## Implementation constraints

- Split `lifecycle.mjs` into:
  - `tools/specs/lifecycle/transitions.mjs` (transition rules and dependency validation)
  - `tools/specs/lifecycle/recovery.mjs` (postcondition inspection, idempotency, REC-xx)
  - `tools/specs/lifecycle/batch.mjs` (batch selection, progress derivation, checkpoints)
  - `tools/specs/lifecycle/provenance.mjs` (changed path attribution, collision detection)
  - `tools/specs/lifecycle/stage.mjs` (pure stage derivation)
  - `tools/specs/lifecycle/review.mjs` (review scopes, batch review verdicts)
- Split `service.mjs` into:
  - `tools/specs/store/change-store.mjs` (loading, finding, and saving changes/tasks)
  - `tools/specs/fingerprint.mjs` (specification and task fingerprints)
  - `tools/specs/indexes.mjs` (building and checking specification indexes)
  - `tools/specs/context.mjs` (constructing task context packets)
  - `tools/specs/follow-ups.mjs` (parsing and persisting follow-up entries)
  - `tools/specs/batch-store.mjs` (batch intent persistence)
- Preserve `lifecycle.mjs` and `service.mjs` as re-export entrypoints to maintain import stability across external consumers.
- Pure decision logic must remain 100% deterministic and decoupled from I/O operations.

## Acceptance criteria

1. Newly created modules have a clear, single responsibility and do not exceed ~300–400 LOC. `automated: node --test tools/tests/specs/**/*.test.mjs`
2. `lifecycle.mjs` and `service.mjs` re-export all previous symbols without breaking public API contracts. `automated: node tools/specs.mjs validate`
3. All specification lifecycle and validation tests pass cleanly. `automated: node --test tools/tests/specs/**/*.test.mjs`

## Verification

```text
node --test tools/tests/specs/**/*.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- Changes to public CLI entrypoints in `tools/specs.mjs` (handled in task 03).
