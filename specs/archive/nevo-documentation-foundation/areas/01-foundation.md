# Area: Documentation foundation

## Responsibility

Establish the tooling, directory structure, package classification, and navigation hub
that every later area depends on.

## Current state

`tools/docs.mjs` validates exactly 5 document types (`architecture`, `development`,
`adr`, `ai`, `change` — `tools/docs.mjs:15-21`). There is no `docs/packages/`,
`docs/guides/`, or `docs/templates/` directory. `docs/index.generated.md` is a flat,
by-type listing produced by `node tools/docs.mjs generate` — not a curated hub.

## Requirements

- `tools/docs.mjs` gains `package` and `guide` entries in `REQUIRED_FIELDS`, additive
  only (no existing type's required fields change).
- `docs/packages/` and `docs/guides/` exist as the canonical locations for the new
  content (D2).
- `docs/templates/` holds skeleton documents for the `package` and `guide` shapes
  (unindexed — no front matter, so `tools/docs.mjs` scanning skips them silently).
- A package-classification document groups the 13 real `src/` packages into: core
  primitives (`NEvo.Core`), messaging core (`NEvo.Messaging`), messaging extensions
  (`NEvo.Messaging.Cqrs`, `NEvo.Messaging.Authorization`, `NEvo.Messaging.Web`,
  `NEvo.Messaging.EntityFramework`), authorization (`NEvo.Authorization`,
  `NEvo.Web.Authorization`), persistence (`NEvo.EntityFramework`), web (`NEvo.Web`),
  event sourcing — experimental (`NEvo.Ddd.EventSourcing`), orchestration — experimental
  (`NEvo.Orchestrating`, `NEvo.Orchestrating.EntityFramework`).
- A navigation hub page links architecture docs, package docs, guides, and ADRs by
  relationship, not just by type.

## Constraints

Per D1: the extension is additive only — no existing document's required fields change,
and no automated cross-link/staleness enforcement is added (Option 3 in D1 was not
chosen).

## Interfaces and boundaries

Every later area's tasks depend on the `package`/`guide` types and the
`docs/packages/`/`docs/guides/` directories existing and validating cleanly before they
add content.

## Area-specific acceptance criteria

- `node tools/docs.mjs validate` passes with the new types present and zero documents
  using them yet (structure exists before content).
- The package-classification document names all 13 real `src/` packages exactly once,
  each in exactly one group.
- The navigation hub links to every existing `docs/architecture/*` and
  `docs/development/*` document.

## Dependencies

None — this is the first area.

## Out of scope

Writing any individual package doc or guide (later areas). Fixing the discovered
architecture inconsistencies (area 02).
