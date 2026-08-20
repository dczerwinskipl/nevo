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
  - tools/dashboard/src/components/ui/status-card.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/status-board.tsx
  - tools/dashboard/src/components/changes-panel.tsx
  - tools/dashboard/src/components/stage-progress.tsx
  - tools/dashboard/src/components/spec-actions.tsx
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
`--accent-strong`). Add **10** new custom properties to `:root` — 4 semantic roles
(`--success`, `--warning`, `--danger`, `--info`), each with a base and a `-strong` variant
(4 × 2 = 8), plus 2 categorical identifiers (`--cat-1`, `--cat-2`) — then migrate every
hardcoded color usage listed below to the matching token. Every token below has at least one
concrete, already-existing usage site named — none is speculative future inventory.

An earlier draft of this task proposed 13 tokens including `--secondary`/`--secondary-strong`
and a third categorical `--cat-3`. Those are dropped: `--secondary` had no component-level
hardcoded color to migrate (its only cited basis was a decorative background gradient already
in `index.css:38`, not a "hardcoded value scattered across components" problem like the others
in this area), and `--cat-3` had no current consumer (it was proposed only as capacity for "a
future third provider"). Neither gets invented meaning here — if a real need for either
appears later, that's a new, separately-justified token at that time.

## Implementation constraints

- Add exactly these 10 custom properties to `:root`, no more, no fewer: `--success`,
  `--success-strong`, `--warning`, `--warning-strong`, `--danger`, `--danger-strong`,
  `--info`, `--info-strong`, `--cat-1`, `--cat-2`. Pick hex values consistent with the
  existing Tailwind shades at each token's migration sites below (e.g. `--danger` ≈ the
  `rose-400`/`rose-500` family already used for errors; `--danger-strong` ≈ the lighter
  `rose-200`/`rose-300` already used for emphasis text on danger states) — these formalize
  colors already in use, they do not introduce new colors, so no separate owner decision is
  needed on the specific hex values.
- `-bg`/`-border` variants are **not** separate custom properties and must not be added to
  `:root`. They are computed inline, at each usage site, via
  `color-mix(in srgb, var(--role) N%, ...)` — the same pattern `index.css` already uses in
  one place (`status-board.tsx:21`'s `color-mix(in_srgb,var(--accent)_25%,transparent)`). Do
  not introduce a global `.tone-*` utility class or any other second derivation mechanism.
- Do not modify `--accent`, `--accent-strong`, or any existing neutral token.
- Do not add `--secondary` or `--cat-3` "for completeness" or "for future use" — if no
  migration site is listed for a token below, that token does not get created.

### Token-by-token source and migration sites

- **`--danger`** — errors/failures. Sites: `operation-progress.tsx` (rose-family usage across
  the failed/error states, e.g. lines 26, 39, 72, 121, 156, 158, 256); `ui/status-card.tsx:90,98,101`
  (`isError` state).
- **`--danger-strong`** — lighter emphasis variant on a danger-tinted background. Site:
  `operation-progress.tsx:53,156` (`text-rose-200` emphasis text on the failed-step state).
- **`--warning`** — warnings/uncommitted/pending. Sites: `spec-actions.tsx:73,76,198`
  (amber badges for a dirty worktree / missing upstream / "Operacja końcowa"); `changes-panel.tsx:229,597,599`
  (amber warning callouts).
- **`--warning-strong`** — lighter emphasis variant. Site: `spec-actions.tsx:92`
  (`text-amber-200/80`, "Branch nie ma upstreamu.").
- **`--success`** — success/clean/completed. Sites: `spec-actions.tsx:71-72` (emerald badge
  for a clean worktree); `ai-tool-view.tsx:41,51` (`isCompleted` tool-call state).
- **`--success-strong`** — lighter emphasis variant. Site: `ai-tool-view.tsx:41`
  (`bg-emerald-400/10 text-emerald-300` — the base/strong pair already co-located in one
  className).
- **`--info`** — running/in-progress (the sole "running" color once the collision below is
  removed). Sites: `operation-progress.tsx:24,38,52` (`text-sky-*` on `running`);
  `ai-tool-view.tsx:40,50` (`text-amber-*` on `isRunning` — migrates **to** `--info`, removing
  the amber/warning collision this token set exists to fix).
- **`--info-strong`** — lighter emphasis variant. Site: `operation-progress.tsx:52`
  (`text-sky-200`, emphasis text on the running-step state).
- **`--cat-1`** — Claude provider badge identity (categorical, identity-only, never
  status/severity). Site: `ai-session-list.tsx:52-57` (`bg-amber-500/10 text-amber-300`
  Claude badge — migrates off amber specifically because amber is also `--warning`, today's
  real collision).
- **`--cat-2`** — Antigravity provider badge identity. Site: `ai-session-list.tsx:59-64`
  (`bg-purple-500/10 text-purple-300` Antigravity badge — currently hardcoded purple with no
  token at all; this migration gives it one, alongside Claude's).

### Other migrations in scope (existing neutral/accent tokens, not new ones)

- `bg-emerald-500/10 text-emerald-300` mock/fallback badge (`ai-session-list.tsx:67`) →
  `--muted-strong` on `--surface` (existing neutral pair — deliberately muted so the mock
  provider reads as "not a real option").
- `stageTone` 5 hues (`status-board.tsx:15-22`): New/Design/Ready → `--muted` (no fill);
  Implementation → `--info`; Review → `--warning`; Done → unchanged `--accent`.
- Remaining `text-slate-*`/`text-zinc-*` neutral text (`operation-progress.tsx`,
  `changes-panel.tsx:64`, `stage-progress.tsx:10`) → `--muted`/`--muted-strong`.

Semantic tokens (`--success`/`--warning`/`--danger`/`--info`) are never applied to pure
decoration/identity uses; categorical tokens (`--cat-1`, `--cat-2`) never signal
status/severity. This produces real collisions today (e.g. amber currently means both
"warning" and "tool call running" in different files, and both "warning" and "Claude's
identity badge" in others) — the migration above is what removes them, so no two migrated
sites may end up sharing a token for two different meanings.

## Acceptance criteria

1. `index.css` defines exactly the 10 custom properties listed above at `:root`; no `-bg`/
   `-border` custom properties, no `.tone-*` classes, no `--secondary`/`--cat-3`.
   `inspection: read index.css, list and count the new custom properties, confirm exactly these 10`
2. Every site listed above no longer contains its pre-migration Tailwind class/raw hex; each
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
- `--secondary` and `--cat-3` — dropped, no current consumer (see "Goal" above).
