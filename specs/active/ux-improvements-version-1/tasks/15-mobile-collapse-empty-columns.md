---
id: ux-improvements-version-1.mobile-collapse-empty-columns
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/task-board-and-reviews.md
    - .nevo-ai-local/ux-review/report/04-task-board-and-reviews.md
    - tools/dashboard/src/components/status-board.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/07-mobile-empty-kanban-columns.png
allowed_paths:
  - tools/dashboard/src/components/status-board.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Collapse/skip empty kanban columns on mobile (TASK-3)

## Goal

At 375px width, "Nowe"/"Projekt"/"Ready" (all empty, each rendered as a full-height "Brak
zadań" card) must be scrolled past before reaching "Implementacja"/"Gotowe" — the only columns
with real content. On mobile, collapse or skip zero-count columns, or sort populated columns
first.

## Implementation constraints

- Desktop layout (narrow columns in a horizontal grid) is unaffected — the report notes empty
  columns cost nothing there; this is a mobile-only (stacked-vertically) fix.
- Preserve the ability to see/reach an empty column's state (e.g. via a collapsed
  header showing "Nowe (0)") — don't make empty stages undiscoverable, just non-blocking.

## Acceptance criteria

1. At 375px width, populated columns ("Implementacja", "Gotowe" or whichever have tasks)
   appear before or without requiring scroll past empty ones.
   `inspection: reproduce at 375px, compare against .nevo-ai-local/ux-review/screenshots/07-mobile-empty-kanban-columns.png`
2. Desktop column layout/order is unchanged. `inspection: verify at 1440px`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Column color-coding or card-nesting structure — see `design-tokens` (task 01) and
`flatten-review-card-nesting` (task 14).
