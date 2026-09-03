# Area: cleanup-and-enforcement

## Responsibility

Once every consumer is migrated (Areas 2-6), remove the old `:root` color-variable
block and now-dead token variants, enable `--color-*: initial`, fix the `theme-color`
meta/background mismatch, and add the lightweight architecture check that prevents
regressions from reintroducing arbitrary-value color utilities or raw palette usage.

## Current state

- `index.css:3-55`'s `:root` block still exists alongside the `@theme` block added in
  Area 1 (both areas require it to remain during migration).
- `--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border` have
  zero real consumers (confirmed) — dead weight to remove, not migrate.
- `index.html:6`'s `theme-color` (`#090b10`) does not match `index.css`'s
  `--color-background` (`#090a0d`).
- No lint/architecture-check infrastructure exists under `tools/dashboard`; the closest
  precedent is the `node --test` regex-over-source-text style already used by
  `tools/dashboard/tests/*.test.mjs`.

## Requirements

**Sweep and removal (first task, `tasks/07-*`):**
- Run a final repo-wide grep across `tools/dashboard/ui` (excluding
  `*.stories.tsx`/`tests/`/`__fixtures__/`) for `-[var(--`, raw white/black utilities,
  and `color-mix(` to confirm Areas 2-6 left zero occurrences; fix any straggler found.
- Remove the entire old `:root` color-variable block from `index.css` (all 39 original
  variables) — every consumer must already be migrated by this point.
- Remove `--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border`
  from wherever they ended up (they should not have been carried into the new `@theme`
  block per Area 1's contract, which never listed them — confirm they were never added).
- Add `--color-*: initial;` to the `@theme` block.
- Fix `index.html:6`'s `theme-color` to match the production `--color-background` value
  exactly (`#090a0d`), per the change request's explicit stage-9 instruction.
- Re-run the full change-wide acceptance criteria from `overview.md` and record the
  before/after Storybook comparison for representative stories (neutral surfaces,
  typography, spacing, non-targeted states unchanged).

**Enforcement (second task, `tasks/08-*`):**
- Add a lightweight, dependency-free check (plain Node script or `node --test` file,
  matching the existing `tools/dashboard/tests/*.test.mjs` precedent — no new npm
  package, per the change-wide constraint against new external dependencies) that scans
  production UI sources (excluding stories, tests, fixtures, generated files) and
  rejects:
  - `bg-[var(--...)]`, `text-[var(--...)]`, `border-[var(--...)]`, or equivalent
    color-bearing arbitrary-value utilities;
  - direct Tailwind default-palette utilities (`bg-white`, `bg-black`, `text-blue-*`,
    etc.);
  - undeclared `--color-*`/`--…` variable references;
  - component-local literal semantic colors or repeated `color-mix(...)` recipes.
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

## Interfaces and boundaries

- Consumes: the fully-migrated codebase from every other area.
- Produces: the final, enforced state of the token system — nothing downstream depends
  on this area.

## Area-specific acceptance criteria

1. Zero occurrences of `-[var(--`, raw white/black utilities, or `color-mix(` remain
   anywhere under `tools/dashboard/ui` production sources.
2. The old `:root` color-variable block and the 5 dead token variants no longer exist
   anywhere in the repository.
3. `--color-*: initial` is present in `@theme`, and `npm --prefix tools/dashboard run
   build` still succeeds with no default-palette utility rendering.
4. `index.html`'s `theme-color` matches `--color-background` exactly.
5. The new architecture check exists, runs as part of `npm --prefix tools/dashboard
   test` (or an equivalently discoverable script), rejects each of the four banned
   patterns with a synthetic fixture, and passes against the real, migrated codebase.
6. Every change-wide acceptance criterion in `overview.md` is re-verified and passes.
7. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run
   test:storybook`, `npm --prefix tools/dashboard run build`, and `npm --prefix
   tools/dashboard run build-storybook` all pass.
8. Representative Storybook stories (at least one per migrated area) are compared
   before/after and confirmed unchanged except the explicitly allowed fixes (D4 hover
   contrast, `--foreground-muted` becoming visible, lane-color parity check).

## Dependencies

`areas/shared-ui-primitives.md`, `areas/status-tone-contract.md`,
`areas/agent-sessions-and-work.md`, `areas/specs-lanes-and-remaining-ui.md`,
`areas/storybook-and-documentation.md` — every consumer-migration area.

## Out of scope

- Any new consumer migration (should be none left) — if the sweep finds one, that's a
  sign an earlier area's task is incomplete, not new scope for this area.
