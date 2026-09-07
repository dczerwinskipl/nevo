---
id: storybook-for-nevo-ai.foundation-stories
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/areas/foundation-stories.md
    - tools/dashboard/ui/index.css
    - docs/development/ui-ux-guidelines.md
allowed_paths:
  - tools/dashboard/ui/foundations/**
forbidden_paths:
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/index.css
  - tools/dashboard/server/**
  - src/**
depends_on:
  - storybook-infrastructure-setup
semantic_references:
  decisions: []
  constraints: [C2, C5]
  dependency_contracts: [storybook-infrastructure-setup]
---

# Task: Typography and color foundation stories

## Goal

Add Storybook foundation stories that render the dashboard's real, current typography and
color tokens from `tools/dashboard/ui/index.css` — no aspirational or parallel palette.

## Dependencies

- `storybook-infrastructure-setup` (task 03).

## Implementation constraints

- Every rendered value must trace to an existing `index.css` custom property or an
  actually-used Tailwind utility class, cited by file:line in the story's own docs.
- Reuse the real `index.css` import already wired into `.storybook/preview.ts(x)` by task
  03 — do not inline copied CSS variable values.
- Document explicitly that only one theme exists (`color-scheme: dark`, no toggle) and that
  no font-loading mechanism exists for "Inter" — do not silently fix or hide either gap.
- `tools/dashboard/ui/index.css` itself is not modified by this task (`forbidden_paths`) —
  it is read-only source material.

## Acceptance criteria

1. Every semantic color token in `index.css:6-51` appears in a color story with its
   custom-property name and resolved value. `inspection: enumerate index.css custom properties and confirm each appears`
2. The typography story renders the real font stack and distinct active font-size, line-height,
   and font-weight utilities present across `features/` and `components/ui/`, each labeled with
   its producing Tailwind utility class and a concrete source-file example.
   `inspection: cross-check against a grep of text-*/leading-*/font-* utility usage`
3. Documented values match `index.css`'s current values exactly.
   `inspection: diff each rendered value against index.css`
4. A representative computed style (`--success` resolved color) is identical between the
   story and the production app when inspected via computed styles.
   `inspection: computed-style comparison performed and recorded`

Note: once task 04 (`component-testing-infrastructure`) has landed, these stories must also
render successfully under `@storybook/addon-vitest` — task 04's own acceptance criterion 2
re-verifies this for whatever stories exist at that point; it is not restated as this task's
own criterion because this task does not depend on task 04.

## Verification

```text
npm --prefix tools/dashboard run build-storybook
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build
```

## Out of scope

- Component-level stories (button, card, etc.) — foundations only.
- Adding or redesigning tokens.
