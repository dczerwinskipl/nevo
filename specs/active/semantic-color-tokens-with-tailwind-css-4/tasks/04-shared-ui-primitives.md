---
id: semantic-color-tokens-with-tailwind-css-4.shared-ui-primitives
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/shared-ui-primitives.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/components/ui/button.tsx
    - tools/dashboard/ui/components/ui/badge.tsx
    - tools/dashboard/ui/components/ui/card.tsx
    - tools/dashboard/ui/components/ui/dialog.tsx
    - tools/dashboard/ui/components/ui/sheet.tsx
    - tools/dashboard/ui/components/ui/status-card.tsx
    - tools/dashboard/ui/components/ui/progress.tsx
    - tools/dashboard/ui/shared/ui/status-label.tsx
    - tools/dashboard/ui/shared/ui/loading-screen.tsx
allowed_paths:
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/shared/ui/loading-screen.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/foundations/**
  - src/**
depends_on:
  - theme-contract
  - frontend-formatter-baseline
  - react-class-composition-guidelines
semantic_references:
  decisions: [D1, D4, D8]
  constraints: [C5, C7, C8]
---

# Task: Migrate shared UI primitives to semantic utilities

## Goal

Migrate Button, Badge, Card, Dialog, Sheet, StatusCard, `status-label.tsx`, and
`loading-screen.tsx` from `-[var(--…)]` arbitrary utilities and raw white/black
utilities to the generated semantic Tailwind utilities from
`areas/theme-foundation.md`, applying the D4 contrast fix to `status-card.tsx`'s
hover-icon treatment, and converting `StatusCard`'s hand-rolled variant/size branching
to a `cva()` recipe per the class-composition contract (D8).

## Dependencies

`theme-contract` (needs the `--color-*` tokens to exist), `frontend-formatter-baseline`
(must start from the formatted baseline), `react-class-composition-guidelines` (must
follow the class-composition contract from the start).

## Implementation constraints

- `button.tsx`'s filled/primary variant: `bg-accent-solid text-fg-on-accent` (not
  `bg-accent`) — the change request's explicit filled-control rule.
- `status-card.tsx:27` hover: replace `hover:text-[var(--accent-strong)]` — do not
  reintroduce `accent-solid`/`accent-strong` as a text color; keep `text-accent`
  unchanged on hover, or apply an opacity modifier, whichever verifiably meets ≥4.5:1
  against the card's rendered background.
- `dialog.tsx:19`, `sheet.tsx:20`: `bg-black/70` → `bg-backdrop`.
- `progress.tsx:7`, `loading-screen.tsx:4-6`: replace `bg-white/N` with a semantic token
  + opacity modifier reproducing the same visual weight (implementation detail — no
  fixed token name mandated, see `areas/shared-ui-primitives.md`).
- `status-card.tsx:90-91,101-102`: replace the `color-mix(...)` recipe with
  `border-status-error/25 bg-status-error/10` (or the raw `--color-status-error` token
  if `areas/status-tone-contract.md` hasn't finalized its own naming yet — do not block
  this task on that area).
- `status-card.tsx:52-53,88-104`: convert the hand-rolled `variant`/`size` `cn()` +
  boolean-ternary branching into a `cva()` recipe (`variant: 'error'|'warning'|'info'`,
  `size: 'sm'|'default'`), deriving props via `VariantProps`, matching the pattern
  already used by `button.tsx`/`sheet.tsx` — per the class-composition contract's
  "reusable component variants" rule (D8). Do not fold the `error`/`warning`/`info`
  variant axis into the `StatusTone` type itself — `StatusCard`'s `variant` is this
  component's own visual API, not a re-declaration of the shared tone contract, even
  though the names overlap.
- Apply the class-composition contract generally: no interpolated Tailwind class
  construction, DOM/ARIA state (e.g. `disabled:`, `data-[state=open]:`) via native
  Tailwind variants rather than new booleans, `cn()` used for conditional
  inclusion/override only.
- Do not touch `index.css` or any `features/**` file.

## Acceptance criteria

1. Zero `-[var(--` occurrences remain in `components/ui/**`, `shared/ui/status-label.tsx`,
   `shared/ui/loading-screen.tsx`. `automated: ! grep -rq -- "-\[var(--" tools/dashboard/ui/components/ui tools/dashboard/ui/shared/ui/status-label.tsx tools/dashboard/ui/shared/ui/loading-screen.tsx`
2. Zero raw `bg/text/border-white|black` occurrences remain in those same files.
   `automated: ! grep -rqE "bg-(white|black)|text-(white|black)|border-(white|black)" tools/dashboard/ui/components/ui tools/dashboard/ui/shared/ui/status-label.tsx tools/dashboard/ui/shared/ui/loading-screen.tsx`
3. `status-card.tsx`'s hover-icon color pair meets ≥4.5:1 against its actual rendered
   background. `inspection: contrast ratio computed and recorded`
4. No component-local `color-mix(...)` remains in these files.
   `automated: ! grep -rq "color-mix" tools/dashboard/ui/components/ui tools/dashboard/ui/shared/ui/status-label.tsx`
5. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook`, and
   `npm --prefix tools/dashboard run build-storybook` all pass.
   `automated: each command listed`
6. Button/Badge/Card/Dialog/Sheet/StatusCard Storybook stories show no unintended visual
   change versus the pre-task baseline (screenshot comparison), except the deliberate
   `status-card.tsx` hover-contrast fix.
   `inspection: before/after screenshot comparison performed and recorded`
7. `StatusCard` exposes its `variant`/`size` API via a `cva()` recipe with
   `VariantProps`-derived props, matching `button.tsx`/`sheet.tsx`'s existing pattern.
   `inspection: source reviewed`
8. The 7-item "required inspection when touching a component" checklist
   (`react-component-guidelines.md` §11/§12) was applied to every component touched by
   this task. `inspection: checklist applied and recorded per component`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

Manual: `mcp__playwright__*` screenshot comparison of the affected Storybook stories,
before and after.

## Documentation impact

None yet — covered by `tasks/08-storybook-and-documentation.md`.

## Out of scope

- Any `features/**` file.
- The central status/tone module itself — `tasks/05-status-tone-contract.md`.
