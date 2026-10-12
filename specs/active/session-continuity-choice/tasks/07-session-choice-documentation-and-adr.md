---
id: session-choice-documentation-and-adr
status: draft
change: session-continuity-choice
depends_on: [ step-start-session-choice-ui, batch-review-session-choice-ui ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - docs/development/workflow-engine.md
    - docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md
allowed_paths:
  - docs/development/workflow-engine.md
  - docs/development/agent-workflow-protocol.md
  - docs/decisions/**
forbidden_paths:
  - src/**
  - tools/**
semantic_references:
  decisions: [D1, D2, D3, D4]
---

# Task: Documentation and ADR

## Dependencies

`step-start-session-choice-ui`, `batch-review-session-choice-ui`.

## Goal

Record the new definition fields, validation rules, and sequential-batch semantics where
the current docs describe the old behavior.

## Requirements

- Update `docs/development/workflow-engine.md` for `execution.allow` and
  `execution.reuseFrom`, the server's candidate derivation and validation, provider
  compatibility, the default change for request-changes (D4), and the batch continue-each
  semantics (D3). Verify against the implemented behavior.
- Write the ADR. Whether it is a new ADR or an ADR-0009 addendum is an owner decision:
  present the choice with a recommendation in the task's review and stop; do not decide it
  unilaterally. Number a new ADR with the next free number (check for collisions with
  `node tools/docs.mjs validate`).
- Note the visible default change in the protocol doc.

## Acceptance criteria

- The workflow-engine doc describes the new fields and rules accurately.
  `inspection: statements match the implemented schema and server errors`
- The ADR exists with the owner-chosen form and records the rejected options (D1).
  `inspection: ADR lists options 1 and 3 and why they were rejected`
- `automated: node tools/docs.mjs validate`

## Verification

```bash
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Code changes.
