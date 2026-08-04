# Area: Foundation

## Responsibility

Establish the tooling and template baseline every later area depends on: the new
`project` doc type and revised/added document templates.

## Current state

`tools/docs/service.mjs`'s `REQUIRED_FIELDS` (`tools/docs/service.mjs:16-23`) validates
`architecture`, `development`, `adr`, `ai`, `change`, `package`, `guide` — no `project`
type. `docs/templates/package-doc-template.md` includes "Basic usage"/"Advanced usage"
sections that this change's D3 requires trimming out of every real package doc; there is
no maintainer-doc template.

## Requirements

- `tools/docs/service.mjs` gains a `project` entry in `REQUIRED_FIELDS`, additive only.
- `docs/templates/package-doc-template.md` is revised to reference-only content (no
  "Basic usage"/"Advanced usage") and to stop instructing authors to embed
  verification narration in reader-facing prose.
- `docs/templates/guide-doc-template.md` gains a "Constraints and failure modes"
  section (per the brief's "Task-oriented guides" rules); otherwise unchanged.
- `docs/templates/maintainer-doc-template.md` is created (subsystem responsibility,
  control/data flow, stable guarantees, ordering constraints, transaction ownership,
  failure semantics, extension points, forbidden approaches, required tests, unresolved
  decisions).

## Constraints

Additive-only tooling change — no existing document type's required fields change.

## Interfaces and boundaries

Every later area's tasks depend on the `project` type and the revised templates
existing before they add or migrate content.

## Area-specific acceptance criteria

- `node tools/docs.mjs validate` passes with the new type present and zero documents
  using it yet.
- The three templates exist, have no front matter (scanner-skipped), and match the
  section lists in "Requirements".

## Dependencies

None — this is the first area.

## Out of scope

Writing any package doc, maintainer doc, guide, or the known-issues document (later
areas).
