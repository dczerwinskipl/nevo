# Area: Colors

## Responsibility

Own the shared CSS design-token set (semantic + categorical) that every other area's fixes
should consume instead of inlining new hardcoded colors.

## Current state

`tools/dashboard/src/index.css` defines neutrals only (`--background`, `--surface`,
`--surface-raised`, `--surface-hover`, `--border`, `--border-strong`, `--foreground`,
`--muted`, `--muted-strong`, `--accent`, `--accent-strong`). Everything else — 34 distinct
Tailwind color+shade combinations and 22 raw hex literals, 56 values total — is hardcoded per
component with no shared source (`.nevo-ai-local/ux-review/report/01-colors.md`, COLOR-1).
This produces real semantic collisions documented with file:line evidence in that report,
e.g. `amber` means both "warning" (`spec-actions.tsx`, `changes-panel.tsx`) and "tool call
running" (`ai-tool-view.tsx:40`); `red` and `rose` both mean "danger" in different files;
`emerald` means both "success" and the mock-provider badge color (`ai-session-list.tsx:67`).
One `color-mix()`-derived usage already exists as precedent:
`color-mix(in_srgb,var(--accent)_25%,transparent)` in `status-board.tsx:21`.

## Requirements

- Add to `index.css`: `--secondary`/`--secondary-strong`, `--success`/`--success-strong`,
  `--warning`/`--warning-strong`, `--danger`/`--danger-strong`, `--info`/`--info-strong`
  (semantic roles — status/severity only, never decoration), and `--cat-1`/`--cat-2`/`--cat-3`
  (categorical — identity only, e.g. AI provider badges, never status/severity). Exact
  proposed hex values and the `role-text`/`role-bg`/`role-border`/`role-strong` derivation
  pattern are in COLOR-1's "Ready-to-paste block for `index.css`" — they formalize colors
  already in use in the app (e.g. `--danger` formalizes the already-dominant `red-400`), not
  new colors, so no separate owner sign-off is needed on the specific hex values.
  `owner-decision: none required — formalizes existing in-use colors, not new ones`
- Migrate every hardcoded usage listed in COLOR-1's migration table to the matching token:
  `rose-*` → `--danger`; `amber-*` on `isRunning` (`ai-tool-view.tsx:40,50`) → `--info`;
  `sky-*` on `running` (`operation-progress.tsx:24,38,52`) → `--info`; Claude badge
  (`ai-session-list.tsx:54`) → `--cat-1`; mock/fallback badge (`ai-session-list.tsx:67`) →
  `--muted-strong` on `--surface`; `stageTone` 5 hues (`status-board.tsx:15-22`) → `--muted`
  (New/Design/Ready), `--info` (Implementation), `--warning` (Review), unchanged `--accent`
  (Done); remaining `slate-*`/`zinc-*` neutral text → `--muted`/`--muted-strong`.

## Constraints

- Do not change `--accent` (`#c8f85a`) or any existing neutral token.
- Follow the existing `color-mix()` derivation pattern (`status-board.tsx:21`) for every
  `-bg`/`-border` variant — do not invent a second derivation mechanism.
- Semantic tokens are never used for pure decoration/identity; categorical tokens never
  signal status/severity (COLOR-1's standing rule).

## Interfaces and boundaries

Exposes the token set every other area's tasks are expected to reuse rather than inlining new
colors: `chat-and-sessions` (mock-provider badge — uses the existing `--muted-strong`, no new
token needed), `task-board-and-reviews` (this area migrates `stageTone` itself; TASK-2's own
task is layout/nesting only, not color).

## Area-specific acceptance criteria

1. `index.css` gains the token block above; no existing neutral or `--accent` value changes.
2. Every file:line listed in COLOR-1's migration table no longer contains the pre-migration
   hardcoded class/hex; it references the corresponding CSS variable instead.
3. No new semantic collision is introduced (e.g. no token is reused for two unrelated
   meanings in the same screen).

## Dependencies

None — sequenced first since other areas' visual consistency benefits from these tokens
existing, though no other task in this spec is blocked on it.

## Out of scope

- Any change to the kanban column *structure* (card nesting, bulk-approve placement) — that's
  `task-board-and-reviews`' `flatten-review-card-nesting` task; this area only swaps which
  color each column state uses.
- NAV-5's lifecycle stepper (deferred to `07-deferred-v2-proposals.md`) — not built here, even
  though it would reuse these tokens if built later.
