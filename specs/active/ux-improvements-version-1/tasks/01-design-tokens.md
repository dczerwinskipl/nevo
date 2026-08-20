---
id: ux-improvements-version-1.design-tokens
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/colors.md
    - tools/dashboard/src/index.css
  optional: []
allowed_paths:
  - tools/dashboard/src/index.css
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/operation-progress.tsx
  - tools/dashboard/src/components/status-card.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/status-board.tsx
  - tools/dashboard/src/components/changes-panel.tsx
  - tools/dashboard/src/components/stage-progress.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Shared color design tokens (COLOR-1)

## Goal

`tools/dashboard/src/index.css` currently defines CSS custom properties for neutrals only
(`--background`, `--surface`, `--surface-raised`, `--surface-hover`, `--border`,
`--border-strong`, `--foreground`, `--muted`, `--muted-strong`, `--accent`,
`--accent-strong`). Add **13** new custom properties to `:root` — 5 semantic roles
(`--secondary`, `--success`, `--warning`, `--danger`, `--info`), each with a base and a
`-strong` variant (5 × 2 = 10), plus 3 categorical identifiers (`--cat-1`, `--cat-2`,
`--cat-3`) — then migrate every hardcoded color usage listed below to the matching token.

## Implementation constraints

- Add exactly these 13 custom properties to `:root`, no more, no fewer:
  `--secondary`, `--secondary-strong`, `--success`, `--success-strong`, `--warning`,
  `--warning-strong`, `--danger`, `--danger-strong`, `--info`, `--info-strong`, `--cat-1`,
  `--cat-2`, `--cat-3`. These formalize colors already in use in the app (e.g. `--danger`
  formalizes the already-dominant `red-400`), not new colors — no separate owner decision
  is needed on the specific hex values; pick values consistent with the colors already in
  use at each migration site below (e.g. `--danger` ≈ existing `red-400`, `--info` ≈
  existing `sky-400`/sole "running" color, `--warning` ≈ existing `amber-400`, `--success`
  ≈ existing `emerald-400`, `--secondary` ≈ the blue already present in the background glow
  in `index.css`).
- `-bg`/`-border` variants are **not** separate custom properties and must not be added to
  `:root`. They are computed inline, at each usage site, via
  `color-mix(in srgb, var(--role) N%, ...)` — the same pattern `index.css` already uses in
  one place (`status-board.tsx:21`'s `color-mix(in_srgb,var(--accent)_25%,transparent)`).
  Do not introduce a global `.tone-*` utility class or any other second derivation
  mechanism — every `-bg`/`-border` need is a one-off inline `color-mix()` value on the
  element that needs it, exactly like the existing `--accent` usage.
- Do not modify `--accent`, `--accent-strong`, or any existing neutral token.
- Migrate every one of these hardcoded usages to the matching token:
  - `text-rose-*`/`bg-rose-*` (`operation-progress.tsx`, 6 spots; `status-card.tsx:90,98,101`) → `--danger`.
  - `text-amber-*` on `isRunning` (`ai-tool-view.tsx:40,50`) → `--info`.
  - `text-sky-*` on `running` (`operation-progress.tsx:24,38,52`) → `--info`.
  - `bg-amber-500/10 text-amber-300` Claude badge (`ai-session-list.tsx:54`) → `--cat-1`.
  - `bg-emerald-500/10 text-emerald-300` mock/fallback badge (`ai-session-list.tsx:67`) →
    `--muted-strong` on `--surface` (an existing neutral pair, not a new token — deliberately
    muted so the mock provider reads as "not a real option").
  - `stageTone` 5 hues (`status-board.tsx:15-22`): New/Design/Ready → `--muted` (no fill);
    Implementation → `--info`; Review → `--warning`; Done → unchanged `--accent`.
  - Remaining `text-slate-*`/`text-zinc-*` neutral text (`operation-progress.tsx`,
    `changes-panel.tsx:64`, `stage-progress.tsx:10`) → `--muted`/`--muted-strong`.
- Semantic tokens (`--success`/`--warning`/`--danger`/`--info`/`--secondary`) are never
  applied to pure decoration/identity uses; categorical tokens (`--cat-1..3`) never signal
  status/severity. This produces real collisions today (e.g. `amber` currently means both
  "warning" and "tool call running" in different files) — the migration above is what
  removes them, so no two migrated sites may end up sharing a token for two different
  meanings.

## Acceptance criteria

1. `index.css` defines exactly the 13 custom properties listed above at `:root`; no `-bg`/
   `-border` custom properties or `.tone-*` classes are added.
   `inspection: read index.css, count and name the new custom properties, confirm exactly 13`
2. No file:line listed above still contains its pre-migration Tailwind class or raw hex; each
   now references the corresponding CSS variable (directly or via an inline `color-mix()`).
   `inspection: grep each listed file for the old class name, expect zero matches`
3. No token is used for two different meanings across the migrated files (e.g. no remaining
   case of the same color meaning both a status and an unrelated identity).
   `inspection: read every migrated site, confirm each token's usage matches its declared role`
4. `npm --prefix tools/dashboard run build` passes (catches any broken className/type
   reference). `automated: npm --prefix tools/dashboard run build`
5. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- The task-board column *structure* (nesting, bulk-approve placement) —
  `flatten-review-card-nesting` (task 14) owns that; this task only changes which color each
  column state uses.
- Any lifecycle-stepper or other new UI element that would consume these tokens — not built
  in this specification.
