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
    - tools/dashboard/ui/features/agent-sessions/turn-work/turn-work-summary.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/activity-model-v2.ts
    - tools/dashboard/ui/features/agent-sessions/work-v2/pending-interaction-view-v2.tsx
    - tools/dashboard/ui/shared/ui/status-label.tsx
    - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
    - tools/dashboard/ui/features/specifications/detail/specification-detail.tsx
  optional:
    - tools/dashboard/ui/features/pull-requests/changes/status.ts
allowed_paths:
  - tools/dashboard/ui/shared/status-tone.ts
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
  - tools/dashboard/ui/features/agent-sessions/turn-work/turn-work-summary.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/activity-model-v2.ts
  - tools/dashboard/ui/features/agent-sessions/work-v2/pending-interaction-view-v2.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
  - tools/dashboard/ui/features/specifications/detail/specification-detail.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/pull-requests/**
  - tools/dashboard/ui/features/operations/**
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

Create a single status-tone module (`StatusTone` type + focused presentation recipes,
7 values + `action-destructive` kept separate — never a "9-state" contract). Migrate the
**legacy** `TurnWork` severity (`transcript/projection.ts`, consumed by
`turn-work/turn-work-summary.tsx`) to a restricted subset of `StatusTone` — it has no
input that could carry `requiresAttention` and must not be given one artificially.
Separately, create a **new, Work-V2-local** projection from `CanonicalTurnV2`/
`TurnStatusV2` to `StatusTone` that does map `requiresAttention` → `'attention'`, and
wire it into Work V2's three independent inline computations
(`work-indicator-v2.tsx`'s two, `pending-interaction-view-v2.tsx`'s one) — this is the
actual fix for the confirmed mis-mapping. Also redesign `status-label.tsx` to receive a
typed `tone` prop instead of converting a raw domain-status string itself, and update
its two known callers (`agent-session-list.tsx`, `specification-detail.tsx`) so neither
is left broken — **this task is `status-label.tsx`'s sole editor; `tasks/04-*` no longer
touches it.**

## Dependencies

`theme-contract`, `frontend-formatter-baseline`, `react-class-composition-guidelines`
(this task's module is the first real consumer of the `StatusTone` type D8 defines).

## Implementation constraints

- **Path correction:** the legacy Work summary component is at
  `tools/dashboard/ui/features/agent-sessions/turn-work/turn-work-summary.tsx` — a
  sibling `turn-work/` directory, **not** under `work-v2/`. Verify this path (and every
  other path this task references) actually exists in Git before starting.
- **`transcript/projection.ts` (legacy) and Work V2 are two separate systems — do not
  merge their projections into one function.** `computePresentationSeverity(items,
  turnError)` operates on the legacy `WorkItem[]`/`turnError` model, which has no
  concept of `requiresAttention` at all; `WorkIndicatorV2` etc. operate on
  `CanonicalTurnV2`/`TurnStatusV2`, a different type. Migrate each to `StatusTone`
  independently:
  - Legacy: `PresentationSeverity`'s `'normal'|'warning'|'error'` → the corresponding
    `StatusTone` subset (`'warning'`→`'warning'`, `'error'`→`'error'`; decide whether
    `'normal'` maps to `'neutral'` or `'success'` based on what
    `turn-work-summary.tsx`'s actual rendering needs — inspect before choosing, don't
    guess). No `requiresAttention` parameter is added to this function.
  - Work V2: a new pure function (suggested: extend `activity-model-v2.ts`, which
    already classifies `requires_attention` as an activity kind, or add a small sibling
    module in `work-v2/` if that's a cleaner fit — implementer's call) mapping
    `CanonicalTurnV2`/`TurnStatusV2` to `StatusTone`, explicitly including
    `requiresAttention` → `'attention'`. Wire it into:
    - `work-indicator-v2.tsx`'s `WorkCurrentActivityLineV2` (`isAttention`, line 28).
    - `work-indicator-v2.tsx`'s `WorkIndicatorV2` (`attention`/`severity`, lines 70-79)
      — this is the actual confirmed-mis-mapping fix.
    - `pending-interaction-view-v2.tsx:18` — only if it needs a rendered tone, not a
      plain boolean gate; inspect before changing.
- Export **only** `StatusTone` and focused presentation recipes from
  `shared/status-tone.ts` — at minimum a text-only recipe and a surface (border+bg+text)
  recipe, both `cva()`-based. Do not create one universal recipe that forces every
  consumer to accept background/border classes it doesn't use. This module must not
  contain any domain-status name (session/spec/PR/Turn status) — only `StatusTone`.
- **Do not export `action-destructive` from `shared/status-tone.ts`.** It is not a
  `StatusTone` member and not part of this module's public surface at all — it is a
  separate theme token (`--color-action-destructive`) consumed directly by the relevant
  destructive component variant (`Button`'s `cva()` recipe, in `tasks/04-*`).
- Use the opacity-modifier convention (`border-status-X/25 bg-status-X/10
  text-status-X`) for surfaces, not `color-mix(...)`.
- **`status-label.tsx` redesign:** change its prop contract from "raw domain-status
  string in, classes out" to "typed `tone: StatusTone` prop in, rendered via this
  module's text-tone recipe." Update its two known callers in the same task:
  - `agent-session-list.tsx:139` — add a small local (or feature-local) session-status
    → `StatusTone` mapping, pass the resulting `tone` to `StatusLabel`. Touch only this
    call site and its immediate supporting mapping — do not otherwise edit this file
    (its `-[var(--…)]`/white-black migration is `tasks/06-*`'s job).
  - `specification-detail.tsx:146` — same pattern: add a local spec-status →
    `StatusTone` mapping, pass `tone` to `StatusLabel`. Touch only this call site (the
    rest of this file's migration is `tasks/07-*`'s job).
- `StatusCard` does **not** need to import `shared/status-tone.ts` — it keeps its own
  `cva()` visual API (`tasks/04-*`) and consumes semantic tokens directly. Do not add an
  unnecessary import to satisfy a "every status component imports the module" reading —
  that reading is corrected in D2's second clarification.
- Design the module's public surface so `tools/dashboard/ui/features/pull-requests/changes/status.ts`'s
  `stateTone()` (migrated in `tasks/07-*`) can consume the shared `StatusTone` type and
  shared tone-rendering recipe without duplicating class strings itself; do not
  implement that file's own PR-state→tone mapping here.
- Do not touch `lane-presentation.ts`, `status-board.tsx`, `features/pull-requests/**`,
  `features/operations/**`, or any `features/agent-sessions/**`/`features/specifications/**`
  file beyond the specific call sites named above.
- Do not touch `index.css` — it already has the tokens this task consumes.
- Apply the "required inspection when touching a component" checklist
  (`react-component-guidelines.md` §11/§12) to every file this task changes.

## Acceptance criteria

1. The status-tone module exports exactly `StatusTone` (the 7-value union from D8) plus
   focused presentation recipes (at least text-only and surface) — no universal
   bg+border+text-only recipe, `action-destructive` is **not** exported, and no
   domain-status name appears in the module.
   `inspection: module reviewed against D2 and D8`
2. The legacy `transcript/projection.ts` severity function has no `requiresAttention`
   parameter and no attention-producing branch. `inspection: source reviewed`
3. A new Work-V2-local projection exists and is the single source
   `work-indicator-v2.tsx`'s two computations and (where applicable)
   `pending-interaction-view-v2.tsx` consume — no duplicated inline
   `=== 'requiresAttention'` logic remains across those files.
   `inspection: source reviewed`
4. `WorkIndicatorV2` renders `requiresAttention` with `status-attention` classes; a
   computed-style check or durable Storybook test confirms it is visually distinct from
   `status-warning` (different hue).
   `inspection: computed-style comparison or Storybook test performed and recorded`
5. `turn-work-summary.tsx` (`features/agent-sessions/turn-work/turn-work-summary.tsx`)
   and `status-label.tsx` each consume their respective migrated projection; no local
   severity-to-class-list mapping remains duplicated in either file.
   `inspection: source reviewed`
6. `status-label.tsx` receives a typed `tone: StatusTone` prop and no longer converts a
   raw domain-status string to classes itself.
   `inspection: source reviewed`
7. `agent-session-list.tsx:139` and `specification-detail.tsx:146` each compute their
   own `StatusTone` from their own domain status and pass it to `StatusLabel` — neither
   file is left calling the old string-based API.
   `inspection: both call sites reviewed`
8. The module's exported shape (type + tone-rendering recipes) is usable by
   `pull-requests/changes/status.ts` without that file needing to invent its own class
   strings — verified by a dry review of that file's intended future call, even though
   its actual migration happens in `tasks/07-*`.
   `inspection: shared-module API reviewed against status.ts's needs`
9. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass. `automated: both commands`
10. The "required inspection when touching a component" checklist was applied to every
    file this task changed. `inspection: checklist applied and recorded`

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
- Any content of `agent-session-list.tsx`/`specification-detail.tsx`/
  `work-indicator-v2.tsx`/`pending-interaction-view-v2.tsx` beyond the specific call
  sites named above — `tasks/06-*`, `tasks/07-*`.
- `work-details-sheet-v2.tsx`/`work-timeline-v2.tsx` — no attention/severity logic of
  their own; their only relevance (`--foreground-muted`) is `tasks/06-*`'s job.
- Any other agent-sessions or specifications file — `tasks/06-*`, `tasks/07-*`.
