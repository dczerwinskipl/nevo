---
id: recovery-documentation-and-adr-amendment
status: draft
change: workspace-claim-self-recovery
depends_on: [ acquire-self-heal-on-contention, workspace-recover-command ]
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md
    - docs/development/agent-workflow-protocol.md
allowed_paths:
  - docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md
  - docs/development/agent-workflow-protocol.md
forbidden_paths:
  - src/**
  - tools/**
semantic_references:
  decisions: [D1, D2]
  dependency_contracts: [acquire-self-heal-on-contention, workspace-recover-command]
---

# Task: Documentation and ADR-0009 amendment

## Dependencies

`acquire-self-heal-on-contention`, `workspace-recover-command`.

## Goal

Record the new behavior where the existing documents describe the old behavior (D2).

## Requirements

- Add an "Amendment" section to ADR-0009 stating: a `recovery-required` agent claim is
  re-assessed on demand with the shared settlement classifier whenever it blocks an
  acquisition; it is released when settlement is `completed` or `resumable` and still
  blocks when ambiguous; the supported operator path is the recover command; and why the
  liveness-bound lease alternative was not adopted. Refine, do not delete, the existing
  sentence that `recovery-required` blocks until repaired.
- Update `docs/development/agent-workflow-protocol.md` where it describes the
  workspace-writer block, with the new error contents and the recovery command, verified
  against the implemented command spelling and error text.

## Acceptance criteria

- ADR-0009 contains the amendment and keeps its original decision record intact.
  `inspection: diff shows only an added amendment section plus the one refined sentence`
- The protocol doc names the actual implemented command and error fields.
  `inspection: command spelling matches tools/specs.mjs and the CLI test`
- `automated: node tools/docs.mjs validate`

## Verification

```bash
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

New ADRs, and any code change.
