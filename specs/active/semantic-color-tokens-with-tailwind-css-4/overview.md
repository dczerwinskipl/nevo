---
id: spec.semantic-color-tokens-with-tailwind-css-4
type: change
title: "Semantic Color Tokens with Tailwind CSS 4"
status: draft
change: semantic-color-tokens-with-tailwind-css-4
---

# Semantic Color Tokens with Tailwind CSS 4

## Context

`tools/dashboard` (Storybook baseline landed via PR #42, merged into
`feature/ai-session-issues-and-diagnostics`, audited revision `c9d7e26`) styles its
entire UI through a flat collection of `:root` CSS custom properties consumed almost
exclusively via Tailwind arbitrary-value utilities (`bg-[var(--…)]`, etc.) instead of
Tailwind 4's native `@theme` token mechanism. This is an API/architecture migration to
generated semantic utilities (`bg-surface`, `text-fg-muted`, `border-border`), not a
visual redesign — see D1 in `owner-decisions.md`. It is intentionally chartered as a
separate change from PR #42 and does not modify or merge that PR.

## Current architecture

- Theme file: `tools/dashboard/ui/index.css:1` — `@import "tailwindcss";` followed by a
  plain `:root { … }` block (lines 3-55, no `@theme` block anywhere in the repo).
- **39** color custom properties under `:root` (exact count, `index.css:6-51`): neutral
  (`--background`, `--surface`, `--surface-raised`, `--surface-hover`, `--border`,
  `--border-strong`, `--foreground`, `--muted`, `--muted-strong`), accent
  (`--accent`, `--accent-strong`, `--accent-foreground`, `--accent-muted`,
  `--accent-border`), four status families × 4 variants each
  (`--success*`, `--warning*`, `--danger*`, `--info*`), 7 lane vars
  (`--lane-new` … `--lane-danger`), and `--cat-1`/`--cat-2`.
- **1003** arbitrary-value occurrences of `-[var(--…]` across 58 files under
  `tools/dashboard/ui` (694 distinct lines — some lines carry more than one). Highest
  density: `features/specifications/navigation/specification-sidebar.tsx` (~44),
  `features/agent-sessions/create-agent-session-dialog.tsx` (~50),
  `features/agent-sessions/agent-session-details.tsx` (~44),
  `features/specifications/actions/spec-actions.tsx` (~38).
- **59** raw `bg/text/border-white|black[/opacity]` occurrences across 27 files (e.g.
  `dialog.tsx:19`/`sheet.tsx:20` `bg-black/70` overlays, `loading-screen.tsx:4-6`
  `bg-white/8` skeletons, `progress.tsx:7` `bg-white/7` track).
- `accent` (180 occurrences / 49 files) is overloaded: filled-button surface
  (`button.tsx:12`), active nav item (`specification-sidebar.tsx:51,60`), link/icon
  color with a darker hover (`specification-list.tsx:66`, `status-card.tsx:27`), focus
  ring (`specification-sidebar.tsx:218`, `agent-session-list.tsx:119`), and section
  labels/avatars — one variable serving five distinct semantic roles.
- `--foreground-muted` is referenced 5 times in 4 files under `features/agent-sessions`
  (`work-indicator-v2.tsx:90`, `work-details-sheet-v2.tsx:188,254`,
  `work-timeline-v2.tsx:49`, `transcript-message.tsx:59`) but is **not defined anywhere**
  — confirmed dangling. Older sibling files in the same feature use `--muted`/
  `--muted-strong` instead, so this is inferred to be a "v2" rewrite artifact, not an
  intentional rename.
- `--cat-1: #fb923c` / `--cat-2: #60a5fa` (`index.css:50-51`) are documented generically
  ("Category 1/2 accent", `colors.stories.tsx:93-94`) but their one real consumer,
  `ProviderBadge` in `agent-session-list.tsx:49-68`, maps them to Claude and Antigravity
  respectively.
- `--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border` are
  defined (`index.css:25,36-39`) but have **zero component consumers** — only their own
  definitions and the token-catalog Storybook story reference them (`--info` is also
  consumed internally by `--lane-ready`).
- `requiresAttention` (`work-indicator-v2.tsx:70`) maps to `severity: 'warning'`
  (line 75-79) and renders with `text-[var(--warning-strong)]` (line 86-91) — no
  distinct "attention" treatment exists despite the documented attention role.
- `--accent: #3882f6`, `--accent-strong: #1d4ed8`, `--accent-foreground: #f8fafc`
  (`index.css:17-19`) confirmed exactly. `--accent-foreground` on `--accent` is the
  filled-button pair (contrast concern, D4). `--accent-strong` is also used as a
  **text** color on dark surfaces at `specification-list.tsx:66` and
  `status-card.tsx:27` (also D4).
- Workflow lanes resolve through a two-step runtime indirection:
  `lane-presentation.ts:7-14` maps each `StageId` to `{ accent: 'var(--lane-X)' }`, then
  `status-board.tsx:119,125,129` sets an inline `style={{ '--lane-accent': … }}` per
  render and consumes it via `bg-[var(--lane-accent)]`.
- `index.html:6`'s `<meta name="theme-color" content="#090b10">` does not match
  `index.css:6`'s `--background: #090a0d` — a pre-existing, unrelated one-hex-digit
  drift to fix per stage 9.
- Tailwind confirmed at `^4.3.3` with `@tailwindcss/vite` `^4.3.3`
  (`tools/dashboard/package.json:49,65`), CSS-first (`index.css:1`), no
  `tailwind.config.*` in the repo.
- No ESLint or other lint/architecture-check infrastructure exists under
  `tools/dashboard` today. The closest repo precedent for a lightweight guard is the
  existing `node --test`, regex-over-source-text style used by
  `tools/dashboard/tests/*.test.mjs` (e.g. `composer-interaction.test.mjs:246`).
- No Prettier config is declared anywhere in the repo; `prettier@3.9.6` is present only
  transitively (required by `@tanstack/router-generator`,
  `tools/dashboard/package-lock.json:9056`), not a direct dependency.
- `cn()` (`tools/dashboard/ui/lib/utils.ts:4`, `clsx` + `tailwind-merge`) and exactly two
  `cva()` recipes (`button.tsx:7`: `variant`/`size`; `sheet.tsx:29`: `side`, both with
  `VariantProps`) are the only current variant-composition convention.
  `class-variance-authority`/`clsx`/`tailwind-merge` are already direct `dependencies`
  (`package.json:32-33,42`). `StatusCard` (`status-card.tsx:52-53,88-104`) has a real
  `variant`/`size` API implemented by hand instead of `cva()`. At least three
  independent status→class-string mapping systems already exist and are **not** the
  same pipeline (confirmed by reading the actual source, correcting an earlier draft of
  this spec): `status-label.tsx:19-40`'s `statusTone()`;
  `transcript/projection.ts:34,43-54`'s legacy `PresentationSeverity`/
  `computePresentationSeverity()`, consumed only by
  `features/agent-sessions/turn-work/turn-work-summary.tsx` (not under `work-v2/`) and
  structurally unable to represent `requiresAttention` (its inputs are only per-tool
  status and `turnError`); and Work V2's own, separate, currently-triplicated inline
  `=== 'requiresAttention'` logic in `work-v2/work-indicator-v2.tsx` (twice) and
  `work-v2/pending-interaction-view-v2.tsx:18` (once), which does not import from
  `transcript/projection.ts` at all. Plus `pull-requests/changes/status.ts:10-15`'s
  `stateTone()` (a fourth, independently-discovered PR-state mapping). No banned
  interpolated-class construction
  (`` `text-status-${x}` ``) exists today; a related pattern — ternary expressions
  selecting whole pre-written class strings instead of `cn()` — exists at 5 call sites
  already targeted for the `color-mix` cleanup in `tasks/06`/`07`.

## Problem

The current model has no compile-time or lint-time contract between "a color exists"
and "a component uses it correctly": any component can reach for any CSS variable via an
arbitrary-value escape hatch, `accent` silently carries five unrelated meanings, one
dangling variable (`--foreground-muted`) and five dead token variants ship unnoticed,
generic names (`cat-1`/`cat-2`) hide real semantics (provider identity), status
presentation is decided per-component instead of once (causing the confirmed
`requiresAttention` → warning mis-mapping), and there is no accessible mechanism to stop
a new arbitrary-value or raw-palette utility from being added tomorrow.

## Constraints

- **C1.** Do not upgrade Tailwind, add a `ThemeProvider`, add light mode, introduce a
  generic 50–950 palette, or extract a shared monorepo package (change-wide,
  owner-stated).
- **C2.** Do not modify or merge PR #42.
- **C3.** Base branch is `feature/ai-session-issues-and-diagnostics`, not `main` — see
  D6. `main` does not yet contain the Storybook baseline this spec depends on.
- **C4.** No new runtime npm dependency may be introduced for the architecture-check
  (`AGENTS.md` gates new external dependencies for owner approval; a plain
  `node --test`-based source-text check follows existing repo precedent and needs no new
  package — see `areas/cleanup-and-enforcement.md`).
- **C5.** Preserve current computed neutral-surface colors exactly; only change values
  where the change request identifies a concrete defect (accent-on-dark contrast,
  missing attention distinction, `--foreground-muted`/`cat-1`/`cat-2` naming, dead
  tokens).
- **C6.** `--color-*: initial` and the architecture check must not be enabled until
  every consuming area has migrated (D5) — enabling either earlier would fail the build
  or the check against legitimately not-yet-migrated code.
- **C7.** The Prettier formatting baseline (`areas/frontend-formatter-baseline.md`) must
  land, as its own mechanical commit, before any task edits `index.css` or any
  `tools/dashboard/ui/**` source file for token/component migration — no task's diff may
  mix formatting changes with semantic changes (D7).
- **C8.** No new styling, variants, or component-composition library is introduced;
  reuse `class-variance-authority`/`clsx`/`tailwind-merge` and Nevo-owned Radix wrappers
  (D8).

## Affected modules

`tools/dashboard/package.json`/`prettier.config.mjs`/`.prettierignore` (formatter
baseline), `docs/development/react-component-guidelines.md`/`docs/ai/task-routing.md`
(class-composition contract), `tools/dashboard/ui/index.css` (theme),
`tools/dashboard/ui/index.html` (theme-color meta), `tools/dashboard/ui/components/ui/*`
(shared primitives), a new shared status/tone module
(`tools/dashboard/ui/shared/status-tone.ts`), `tools/dashboard/ui/features/agent-sessions/**`,
`tools/dashboard/ui/features/specifications/**`, `tools/dashboard/ui/features/pull-requests/**`,
`tools/dashboard/ui/features/operations/**`, `tools/dashboard/ui/foundations/colors.stories.tsx`,
`docs/development/*` (UX/color guideline doc), a new `tools/dashboard/tests/*` or
`tools/dashboard/scripts/*` architecture-check.

## Options and trade-offs

The architectural shape (direct-value `@theme`, no primitive layer, canonical status
contract, static lane/provider mapping, Prettier over Biome, a documented class-
composition contract reusing the existing `cva()`/`cn()` stack) was specified by the
owner, not chosen among agent-proposed alternatives — see `owner-decisions.md` D1-D4 and
D7-D8 for the two-option comparisons the owner was given and decided between. The only
agent-decided trade-offs are: the enforcement mechanism (plain source-text check vs.
introducing ESLint — plain check chosen to avoid a new external dependency and match
existing repo precedent, D5/C4, `AGENTS.md` "New external dependencies" gate), and the
exact task/area decomposition of D7/D8's requirements (numbering, which task touches
which file) — an implementation detail within the owner's already-decided architecture.

## Owner decisions

See `owner-decisions.md` — D1 (theme contract shape), D2 (status/tone contract — **7
`StatusTone` values + 1 separate `action-destructive` action role**, not a "9-state"
contract), D3 (lane/provider naming and static mapping), D4 (accent contrast fix), D5
(migration and enforcement sequencing), D6 (base branch), D7 (Prettier +
`prettier-plugin-tailwindcss`, not Biome, applied as a standalone mechanical baseline),
D8 (durable Tailwind class-composition contract in `react-component-guidelines.md`), D9
(visual-parity claims reframed as intentional semantic normalization, verified for
contrast/legibility, not pixel identity — added during `/nevo-ai:spec-review`), D10
(`@theme static` for the direct-value token contract, plus a Storybook token-presence
test — added during `/nevo-ai:spec-review`).

## Proposed architecture

Land two independent prerequisite areas first: a Prettier + `prettier-plugin-tailwindcss`
formatting baseline, applied as its own mechanical commit (`areas/frontend-formatter-baseline.md`,
D7), and a documentation-only Tailwind class-composition contract added to
`react-component-guidelines.md`/`task-routing.md` (`areas/react-class-composition-guidelines.md`,
D8) — both must exist before any semantic/component edit lands, per C7/C8. Then add the
exact `@theme` contract given in the change request (namespace `--color-*`,
neutral/foreground/interaction/canonical-status/action/provider/workflow groups, one
`@theme static inline` block for `status-active`/`status-neutral` aliases — D10) alongside the
existing `:root` block so computed colors are unchanged while the new utilities become
available (`areas/theme-foundation.md`). Migrate consumers in dependency order: shared UI
primitives and the new central status/tone contract next (independent of each other,
both depend only on the theme contract plus the two prerequisite areas), then the two
large feature sweeps (agent sessions/Work, and specifications/lanes/PRs/operations/
remaining UI) which depend on both, then Storybook/docs, then a final area that removes
the old `:root` variables and now-dead token variants, enables `--color-*: initial`,
fixes the `theme-color` meta value, and adds the architecture-check guardrail. See
`owner-decisions.md` D5 for why cleanup and enforcement are ordered last, D7 for why
formatting is ordered first.

## Areas

- `areas/frontend-formatter-baseline.md` — Prettier + `prettier-plugin-tailwindcss`,
  applied once as a standalone mechanical commit.
- `areas/react-class-composition-guidelines.md` — the durable Tailwind
  class-composition contract in `react-component-guidelines.md`/`task-routing.md`.
- `areas/theme-foundation.md` — the `@theme` contract and its computed-color parity
  guarantee.
- `areas/shared-ui-primitives.md` — Button, Badge, Card, Dialog, Sheet, StatusCard
  (incl. its `cva()` conversion), shared status-label, and their own raw white/black
  cleanup.
- `areas/status-tone-contract.md` — the central `StatusTone` presentation module and its
  first consumers (severity mappings currently scattered per component, incl. the real
  `transcript/projection.ts` owner).
- `areas/agent-sessions-and-work.md` — agent-session feature components, Work V2
  presentation, `--foreground-muted` fix, provider badge rename.
- `areas/specs-lanes-and-remaining-ui.md` — specifications feature (incl. workflow lane
  static mapping), pull-requests (incl. `status.ts`'s `StatusTone` consumption),
  operations, and any remaining stray usages.
- `areas/storybook-and-documentation.md` — live-value Colors story and UX guideline doc.
- `areas/cleanup-and-enforcement.md` — old-variable/dead-token removal,
  `--color-*: initial`, `theme-color` meta fix, and the architecture check (incl. the
  interpolated-class-construction ban).

## Change-wide acceptance criteria

- Zero occurrences of `bg-[var(--`, `text-[var(--`, `border-[var(--` (or equivalent
  color-bearing arbitrary-value utility) remain under `tools/dashboard/ui`, excluding
  Storybook stories/tests/fixtures and any explicitly documented exception.
- Zero undefined color-variable references (no `--foreground-muted`-style dangling var).
- The old `:root` color variable block is removed from `index.css`; no component
  references a pre-migration variable name.
- `--color-*: initial` is present in `@theme` and no product UI renders a default
  Tailwind palette color (`bg-white`, `text-blue-500`, etc.) outside documented
  exceptions.
- `status-error` and `action-destructive` remain distinct roles in the token API even
  though they may share a value.
- `requiresAttention` renders visually distinct from `warning`.
- `bg-accent-solid text-fg-on-accent` (filled primary control) and every other
  foreground/background pair actually rendered by migrated components meets ≥4.5:1
  (normal text) / ≥3:1 (large text, non-text UI indicators, focus boundaries).
- `provider-claude`/`provider-antigravity` replace `cat-1`/`cat-2`; `workflow-design` and
  the given static lane mapping replace the `--lane-accent` runtime indirection.
- The Storybook Colors story reads live computed `--color-*` values, not a duplicated
  TypeScript palette.
- `prettier`/`prettier-plugin-tailwindcss` are direct devDependencies; the formatting
  baseline landed as its own mechanical commit, separate from every semantic/token
  commit in this change.
- `react-component-guidelines.md` documents the Tailwind class-composition contract
  (incl. the `StatusTone` type and the required-inspection checklist) and
  `task-routing.md` routes future `tools/dashboard/ui/**` work through it.
- Every component this change touches was reviewed against the "required inspection
  when touching a component" checklist; components with a stable variant API
  (`StatusCard`) expose it via `cva()`; no interpolated Tailwind class construction was
  introduced; the 3 pre-existing independent status-mapping helpers
  (`status-label.tsx`, `transcript/projection.ts`, `pull-requests/changes/status.ts`)
  all consume the shared `StatusTone` type/recipe.
- `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run test:storybook`,
  `npm --prefix tools/dashboard run build`, `npm --prefix tools/dashboard run
  build-storybook`, and `npm --prefix tools/dashboard run format:check` all pass.
- `node tools/docs.mjs validate`, `node tools/docs.mjs check`, `node tools/specs.mjs
  validate`, and `node tools/specs.mjs check` all pass.

## Verification strategy

Each task runs its own scoped verification (see `tasks/*.md`) via durable Storybook
tests, not per-task manual screenshots. The **one** representative final visual review
happens in the final `cleanup-and-enforcement` task (`tasks/09-*`), comparing
representative Storybook stories before/after (screenshot or computed styles) to
confirm neutral surfaces, typography, spacing, and non-targeted states are unchanged,
and that every intentional color-recipe change catalogued in D9 (StatusCard's
20/8%→25/10% recipe, sRGB `color-mix`→OKLab-mixed opacity modifiers, `warning-strong`→
`status-warning`, white-alpha→semantic-foreground opacity, the accent contrast fix)
reads correctly for contrast/legibility — none of these are claimed pixel-identical to
the pre-migration state. The final review additionally includes a focused audit of
every React component this specification modified against the class-composition rules
in `react-component-guidelines.md` §12 and its review checklist (§11) — recorded per
component, not just asserted in aggregate.

Record, at minimum, the results of:

```text
npm --prefix tools/dashboard run format:check
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run build-storybook
node tools/docs.mjs validate
node tools/docs.mjs check
node tools/specs.mjs validate
node tools/specs.mjs check
```

## Out of scope

Light mode, a `ThemeProvider`, a Tailwind upgrade, a generic 50–950 palette, a shared
monorepo package, typography/spacing/radii/shadow/layout redesign, a visual-regression
SaaS, OKLCH conversion, and any modification to or merge of PR #42.
