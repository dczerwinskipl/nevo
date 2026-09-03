# Area: shared-ui-primitives

## Responsibility

Migrate the dashboard's shared UI primitives — Button, Badge, Card, Dialog, Sheet,
StatusCard, and the shared status-label component — from `-[var(--…)]` arbitrary
utilities to generated semantic Tailwind utilities, including their own raw
white/black usages, so every feature area built on top of them (Areas 4-5) inherits
correct tokens automatically.

## Current state

- `tools/dashboard/ui/components/ui/button.tsx:8-14` — variant map using
  `bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-strong)]`
  (9 arbitrary-value occurrences total).
- `tools/dashboard/ui/components/ui/badge.tsx`, `card.tsx` — not individually profiled
  by discovery but confirmed present under `components/ui/` and in-scope per the change
  request's explicit primitive list.
- `tools/dashboard/ui/components/ui/dialog.tsx:19` and `sheet.tsx:20` — `bg-black/70`
  raw overlay backdrops.
- `tools/dashboard/ui/components/ui/status-card.tsx:27` — `text-[var(--accent)]
  hover:text-[var(--accent-strong)]` icon (D4: hover must stop using the fill-only
  `accent-solid`/`accent-strong` value as text); `:90-91,101-102` —
  `color-mix(in_srgb,var(--danger)_20%,transparent)` / `_8%,transparent` error-banner
  recipe (duplicated with `spec-actions.tsx`, `operation-progress.tsx`,
  `pull-request-detail.tsx` — those call sites are Area 5's concern, this task only
  fixes `status-card.tsx`'s own copy).
- `tools/dashboard/ui/components/ui/progress.tsx:7` — `bg-white/7` track.
- `tools/dashboard/ui/shared/ui/status-label.tsx` — the shared status-label component
  referenced by the change request; exact current token usage to be confirmed during
  implementation (not individually profiled by discovery) — treat it as in-scope for
  migration to the new tokens, and to the status/tone contract once
  `areas/status-tone-contract.md` exists (this area migrates its raw-token usage only;
  wiring it to the central contract is `areas/status-tone-contract.md`'s job if
  `status-label.tsx` is one of that area's target consumers).
- `tools/dashboard/ui/shared/ui/loading-screen.tsx:4-6` — `bg-white/8`, `bg-white/8`,
  `bg-white/5` skeleton loaders.

## Requirements

- Replace every `-[var(--…)]` occurrence in the files above with the matching generated
  utility from `areas/theme-foundation.md`'s contract (e.g. `bg-[var(--accent)]` →
  `bg-accent`, `text-[var(--accent-foreground)]` → `text-fg-on-accent`).
- Button's filled/primary variant becomes `bg-accent-solid text-fg-on-accent` per the
  change request's explicit filled-control rule — not `bg-accent`.
- `status-card.tsx:27`'s hover treatment stops referencing `accent-strong`/
  `accent-solid` as text color (D4) — keep `text-accent` on hover (no darkening), or use
  an opacity modifier on `accent` if a hover affordance is still wanted; verify the
  result still meets ≥4.5:1 against the card's actual background.
- `status-card.tsx:90-91,101-102`'s error-banner `color-mix` recipe becomes
  `border-status-error/25 bg-status-error/10` (per the change request's status-surface
  opacity-modifier convention) or the equivalent using the tokens
  `areas/status-tone-contract.md` will define — if that area's token names aren't final
  yet when this task runs, use `--color-status-error` directly and let Area 3 finish the
  wiring (see Dependencies).
- `dialog.tsx:19` / `sheet.tsx:20` `bg-black/70` → `bg-backdrop` (new token from
  `areas/theme-foundation.md`).
- `progress.tsx:7` `bg-white/7` and `loading-screen.tsx:4-6` `bg-white/8|8|5` → a
  semantic surface token with an opacity modifier (e.g. `bg-fg-primary/7`,
  `bg-fg-primary/8`, `bg-fg-primary/5` — pick whichever existing token reproduces the
  current visual weight most closely; these are decorative skeleton/track fills, not
  text, so exact token choice is an implementation detail, not a new decision).
- No component-local `color-mix(...)` recipe may remain in these files after migration.

## Constraints

- Zero visual change except the one explicitly required contrast fix (D4's hover
  treatment on `status-card.tsx`).
- Do not touch any file under `features/**` — that's Areas 4-5.

## Interfaces and boundaries

- Consumes: the `--color-*` contract from `areas/theme-foundation.md`.
- Produces: the primitive components every feature area renders through. Areas 4-5 must
  not need to touch `components/ui/**` or `shared/ui/**` themselves once this area is
  done, except to consume the new class names already in place.

## Area-specific acceptance criteria

1. Zero `-[var(--` occurrences remain in `components/ui/**` and `shared/ui/status-label.tsx`,
   `shared/ui/loading-screen.tsx`.
2. Zero `bg-black`/`bg-white`/`text-black`/`text-white`/`border-black`/`border-white`
   occurrences remain in the files listed under Current state.
3. `status-card.tsx`'s hover-icon foreground/background pair meets ≥4.5:1.
4. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`, and
   `npm --prefix tools/dashboard run test:storybook` all pass.
5. A Storybook screenshot/computed-style comparison of Button, Badge, Card, Dialog,
   Sheet, StatusCard stories before/after shows no unintended visual change.

## Dependencies

`areas/theme-foundation.md`. Independent of `areas/status-tone-contract.md` — may run in
parallel with it; if `status-card.tsx`'s status-surface migration needs a token name
Area 3 hasn't finalized yet, use the raw `--color-status-*` token directly here and treat
final wiring as Area 3's job (see Requirements).

## Out of scope

- Any `features/**` component — Areas 4-5.
- The central status/tone contract module itself — `areas/status-tone-contract.md`.
