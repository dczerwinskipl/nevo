# Area: Typography & Interaction Consistency

## Responsibility

Own the one shared `<StatusLabel>` component that fixes both TYPO-1 (task/stage status
rendered 3 different ways) and CHAT-4 (session status rendered 2 different ways) — same root
cause, one component. Also standardizes the H2 scale and makes `Escape` close every modal
consistently.

## Current state

- **Status label inconsistency (TYPO-1 + CHAT-4):** the word "Gotowe"/"Done" renders with
  three different treatments on one screen — `uppercase`/9px (stage-breakdown row),
  `uppercase`/11px (column header), natural-case/9px (task-card pill) — measured via
  `getComputedStyle()`. Separately, session status renders as "Bezczynna" (Polish, session
  card) and "idle" (English, lowercase, session header) for the same session. Both are direct
  evidence of no shared `StatusLabel`/`StatusBadge` component existing anywhere in the app.
- **H2 scale (TYPO-2):** `<h2>Ostatnie rozmowy</h2>` measures 18px/600 weight;
  `<h2>Status zadań</h2>` measures 20px/600 weight — same page, same semantic level, two
  values.
- **Escape key (TYPO-3):** the task-detail modal closes on `Escape`; the "New session AI"
  modal does not — its backdrop keeps blocking clicks until the "Zamknij tworzenie sesji"
  button is used instead.

## Requirements

Three tasks: `shared-status-label-component`, `standardize-h2-scale`,
`escape-key-closes-all-modals`.

## Constraints

`shared-status-label-component` must cover all 5 measured render sites (3 from TYPO-1, 2 from
CHAT-4) with one component/lookup, not two separate fixes.

## Area-specific acceptance criteria

1. One `<StatusLabel status="..." />` (or equivalent shared lookup) renders task/stage status
   at all 3 sites (stage-breakdown row, column header, task-card pill) and session status at
   both sites (session card, session header) with one consistent size/case/tracking per
   status kind, and the *same* status value/language in both session-status render sites.
2. Both `<h2>` instances measured in TYPO-2 render at the same font-size (20px).
3. `Escape` closes the "New session AI" modal the same way it already closes the task-detail
   modal.

## Dependencies

None. `chat-and-sessions`' session cards/header consume the component built here for their two
status-render sites (CHAT-4) — not a blocking dependency, just where the shared component's
consumers live.

## Out of scope

Any typography inconsistency not explicitly measured in the review (no new audit here beyond
TYPO-1/2/3).
