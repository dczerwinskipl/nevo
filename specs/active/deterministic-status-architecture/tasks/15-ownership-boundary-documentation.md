---
id: deterministic-status-architecture.ownership-boundary-documentation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ownership-boundary-docs.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - docs/development/agent-workflow-protocol.md
forbidden_paths:
  - tools/**
  - src/**
  - docs/development/package-boundaries.md
depends_on: [ legacy-mutation-guard, deterministic-mutation-guard ]
semantic_references:
  decisions: [D3]
---

# Task: Ownership boundary documentation

## Goal

Extend `docs/development/agent-workflow-protocol.md`'s existing "Ownership Boundaries &
Manifest Immutability" section to name the legacy/deterministic mutation module trees and
the no-cross-import guard this change enforces — per `owner-decisions.md` D3, no new
top-level doc file.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard` — this task documents their final,
implemented shape, so it should run after (or be revised to match) their landed behavior.

## Implementation constraints

- Purely additive to the existing "Ownership Boundaries & Manifest Immutability" section —
  do not restructure or rewrite the rest of `agent-workflow-protocol.md`.
- Name the two module trees explicitly: `tools/specs/{approve,start,complete,verify}/**`
  (legacy mutation) and `tools/specs/workflow/**`'s mutation entry points (deterministic
  mutation), the hard-guard behavior, and the no-cross-import rule enforced by
  `lifecycle-boundary-regression-tests`.
- Cross-reference (do not restate) the legacy/deterministic instruction sets from
  `lifecycle-skill-instruction-split`.
- Do not touch `docs/development/package-boundaries.md` — it is correctly scoped to the
  .NET project-reference graph only and this change does not extend it.

## Acceptance criteria

- The "Ownership Boundaries & Manifest Immutability" section, after this task, names both
  module trees and the guard/no-import rule explicitly.
  `inspection: confirm the section text names both module trees and the no-cross-import rule`
- `node tools/docs.mjs validate` passes with the updated content/front matter.
  `automated: node tools/docs.mjs validate`
- No new top-level doc file is created by this task (D3).
  `inspection: confirm git status shows only agent-workflow-protocol.md modified, no new file`

## Verification

```bash
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/development/agent-workflow-protocol.md` (this task's own scope).

## Out of scope

`docs/development/package-boundaries.md` (unchanged — it does not cover `tools/specs/**`
and this change does not extend it to).
