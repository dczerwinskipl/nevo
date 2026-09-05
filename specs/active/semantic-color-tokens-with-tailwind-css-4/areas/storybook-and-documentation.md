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

- Author `docs/development/dashboard-frontend-architecture.md` formally establishing the
  dashboard architecture contract: layer responsibilities (`app -> routes -> features -> shared`),
  component taxonomy, domain area boundaries, public API rules, resolution of `components/ui`
  vs `shared/ui` (declaring `shared/ui` as official home and recognizing `components/ui` as legacy
  with deferred mass migration), state management, Storybook colocation, and decision matrix (D15).
- Align Storybook story titles across all primitives (`Shared/UI/*`), features (`Features/<Domain>/*`),
  and foundations (`Foundations/*`).
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

1. `docs/development/dashboard-frontend-architecture.md` is authored with all 11 required
   sections, decision matrix, pseudo-tree, and guidelines, and cross-referenced in related docs.
2. Story titles match the component taxonomy (`Shared/UI/*`, `Features/*`, `Foundations/*`).
3. `colors.stories.tsx`, `typography.stories.tsx`, and `smoke.stories.tsx` use semantic
   Tailwind utilities and live token resolution.
4. Tokens in `colors.stories.tsx` are grouped by semantic categories.
5. Filled-button contrast pair meets ≥4.5:1 ratio.
6. `docs/development/storybook.md` accurately describes story structure and co-location.
7. Broken section references to `react-component-guidelines.md` are resolved.
8. `npm --prefix tools/dashboard run test:storybook` and `npm --prefix tools/dashboard run build-storybook` pass.
9. `node tools/docs.mjs generate`, `validate`, and `check` all pass.


## Dependencies

`areas/theme-foundation.md`. Benefits from, but does not strictly require,
`areas/shared-ui-primitives.md` and `areas/status-tone-contract.md` completing first.

## Out of scope

- Chat, session, and domain feature story authoring outside the foundations and primitives covered by Tasks 04-07.
- Feature-level component migration — Areas 2-5.
