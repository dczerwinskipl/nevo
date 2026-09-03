# Area: status-tone-contract

## Responsibility

Create one central status/tone presentation module implementing the canonical semantic
contract (D2), and migrate every currently-scattered severity/status-to-color mapping to
consume it instead of deciding locally.

## Current state

Status/severity presentation is decided independently in at least these places:

- `tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx:70-91` —
  `requiresAttention` → `severity: 'warning'` → `text-[var(--warning-strong)]`
  (confirmed mis-mapping the change request calls out: attention must be visually
  distinct from warning).
- `tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx:67` (and
  likely nearby lines) — an analogous local `severity` → class-list mapping using
  `--danger-strong` for its own `error` case.
- `tools/dashboard/ui/components/ui/status-card.tsx` — its own error-banner
  `color-mix` recipe (see `areas/shared-ui-primitives.md`).
- `tools/dashboard/ui/shared/ui/status-label.tsx` — a generic shared status-label
  component (per its own file comment) that any status-bearing feature can render
  through, but does not currently source from one central tone contract.

No single file today expresses "given a canonical status name, return its presentation
classes" — each caller re-derives its own subset of the mapping.

## Requirements

- Create one new module (suggested location:
  `tools/dashboard/ui/shared/status-tone.ts`, e.g. exporting a `statusToneClasses(tone:
  StatusTone) => { text, bg, border }`-shaped helper or equivalent — exact shape is an
  implementation detail) that is the single source of truth for the 9-state contract:
  `status-active`, `status-success`, `status-warning`, `status-error`,
  `status-attention`, `status-info`, `status-neutral`, `action-destructive`, plus
  whatever "completed historical work → normally neutral" and "waiting/inactive/
  cancelled/unremarkable → status-neutral" rules the change request states.
- `status-error` and `action-destructive` must be two distinct entries in this module
  (two separate lookup keys), never merged into one, even though both currently resolve
  to the same `--color-status-error`/`--color-action-destructive` value.
- Migrate `work-indicator-v2.tsx`'s `requiresAttention` mapping to resolve to
  `status-attention`, not `status-warning` — this is the concrete fix for the confirmed
  mis-mapping.
- Migrate `turn-work-summary.tsx`'s local severity mapping and `status-label.tsx` to
  consume the new module instead of their own local class-list logic.
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

`areas/theme-foundation.md`. Independent of `areas/shared-ui-primitives.md` — may run in
parallel with it.

## Out of scope

- Workflow lane presentation (`lane-presentation.ts`, `status-board.tsx`) —
  `areas/specs-lanes-and-remaining-ui.md`.
- Any other `features/**` migration beyond the specific severity-mapping call sites
  named above — the rest of `agent-sessions` and `specifications` etc. is Areas 4-5.
