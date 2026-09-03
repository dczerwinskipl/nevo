# Area: status-tone-contract

## Responsibility

Create one central status/tone presentation module implementing the canonical semantic
contract (D2: **7 `StatusTone` values plus 1 separate `action-destructive` action
role** — not a "9-state" contract; `status-active`/`status-neutral` are `@theme inline`
aliases that *implement* 2 of the 7 `StatusTone` values, not additional states beyond
them), and migrate every currently-scattered severity/status-to-color mapping to
consume it instead of deciding locally. Also the **sole owner** of
`shared/ui/status-label.tsx` (see § Requirements — Task 04 does not touch this file,
correcting the original spec's accidental dual ownership).

## Current state

Status/severity presentation is decided independently in at least these places:

- `tools/dashboard/ui/features/agent-sessions/transcript/projection.ts:34,43-54` — the
  **real owner** of the severity mapping: `PresentationSeverity` type and
  `computePresentationSeverity()`. `work-indicator-v2.tsx:70-91` and
  `turn-work-summary.tsx:67` are *consumers* of this mapping, not independent
  implementations (correction to earlier discovery, which cited the two consumer files
  as if they owned the mapping themselves). `requiresAttention` → `severity: 'warning'`
  → `text-[var(--warning-strong)]` is the confirmed mis-mapping the change request calls
  out: attention must be visually distinct from warning.
- `tools/dashboard/ui/components/ui/status-card.tsx` — its own error-banner
  `color-mix` recipe (see `areas/shared-ui-primitives.md`).
- `tools/dashboard/ui/shared/ui/status-label.tsx:19-40` — `statusTone(status: string)`,
  a generic shared status-label helper that converts a **raw domain-status string**
  directly into Tailwind classes itself. Reused by `specification-detail.tsx:146` and
  `agent-session-list.tsx:139`. This violates the class-composition contract's
  domain-state → tone → variant → utility → token flow (D8): a shared visual component
  should receive an already-projected `tone`, not perform the domain-to-tone projection
  itself. **This area is `status-label.tsx`'s sole migration owner** — the original
  spec's `areas/shared-ui-primitives.md`/`tasks/04-*` also listed this file, which was a
  planning error (two tasks editing the same file while declared independent); it has
  been removed from `tasks/04-*` (see that task's own note).
- `tools/dashboard/ui/features/pull-requests/changes/status.ts:10-15` — `stateTone()`, a
  **third, independent** status→full-Tailwind-class-string mapping (PR
  draft/merged/closed/open state), feature-local to `pull-requests`. Its own
  canonical-state→tone mapping logic stays feature-local (PR state is a different
  canonical domain than Turn/tool status — see `areas/react-class-composition-guidelines.md`),
  but it should consume the same shared `StatusTone` type and tone-rendering surface
  this area produces, rather than inventing its own class strings independently. Migrated
  in `areas/specs-lanes-and-remaining-ui.md`'s task, not this one — noted here because
  its existence shapes what this area's module's public API must support.

No single file today expresses "given a canonical status name, return its presentation
classes" — each caller re-derives its own subset of the mapping.

## Requirements

- Create one new module (suggested location: `tools/dashboard/ui/shared/status-tone.ts`)
  exporting **only** the `StatusTone` union type exactly as defined in
  `react-component-guidelines.md` (D8):
  ```ts
  type StatusTone =
    | 'neutral'
    | 'active'
    | 'success'
    | 'warning'
    | 'error'
    | 'attention'
    | 'info';
  ```
  plus **focused, separate presentation recipes** keyed by `tone` — e.g. a text-only
  recipe (`statusTextTone({ tone })`, for consumers like `StatusLabel` that only need a
  foreground color) and a surface recipe (`statusSurfaceTone({ tone })`, for consumers
  like banners/cards that need `border`/`bg`/`text` together) — both `cva()`-based with
  `VariantProps`. **Do not create one universal recipe that always emits
  background+border+text classes to every consumer** — a text-only consumer forced to
  accept unused surface classes is exactly the "hidden boolean/unused-variant" smell the
  class-composition contract's inspection checklist exists to catch.
  This module is the source of truth for the 7 `StatusTone` values plus the
  `status-active`/`status-neutral` aliasing already defined in `@theme inline` (those are
  2 of the 7 values, not additional states). Include whatever "completed historical work
  → normally neutral" and "waiting/inactive/cancelled/unremarkable → status-neutral"
  rules the change request states.
- **Do not export `action-destructive` from this module.** It is intentionally not a
  `StatusTone` — it is a separate, one-off action-classification role (D2), not an
  ongoing-state tone. Its own theme token (`--color-action-destructive`) is consumed
  directly by the relevant destructive component variant (e.g. a `Button` `variant:
  'destructive'` entry in `button.tsx`'s own `cva()` recipe, migrated in
  `areas/shared-ui-primitives.md`) — never routed through `shared/status-tone.ts`.
- Migrate `projection.ts`'s `PresentationSeverity`/`computePresentationSeverity()` — the
  real owner of the mapping `work-indicator-v2.tsx`/`turn-work-summary.tsx` render
  through — so `requiresAttention` resolves to `status-attention`, not `status-warning`
  (the concrete fix for the confirmed mis-mapping). Replace `PresentationSeverity` with
  `StatusTone` (or make it a direct alias) rather than keeping two parallel taxonomies
  for the same concept.
- **Redesign `status-label.tsx`**: its exported component/prop contract changes from
  "receives a raw domain-status string and derives classes itself" to "receives a typed
  `tone: StatusTone` prop and renders via this area's text-tone recipe." The
  domain-status → `StatusTone` projection moves to each owning feature:
  - `agent-session-list.tsx:139`'s session-status → tone mapping stays in that file (or
    a small feature-local projection beside it) — agent-sessions' own domain.
  - `specification-detail.tsx:146`'s spec-status → tone mapping stays in that file (or a
    small feature-local projection beside it) — specifications' own domain.
  Because both call sites currently rely entirely on `status-label.tsx` to do this
  conversion, this area's task must also touch those two specific call sites (narrow,
  surgical — the `StatusLabel` usage only, not the rest of either file) so no
  intermediate task is left with a broken build; see `tasks/05-*`'s `allowed_paths` for
  the exact narrow carve-out and `areas/agent-sessions-and-work.md`/
  `areas/specs-lanes-and-remaining-ui.md` for confirmation that `tasks/06-*`/`tasks/07-*`
  do not need to re-touch this specific call site.
- Design the module's exported shape so `pull-requests/changes/status.ts`'s
  `stateTone()` (a third, independent status→class mapping, migrated separately in
  `areas/specs-lanes-and-remaining-ui.md`) can consume the shared `StatusTone` type and
  a tone-rendering recipe without inventing its own class strings — this area does not
  implement that file's PR-state mapping itself.
- Status surfaces/borders use the opacity-modifier convention from the change request
  (`border-status-warning/25 bg-status-warning/10 text-status-warning`), not
  `color-mix(...)`.

## Constraints

- This area does not touch workflow-lane presentation (`lane-presentation.ts`,
  `status-board.tsx`) — that consumes this module's tokens but is
  `areas/specs-lanes-and-remaining-ui.md`'s own task, since it's specifically about
  removing the `--lane-accent` runtime indirection, a separate concern from the status
  module itself.
- Do not invent an 8th `StatusTone` beyond the 7 named in D2/D8. `action-destructive` is
  a separate, 1-member action role, not a member of this 7-value union — the contract as
  a whole is "7 tones + 1 action role," never described as "9 states."
- `status-label.tsx` is edited **only** here, not in `tasks/04-*`.

## Interfaces and boundaries

- Consumes: `--color-status-*`/`--color-status-active`/`--color-status-neutral` tokens
  from `areas/theme-foundation.md` (not `--color-action-destructive` — see Requirements).
- Produces: the status-tone module every status-bearing consumer (Areas 4-5, and
  `lane-presentation.ts` in Area 5) imports instead of writing its own mapping, and the
  redesigned `status-label.tsx` (typed `tone` prop) its two known callers now depend on.

## Area-specific acceptance criteria

1. The new status-tone module exports exactly `StatusTone` (7 values) plus focused
   presentation recipes (at least a text-only and a surface recipe — not one universal
   recipe) — `action-destructive` is **not** exported from it.
2. `requiresAttention` in `work-indicator-v2.tsx` renders with `status-attention`
   classes, visually distinct from `status-warning` (different hue, not just a shade).
3. `turn-work-summary.tsx` and `status-label.tsx` consume the new module — no local
   severity-to-class mapping remains duplicated in either file.
4. `status-label.tsx` receives a typed `tone: StatusTone` prop; it no longer converts a
   raw domain-status string to classes itself. `agent-session-list.tsx` and
   `specification-detail.tsx` each compute their own tone from their own domain status
   before calling it — verified by source review, not by the component's own behavior
   (a component can correctly render a tone while still being handed a raw string by a
   caller that didn't migrate; both sides must be checked).
5. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass.

## Dependencies

`areas/theme-foundation.md`, `areas/frontend-formatter-baseline.md`,
`areas/react-class-composition-guidelines.md` (this module is the first real consumer of
the `StatusTone` type). Independent of `areas/shared-ui-primitives.md` — may run in
parallel with it.

## Out of scope

- Workflow lane presentation (`lane-presentation.ts`, `status-board.tsx`) —
  `areas/specs-lanes-and-remaining-ui.md`.
- Any other content of `agent-session-list.tsx`/`specification-detail.tsx` beyond the
  `StatusLabel` call site itself — the rest of those files' migration is `tasks/06-*`/
  `tasks/07-*`.
- The `action-destructive` token's actual consumer (`Button`'s destructive variant) —
  `areas/shared-ui-primitives.md`.
