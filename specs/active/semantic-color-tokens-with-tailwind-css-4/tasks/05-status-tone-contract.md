---
id: semantic-color-tokens-with-tailwind-css-4.status-tone-contract
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/status-tone-contract.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx
    - tools/dashboard/ui/shared/ui/status-label.tsx
  optional:
    - tools/dashboard/ui/features/pull-requests/changes/status.ts
allowed_paths:
  - tools/dashboard/ui/shared/status-tone.ts
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
  - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/specifications/**
  - tools/dashboard/ui/features/pull-requests/**
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx
  - src/**
depends_on:
  - theme-contract
  - frontend-formatter-baseline
  - react-class-composition-guidelines
semantic_references:
  decisions: [D2, D8]
  constraints: [C5, C7, C8]
---

# Task: Build the central status/tone contract and fix `requiresAttention`

## Goal

Create a single status-tone module implementing the 9-state canonical contract from
`owner-decisions.md` D2, expressed through the `StatusTone` union type from D8, and
migrate the real severity-mapping source — `transcript/projection.ts`'s
`PresentationSeverity`/`computePresentationSeverity()` (consumed by
`work-indicator-v2.tsx` and `turn-work-summary.tsx`, not owned by either of them) — plus
`status-label.tsx`'s `statusTone()` to consume it.

## Dependencies

`theme-contract`, `frontend-formatter-baseline`, `react-class-composition-guidelines`
(this task's module is the first real consumer of the `StatusTone` type D8 defines).

## Implementation constraints

- **Correction to prior discovery:** the severity mapping `work-indicator-v2.tsx` and
  `turn-work-summary.tsx` both render through lives in
  `tools/dashboard/ui/features/agent-sessions/transcript/projection.ts:34,43-54`
  (`PresentationSeverity` type, `computePresentationSeverity()`) — those two `work-v2`
  files are *consumers*, not the mapping's owner. Migrate `projection.ts` itself; the two
  consumer files only need their render call sites updated to use the new module's
  output classes/tone.
- Name the new module's exported type `StatusTone` exactly as defined in
  `react-component-guidelines.md` (D8) — 7 values: `neutral | active | success |
  warning | error | attention | info`. `PresentationSeverity` either becomes an alias
  for `StatusTone` or is replaced by it outright (prefer replacing it — keeping two
  parallel names for the same concept re-creates the duplication this task exists to
  remove).
- `status-error` and `action-destructive` must be two distinct lookup keys in the new
  module, never collapsed into one, even though they currently share a value.
  `action-destructive` is **not** one of the 7 `StatusTone` values (it's a
  component-variant concern — e.g. a destructive Button variant — not an ongoing-state
  tone); keep it as a separate export, not a member of the `StatusTone` union.
  `PresentationSeverity`/the old severity model may have conflated `error` (Turn
  failure) differently than D2's `status-error` — reconcile against D2's canonical
  contract, not the old local naming, when the two differ.
- `work-indicator-v2.tsx:70-91`/`projection.ts`: `requiresAttention` must resolve to
  `status-attention`, not `status-warning`.
- Use the opacity-modifier convention (`border-status-X/25 bg-status-X/10
  text-status-X`) for surfaces, not `color-mix(...)`. Where a rendering recipe is
  reusable across tones, express it as a `cva()` recipe keyed by `tone` (per D8) rather
  than a plain function returning a raw class string, so `VariantProps` and the
  established `cn(componentVariants({ tone }), className)` composition pattern both
  apply.
- Design the module's public surface so `tools/dashboard/ui/features/pull-requests/changes/status.ts`'s
  `stateTone()` (a third, independent status→class mapping, out of this task's own
  `allowed_paths` — it's migrated in `tasks/07-*`) can consume the shared `StatusTone`
  type and shared tone-rendering recipe without duplicating class strings itself; do not
  implement that file's own PR-state→tone mapping here (PR state is a different
  canonical domain than Turn/tool status and stays feature-local to `pull-requests` per
  D2/D8's "keep close to the feature that owns the semantics" rule) — only make sure the
  shared module's exported shape is usable by it.
- Do not touch `lane-presentation.ts`, `status-board.tsx`, `features/pull-requests/**`,
  or any other `features/specifications/**` file — lane presentation and the PR-status
  consumer migration are `tasks/07-*`.
- Do not touch `index.css` — it already has the tokens this task consumes.
- Apply the "required inspection when touching a component" checklist
  (`react-component-guidelines.md` §11/§12) to `work-indicator-v2.tsx` and
  `turn-work-summary.tsx`'s changed render logic.

## Acceptance criteria

1. The status-tone module exports `StatusTone` (exactly the 7-value union from D8) and
   covers the full 9-state canonical contract (7 `StatusTone` values + the
   `status-neutral`/`status-active` aliasing already defined in `@theme inline` +
   `action-destructive` as a distinct, separate export), with `status-error` and
   `action-destructive` kept distinct. `inspection: module reviewed against D2 and D8`
2. `projection.ts` is the actual, single owner of the severity→tone mapping;
   `PresentationSeverity` is either removed in favor of `StatusTone` or is a direct
   alias, not a second independent taxonomy. `inspection: source reviewed`
3. `requiresAttention` renders with `status-attention` classes; a rendered comparison
   (screenshot or computed style) confirms it is visually distinct from
   `status-warning` (different hue).
   `inspection: computed-style/screenshot comparison performed and recorded`
4. `turn-work-summary.tsx` and `status-label.tsx` consume the new module; no local
   severity-to-class-list mapping remains duplicated in either file.
   `inspection: source reviewed, no duplicated mapping logic`
5. The module's exported shape (type + tone-rendering recipe) is usable by
   `pull-requests/changes/status.ts` without that file needing to invent its own class
   strings — verified by a dry review of that file's intended future call, even though
   its actual migration happens in `tasks/07-*`.
   `inspection: shared-module API reviewed against status.ts's needs`
6. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass. `automated: both commands`
7. The "required inspection when touching a component" checklist was applied to
   `work-indicator-v2.tsx`/`turn-work-summary.tsx`. `inspection: checklist applied and recorded`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Documentation impact

None yet — the canonical mapping is documented by `tasks/08-storybook-and-documentation.md`
once it's in its final, fully-consumed shape.

## Out of scope

- Workflow lanes and the `pull-requests/changes/status.ts` migration —
  `tasks/07-specs-lanes-and-remaining-ui.md`.
- Any other agent-sessions or specifications file — `tasks/06-*`, `tasks/07-*`.
