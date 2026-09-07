# Area: cleanup-and-enforcement

## Responsibility

Once every consumer is migrated (Areas 2-6), migrate `index.css`'s own embedded legacy
color-variable references, remove the now-legacy color-variable declarations and
now-dead token variants (while preserving `index.css`'s non-color global declarations),
enable `--color-*: initial`, fix the `theme-color` meta/background mismatch, and add the
lightweight architecture check that prevents regressions from reintroducing
arbitrary-value color utilities, raw palette usage, or legacy CSS-variable references.

## Current state

- `index.css:3-55`'s `:root` block still exists alongside the `@theme` block added in
  Area 1 (both areas require it to remain during migration). It contains **both**
  color custom properties (39 of them, to be removed) **and 4 non-color declarations
  that must be preserved**: `color-scheme: dark;` (line 4), `font-family: ...;`
  (line 52), `font-synthesis: none;` (line 53), `text-rendering: optimizeLegibility;`
  (line 54). Removing `:root` wholesale — as an earlier draft of this spec described —
  would silently delete these 4 declarations too; that is a real production behavior
  regression, not a color-token cleanup.
- Beyond the `-[var(--…)]` (Tailwind arbitrary-value) and `bg/text/border-white|black`
  patterns already swept in TS/TSX by Areas 2-6, `index.css` **itself** contains direct
  CSS `var(--legacy-name)` references in its own selector rules — a category the
  original TS/TSX-focused discovery did not search for. Confirmed sites (all within
  `index.css`, exact line numbers from the current file):
  - `*` (universal selector): `scrollbar-color: var(--border-strong) transparent;`
    (line 59).
  - `html`: `background: var(--background);` (line 65).
  - `body`: `color: var(--foreground);` (line 76) — the `background` declaration
    (lines 72-75) mixes `var(--background)` with two raw decorative
    `rgba(255,255,255,…)` gradients (those stay raw — one-off decorative global CSS is
    an allowed exception, not a token consumer).
  - `::selection` (lines 102-103): `background: color-mix(in srgb, var(--accent) 30%,
    transparent); color: var(--accent-foreground);` — a genuinely selector-oriented,
    global-pseudo-element case; the `color-mix(...)` itself is the allowed exception
    category (not a component-local recipe), only the variable name inside it needs
    updating.
  - `.markdown-body` and its descendants (lines 110, 123, 129, 143, 144, 146, 151, 153,
    155, 162, 164, 169, 173, 174): multiple `var(--muted-strong|foreground|border|
    accent|muted|background)` references, plus one more `color-mix(in srgb,
    var(--accent) 45%, transparent)` at line 146 (same allowed-exception category as
    `::selection`).
  - `.nevo-diff-view` and its descendants (lines 177, 183):
    `scrollbar-color: var(--border-strong) var(--background);`,
    `background: var(--surface);`.
  Every legacy variable name referenced above already has a direct `--color-*`
  replacement in the `@theme` contract (`areas/theme-foundation.md`) — no new token is
  needed to complete this migration.
- `--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border` have
  zero real consumers (confirmed) — dead weight to remove, not migrate.
- `index.html:6`'s `theme-color` (`#090b10`) does not match `index.css`'s
  `--color-background` (`#090a0d`).
- No lint/architecture-check infrastructure exists under `tools/dashboard`; the closest
  precedent is the `node --test` regex-over-source-text style already used by
  `tools/dashboard/tests/*.test.mjs`.

## Requirements

**Migration and removal (first task, `tasks/09-*`):**
- Run a final sweep across `tools/dashboard/ui/**/*.{ts,tsx}` (excluding
  `*.stories.tsx`/`tests/`/`__fixtures__/`) for `-[var(--`, raw white/black utilities,
  and `color-mix(` to confirm Areas 2-6 left zero occurrences in TS/TSX; fix any
  straggler found.
- **Before removing any legacy color declaration**, migrate every direct `var(--…)`
  reference embedded in `index.css`'s own selectors (the full list under Current
  state — universal scrollbar, `html`/`body`, `::selection`, `.markdown-body` family,
  `.nevo-diff-view` family) to the corresponding `--color-*` token. The two
  `color-mix(...)` occurrences in `::selection`/`.markdown-body blockquote` stay as
  `color-mix(...)` (selector-oriented global CSS is the class-composition contract's
  documented exception) — only their variable name changes, from `var(--accent)` to
  `var(--color-accent)`.
- Only once that migration is verified complete, remove the 39 legacy color custom
  properties from `:root` and the 5 dead token variants — **do not remove the `:root`
  selector itself**, and do not remove `color-scheme`, `font-family`, `font-synthesis`,
  or `text-rendering`. Keep those 4 declarations in `:root` (the smallest, lowest-risk
  change — `:root` shrinks to only these 4 lines, it is not deleted) unless there is a
  concrete reason found during implementation to move them to `html`/`body` instead; if
  moved, do so deliberately and document why.
- Confirm `--success-strong`/`--info`/`--info-strong`/`--info-muted`/`--info-border`
  were never carried into the `@theme` block (Area 1 never listed them) before declaring
  them removed.
- Add `--color-*: initial;` to the `@theme` block.
- Fix `index.html:6`'s `theme-color` to match the production `--color-background` value
  exactly (`#090a0d`), per the change request's explicit stage-9 instruction.
- Re-run the full change-wide acceptance criteria from `overview.md`. Perform **one**
  representative final visual review (not a repeated screenshot pass per task — see D9)
  confirming neutral surfaces, typography, and spacing are unchanged, and that every
  named intentional color change across the whole spec (D9's list) reads correctly for
  contrast/legibility.

**Enforcement (second task, `tasks/10-*`):**
- Add a lightweight, dependency-free check (plain Node script or `node --test` file,
  matching the existing `tools/dashboard/tests/*.test.mjs` precedent — no new npm
  package, per the change-wide constraint against new external dependencies) that scans
  production UI sources (excluding stories, tests, fixtures, generated files) and
  rejects, **across both TS/TSX and CSS files**:
  - `bg-[var(--...)]`, `text-[var(--...)]`, `border-[var(--...)]`,
    `ring-[var(--...)]`, `outline-[var(--...)]`, `fill-[var(--...)]`,
    `stroke-[var(--...)]`, `caret-[var(--...)]`, or equivalent color-bearing
    arbitrary-value utilities, in TS/TSX;
  - direct Tailwind default-palette utilities (`bg-white`, `bg-black`, `text-blue-*`,
    etc.), in TS/TSX;
  - undeclared `--color-*` variable references, in TS/TSX;
  - component-local literal semantic colors or repeated `color-mix(...)` recipes, in
    TS/TSX;
  - **legacy (pre-migration) CSS custom-property references** (e.g. `var(--accent)`
    instead of `var(--color-accent)`) in any `.css` file — this is the mechanism that
    would have caught the `index.css`-embedded references this spec's original
    discovery missed;
  - **`text-accent-solid`** and equivalent use of the fill-only `accent-solid` token as
    a text color (D4's contrast rule) — flag it anywhere it appears, not just in the two
    sites already fixed by earlier tasks, so a future regression is caught.
- Maintain an explicit, minimal exception list for genuinely dynamic CSS custom
  properties or one-off decorative global CSS — do not make the check so strict it can
  never be satisfied by legitimate dynamic styling.
- Wire the check into `npm --prefix tools/dashboard test` (or a clearly named new
  script) so it runs as part of the existing test command, not a forgotten side script.

## Constraints

- Must run after every other area — enabling `--color-*: initial` or the enforcement
  check before all consumers are migrated would fail the build/check against
  not-yet-migrated code (D5).
- No new npm dependency for the enforcement check.
- `:root` is never fully removed — only its color custom properties are; its 4
  non-color declarations remain effective throughout and after this area.

## Interfaces and boundaries

- Consumes: the fully-migrated codebase from every other area.
- Produces: the final, enforced state of the token system — nothing downstream depends
  on this area.

## Area-specific acceptance criteria

1. Zero occurrences of `-[var(--`, raw white/black utilities, or `color-mix(` remain in
   `tools/dashboard/ui/**/*.{ts,tsx}` production sources.
2. Every legacy color custom-property **declaration** (the original 39 names) and the 5
   dead token variants no longer exist anywhere in the repository.
3. Every legacy color-variable **reference** (`var(--legacy-name)`) is gone from
   `index.css` — replaced by the corresponding `--color-*` token, including inside the
   two preserved `color-mix(...)` exceptions.
4. `color-scheme`, `font-family`, `font-synthesis`, and `text-rendering` are still
   present in `index.css` and still effective (still apply to the same elements they did
   before this area's changes).
5. `--color-*: initial` is present in `@theme`, and `npm --prefix tools/dashboard run
   build` still succeeds with no default-palette utility rendering.
6. `index.html`'s `theme-color` matches `--color-background` exactly.
7. The new architecture check exists, runs as part of `npm --prefix tools/dashboard
   test` (or an equivalently discoverable script), rejects each banned pattern —
   including the CSS-file legacy-reference check and the `text-accent-solid` misuse
   check — with a synthetic fixture, and passes against the real, migrated codebase.
8. Every change-wide acceptance criterion in `overview.md` is re-verified and passes.
9. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run
   test:storybook`, `npm --prefix tools/dashboard run build`, and `npm --prefix
   tools/dashboard run build-storybook` all pass.
10. One representative final visual review (screenshot or computed-style based, covering
    at least one story per migrated area) confirms neutral surfaces, typography, and
    spacing are unchanged, and that D9's list of intentional color-recipe changes reads
    correctly for contrast/legibility — this is the change's single visual-parity
    checkpoint, not a per-task repeat.

## Dependencies

`areas/shared-ui-primitives.md`, `areas/status-tone-contract.md`,
`areas/agent-sessions-and-work.md`, `areas/specs-lanes-and-remaining-ui.md`,
`areas/storybook-and-documentation.md` — every consumer-migration area.

## Out of scope

- Any new TS/TSX consumer migration (should be none left) — if the sweep finds one,
  that's a sign an earlier area's task is incomplete, not new scope for this area.
