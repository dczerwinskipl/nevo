# Area: shared-ui-primitives

## Responsibility

Migrate the dashboard's shared UI primitives — Button, Badge, Card, Dialog, Sheet, and
StatusCard — from `-[var(--…)]` arbitrary utilities to generated semantic Tailwind
utilities, including their own raw white/black usages, so every feature area built on
top of them (Areas 4-5) inherits correct tokens automatically. **`status-label.tsx` is
not this area's responsibility** — it is `areas/status-tone-contract.md`'s sole
migration owner (see that area's Current state for why the original spec's dual
ownership was a planning error).

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
- `tools/dashboard/ui/shared/ui/loading-screen.tsx:4-6` — `bg-white/8`, `bg-white/8`,
  `bg-white/5` skeleton loaders.
- `button.tsx` has no `destructive` variant today (confirmed: only `default`/
  `secondary`/`ghost`) — one must be added, consuming `--color-action-destructive`
  directly (D2/D8: that token is never routed through `shared/status-tone.ts`). This is
  justified by a confirmed real consumer (not catalog-only, per the class-composition
  contract's "don't create an unused variant" rule): `agent-session-details.tsx`'s
  "Usuń sesję z dysku" delete-session button (lines 129-142) currently uses
  `variant="ghost"` plus ~7 manual `border-[var(--danger-border)] bg-[var(--danger-muted)]
  text-[var(--danger)] hover:...` overrides — migrated to `variant="destructive"` in
  `areas/agent-sessions-and-work.md`'s task. Confirmed by audit: no other genuine
  irreversible-delete action exists elsewhere in `features/specifications/**` or
  `features/pull-requests/**`. The composer's "Przerwij" (stop/cancel active turn)
  button is a *different*, non-destructive action (interrupting in-progress generation,
  not irreversible deletion) — it keeps its own, lighter treatment and does **not**
  adopt this variant (see `areas/agent-sessions-and-work.md`).

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
- `status-card.tsx:52-53,88-104`'s hand-rolled `variant`/`size` `cn()` + boolean-ternary
  branching becomes a `cva()` recipe with `VariantProps`-derived props, per
  `areas/react-class-composition-guidelines.md` (D8) — matching the existing
  `button.tsx`/`sheet.tsx` pattern. `StatusCard`'s `variant` axis (`error`/`warning`/
  `info`) is this component's own visual API, not the shared `StatusTone` contract.
- No component-local `color-mix(...)` recipe may remain in these files after migration.

## Constraints

- Neutral surfaces, typography, and spacing stay unchanged. The `status-card.tsx`
  hover-contrast fix (D4), the `StatusCard` → `cva()` conversion's resulting class
  names (D8), and the new `destructive` Button variant are intentional, prescribed
  changes — verified for contrast/legibility and correct token usage, not claimed as
  pixel-identical to the pre-migration state (D9).
- Do not touch any file under `features/**` — that's Areas 4-5.
- Do not touch `status-label.tsx` — `areas/status-tone-contract.md`.

## Interfaces and boundaries

- Consumes: the `--color-*` contract from `areas/theme-foundation.md`.
- Produces: the primitive components every feature area renders through. Areas 4-5 must
  not need to touch `components/ui/**` or `shared/ui/**` themselves once this area is
  done, except to consume the new class names already in place.

## Area-specific acceptance criteria

1. Zero `-[var(--` occurrences remain in `components/ui/**` and
   `shared/ui/loading-screen.tsx`.
2. Zero `bg-black`/`bg-white`/`text-black`/`text-white`/`border-black`/`border-white`
   occurrences remain in the files listed under Current state.
3. `status-card.tsx`'s hover-icon foreground/background pair meets ≥4.5:1.
4. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`, and
   `npm --prefix tools/dashboard run test:storybook` all pass.
5. Durable Storybook tests cover Button/Badge/Card/Dialog/Sheet/StatusCard's default and
   key variant states and pass — the intentional changes (D4 hover fix, `cva()`
   conversion, new destructive variant) are reviewed for correctness, not required to be
   pixel-identical to the pre-migration state (D9).
6. `StatusCard` exposes `variant`/`size` via a `cva()` recipe with `VariantProps`-derived
   props, consistent with `button.tsx`/`sheet.tsx`.
7. `Button`'s `destructive` variant consumes `--color-action-destructive` directly.

## Dependencies

`areas/theme-foundation.md`, `areas/frontend-formatter-baseline.md`,
`areas/react-class-composition-guidelines.md`. Independent of
`areas/status-tone-contract.md` — may run in parallel with it; if `status-card.tsx`'s
status-surface migration needs a token name that area hasn't finalized yet, use the raw
`--color-status-*` token directly here and treat final wiring as that area's job (see
Requirements).

## Out of scope

- Any `features/**` component — Areas 4-5.
- `status-label.tsx` and the central status/tone contract module —
  `areas/status-tone-contract.md`.
