# Area: Ownership boundary documentation

## Responsibility

Document, in one authoritative place, the legacy/deterministic lifecycle-mutation ownership
boundary this change enforces in code — so the boundary is explicit and discoverable, not
only implicit in test coverage.

## Current state

`docs/development/agent-workflow-protocol.md` already has an "Ownership Boundaries &
Manifest Immutability" section (owner/product-only `workflow.mode` selection; agents never
directly mutate lifecycle/workflow state in `change.yaml`). No document currently states
which *modules* own legacy vs. deterministic mutation, or that cross-importing between them
is disallowed. `docs/development/package-boundaries.md` does not cover `tools/specs/**` at
all (it is scoped to the .NET project-reference graph) — confirmed by discovery, and
recorded as D3: this change does not create a new doc for this.

## Requirements

- Extend `docs/development/agent-workflow-protocol.md`'s existing "Ownership Boundaries &
  Manifest Immutability" section with: which module trees own legacy mutation
  (`tools/specs/{approve,start,complete,verify}/**`) vs. deterministic mutation
  (`tools/specs/workflow/**`'s mutation entry points), the hard-guard behavior
  `areas/lifecycle-boundary-guards.md` implements, and the no-cross-import rule the
  regression test in that area enforces.
- Cross-reference `areas/skills-instruction-split.md`'s legacy/deterministic instruction
  sets rather than restating them.

## Constraints

- Additive to the existing section — do not restructure or rewrite the rest of
  `agent-workflow-protocol.md`.
- Must accurately describe the *as-implemented* boundary (this area is written/finalized
  after the guard and regression-test areas land, or updated to match their final shape) —
  architecture docs describe current behavior, not aspiration (`references/artifact-policy.md`).

## Interfaces and boundaries

Exposes: the documented boundary — read by future contributors and agents, not consumed
programmatically.

Consumed by: `areas/skills-instruction-split.md` (cross-references it).

## Area-specific acceptance criteria

- `docs/development/agent-workflow-protocol.md`'s "Ownership Boundaries & Manifest
  Immutability" section, after this change, names both module trees and the guard/no-import
  rule explicitly.
- `node tools/docs.mjs validate` passes with the updated front matter/content.
- No new top-level doc file is created for this purpose (D3).

## Dependencies

`areas/lifecycle-boundary-guards.md` (documents what that area implements).

## Out of scope

Any change to `docs/development/package-boundaries.md` (still correctly scoped to .NET
only — not touched by this change).
