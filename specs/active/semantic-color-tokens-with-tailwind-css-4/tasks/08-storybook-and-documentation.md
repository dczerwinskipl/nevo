---
id: semantic-color-tokens-with-tailwind-css-4.storybook-and-documentation
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/storybook-and-documentation.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/foundations/colors.stories.tsx
  optional:
    - tools/dashboard/ui/components/ui/button.tsx
    - tools/dashboard/ui/shared/status-tone.ts
allowed_paths:
  - tools/dashboard/ui/foundations/colors.stories.tsx
  - docs/development/**
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
  decisions: [D1, D2, D3]
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
- First run `node tools/docs.mjs find --scope <dashboard/UI-relevant scope>` (or
  equivalent) to determine whether a UX color-role doc already exists under
  `docs/development/`; update it if found, create the minimal doc if genuinely absent —
  do not create a duplicate doc if one exists.
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
5. All 9 canonical status tones are represented.
6. UX documentation reflects the final role/name contract, not the provisional one.
7. `npm --prefix tools/dashboard run test:storybook` and
   `npm --prefix tools/dashboard run build-storybook` pass.
   `automated: both commands`
8. `node tools/docs.mjs validate` passes if `docs/` was touched.
   `automated: node tools/docs.mjs validate`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
node tools/docs.mjs validate
```

## Documentation impact

Updates (or creates) the UX color-role guideline doc under `docs/development/`.

## Out of scope

- Any other Storybook story.
- Feature-level component migration.
