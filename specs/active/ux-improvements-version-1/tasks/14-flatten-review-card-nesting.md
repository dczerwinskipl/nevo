---
id: ux-improvements-version-1.flatten-review-card-nesting
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/task-board-and-reviews.md
    - tools/dashboard/src/components/status-board.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/status-board.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Flatten "card in card in card" nesting in the Review column (TASK-2)

## Goal

Today's structure is section ("Status zadań") → column (Review) → task card → a full-width
"Zaakceptuj" button as a separate block (`status-board.tsx:98`), plus a fifth layer above the
column's cards: "Zaakceptuj wszystkie (N)" (`status-board.tsx:160`) styled full-width/centered,
easily misread as a section header. Flatten to: the per-task approve action inline on the
task-card title row (right-aligned icon/button, not a separate block); the bulk-approve action
moved into the column header next to "REVIEW N", not as the first list item.

## Implementation constraints

- Do not change what either action *does* — only where/how it renders.
- Check whether the same "title + separate button block underneath" pattern repeats on PR
  cards and review cards elsewhere in `status-board.tsx`; if so, unify to the same one
  inline-metadata-plus-one-primary-action pattern rather than fixing only the task card.
- Column color-coding is owned by the `design-tokens` task (task 01) — do not duplicate that
  work here, this task is structure only.

## Acceptance criteria

1. The per-task "Zaakceptuj" action renders inline on the task card's title row
   (right-aligned), not as a separate full-width block beneath it.
   `inspection: visually confirm the action no longer renders as a separate block beneath the title`
2. "Zaakceptuj wszystkie (N)" renders in the Review column's header (next to the column
   count), not as the first item in the card list.
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Column color-coding — see `design-tokens` (task 01).
