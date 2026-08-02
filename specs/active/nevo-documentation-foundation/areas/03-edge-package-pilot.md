# Area: Edge-package pilot

## Responsibility

Validate the package-doc template (from area 01) against two representative packages
before scaling to the remaining 11 (D5).

## Current state

Neither `NEvo.Orchestrating` nor `NEvo.Web.Authorization` has any dedicated documentation
today. `NEvo.Orchestrating` depends only on `NEvo.Core` (deliberately decoupled from
messaging per `package-boundaries.md` rule 3) and is marked `experimental` in
`docs/architecture/orchestration.md`'s front matter. `NEvo.Web.Authorization` is a
small, single-purpose package (`ServiceCollectionExtensions.cs` plus provider
implementations under `Claims/`, `Roles/`, `Users/` — corrected here from "single-file"
after task `package-doc-web-authorization` read the real source) depending only on
`NEvo.Authorization`.

## Requirements

- `docs/packages/NEvo.Orchestrating.md` and `docs/packages/NEvo.Web.Authorization.md`,
  each covering: purpose, responsibilities, dependencies, public concepts/APIs,
  configuration, basic usage, advanced usage, limitations, related packages, relevant
  examples/tests.
- Any gap or awkward fit found in the area-01 template must be fixed in the template
  itself (not worked around ad hoc in these two docs), since every later package-doc task
  reuses it.

## Constraints

Both packages are `experimental`/minimal respectively — do not present either as more
stable or more complete than the code and existing architecture docs support.

## Interfaces and boundaries

Consumes: the `package` doc type and `docs/templates/package-doc-template.md` from area
01, and the corrected `package-boundaries.md` from area 02. Produces: the validated
template shape that areas 04-05 apply mechanically.

## Area-specific acceptance criteria

- Both package docs pass `node tools/docs.mjs validate` under the `package` type.
- Every dependency claim in both docs matches the corrected `package-boundaries.md`.
- `NEvo.Orchestrating.EntityFramework`'s EF-persistence relationship to
  `NEvo.Orchestrating` is at least cross-referenced from the `NEvo.Orchestrating` doc's
  "related packages" section (its own doc is written in area 05).

## Dependencies

`01-foundation`, `02-architecture-corrections`.

## Out of scope

Documenting `NEvo.Orchestrating.EntityFramework` in full (area 05). Any other package.
