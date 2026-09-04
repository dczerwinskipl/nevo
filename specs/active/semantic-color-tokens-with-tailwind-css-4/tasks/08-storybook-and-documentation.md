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
  - tools/dashboard/ui/foundations/colors.stories.tsx
  - docs/development/**
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/foundations/typography.stories.tsx
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
semantic_references:
  decisions: [D1, D2, D3, D10]
  constraints: [C5]
---

# Task: Live-value Colors story and UX documentation update

## Goal

Rewrite `colors.stories.tsx` to read live computed `--color-*` values grouped by
semantic role (no duplicated TypeScript palette), including the canonical status set,
provider/workflow tokens, and the filled-button contrast pair; update the UX color-role
documentation to the final contract.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`.

## Implementation constraints

- No hardcoded hex value may appear in `colors.stories.tsx` for any token also defined
  in `index.css` — read via computed styles.
- Add a Storybook test (via the existing `test:storybook`/Vitest-browser infrastructure)
  asserting that every token catalogued in the story resolves to a non-empty computed
  color value (`getComputedStyle(...).color`/`.backgroundColor` etc. is not `""`,
  `"rgba(0, 0, 0, 0)"`, or otherwise empty) — including the two `@theme static inline`
  alias tokens (`status-active`, `status-neutral`), not just the direct-value tokens.
  This is the story's own proof that `@theme static`/`@theme static inline`
  (`tasks/03-*`, D10) actually did their job; a story that silently renders blank
  swatches for undetected tokens is the exact failure mode `static` exists to prevent,
  so the story must actively check for it, not just visually assume it.
- First run:
  ```text
  node tools/docs.mjs find --query "semantic color status tokens" --type development
  ```
  and:
  ```text
  node tools/docs.mjs find --path tools/dashboard/ui/foundations/colors.stories.tsx
  ```
  to identify existing documentation owners under `docs/development/` (specifically
  `ui-ux-guidelines.md`); update the existing owner and do not create a duplicate
  design-system document.
- After changing any `docs/development/**` content, run `node tools/docs.mjs generate`
  to refresh `docs/index.generated.json`/`docs/index.generated.md`/
  `docs/routing.generated.json` (all three are in `allowed_paths` specifically for this
  — they are the deterministic, tool-written output of this step, not hand-edited), then
  `node tools/docs.mjs validate` and `node tools/docs.mjs check`.
- Do not touch `typography.stories.tsx` or any other unrelated story.
- Do not touch `index.css`, `components/ui/**`, or any `features/**` file.

## Acceptance criteria

1. `colors.stories.tsx` contains zero duplicated hex literals for theme-defined tokens.
   `inspection: source reviewed`
2. Tokens are grouped by the same categories as the `@theme` block (neutral, foreground,
   interaction, status, action, provider, workflow).
3. The filled-button pair (`bg-accent-solid text-fg-on-accent`) is shown with a
   verifiable ≥4.5:1 contrast ratio. `inspection: contrast ratio computed and recorded`
4. `cat-1`/`cat-2`/`info-strong`/`info-muted`/`info-border`/`success-strong` no longer
   appear in the story. `automated: ! grep -qE "cat-1|cat-2|info-strong|info-muted|info-border|success-strong" tools/dashboard/ui/foundations/colors.stories.tsx`
5. All 7 `StatusTone` values are represented, plus `action-destructive` shown
   separately in its actual consumer context (a destructive Button variant) — not
   listed as an 8th status tone.
6. UX documentation reflects the final role/name contract, not the provisional one.
7. `npm --prefix tools/dashboard run test:storybook` and
   `npm --prefix tools/dashboard run build-storybook` pass.
   `automated: both commands`
8. `node tools/docs.mjs generate` was run after any `docs/development/**` content
   change, and `node tools/docs.mjs validate` and `node tools/docs.mjs check` both pass.
   `automated: all three commands, in that order`
9. The new token-presence test fails if run against a story deliberately reading a
   non-existent token (sanity-checked during implementation), and passes against the
   real, final token catalog. `automated: part of test:storybook`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
node tools/docs.mjs generate
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

Updates (or creates) the UX color-role guideline doc under `docs/development/`.

## Out of scope

- Any other Storybook story.
- Feature-level component migration.
