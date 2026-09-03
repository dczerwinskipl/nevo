---
id: semantic-color-tokens-with-tailwind-css-4.theme-contract
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/theme-foundation.md
    - tools/dashboard/ui/index.css
allowed_paths:
  - tools/dashboard/ui/index.css
forbidden_paths:
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/components/**
  - tools/dashboard/ui/shared/**
  - tools/dashboard/ui/foundations/**
  - tools/dashboard/ui/index.html
  - src/**
depends_on:
  - frontend-formatter-baseline
semantic_references:
  decisions: [D1, D4, D5, D7, D10]
  constraints: [C5, C6, C7]
---

# Task: Add the Tailwind 4 `@theme` semantic color contract

## Goal

Add the `@theme static { … }` block (and its separate `@theme inline` alias block)
specified in `overview.md` § Current architecture / `areas/theme-foundation.md` to
`tools/dashboard/ui/index.css`, without removing the existing `:root` block and without
adding `--color-*: initial` yet, so every currently-rendered page is pixel-identical
after this task. `static` guarantees every token compiles into CSS even with zero
consumers yet (D10) — plain `@theme` would not.

## Dependencies

`frontend-formatter-baseline` (must start from the formatted baseline so this task's
diff is pure semantic change).

## Implementation constraints

- Insert the `@theme static { … }` block after the existing `@import "tailwindcss";`
  line and before or after the `:root` block (either position is fine — do not
  interleave them). Verify `tailwindcss@^4.3.3` actually supports the `static` keyword
  before implementation; if unsupported, stop and escalate rather than silently
  reverting to plain `@theme` (D10).
- Copy neutral/foreground/accent-fill token values from the current `:root` values
  exactly (`--background`→`--color-background`, etc. — full mapping in
  `areas/theme-foundation.md` § Requirements). Do not "improve" any value beyond what
  `areas/theme-foundation.md` specifies (e.g. `--color-fg-secondary`/`--color-fg-muted`
  mapping from `--muted-strong`/`--muted` needs a contrast check, not a blind copy — see
  Acceptance criteria).
- `--color-status-error`/`--color-action-destructive` both start from the current
  `--danger` value — write them as two separate declarations (not one variable aliasing
  the other) since they are separate roles per D2 even while numerically equal today.
- Do not write `--color-*: initial` anywhere in this task.
- Do not touch any file outside `index.css`.

## Acceptance criteria

1. Every token listed in `areas/theme-foundation.md` § Requirements exists in the new
   `@theme static`/`@theme inline` blocks with the specified value.
   `automated: grep -c "  --color-" tools/dashboard/ui/index.css` (expect the full count)
2. `--color-fg-secondary` (from `--muted-strong`) and `--color-fg-muted` (from `--muted`)
   each meet ≥4.5:1 contrast against `--color-surface` and `--color-background` — check
   the actual current values, do not assume the copy is already compliant.
   `inspection: contrast ratio computed for both pairs and recorded`
3. `npm --prefix tools/dashboard run build` succeeds, and **every** declared
   `--color-*` custom property is present with its exact expected value in the compiled
   CSS output — this is the direct evidence `@theme static` is emitting the full token
   catalog with zero consumers, which the Storybook Colors story (`tasks/08-*`) will
   later depend on. `automated: build + per-token compiled-CSS value assertion`
4. No manual screenshot comparison is required here — nothing consumes the new tokens
   yet, so a visual diff has nothing meaningful to catch; that check happens once, in
   `tasks/09-*` (D9). A quick computed-style spot check of the *existing, unaffected*
   page (still rendering off the old `:root` variables) confirms this task had no side
   effect on current rendering. `inspection: computed-style spot check performed and recorded`
5. `--color-*: initial` does not appear anywhere in `index.css` yet.
   `automated: ! grep -q -- "--color-\*: initial" tools/dashboard/ui/index.css`

## Verification

```text
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard test
```

No manual screenshot pass required (see acceptance criterion 4).

## Documentation impact

None — the token contract is documented live by `tasks/08-storybook-and-documentation.md`
once real consumers exist.

## Out of scope

- Any consumer migration.
- `--color-*: initial`, old-variable removal — `tasks/09-*`.
