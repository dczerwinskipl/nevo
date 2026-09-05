# Area: storybook-and-documentation

## Responsibility

Update all foundation Storybook stories (`colors.stories.tsx`, `typography.stories.tsx`,
`smoke.stories.tsx`) to read live production `--color-*` values and use semantic Tailwind
utilities, prove every catalogued token actually resolves to a real value, update
`docs/development/storybook.md` to match actual story hierarchy and co-location rules,
repair broken numeric section references to `react-component-guidelines.md`, and update
the UX/color guideline documentation to the final semantic contract.

## Current state

- `tools/dashboard/ui/foundations/colors.stories.tsx` currently documents the old
  `:root` tokens, including generic labels and dead variants.
- `typography.stories.tsx` and `smoke.stories.tsx` contain legacy `var(--foreground)`-style
  utilities and raw `amber-*` classes.
- `docs/development/storybook.md` inaccurately claims that `Components/*` is unused.
- Broken numeric section references (`§20.1`, `§16`, old `§9.1`/`§9.2`) to
  `react-component-guidelines.md` exist across source files.

## Requirements

- Rewrite `colors.stories.tsx` to read live computed CSS custom property values rather
  than hardcoded objects.
- Migrate `typography.stories.tsx` and `smoke.stories.tsx` to semantic Tailwind utilities
  and remove raw palette classes and legacy CSS variables.
- Group tokens in `colors.stories.tsx` by semantic role (neutral, foreground, interaction,
  status, action, provider, workflow).
- Show representative foreground/background combinations and all 7 `StatusTone` values
  plus `action-destructive`.
- Update `docs/development/storybook.md` to reflect real story hierarchy and co-location rules.
- Replace fragile numeric references to `react-component-guidelines.md` with stable headings/IDs.
- After any `docs/development/**` change, run `node tools/docs.mjs generate`, `validate`, `check`.

## Area-specific acceptance criteria

1. `colors.stories.tsx`, `typography.stories.tsx`, and `smoke.stories.tsx` use semantic
   Tailwind utilities and live token resolution.
2. Tokens in `colors.stories.tsx` are grouped by semantic categories.
3. Filled-button contrast pair meets ≥4.5:1 ratio.
4. `docs/development/storybook.md` accurately describes story structure and co-location.
5. Broken section references to `react-component-guidelines.md` are resolved.
6. `npm --prefix tools/dashboard run test:storybook` and `npm --prefix tools/dashboard run build-storybook` pass.
7. `node tools/docs.mjs generate`, `validate`, and `check` all pass.


## Dependencies

`areas/theme-foundation.md`. Benefits from, but does not strictly require,
`areas/shared-ui-primitives.md` and `areas/status-tone-contract.md` completing first.

## Out of scope

- Any other Storybook story (typography, chat, etc.).
- Feature-level migration — Areas 2-5.
