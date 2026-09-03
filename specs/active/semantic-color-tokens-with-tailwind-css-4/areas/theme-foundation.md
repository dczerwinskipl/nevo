# Area: theme-foundation

## Responsibility

Add the final Tailwind 4 `@theme` semantic color contract to
`tools/dashboard/ui/index.css` while every currently-computed color stays pixel-identical
— this area only adds the new token surface, it does not migrate any consumer.

## Current state

`index.css:1` is `@import "tailwindcss";` followed only by a plain `:root { … }` block
(lines 3-55, 39 color variables — see `overview.md` § Current architecture for the full
list). No `@theme` block exists anywhere in the repo (grep confirmed zero matches).
`--accent: #3882f6`, `--accent-strong: #1d4ed8`, `--accent-foreground: #f8fafc`
(`index.css:17-19`) are the values the new `--color-accent`/`--color-accent-solid`/
`--color-fg-on-accent` tokens must reproduce exactly, pending the contrast fix in D4.

## Requirements

- Add an `@theme { … }` block to `index.css`, using the exact structure and values given
  in the change request (D1), **except** `--color-*: initial` — that line is deliberately
  deferred to `areas/cleanup-and-enforcement.md` (D5). Adding it now would immediately
  stop Tailwind generating *any* default-palette utility (`bg-white`, `bg-black`,
  `text-blue-*`, …) repo-wide, silently unstyling the 59 not-yet-migrated raw white/black
  occurrences and any story that still uses one — a real regression, not a no-op, so it
  cannot land until every consumer is migrated.
  - Neutral foundation: `--color-background`, `--color-surface`,
    `--color-surface-raised`, `--color-surface-hover`, `--color-border`,
    `--color-border-strong` — set to the current computed values of `--background`,
    `--surface`, `--surface-raised`, `--surface-hover`, `--border`, `--border-strong`
    (`index.css:6-11`) exactly.
  - Foreground hierarchy: `--color-fg-primary`, `--color-fg-secondary`,
    `--color-fg-muted`, `--color-fg-on-accent` — `fg-primary`/`fg-on-accent` reproduce
    `--foreground`/`--accent-foreground` exactly; `fg-secondary`/`fg-muted` are new
    two-step hierarchy replacing the current single `--muted`/`--muted-strong` pair (map
    `--muted-strong`→`fg-secondary`, `--muted`→`fg-muted`, verified against real
    foreground/background pairs per the contrast requirement below — do not just copy
    without checking).
  - Interaction: `--color-accent` (= current `--accent`), `--color-accent-solid` (=
    current `--accent-strong`, but D4 restricts it to fill-only usage going forward).
  - Canonical status: `--color-status-success`, `-warning`, `-error`, `-attention`,
    `-info` — `success`/`warning`/`info` reproduce current `--success`/`--warning`/
    `--info` exactly; `error` reproduces current `--danger` (rename only); `attention` is
    a genuinely new token (current codebase has no attention color — pick a value
    visually distinct from both `warning` and `accent`, per D2; the exact hex in the
    change request, `#a78bfa`, is the given value, use it).
  - `--color-action-destructive` — same initial value as `--color-status-error` (both
    currently map to `--danger`), kept as a separate token name per D2.
  - Provider/workflow: `--color-provider-claude` (= current `--cat-1`, `#fb923c`),
    `--color-provider-antigravity` (= current `--cat-2`, `#60a5fa`),
    `--color-workflow-design` (new token, value from the change request, `#8b5cf6`).
  - `--color-backdrop` (new token for `bg-black/70`-style overlays, value
    `rgb(0 0 0 / 70%)` from the change request).
  - `@theme inline { --color-status-active: var(--color-accent); --color-status-neutral:
    var(--color-fg-muted); }` exactly as given.
- Do **not** remove or edit the existing `:root` block in this task — old and new
  co-exist until `areas/cleanup-and-enforcement.md`.
- Do not add a primitive/50-950 scale, light-theme variant, or any token not listed
  above or consumed by a later area (verify against the areas below before adding
  anything not explicit in the change request).

## Constraints

- `--color-*: initial` is explicitly out of scope for this task (see Requirements) —
  adding it here would visibly change every currently-rendered page that still uses a
  default-palette utility.
- No new npm dependency.

## Interfaces and boundaries

- Produces the entire `--color-*` namespace every other area consumes. No other area may
  invent a token name not defined here — if a later area finds it needs one, that's an
  escalation back to this area (or an owner decision if it wasn't in the original
  contract), not a local addition.
- Consumes: nothing beyond the existing `index.css` and its documented current values.

## Area-specific acceptance criteria

1. `index.css` contains the `@theme` block with every token listed above and the
   `@theme inline` alias block, `automated: grep for each --color-* name in index.css`.
2. With this task's changes alone (no consumer migrated yet), `npm --prefix
   tools/dashboard run build` succeeds and a visual/computed-style spot check of the
   running dashboard shows **zero** difference from the pre-task baseline — confirmed
   via the `mcp__playwright__*` tools (computed styles + screenshot on at least: the
   sidebar, a filled button, a status badge). `inspection: computed-style + screenshot
   comparison performed and recorded`
## Dependencies

`areas/frontend-formatter-baseline.md` (must start from the formatted baseline).
Independent of `areas/react-class-composition-guidelines.md` — this area touches only
`index.css`, not React components. Every consumer area depends on this one.

## Out of scope

- Migrating any component to the new utilities — every other area.
- Removing the old `:root` block, old token names, or adding `--color-*: initial` — all
  `areas/cleanup-and-enforcement.md`.
