# Area: status-tone-contract

## Responsibility

Create one central status/tone presentation module (`StatusTone` type + focused
presentation recipes) implementing the canonical semantic contract (D2: **7
`StatusTone` values plus 1 separate `action-destructive` action role** — not a
"9-state" contract; `status-active`/`status-neutral` are `@theme static inline` aliases that
*implement* 2 of the 7 `StatusTone` values, not additional states beyond them). This
module owns **only** the `StatusTone`-to-presentation direction — it is not a central
switch over every domain status in the product (see D2's second clarification). Two
genuinely separate domain-state → `StatusTone` projections consume it:
`transcript/projection.ts`'s legacy `TurnWork` severity, and a new Work-V2-local
projection this area also creates. Also the **sole owner** of `shared/ui/status-label.tsx`
(Task 04 does not touch this file, correcting the original spec's accidental dual
ownership).

## Current state

**Correction (found during `/nevo-ai:spec-review`): the previous draft of this area
wrongly described `transcript/projection.ts` as the owner of the `requiresAttention`
mis-mapping. It is not — that mapping lives entirely in Work V2, a separate system.**
Verified directly from source:

- `tools/dashboard/ui/features/agent-sessions/transcript/projection.ts:34,43-54` —
  `PresentationSeverity = 'normal' | 'warning' | 'error'` and
  `computePresentationSeverity(items: WorkItem[], turnError)`. This is the **legacy**
  `TurnWork` projection's severity — its only inputs are per-tool-item `status` and a
  turn's `turnError`. **It has no input that could carry `requiresAttention`** (that
  concept doesn't exist in the legacy `WorkItem`/`TurnWork`/`NormalizedMessage` model at
  all) — so it structurally cannot produce an "attention" outcome, and must not be
  described as needing to. Its sole consumer is
  `tools/dashboard/ui/features/agent-sessions/turn-work/turn-work-summary.tsx`
  (**path correction**: not `work-v2/turn-work-summary.tsx` — that path does not exist;
  the real file lives in a sibling `turn-work/` directory, not `work-v2/`), which
  imports `PresentationSeverity`/`TurnWork`/`WorkItem`/`isGenuineTurnError` from it
  directly (`turn-work-summary.tsx:6`).
- `tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx` is a
  **completely separate system** operating on `CanonicalTurnV2`/`TurnStatusV2` (a
  different canonical type than the legacy `NormalizedMessage`-derived model). It does
  **not** import anything from `transcript/projection.ts`. It computes attention/severity
  **inline, twice, independently**:
  - `WorkCurrentActivityLineV2` (lines 16-60): `const isAttention = display.kind ===
    'requires_attention'` (line 28), sourced from `describeCurrentActivityV2()`
    (`activity-model-v2.ts`, which has its own `case 'requires_attention':` branch at
    line 45) — renders `text-[var(--warning-strong)]` when attention (line 36).
  - `WorkIndicatorV2` (lines 68-110): `const attention = turn.status.status ===
    'requiresAttention'` (line 70) → `severity: 'normal'|'warning'|'error' = attention ?
    'warning' : …` (lines 75-79) → renders `text-[var(--warning-strong)]` (line 89).
    **This second inline computation is the confirmed mis-mapping** the change request
    calls out — attention rendering as warning.
  - `tools/dashboard/ui/features/agent-sessions/work-v2/pending-interaction-view-v2.tsx:18`
    also checks `turn.status.status !== 'requiresAttention'` directly, independently of
    the two computations above.
  None of Work V2's three `requiresAttention`-adjacent call sites share one projection
  today — this is exactly the "scattered per component" problem D2 exists to fix, but
  the fix belongs entirely inside Work V2 (a new, Work-V2-local projection this area
  creates), not inside the legacy `transcript/projection.ts`.
- `tools/dashboard/ui/components/ui/status-card.tsx` — its own error-banner
  `color-mix` recipe (see `areas/shared-ui-primitives.md`); `StatusCard` keeps its own
  constrained `variant`/`size` `cva()` visual API (migrated in
  `areas/shared-ui-primitives.md`) and consumes semantic status tokens directly — it
  does **not** need to import `shared/status-tone.ts` (D2's second clarification: not
  every status-bearing component must import the shared module's specific recipes, only
  the domain-state → tone projection upstream of it must resolve to `StatusTone`).
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
  background+border+text classes to every consumer.** This module owns presentation
  only — it must not grow into a switch over domain statuses (session status, spec
  status, PR state, Turn status, …); those projections live in their owning features and
  only their *output* (a `StatusTone` value) reaches this module.
- **Do not export `action-destructive` from this module.** It is intentionally not a
  `StatusTone` — it is a separate, one-off action-classification role (D2), not an
  ongoing-state tone. Its own theme token (`--color-action-destructive`) is consumed
  directly by the relevant destructive component variant (e.g. a `Button` `variant:
  'destructive'` entry in `button.tsx`'s own `cva()` recipe, migrated in
  `areas/shared-ui-primitives.md`) — never routed through `shared/status-tone.ts`.
- **Legacy `TurnWork` projection** (`transcript/projection.ts`): migrate
  `PresentationSeverity`/`computePresentationSeverity()` to produce `StatusTone` values
  from **only the subset it can honestly represent** — `'normal'` → `'neutral'` (or
  `'success'`, whichever the change request's "completed historical work → normally
  neutral" rule implies for this legacy model — decide based on what
  `turn-work-summary.tsx` actually needs, don't guess), `'warning'` → `'warning'`,
  `'error'` → `'error'`. **Do not add `requiresAttention` as an artificial parameter to
  this function merely to preserve prior wording about a unified fix** — this legacy
  projection has no such input and must not be given one just to look consistent with
  Work V2. Update `turn-work-summary.tsx` (real path: `features/agent-sessions/turn-work/
  turn-work-summary.tsx`) to consume the migrated output.
- **New Work-V2-local projection** (this area creates it — fixed path:
  `tools/dashboard/ui/features/agent-sessions/work-v2/turn-status-tone-v2.ts`, a new
  file; do not extend `activity-model-v2.ts` in place of creating it, though
  `activity-model-v2.ts`'s existing `requires_attention` activity-kind classification
  stays useful read-only context for this new module's own logic): a pure function
  mapping `CanonicalTurnV2`/`TurnStatusV2` (and the current-activity `kind` where
  relevant) to `StatusTone`, explicitly including `requiresAttention` → `'attention'`.
  Migrate all three known Work V2 call sites to consume it instead of each
  computing/checking independently:
  - `work-indicator-v2.tsx`'s `WorkCurrentActivityLineV2` (`isAttention`, line 28).
  - `work-indicator-v2.tsx`'s `WorkIndicatorV2` (`attention`/`severity`, lines 70-79) —
    this is the confirmed mis-mapping fix.
  - `pending-interaction-view-v2.tsx:18`'s direct `turn.status.status !==
    'requiresAttention'` check (only if it needs a tone for rendering, not merely a
    boolean gate — inspect before changing; a pure boolean guard with no color output
    doesn't need to go through `StatusTone` at all).
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
  the exact narrow carve-out.
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
- Do not merge the legacy `TurnWork` projection and the new Work-V2-local projection
  into one function — they have genuinely different inputs (the legacy model cannot
  express `requiresAttention`) and must stay two separate, correctly-scoped projections
  that both happen to produce `StatusTone` as their output type.
- Not every status-bearing visual component needs to import this module directly —
  `StatusCard` is a confirmed example that keeps its own `cva()` API and consumes
  semantic tokens directly (D2's second clarification).

## Interfaces and boundaries

- Consumes: `--color-status-*`/`--color-status-active`/`--color-status-neutral` tokens
  from `areas/theme-foundation.md` (not `--color-action-destructive` — see Requirements).
- Produces: the `StatusTone` type and presentation recipes that any domain-state
  projection may target and any visual component may consume (directly, or via its own
  constrained `cva()` API) — not a mandatory import for every status-bearing component.
  Also produces the redesigned `status-label.tsx` (typed `tone` prop) its two known
  callers now depend on, and the new Work-V2-local projection Work V2's own consumers
  depend on.

## Area-specific acceptance criteria

1. The new status-tone module exports exactly `StatusTone` (7 values) plus focused
   presentation recipes (at least a text-only and a surface recipe — not one universal
   recipe) — `action-destructive` is **not** exported from it, and the module contains
   no domain-status switch (session/spec/PR/Turn status names do not appear in it).
2. `transcript/projection.ts`'s migrated severity function has no `requiresAttention`
   parameter and no attention-producing branch — verified by source review, confirming
   it was not artificially extended to match Work V2's wording.
3. `work-v2/turn-status-tone-v2.ts` exists, is the single source Work V2's three named
   call sites (`WorkCurrentActivityLineV2`, `WorkIndicatorV2`,
   `pending-interaction-view-v2.tsx` where applicable) consume, and maps
   `requiresAttention` to `'attention'`.
4. `WorkIndicatorV2` renders `requiresAttention` with `status-attention` classes,
   visually distinct from `status-warning` (different hue, not just a shade) — the
   confirmed mis-mapping fix. `inspection: computed-style comparison or Storybook test`
5. `turn-work-summary.tsx` (real path:
   `features/agent-sessions/turn-work/turn-work-summary.tsx`) and `status-label.tsx`
   consume their respective (different) migrated projections — no local
   severity-to-class mapping remains duplicated in either file.
6. `status-label.tsx` receives a typed `tone: StatusTone` prop; it no longer converts a
   raw domain-status string to classes itself. `agent-session-list.tsx` and
   `specification-detail.tsx` each compute their own tone from their own domain status
   before calling it — verified by source review, not by the component's own behavior.
7. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass.

## Dependencies

`areas/theme-foundation.md`, `areas/frontend-formatter-baseline.md`,
`areas/react-class-composition-guidelines.md` (this module is the first real consumer of
the `StatusTone` type). Independent of `areas/shared-ui-primitives.md` — may run in
parallel with it.

## Out of scope

- Workflow lane presentation (`lane-presentation.ts`, `status-board.tsx`) —
  `areas/specs-lanes-and-remaining-ui.md`.
- Any other content of `agent-session-list.tsx`/`specification-detail.tsx`/
  `work-indicator-v2.tsx`/`pending-interaction-view-v2.tsx` beyond the specific call
  sites named above — the rest of those files' migration is `tasks/06-*`/`tasks/07-*`.
- The `action-destructive` token's actual consumer (`Button`'s destructive variant) —
  `areas/shared-ui-primitives.md`.
- `work-details-sheet-v2.tsx`/`work-timeline-v2.tsx` — confirmed to have no
  attention/severity logic of their own (only the unrelated `--foreground-muted` fix,
  which is `tasks/06-*`'s job).
