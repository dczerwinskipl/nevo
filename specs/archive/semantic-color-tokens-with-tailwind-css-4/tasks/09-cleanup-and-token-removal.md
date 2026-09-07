---
id: semantic-color-tokens-with-tailwind-css-4.cleanup-and-token-removal
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/cleanup-and-enforcement.md
    - docs/development/react-component-guidelines.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - docs/development/nevo-interaction-model.md
    - docs/development/storybook.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/index.html
allowed_paths:
  - tools/dashboard/ui/**
  - tools/dashboard/tests/**
  - docs/development/dashboard-frontend-architecture.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
  - agent-sessions-and-work
  - specs-lanes-and-remaining-ui
  - storybook-and-documentation
semantic_references:
  decisions: [D1, D5, D9]
  constraints: [C5, C6]
---

# Task: Migrate global CSS, remove legacy tokens, `--color-*: initial`, theme-color fix

## Goal

Confirm zero remaining TS/TSX `-[var(--…)]`/raw-white-black/`color-mix(...)`
occurrences; migrate every legacy CSS-variable reference embedded directly in
`index.css`'s own selectors (`*`, `html`, `body`, `::selection`, `.markdown-body*`,
`.nevo-diff-view*`) to the new `--color-*` tokens; **only then** remove the legacy color
custom-property declarations and the 5 dead token variants, while preserving
`index.css`'s 4 non-color global declarations (`color-scheme`, `font-family`,
`font-synthesis`, `text-rendering`); add `--color-*: initial` to `@theme`; and fix
`index.html`'s `theme-color` to match `--color-background`.

## Dependencies

Every consumer-migration task: `shared-ui-primitives`, `status-tone-contract`,
`agent-sessions-and-work`, `specs-lanes-and-remaining-ui`,
`storybook-and-documentation`.

## Implementation constraints

- Run the TS/TSX sweep first (`tools/dashboard/ui/**/*.{ts,tsx}`, including `*.stories.tsx`,
  excluding tests/fixtures); if it finds any straggler, fix it in this task (do not defer)
  and note which earlier task missed it. Stories are executable UI consumers and must
  satisfy the same token architecture as production components.
- **Migrate `index.css`'s own embedded `var(--legacy-name)` references before removing
  any legacy declaration.** The full, confirmed list (line numbers from the file as of
  this spec's writing — re-verify against the actual file at implementation time, since
  earlier tasks may have shifted lines):
  - `*` (line 59): `scrollbar-color: var(--border-strong) transparent;` →
    `var(--color-border-strong)`.
  - `html` (line 65): `background: var(--background);` → `var(--color-background)`.
  - `body` (line 76): `color: var(--foreground);` → `var(--color-fg-primary)`. (The
    `background` declaration's raw `rgba(255,255,255,…)` decorative gradients, lines
    72-75, are not var-based and stay as-is — decorative exception.)
  - `::selection` (lines 102-103): `background: color-mix(in srgb, var(--accent) 30%,
    transparent); color: var(--accent-foreground);` → update the variable names inside
    (`var(--color-accent)`, `var(--color-fg-on-accent)`) — **keep the `color-mix(...)`
    itself**, this is the allowed selector-oriented-global-CSS exception, not a
    violation to convert to a Tailwind utility (there is no Tailwind class context
    here at all).
  - `.markdown-body` and descendants (lines 110, 123, 129, 143, 144, 146, 151, 153, 155,
    162, 164, 169, 173, 174): update each `var(--muted-strong|foreground|border|accent|
    muted|background)` to its `--color-*` equivalent
    (`fg-secondary|fg-primary|border|accent|fg-muted|background`); line 146's
    `color-mix(in srgb, var(--accent) 45%, transparent)` keeps its `color-mix(...)` form
    (same exception), only the variable name updates.
  - `.nevo-diff-view` and descendants (lines 177, 183):
    `scrollbar-color: var(--border-strong) var(--background);` and
    `background: var(--surface);` → `--color-border-strong`/`--color-background`/
    `--color-surface`.
- Only after that migration is verified complete, remove the 39 legacy color custom
  properties from `:root` and the 5 dead token variants (`--success-strong`, `--info`,
  `--info-strong`, `--info-muted`, `--info-border` — confirm they were never carried
  into `@theme`, since Area 1's contract never listed them).
- **Do not remove the `:root` selector.** It keeps exactly 4 declarations:
  `color-scheme: dark;`, `font-family: ...;`, `font-synthesis: none;`,
  `text-rendering: optimizeLegibility;`. If a concrete reason emerges during
  implementation to move any of these to `html`/`body` instead, do so deliberately and
  record why — do not move them by default.
- `theme-color` in `index.html` must equal `--color-background`'s literal value
  (`#090a0d`), not be independently re-derived.
- Add `--color-*: initial;` to the `@theme` block only after the above migration and
  removal are both complete (adding it earlier would unstyle any not-yet-migrated
  default-palette usage — but by this task, none should remain).

## Acceptance criteria

1. TS/TSX sweep (`tools/dashboard/ui/**/*.{ts,tsx}`, including `*.stories.tsx`,
   excluding tests/fixtures) returns zero `-[var(--`, raw white/black, or `color-mix(` occurrences.
   `automated: sweep grep with story/test/fixture exclusions, scoped to .ts/.tsx`
2. Zero `var(--legacy-name)` references remain in `index.css` for any of the original 39
   names — including inside the two preserved `color-mix(...)` calls.
   `automated: grep index.css for each legacy variable name used as var(--name)`
3. `color-scheme`, `font-family`, `font-synthesis`, and `text-rendering` are present in
   `index.css` and apply to the same elements as before (still effective).
   `inspection: index.css reviewed; a rendered page's computed font-family/color-scheme
   confirmed unchanged`
4. The 39 legacy color custom-property declarations and the 5 dead token variants
   (`--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border`) no
   longer exist anywhere in the repository.
   `automated: grep for each legacy declaration name across tools/dashboard`
5. `--color-*: initial` is present in `@theme`.
   `automated: grep -q -- "--color-\*: initial" tools/dashboard/ui/index.css`
6. `index.html`'s `theme-color` equals `index.css`'s `--color-background` value exactly.
   `automated: values compared programmatically`
7. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook`, and `npm --prefix tools/dashboard
   run build-storybook` all pass.
8. Every change-wide acceptance criterion in `overview.md` is re-checked and passes.
9. One representative final visual review (screenshot or computed-style based, one
   story per migrated area) confirms neutral surfaces, typography, and spacing are
   unchanged, and that D9's list of intentional color-recipe changes reads correctly
   for contrast/legibility — this is the change's single visual-parity checkpoint.
   `inspection: final review performed and recorded`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Documentation impact

None beyond what `tasks/08-*` already updated.

## Out of scope

- The architecture-check itself — `tasks/10-architecture-enforcement-check.md`.
