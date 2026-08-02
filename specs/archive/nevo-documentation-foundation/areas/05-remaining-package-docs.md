# Area: Remaining package docs

## Responsibility

Document the remaining 5 packages not covered by the pilot (area 03) or core/messaging
(area 04): `NEvo.Authorization`, `NEvo.EntityFramework`, `NEvo.Web`,
`NEvo.Ddd.EventSourcing`, `NEvo.Orchestrating.EntityFramework`.

## Current state

`NEvo.Authorization` and `NEvo.EntityFramework` are mentioned only in the module-map/
dependency-graph docs, no deeper write-up. `NEvo.Web` has the description error corrected
in area 02 but no package doc yet. `NEvo.Ddd.EventSourcing` and
`NEvo.Orchestrating.EntityFramework` have dedicated architecture docs
(`event-sourcing.md`, `orchestration.md`) marked `experimental`, but no purpose/usage
package doc.

## Requirements

- `docs/packages/NEvo.Authorization.md`, `docs/packages/NEvo.EntityFramework.md`.
- `docs/packages/NEvo.Web.md` — must reflect the corrected description from area 02 (HTTP
  client wrapper, not middleware/routing).
- `docs/packages/NEvo.Ddd.EventSourcing.md`,
  `docs/packages/NEvo.Orchestrating.EntityFramework.md` — both must carry the same
  `experimental` status their existing architecture docs state, and must not present
  either as production-ready.

## Constraints

Reuse the validated template (area 03) mechanically.

## Interfaces and boundaries

Consumes: validated template (area 03), corrected facts (area 02). Produces: the full
13-package doc set that area 06/07 reference.

## Area-specific acceptance criteria

- All 5 docs pass `node tools/docs.mjs validate` under the `package` type.
- `docs/packages/NEvo.Web.md`'s description matches the corrected `README.md` entry from
  area 02 (no drift between the two).
- After this area, `docs/packages/` contains exactly 13 documents — one per real `src/`
  package, no more, no fewer.

## Dependencies

`04-core-and-messaging-docs`.

## Out of scope

Any package already documented in areas 03-04.
