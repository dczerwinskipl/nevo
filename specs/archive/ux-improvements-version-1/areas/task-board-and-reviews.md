# Area: Task Board & PR Reviews

## Responsibility

Fix the task-detail modal's clipping bug, flatten the nested card structure in the review
column, stop mobile kanban from forcing scroll past empty columns, and label the raw commit
hash shown in a review item's title.

## Current state

- **Modal clipped by sidebar (TASK-1, High):** at 1440×900, the task-detail modal is centered
  against the *full* window width, but the 300px left sidebar (higher stacking order) covers
  the first ~96px of the modal. Confirmed via DOM inspection:
  `dialog.getBoundingClientRect() = {x: 272, width: 896, right: 1168}`, sidebar ends at
  x≈368. Mobile (full-screen modal, no persistent sidebar) is unaffected.
- **Card-in-card nesting (TASK-2):** structure is section → column (Review) → task card →
  a full-width "Zaakceptuj" button as a separate block inside the card, plus a fifth layer
  above the column's cards: "Zaakceptuj wszystkie (N)" styled full-width/centered, easily
  misread as a section header rather than a button.
- **Mobile empty columns (TASK-3):** at 375px, "Nowe"/"Projekt"/"Ready" (all empty, each a
  full-height "Brak zadań" card) must be scrolled past before "Implementacja"/"Gotowe" (the
  only populated columns) appear.
- **Raw commit hash (TASK-4):** the "Recenzje" tab shows a title like "Batch review:
  multi-provider-agent-sessions (**55b58f00**)" with no label explaining the hex string, next
  to review items with fully descriptive titles.

## Requirements

Four tasks: `task-modal-clipped-by-sidebar`, `flatten-review-card-nesting`,
`mobile-collapse-empty-columns`, `label-commit-hash`.

## Constraints

`flatten-review-card-nesting` is layout/structure only — the column-color angle documented in
COLOR-1's "Bonus" section is owned by `areas/colors.md`'s `design-tokens` task, not duplicated
here.

## Area-specific acceptance criteria

1. The task-detail modal is centered against the content area (viewport minus sidebar width),
   or raised above the sidebar's stacking order — no clipped leading characters at 1440×900.
   `inspection: reproduce at 1440x900, confirm no text is clipped behind the sidebar`
2. The per-task "Zaakceptuj" action renders inline on the task-card title row (right-aligned),
   not as a separate block layer; "Zaakceptuj wszystkie (N)" renders in the column header, not
   as the first list item.
3. On mobile, zero-count kanban columns are collapsed or sorted after populated columns.
4. The commit-hash review title carries an explicit label/prefix (e.g. "commit 55b58f00") or
   is replaced with a date.

## Dependencies

None. Visually benefits from `areas/colors.md`'s stage-color migration but is not blocked by
it — the nesting fix is independent of which color each stage uses.

## Out of scope

- TASK-5 (PR diff viewer scope/filtering) — retracted by the review itself, already works as
  intended.
- Area/path-to-area configuration authoring — out of scope of the review itself.
