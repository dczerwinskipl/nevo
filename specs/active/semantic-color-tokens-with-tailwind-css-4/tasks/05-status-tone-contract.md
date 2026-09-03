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
    - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
    - tools/dashboard/ui/features/specifications/detail/specification-detail.tsx
  optional:
    - tools/dashboard/ui/features/pull-requests/changes/status.ts
allowed_paths:
  - tools/dashboard/ui/shared/status-tone.ts
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
  - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
  - tools/dashboard/ui/features/specifications/detail/specification-detail.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/specifications/**
  - tools/dashboard/ui/features/pull-requests/**
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
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

Create a single status-tone module implementing the canonical contract from
`owner-decisions.md` D2 — **7 `StatusTone` values plus 1 separate `action-destructive`
action role, not a "9-state" contract** — expressed through the `StatusTone` union type
from D8, and migrate the real severity-mapping source
(`transcript/projection.ts`'s `PresentationSeverity`/`computePresentationSeverity()`,
consumed by `work-indicator-v2.tsx` and `turn-work-summary.tsx`, not owned by either of
them) to it. Also redesign `status-label.tsx` to receive a typed `tone` prop instead of
converting a raw domain-status string itself, and update its two known callers
(`agent-session-list.tsx`, `specification-detail.tsx`) so neither is left broken —
**this task is `status-label.tsx`'s sole editor; `tasks/04-*` no longer touches it.**

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
- Export **only** `StatusTone` and focused presentation recipes from
  `shared/status-tone.ts` — at minimum a text-only recipe and a surface (border+bg+text)
  recipe, both `cva()`-based. Do not create one universal recipe that forces every
  consumer to accept background/border classes it doesn't use.
- **Do not export `action-destructive` from `shared/status-tone.ts`.** It is not a
  `StatusTone` member and not part of this module's public surface at all — it is a
  separate theme token (`--color-action-destructive`) consumed directly by the relevant
  destructive component variant (`Button`'s `cva()` recipe, in `tasks/04-*`). If
  `status-error` and `action-destructive` need to be discussed together anywhere in this
  task's own code/comments, keep them conceptually distinct (two different concerns,
  only one of which — `status-error` — belongs to this module).
- `work-indicator-v2.tsx:70-91`/`projection.ts`: `requiresAttention` must resolve to
  `status-attention`, not `status-warning`.
- Use the opacity-modifier convention (`border-status-X/25 bg-status-X/10
  text-status-X`) for surfaces, not `color-mix(...)`.
- **`status-label.tsx` redesign:** change its prop contract from "raw domain-status
  string in, classes out" to "typed `tone: StatusTone` prop in, rendered via this
  module's text-tone recipe." Update its two known callers in the same task:
  - `agent-session-list.tsx:139` — add a small local (or feature-local, e.g. beside the
    existing session-list code) session-status → `StatusTone` mapping, and pass the
    resulting `tone` to `StatusLabel` instead of the raw status. Touch only this call
    site and its immediate supporting mapping — do not otherwise edit this file (its
    `-[var(--…)]`/white-black migration is `tasks/06-*`'s job).
  - `specification-detail.tsx:146` — same pattern: add a local spec-status →
    `StatusTone` mapping, pass `tone` to `StatusLabel`. Touch only this call site (the
    rest of this file's migration is `tasks/07-*`'s job).
  This keeps the domain-status → tone projection in each owning feature (D8's
  requirement), not inside the shared component.
- Design the module's public surface so `tools/dashboard/ui/features/pull-requests/changes/status.ts`'s
  `stateTone()` (a third, independent status→class mapping, out of this task's own
  `allowed_paths` — it's migrated in `tasks/07-*`) can consume the shared `StatusTone`
  type and shared tone-rendering recipe without duplicating class strings itself; do not
  implement that file's own PR-state→tone mapping here (PR state is a different
  canonical domain than Turn/tool status and stays feature-local to `pull-requests` per
  D2/D8's "keep close to the feature that owns the semantics" rule) — only make sure the
  shared module's exported shape is usable by it.
- Do not touch `lane-presentation.ts`, `status-board.tsx`, `features/pull-requests/**`,
  or any other `features/specifications/**`/`features/agent-sessions/**` file beyond the
  two narrow call sites named above — lane presentation and the PR-status consumer
  migration are `tasks/07-*`; the rest of agent-sessions is `tasks/06-*`.
- Do not touch `index.css` — it already has the tokens this task consumes.
- Apply the "required inspection when touching a component" checklist
  (`react-component-guidelines.md` §11/§12) to `work-indicator-v2.tsx`,
  `turn-work-summary.tsx`, and `status-label.tsx`'s changed render logic.

## Acceptance criteria

1. The status-tone module exports exactly `StatusTone` (the 7-value union from D8) plus
   focused presentation recipes (at least text-only and surface) — no universal
   bg+border+text-only recipe, and `action-destructive` is **not** exported from it.
   `inspection: module reviewed against D2 and D8`
2. `projection.ts` is the actual, single owner of the severity→tone mapping;
   `PresentationSeverity` is either removed in favor of `StatusTone` or is a direct
   alias, not a second independent taxonomy. `inspection: source reviewed`
3. `requiresAttention` renders with `status-attention` classes; a computed-style check
   (or a durable Storybook test, not necessarily a manual screenshot) confirms it is
   visually distinct from `status-warning` (different hue).
   `inspection: computed-style comparison or Storybook test performed and recorded`
4. `status-label.tsx` receives a typed `tone: StatusTone` prop and no longer converts a
   raw domain-status string to classes itself.
   `inspection: source reviewed`
5. `agent-session-list.tsx:139` and `specification-detail.tsx:146` each compute their
   own `StatusTone` from their own domain status (a local or feature-local mapping) and
   pass it to `StatusLabel` — neither file is left calling the old string-based API.
   `inspection: both call sites reviewed`
6. `turn-work-summary.tsx` consumes the new module; no local severity-to-class-list
   mapping remains duplicated. `inspection: source reviewed`
7. The module's exported shape (type + tone-rendering recipes) is usable by
   `pull-requests/changes/status.ts` without that file needing to invent its own class
   strings — verified by a dry review of that file's intended future call, even though
   its actual migration happens in `tasks/07-*`.
   `inspection: shared-module API reviewed against status.ts's needs`
8. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass. `automated: both commands`
9. The "required inspection when touching a component" checklist was applied to
   `work-indicator-v2.tsx`/`turn-work-summary.tsx`/`status-label.tsx`.
   `inspection: checklist applied and recorded`

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
- Any content of `agent-session-list.tsx`/`specification-detail.tsx` beyond the
  `StatusLabel` call site — `tasks/06-*`, `tasks/07-*`.
- Any other agent-sessions or specifications file — `tasks/06-*`, `tasks/07-*`.
