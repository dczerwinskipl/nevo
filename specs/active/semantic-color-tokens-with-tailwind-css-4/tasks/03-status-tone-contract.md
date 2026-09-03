---
id: semantic-color-tokens-with-tailwind-css-4.status-tone-contract
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/status-tone-contract.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx
    - tools/dashboard/ui/shared/ui/status-label.tsx
allowed_paths:
  - tools/dashboard/ui/shared/status-tone.ts
  - tools/dashboard/ui/shared/ui/status-label.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
  - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-summary.tsx
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/features/specifications/**
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx
  - src/**
depends_on:
  - theme-contract
semantic_references:
  decisions: [D2]
  constraints: [C5]
---

# Task: Build the central status/tone contract and fix `requiresAttention`

## Goal

Create a single status-tone module implementing the 9-state canonical contract from
`owner-decisions.md` D2, and migrate `work-indicator-v2.tsx`'s `requiresAttention`
mapping, `turn-work-summary.tsx`'s local severity mapping, and `status-label.tsx` to
consume it.

## Dependencies

`theme-contract`.

## Implementation constraints

- `status-error` and `action-destructive` must be two distinct lookup keys in the new
  module, never collapsed into one, even though they currently share a value.
- `work-indicator-v2.tsx:70-91`: `requiresAttention` must resolve to `status-attention`,
  not `status-warning`.
- Use the opacity-modifier convention (`border-status-X/25 bg-status-X/10
  text-status-X`) for surfaces, not `color-mix(...)`.
- Do not touch `lane-presentation.ts`, `status-board.tsx`, or any `features/specifications/**`
  file — lane presentation is a separate task (`tasks/05-*`).
- Do not touch `index.css` — it already has the tokens this task consumes.

## Acceptance criteria

1. The status-tone module covers all 9 states (`status-active`, `status-success`,
   `status-warning`, `status-error`, `status-attention`, `status-info`,
   `status-neutral`, `action-destructive`, and the "completed→neutral" /
   "cancelled/unremarkable→neutral" rules) with `status-error` and `action-destructive`
   kept distinct. `inspection: module reviewed against the 9-state contract`
2. `requiresAttention` in `work-indicator-v2.tsx` renders with `status-attention`
   classes; a rendered comparison (screenshot or computed style) confirms it is visually
   distinct from `status-warning` (different hue).
   `inspection: computed-style/screenshot comparison performed and recorded`
3. `turn-work-summary.tsx` and `status-label.tsx` import and use the new module; no
   local severity-to-class-list mapping remains in either file.
   `inspection: source reviewed, no duplicated mapping logic`
4. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
   pass. `automated: both commands`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Documentation impact

None yet — the canonical mapping is documented by `tasks/06-storybook-and-documentation.md`
once it's in its final, fully-consumed shape.

## Out of scope

- Workflow lanes — `tasks/05-specs-lanes-and-remaining-ui.md`.
- Any other agent-sessions or specifications file — `tasks/04-*`, `tasks/05-*`.
