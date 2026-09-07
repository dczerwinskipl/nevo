# Area: theme-foundation

## Responsibility

Add the final Tailwind 4 `@theme` semantic color contract to
`tools/dashboard/ui/index.css` while every currently-computed color stays pixel-identical
— this area only adds the new token surface, it does not migrate any consumer. Use
`@theme static` for the direct-value contract (not plain `@theme`) so every declared
token is guaranteed to appear in compiled CSS regardless of whether Tailwind's
usage-detection sees it referenced yet — this matters immediately, since at the point
this area lands, nothing consumes the new tokens.

## Current state

`index.css:1` is `@import "tailwindcss";` followed only by a plain `:root { … }` block
(lines 3-55, 39 color variables — see `overview.md` § Current architecture for the full
list). No `@theme` block exists anywhere in the repo (grep confirmed zero matches).
`--accent: #3882f6`, `--accent-strong: #1d4ed8`, `--accent-foreground: #f8fafc`
(`index.css:17-19`) are the values the new `--color-accent`/`--color-accent-solid`/
`--color-fg-on-accent` tokens must reproduce exactly, pending the contrast fix in D4.

## Requirements

- Add an `@theme static { … }` block to `index.css` (Tailwind 4's `static` keyword
  forces every declared theme variable into compiled CSS even if nothing references it
  yet at build time — plain `@theme` only emits variables Tailwind detects as used, which
  the Storybook Colors story cannot rely on since it must read every documented token
  independent of incidental product usage, D10), using the exact structure and values
  given in the change request (D1), **except** `--color-*: initial` — that line is
  deliberately
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
  - A separate `@theme static inline { --color-status-active: var(--color-accent);
    --color-status-neutral: var(--color-fg-muted); }` block (**not** plain `@theme
    inline` — `static` and `inline` are orthogonal and both required here: `inline`
    keeps these two entries reference-based in generated utilities since they alias
    another theme variable rather than holding a literal value, `static` guarantees they
    are still emitted into compiled CSS with zero consumers yet, the same reason the
    direct-value block needs it — D10).
- Do **not** remove or edit the existing `:root` block in this task — old and new
  co-exist until `areas/cleanup-and-enforcement.md`.
- Do not add a primitive/50-950 scale, light-theme variant, or any token not listed
  above or consumed by a later area (verify against the areas below before adding
  anything not explicit in the change request).

## Constraints

- `--color-*: initial` is explicitly out of scope for this task (see Requirements) —
  adding it here would visibly change every currently-rendered page that still uses a
  default-palette utility.
- The direct-value token block uses `@theme static`, and the alias block uses `@theme
  static inline` (not plain `@theme`/`@theme inline`) — verify the installed Tailwind
  version (`^4.3.3`) actually supports both `static` and `static inline` before
  implementation; if it doesn't, escalate rather than silently falling back to plain
  `@theme`/`@theme inline` (D10 exists specifically because plain usage-detection is not
  reliable enough for a token catalog story, for aliases exactly as much as direct
  values).
- No new npm dependency.

## Interfaces and boundaries

- Produces the entire `--color-*` namespace every other area consumes. No other area may
  invent a token name not defined here — if a later area finds it needs one, that's an
  escalation back to this area (or an owner decision if it wasn't in the original
  contract), not a local addition.
- Consumes: nothing beyond the existing `index.css` and its documented current values.

## Area-specific acceptance criteria

1. `index.css` contains the `@theme static` block with every token listed above and the
   separate `@theme static inline` alias block (both aliases), `automated: grep for each --color-* name in index.css`.
2. With this task's changes alone (no consumer migrated yet), `npm --prefix
   tools/dashboard run build` succeeds. **No manual screenshot comparison is required at
   this point** — nothing consumes the new tokens yet, so there is nothing for a visual
   diff to meaningfully catch; a manual screenshot pass here would be redundant with the
   one final representative review in `tasks/09-*` (D9). Instead, verify via the
   compiled output: every declared `--color-*` custom property (including every token
   listed in Requirements, and **both** `@theme static inline` alias tokens,
   `--color-status-active` and `--color-status-neutral`) is present with its exact
   expected value in the built CSS (`npm --prefix tools/dashboard run build`'s output,
   or an equivalent dev-server compiled-stylesheet check) — this is also the proof that
   `@theme static`/`@theme static inline` are doing their job (D10).
   `automated: build + compiled-CSS assertion per token, including both aliases`
3. A computed-style spot check on the *already-rendered, not-yet-migrated* page (still
   using the old `:root` variables for actual rendering) confirms the page itself is
   unchanged — since this task adds tokens without wiring any consumer, this is a
   sanity check that adding the `@theme static` block had no side effect on existing
   rendering, not a claim about the new tokens' own visual output (which has no
   consumer to render yet). `inspection: computed-style spot check performed and recorded`

## Dependencies

`areas/frontend-formatter-baseline.md` (must start from the formatted baseline).
Independent of `areas/react-class-composition-guidelines.md` — this area touches only
`index.css`, not React components. Every consumer area depends on this one.

## Out of scope

- Migrating any component to the new utilities — every other area.
- Removing the old `:root` block, old token names, or adding `--color-*: initial` — all
  `areas/cleanup-and-enforcement.md`.
