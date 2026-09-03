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
    - tools/dashboard/ui/shared/ui/loading-screen.tsx
allowed_paths:
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/shared/ui/loading-screen.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/foundations/**
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/shared/status-tone.ts
  - src/**
depends_on:
  - theme-contract
  - frontend-formatter-baseline
  - react-class-composition-guidelines
semantic_references:
  decisions: [D1, D4, D8, D9]
  constraints: [C5, C7, C8]
---

# Task: Migrate shared UI primitives to semantic utilities

## Goal

Migrate Button, Badge, Card, Dialog, Sheet, StatusCard, and `loading-screen.tsx` from
`-[var(--…)]` arbitrary utilities and raw white/black utilities to the generated
semantic Tailwind utilities from `areas/theme-foundation.md`, applying the D4 contrast
fix to `status-card.tsx`'s hover-icon treatment, converting `StatusCard`'s hand-rolled
variant/size branching to a `cva()` recipe per the class-composition contract (D8), and
wiring `--color-action-destructive` directly into `Button`'s destructive variant.
**`status-label.tsx` is out of scope for this task** — it is `tasks/05-*`'s sole
responsibility (correcting the original spec's accidental dual ownership).

## Dependencies

`theme-contract` (needs the `--color-*` tokens to exist), `frontend-formatter-baseline`
(must start from the formatted baseline), `react-class-composition-guidelines` (must
follow the class-composition contract from the start).

## Implementation constraints

- `button.tsx`'s filled/primary variant: `bg-accent-solid text-fg-on-accent` (not
  `bg-accent`) — the change request's explicit filled-control rule.
- `button.tsx`: add a `destructive` variant entry in its own `cva()` recipe that
  consumes `--color-action-destructive` directly. **Do not use a filled pair**
  (`bg-action-destructive text-fg-on-accent`) — with the contract's actual values,
  `#f8fafc` on `#ef4444` is only ≈3.60:1, below the change-wide ≥4.5:1 normal-text
  requirement. Use a semantic outline/tinted treatment instead, matching the shape of
  the existing delete-session button's own (currently manual) styling:
  `text-action-destructive` foreground, a low-opacity `action-destructive`
  border/background via Tailwind opacity modifiers (e.g.
  `border-action-destructive/40 bg-action-destructive/10`), and an
  `action-destructive` focus ring (`focus-visible:ring-action-destructive`). Verify the
  default-state `text-action-destructive`-on-`bg-action-destructive/10` pair and the
  hover-state pair both meet ≥4.5:1 against their actual rendered background (the
  low-opacity fill composited over the button's surrounding surface, not the raw token
  alone) — adjust the opacity values if the first attempt doesn't clear the bar. Do not
  introduce a new theme token (e.g. an `action-destructive-muted`/`-border` variant)
  unless implementation proves the opacity-modifier approach genuinely can't meet
  contrast — that would be a new finding to report, not something to add speculatively
  now. This is not a speculative/catalog-only addition: `tasks/06-*` migrates a
  confirmed real consumer, `agent-session-details.tsx`'s "Usuń sesję z dysku" (delete
  session) button (currently `variant="ghost"` plus ~7 manual `--danger*` class
  overrides), to this variant. `--color-action-destructive` is never routed through
  `shared/status-tone.ts` (that module doesn't export it — see `tasks/05-*`).
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

1. Zero `-[var(--` occurrences remain in `components/ui/**`, `shared/ui/loading-screen.tsx`.
   `automated: ! grep -rq -- "-\[var(--" tools/dashboard/ui/components/ui tools/dashboard/ui/shared/ui/loading-screen.tsx`
2. Zero raw `bg/text/border-white|black` occurrences remain in those same files.
   `automated: ! grep -rqE "bg-(white|black)|text-(white|black)|border-(white|black)" tools/dashboard/ui/components/ui tools/dashboard/ui/shared/ui/loading-screen.tsx`
3. `status-card.tsx`'s hover-icon color pair meets ≥4.5:1 against its actual rendered
   background. `inspection: contrast ratio computed and recorded`
4. No component-local `color-mix(...)` remains in these files.
   `automated: ! grep -rq "color-mix" tools/dashboard/ui/components/ui`
5. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook`, and
   `npm --prefix tools/dashboard run build-storybook` all pass.
   `automated: each command listed`
6. Durable Storybook tests (`test:storybook`) cover Button/Badge/Card/Dialog/Sheet/
   StatusCard's default and key variant states, and pass — this is the evidence of no
   unintended visual regression during this task, not a manual screenshot diff (see D9,
   `overview.md` § Verification strategy). The `status-card.tsx` hover-contrast fix
   (D4) and the `StatusCard` → `cva()` conversion (D8) are intentional, expected changes
   to that component's states, not regressions.
7. `StatusCard` exposes its `variant`/`size` API via a `cva()` recipe with
   `VariantProps`-derived props, matching `button.tsx`/`sheet.tsx`'s existing pattern.
   `inspection: source reviewed`
8. `Button`'s destructive variant renders with `--color-action-destructive`, sourced
   directly from the theme token, not from `shared/status-tone.ts`; it uses an
   outline/tinted treatment (text + low-opacity border/background + focus ring), never
   a filled `bg-action-destructive text-fg-on-accent` pair.
   `inspection: source reviewed`
9. The destructive variant's default-state and hover-state foreground/background
   pairs both meet ≥4.5:1, verified against the actual rendered (composited) colors,
   not the raw token value alone.
   `inspection: contrast ratio computed for both states and recorded`
10. The 7-item "required inspection when touching a component" checklist
    (`react-component-guidelines.md` §11/§12) was applied to every component touched by
    this task. `inspection: checklist applied and recorded per component`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

No manual screenshot pass is required for this task — `test:storybook`'s durable tests
are the verification evidence; the one representative visual review happens once, in
`tasks/09-*`.

## Documentation impact

None yet — covered by `tasks/08-storybook-and-documentation.md`.

## Out of scope

- Any `features/**` file.
- `status-label.tsx` and the central status/tone module — `tasks/05-status-tone-contract.md`.
