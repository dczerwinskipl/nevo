---
id: workspace-recover-command
status: draft
change: workspace-claim-self-recovery
depends_on: [ workspace-claim-recovery-core ]
context:
  required:
    - specs/active/workspace-claim-self-recovery/overview.md
    - specs/active/workspace-claim-self-recovery/owner-decisions.md
    - tools/specs/workflow/workspace-claim-recovery.mjs
    - tools/specs.mjs
    - tools/specs/workflow/cli.mjs
allowed_paths:
  - tools/specs.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/workflow-workspace-recover-cli.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/workspace-writer.mjs
semantic_references:
  decisions: [D1]
  dependency_contracts: [workspace-claim-recovery-core]
---

# Task: Operator recovery command

## Dependencies

`workspace-claim-recovery-core`.

## Goal

Give the operator a supported command to inspect and repair a stuck workspace claim,
replacing the test-only `forceReleaseWorkspaceWriterUnsafe` and ad hoc scripts.

## Requirements

- `node tools/specs.mjs workflow workspace recover` (final spelling may follow the
  existing `workflow` subcommand conventions in `tools/specs.mjs`):
  - Reads the current claim. No claim: prints that and exits 0.
  - Claim not `recovery-required`: prints the holder (kind, change, task, session, age)
    and exits 0 without changing anything.
  - `recovery-required` agent claim: runs `recoverWorkspaceClaim`, prints the outcome
    (released, or unresolved with reason and holder), exit 0 for released, non-zero for
    unresolved.
  - Corrupt or batch-scope claim: prints why it cannot be auto-recovered; exit non-zero.
- An explicit force path for genuinely ambiguous claims is permitted only if it requires
  both a force flag and a confirmation flag and prints what it is releasing; whether to
  include it at all is an open question (see Out of scope) — implement the non-force path
  only unless the owner decides otherwise before approval.
- Supports `--json` output consistent with sibling `workflow` commands.

## Acceptance criteria

- Recovering a settled `recovery-required` claim releases it and exits 0.
  `automated: node --test tools/tests/workflow-workspace-recover-cli.test.mjs`
- An unresolved claim is left in place and the command exits non-zero with the holder.
  `automated: node --test tools/tests/workflow-workspace-recover-cli.test.mjs`
- No claim and active-claim cases change nothing.
  `automated: node --test tools/tests/workflow-workspace-recover-cli.test.mjs`
- `--json` output is valid JSON with `recovered`, `outcome`, and `holder` fields.
  `automated: node --test tools/tests/workflow-workspace-recover-cli.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-workspace-recover-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

A force-release path (open owner question, non-blocking), UI buttons for recovery, and the
acquire-time integration (task 02).
