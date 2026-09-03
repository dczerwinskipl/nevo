# Area: storybook-and-documentation

## Responsibility

Update the Colors foundation Storybook story to read live production `--color-*`
values (no duplicated TypeScript palette), prove every catalogued token actually
resolves to a real value (guarding against `@theme static` regressing to plain
`@theme`'s usage-detection gaps, D10), and update the UX/color guideline documentation
from provisional color roles to the final semantic contract.

## Current state

- `tools/dashboard/ui/foundations/colors.stories.tsx` currently documents the old
  `:root` tokens, including the generic "Category 1/2 accent" labels for `--cat-1`/
  `--cat-2` (lines 93-94) and the four now-dead `info-*`/`success-strong` variants
  (lines 54, 68-71) — confirmed defined but with zero real component consumers.
- No dedicated UX color-role guideline doc was identified by discovery under
  `docs/development/`; if one exists it must be found and updated during this task
  (`node tools/docs.mjs find` scoped to the dashboard/UI area), and if none exists, the
  change request's own requirement to "update the UX guidelines from provisional color
  roles to the final semantic contract" is satisfied by creating the minimal doc needed
  — confirm which case applies before writing new prose (per `artifact-policy.md`, don't
  create boilerplate for its own sake).

## Requirements

- Rewrite `colors.stories.tsx` to read live computed CSS custom property values (e.g. via
  `getComputedStyle` against a rendered element) rather than a hardcoded TypeScript
  object — the story must not duplicate palette values in source.
- Group tokens by semantic role (neutral/foreground/interaction/status/action/provider/
  workflow), matching the `@theme` block's own grouping.
- Show representative foreground/background combinations actually used by product
  components (not just isolated swatches) — at minimum: `fg-primary` on `background`,
  `fg-secondary`/`fg-muted` on `surface`, and the primary filled-button pair.
- Show all 7 `StatusTone` values (`status-active`, `status-success`, `status-warning`,
  `status-error`, `status-attention`, `status-info`, `status-neutral`), plus
  `action-destructive` shown separately in its real consumer context (a destructive
  Button variant), not grouped in as an 8th status tone.
- Include the primary filled-button contrast pair (`bg-accent-solid text-fg-on-accent`)
  with its computed contrast ratio displayed or computable from the story.
- Remove the old `cat-1`/`cat-2`/`info-*`/`success-strong` entries; replace with
  `provider-claude`/`provider-antigravity`/`workflow-design` and the canonical status
  set.
- Update (or create, if none exists) the UX color-role documentation to describe the
  final semantic contract by role/name, not by hex value — production CSS remains the
  value source of truth, the doc must not need to be updated every time a value changes.
- After any `docs/development/**` content change, run `node tools/docs.mjs generate` to
  refresh the generated doc indexes (`docs/index.generated.json`,
  `docs/index.generated.md`, `docs/routing.generated.json` — all three are this task's
  own tool-written output, included in its `allowed_paths`), then `node tools/docs.mjs
  validate` and `node tools/docs.mjs check`.
- Add a Storybook test asserting every catalogued token resolves to a non-empty computed
  color — this is the story's own guard against silently rendering blank swatches if
  `@theme static` isn't actually emitting a token (D10).
- Do not refactor typography or any unrelated Storybook story.

## Constraints

- No new palette values invented for the story — it reads whatever `index.css` actually
  contains.
- Depends on `areas/theme-foundation.md` (tokens must exist) and, for full accuracy,
  benefits from running after `areas/shared-ui-primitives.md` and
  `areas/status-tone-contract.md` land (so the filled-button pair and status tones are
  already migrated) — but does not require Areas 4-5 to be complete, since it documents
  the token contract itself, not feature-level consumption.

## Interfaces and boundaries

- Consumes: the `--color-*` contract, the migrated Button primitive, the status-tone
  module.
- Produces: nothing consumed by other areas.

## Area-specific acceptance criteria

1. `colors.stories.tsx` contains no hardcoded hex/color literal duplicating a theme
   value — every displayed value is read from computed styles at render time.
2. The story groups tokens by the same semantic categories as the `@theme` block.
3. The filled-button contrast pair is shown with a verifiable ≥4.5:1 ratio.
4. `cat-1`/`cat-2`/`info-*`/`success-strong` no longer appear in the story.
5. The UX documentation (existing or newly created, whichever applies) describes the
   final contract by role/name.
6. `npm --prefix tools/dashboard run test:storybook` and
   `npm --prefix tools/dashboard run build-storybook` pass.
7. `node tools/docs.mjs generate` was run after any `docs/development/**` change, and
   `node tools/docs.mjs validate`/`node tools/docs.mjs check` both pass.
8. A durable Storybook test confirms every catalogued token resolves to a non-empty
   computed color.

## Dependencies

`areas/theme-foundation.md`. Benefits from, but does not strictly require,
`areas/shared-ui-primitives.md` and `areas/status-tone-contract.md` completing first.

## Out of scope

- Any other Storybook story (typography, chat, etc.).
- Feature-level migration — Areas 2-5.
