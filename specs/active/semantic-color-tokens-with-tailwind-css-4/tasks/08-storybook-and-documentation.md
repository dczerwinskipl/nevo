---
id: semantic-color-tokens-with-tailwind-css-4.storybook-and-documentation
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/storybook-and-documentation.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/storybook.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/foundations/colors.stories.tsx
  optional:
    - docs/development/react-component-guidelines.md
    - tools/dashboard/ui/components/ui/button.tsx
    - tools/dashboard/ui/shared/status-tone.ts
allowed_paths:
  - tools/dashboard/ui/foundations/**
  - docs/development/**
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/**
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
semantic_references:
  decisions: [D1, D2, D3, D10, D14]
  constraints: [C5]
---

# Task: Live-value Colors story, foundation stories migration, and UX/Storybook documentation update

## Goal

Rewrite `colors.stories.tsx` to read live computed `--color-*` values grouped by
semantic role (no duplicated TypeScript palette), including the canonical status set,
provider/workflow tokens, and the filled-button contrast pair. Migrate all foundation
stories (`colors.stories.tsx`, `typography.stories.tsx`, `smoke.stories.tsx`) to semantic
Tailwind utilities and live token resolution. Update `docs/development/storybook.md` to
reflect actual story hierarchy and co-location rules, repair stale section references to
`react-component-guidelines.md`, and update UX color-role documentation.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`.

## Implementation constraints

- No hardcoded hex value may appear in `colors.stories.tsx` for any token also defined
  in `index.css` — read via computed styles.
- Add a Storybook test (via the existing `test:storybook`/Vitest-browser infrastructure)
  asserting that every token catalogued in the story resolves to a non-empty computed
  color value — including the two `@theme static inline` alias tokens (`status-active`,
  `status-neutral`), not just the direct-value tokens.
- Migrate all foundation stories:
  - `colors.stories.tsx`: live token resolution, remove copied hex/RGB expectations, remove
    stale source-line metadata.
  - `typography.stories.tsx`: replace legacy `var(--foreground)`-style utilities and raw
    colors with semantic utilities (`text-fg-primary`, `text-fg-secondary`, `text-fg-muted`).
  - `smoke.stories.tsx`: replace raw `amber-*` palette utilities with semantic tokens.
- Documentation consistency:
  - Update `docs/development/storybook.md` to describe the actual story hierarchy and
    co-location rules (remove outdated claim that `Components/*` is unused).
  - Find references in source code to moved/nonexistent numeric sections of
    `react-component-guidelines.md` (`§20.1`, `§16`, old `§9.1`/`§9.2`) and remove or replace
    them with stable doc IDs and heading names.
- After changing any `docs/development/**` content, run `node tools/docs.mjs generate`
  to refresh `docs/index.generated.json`/`docs/index.generated.md`/`docs/routing.generated.json`,
  then `node tools/docs.mjs validate` and `node tools/docs.mjs check`.
- Do not touch `index.css`, `components/ui/**`, or any `features/**` file.

## Acceptance criteria

1. `colors.stories.tsx` contains zero duplicated hex literals for theme-defined tokens.
2. Tokens are grouped by the same categories as the `@theme` block (neutral, foreground,
   interaction, status, action, provider, workflow).
3. The filled-button pair (`bg-accent-solid text-fg-on-accent`) is shown with a
   verifiable ≥4.5:1 contrast ratio.
4. `cat-1`/`cat-2`/`info-strong`/`info-muted`/`info-border`/`success-strong` no longer
   appear in the story.
5. All 7 `StatusTone` values are represented, plus `action-destructive` shown separately.
6. All foundation stories (`colors`, `typography`, `smoke`) use semantic Tailwind utilities
   and live token resolution with no legacy `var(--foreground)`, raw `amber-*`, or stale line numbers.
7. `docs/development/storybook.md` accurately describes story hierarchy and co-location rules.
8. Fragile numeric section references to `react-component-guidelines.md` are replaced or removed.
9. `npm --prefix tools/dashboard run test:storybook` and `npm --prefix tools/dashboard run build-storybook` pass.
10. `node tools/docs.mjs generate` was run, and `node tools/docs.mjs validate` and `node tools/docs.mjs check` both pass.

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
node tools/docs.mjs generate
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

Updates `docs/development/storybook.md`, `docs/development/ui-ux-guidelines.md`, and references across docs.

## Out of scope

- Feature-level component migration.
