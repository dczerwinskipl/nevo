# Area: Package reference

## Responsibility

Migrate all 14 `docs/packages/*.md` files to `docs/reference/packages/` and trim each to
pure reference material per the brief's "Package reference" rules, removing process
narration and cross-file duplication.

## Current state

Package docs range 117–237 lines; the three longest (`NEvo.Orchestrating.md` 237,
`NEvo.Ddd.EventSourcing.md` 208, `NEvo.Messaging.Authorization.md` 202) are also the
three with the densest "confirmed against source"/`grep -rn` narration and the most
"Basic usage"/"Advanced usage" tutorial content duplicating (or pre-empting) content
that belongs in `docs/usage/`. The `Either<T>` convention, the dependency-direction
rule, and several other facts are each restated in multiple package docs instead of
linked from one authoritative maintainer doc.

## Requirements

- Move all 14 package docs + `classification.md` to `docs/reference/packages/`.
- For each: remove "Basic usage"/"Advanced usage" sections (their content, where not
  already covered by an existing guide, is handed to area `usage-guides` — do not
  delete real, non-duplicated usage information without a destination).
- Remove every instance of documentation-process narration ("confirmed against",
  "verified directly against", quoted `grep`/`find`/`dotnet sln` commands, the leaked
  task-ID reference in `NEvo.EntityFramework.md:106-107`) — state the fact directly.
- Replace restated explanations of `Either<Exception, T>`, the dependency-direction
  rule, and any other concept now owned by a `docs/development/*` doc (area
  `maintainer-documentation`) with a link to that doc.
- Add "When to use" / "When not to use" per the brief's package-reference rules (not
  present in the current template).
- Cross-link each package's remaining defect mentions to `docs/project/known-issues.md`
  (area `known-issues`) instead of restating the full detail inline.

## Constraints

No factual claim becomes unsourced as a result of trimming — a fact removed from prose
must either already exist in the linked authoritative doc, or be preserved verbatim if
no such doc exists yet.

## Interfaces and boundaries

Depends on areas `maintainer-documentation` and `known-issues` (needs their final
content/locations to link to instead of duplicate). Feeds area `usage-guides` (usage
content extracted here needs a home there) and area `navigation-and-ai-routing`.

## Area-specific acceptance criteria

- All 14 package docs live under `docs/reference/packages/`; `docs/packages/` no longer
  exists.
- No package doc contains a "Basic usage" or "Advanced usage" heading.
- No package doc contains process-narration phrasing (spot-checked against the audit's
  specific citations in `overview.md`).
- `node tools/docs.mjs validate` and `find --type package` pass with all 14 docs present.

## Dependencies

Depends on areas `foundation`, `maintainer-documentation`, `known-issues`.

## Out of scope

Writing the guides that absorb extracted usage content (area `usage-guides`) — this
area only identifies what needs a new home and removes it from the package page; the
guide itself is a separate task's output.
