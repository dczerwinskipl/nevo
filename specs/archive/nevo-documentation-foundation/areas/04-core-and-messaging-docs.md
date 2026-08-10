# Area: Core and messaging package docs

## Responsibility

Document the packages most consuming applications depend on directly: `NEvo.Core`,
`NEvo.Messaging`, and its 4 extension packages.

## Current state

`NEvo.Core` has no dedicated doc of its own today — it appears only as the shared
dependency root in other architecture docs. `NEvo.Messaging` has 3 dedicated architecture
docs (`messaging-pipeline.md`, `message-context.md`, `inbox-outbox.md`) but no
purpose/usage-oriented package doc. The 4 extension packages
(`NEvo.Messaging.Cqrs`, `NEvo.Messaging.Authorization`, `NEvo.Messaging.Web`,
`NEvo.Messaging.EntityFramework`) have no documentation at all beyond their mention in
`overview.md`'s module map.

## Requirements

- `docs/packages/NEvo.Core.md`, `docs/packages/NEvo.Messaging.md`.
- `docs/packages/NEvo.Messaging.Cqrs.md`, `docs/packages/NEvo.Messaging.Authorization.md`,
  `docs/packages/NEvo.Messaging.Web.md`, `docs/packages/NEvo.Messaging.EntityFramework.md`.
- `NEvo.Messaging.Cqrs`'s doc must note, with evidence, that only the command side is
  implemented (`Commands/` folder; an empty `<Folder Include="Queries\" />` placeholder
  exists in the `.csproj` with no corresponding code) — do not describe query support as
  present or planned without evidence.
- Each extension package's doc must cross-reference `NEvo.Messaging`'s doc as the
  package it extends, consistent with the corrected `package-boundaries.md`.

## Constraints

Reuse the template validated in area 03 mechanically — do not introduce a new document
shape here.

## Interfaces and boundaries

Consumes: the validated template (area 03), corrected `package-boundaries.md` (area 02).
Produces: package docs that area 06 (use-case guides) and area 07 (developer guides)
cross-link to.

## Area-specific acceptance criteria

- All 6 docs pass `node tools/docs.mjs validate` under the `package` type.
- `NEvo.Messaging.Web`'s doc documents its actual dependency on `NEvo.Messaging.Cqrs`
  (per the area-02 correction) rather than omitting it.

## Dependencies

`03-edge-package-pilot` (template must be validated first).

## Out of scope

`NEvo.Authorization`, `NEvo.Web.Authorization` (already done in the pilot),
`NEvo.EntityFramework`, `NEvo.Web`, `NEvo.Ddd.EventSourcing`,
`NEvo.Orchestrating.EntityFramework` (area 05).
