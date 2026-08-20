# Area: Colors

## Responsibility

Own the shared CSS design-token set (semantic + categorical) that every other area's fixes
should consume instead of inlining new hardcoded colors.

## Current state

`tools/dashboard/src/index.css` defines neutrals only (`--background`, `--surface`,
`--surface-raised`, `--surface-hover`, `--border`, `--border-strong`, `--foreground`,
`--muted`, `--muted-strong`, `--accent`, `--accent-strong`). Everything else — 34 distinct
Tailwind color+shade combinations and 22 raw hex literals, 56 values total — is hardcoded per
component with no shared source. This produces real semantic collisions with file:line
evidence, e.g. `amber` means both "warning" (`spec-actions.tsx`, `changes-panel.tsx`) and
"tool call running" (`ai-tool-view.tsx:40`); `red` and `rose` both mean "danger" in different
files; `emerald` means both "success" and the mock-provider badge color
(`ai-session-list.tsx:67`). One `color-mix()`-derived usage already exists as precedent:
`color-mix(in_srgb,var(--accent)_25%,transparent)` in `status-board.tsx:21`.

## Requirements

- Add exactly 13 new custom properties to `index.css`'s `:root`: 5 semantic roles
  (`--secondary`, `--success`, `--warning`, `--danger`, `--info`), each with a base and a
  `-strong` variant (10 properties), plus 3 categorical identifiers (`--cat-1`, `--cat-2`,
  `--cat-3`). Semantic roles are for status/severity only, never decoration; categorical
  identifiers are identity-only (e.g. AI provider badges), never status/severity. Pick hex
  values consistent with the colors already in use at each migration site below (this
  formalizes colors already in use in the app — e.g. `--danger` ≈ the already-dominant
  `red-400` — not new colors, so no separate owner sign-off is needed on the specific values).
  `owner-decision: none required — formalizes existing in-use colors, not new ones`
- `-bg`/`-border` variants are **not** separate custom properties. They are computed inline,
  per usage site, via `color-mix(in srgb, var(--role) N%, ...)` — the same pattern already at
  `status-board.tsx:21`. No global `.tone-*` utility class or other second derivation
  mechanism.
- Migrate every hardcoded usage below to the matching token:
  `rose-*` → `--danger`; `amber-*` on `isRunning` (`ai-tool-view.tsx:40,50`) → `--info`;
  `sky-*` on `running` (`operation-progress.tsx:24,38,52`) → `--info`; Claude badge
  (`ai-session-list.tsx:54`) → `--cat-1`; mock/fallback badge (`ai-session-list.tsx:67`) →
  `--muted-strong` on `--surface`; `stageTone` 5 hues (`status-board.tsx:15-22`) → `--muted`
  (New/Design/Ready), `--info` (Implementation), `--warning` (Review), unchanged `--accent`
  (Done); remaining `slate-*`/`zinc-*` neutral text → `--muted`/`--muted-strong`.

## Constraints

- Do not change `--accent` (`#c8f85a`) or any existing neutral token.
- Follow the existing `color-mix()` derivation pattern (`status-board.tsx:21`) for every
  `-bg`/`-border` need — do not invent a second derivation mechanism, and do not add `-bg`/
  `-border` as their own custom properties.
- Semantic tokens are never used for pure decoration/identity; categorical tokens never
  signal status/severity.

## Interfaces and boundaries

Exposes the token set every other area's tasks are expected to reuse rather than inlining new
colors: `chat-and-sessions` (mock-provider badge — uses the existing `--muted-strong`, no new
token needed), `task-board-and-reviews` (this area migrates `stageTone` itself; TASK-2's own
task is layout/nesting only, not color).

## Area-specific acceptance criteria

1. `index.css` gains exactly the 13 custom properties described above; no existing neutral or
   `--accent` value changes; no `-bg`/`-border` custom properties or `.tone-*` classes are
   added.
2. Every file:line listed in "Requirements" above no longer contains the pre-migration
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
- NAV-5's lifecycle stepper (deferred, out of scope for this specification) — not built here,
  even though it would reuse these tokens if built later.
