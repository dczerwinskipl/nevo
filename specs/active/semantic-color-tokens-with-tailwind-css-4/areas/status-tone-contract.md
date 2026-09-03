# Area: status-tone-contract

## Responsibility

Create one central status/tone presentation module implementing the canonical semantic
contract (D2), and migrate every currently-scattered severity/status-to-color mapping to
consume it instead of deciding locally.

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
- `tools/dashboard/ui/shared/ui/status-label.tsx:19-40` — `statusTone()`, a generic
  shared status-label helper, reused by `specification-detail.tsx:146` and
  `agent-session-list.tsx:139`, but not sourced from one central tone contract.
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
  exporting the `StatusTone` union type exactly as defined in
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
  plus a `cva()`-based tone-rendering recipe (e.g. `statusToneVariants({ tone })`,
  exact shape is an implementation detail) so consumers get `VariantProps` and the
  standard `cn(statusToneVariants({ tone }), className)` composition, not a plain
  function returning a raw string. This is the single source of truth for the 9-state
  contract: the 7 `StatusTone` values, plus `action-destructive` (kept as a distinct,
  separate export — not a member of the `StatusTone` union, since it's a component
  variant concern, not an ongoing-state tone) and the `status-active`/`status-neutral`
  aliasing already defined in `@theme inline`. Include whatever "completed historical
  work → normally neutral" and "waiting/inactive/cancelled/unremarkable → status-neutral"
  rules the change request states.
- `status-error` and `action-destructive` must be two distinct entries in this module
  (two separate lookup keys), never merged into one, even though both currently resolve
  to the same `--color-status-error`/`--color-action-destructive` value.
- Migrate `projection.ts`'s `PresentationSeverity`/`computePresentationSeverity()` — the
  real owner of the mapping `work-indicator-v2.tsx`/`turn-work-summary.tsx` render
  through — so `requiresAttention` resolves to `status-attention`, not `status-warning`
  (the concrete fix for the confirmed mis-mapping). Replace `PresentationSeverity` with
  `StatusTone` (or make it a direct alias) rather than keeping two parallel taxonomies
  for the same concept.
- Migrate `status-label.tsx`'s `statusTone()` to consume the new module instead of its
  own local class-list logic.
- Design the module's exported shape so `pull-requests/changes/status.ts`'s
  `stateTone()` (a third, independent status→class mapping, migrated separately in
  `areas/specs-lanes-and-remaining-ui.md`) can consume the shared `StatusTone` type and
  tone-rendering recipe without inventing its own class strings — this area does not
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
- Do not invent a 10th status beyond the 9 named in D2.

## Interfaces and boundaries

- Consumes: `--color-status-*`/`--color-action-destructive`/`--color-status-active`/
  `--color-status-neutral` tokens from `areas/theme-foundation.md`.
- Produces: the status-tone module every status-bearing consumer (Areas 4-5, and
  `lane-presentation.ts` in Area 5) imports instead of writing its own mapping.

## Area-specific acceptance criteria

1. The new status-tone module exists and covers all 9 canonical states with no
   ambiguity between `status-error` and `action-destructive`.
2. `requiresAttention` in `work-indicator-v2.tsx` renders with `status-attention`
   classes, visually distinct from `status-warning` (different hue, not just a shade).
3. `turn-work-summary.tsx` and `status-label.tsx` consume the new module — no local
   severity-to-class mapping remains duplicated in either file.
4. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass.

## Dependencies

`areas/theme-foundation.md`, `areas/frontend-formatter-baseline.md`,
`areas/react-class-composition-guidelines.md` (this module is the first real consumer of
the `StatusTone` type). Independent of `areas/shared-ui-primitives.md` — may run in
parallel with it.

## Out of scope

- Workflow lane presentation (`lane-presentation.ts`, `status-board.tsx`) —
  `areas/specs-lanes-and-remaining-ui.md`.
- Any other `features/**` migration beyond the specific severity-mapping call sites
  named above — the rest of `agent-sessions` and `specifications` etc. is Areas 4-5.
