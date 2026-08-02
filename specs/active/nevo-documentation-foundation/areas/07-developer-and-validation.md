# Area: Developer and extension guides, final validation

## Responsibility

Document how to extend NEvo (new transport, persistence mechanism, handler, event type)
and broader coding conventions, then validate the whole documentation system end to end.

## Current state

`docs/development/` already covers git workflow, commit conventions, PR rules, testing,
and local setup. It does not cover how to add a new transport, persistence mechanism,
handler, or event type, nor coding conventions beyond commit message format (e.g. the
`Either<Exception, T>` pattern referenced in
`docs/ai/specification-workflow.md:179` is used but not documented as a convention on its
own).

## Requirements

- `docs/guides/extending-nevo.md` — how to add a new transport, persistence mechanism,
  handler, or event type, grounded in how existing extension packages
  (`NEvo.Messaging.Web` as a transport, `NEvo.Messaging.EntityFramework` as a persistence
  mechanism) actually implement their respective extension points, cited by file/type
  name.
- A conventions section in `docs/development/coding-conventions.md` (new file — decided
  in D7, `owner-decisions.md`) covering patterns already established in code
  (`Either<Exception, T>`, package-boundary dependency direction) that aren't yet written
  down as conventions.
- Final pass: `node tools/docs.mjs generate` then `node tools/docs.mjs check`,
  `node tools/docs.mjs validate`, `node tools/specs.mjs validate`. Fix any broken
  `related`/cross-link reference found.

## Constraints

Do not invent an extension point that isn't demonstrated by at least one existing
package — every "how to add X" claim must cite the existing package that already does X
as the worked example.

## Interfaces and boundaries

Consumes: every package doc and guide produced by prior areas (this is the final
integration/validation pass). Produces: nothing new is added to `docs/packages/` here.

## Area-specific acceptance criteria

- The extension guide passes `node tools/docs.mjs validate` under the `guide` type.
- `node tools/docs.mjs check` reports indexes current.
- `node tools/specs.mjs validate` reports no errors for this change.
- Every `related`/cross-link reference across all documents created or modified by this
  change resolves to an existing document id.

## Dependencies

`05-remaining-package-docs`, `06-use-case-guides`.

## Out of scope

Any change to `src/**` to add an actual new extension point — this area documents
existing extension points only.
