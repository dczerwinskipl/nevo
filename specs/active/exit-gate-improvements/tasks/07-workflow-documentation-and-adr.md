---
id: exit-gate-improvements.workflow-documentation-and-adr
status: draft
change: exit-gate-improvements
depends_on: [finish-derived-sync, publish-and-batch-derived-sync, specs-index-projection-stability, gate-failure-recovery-and-taxonomy, explicit-task-verification-action]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - docs/development/workflow-engine.md
allowed_paths:
  - docs/decisions/ADR-0011-workflow-owned-derived-artifacts-and-transition-aware-gates.md
  - docs/development/workflow-engine.md
  - docs/development/agent-workflow-protocol.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - tools/**
  - src/**
semantic_references:
  decisions: [D2, D3, D4, D5, D6]
  dependency_contracts:
    - finish-derived-sync
    - publish-and-batch-derived-sync
    - specs-index-projection-stability
    - gate-failure-recovery-and-taxonomy
    - explicit-task-verification-action
---

# Task: Documentation and ADR

## Goal

Document the as-built ownership model, sync points, error codes, `when` semantics and
recovery behavior; add the ADR (next free number, re-checked at start).

## Acceptance criteria

- ADR and doc sections match shipped behavior. `inspection: compare against tasks 02, 03, 05, 06`
- Docs state when generated artifacts are synchronized and when a clean tree is required.
- Docs indexes regenerated (until task 02 lands for docs, they remain task-owned here).

## Verification

```bash
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Any code change.
