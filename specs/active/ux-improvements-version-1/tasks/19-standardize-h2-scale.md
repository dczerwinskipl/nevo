---
id: ux-improvements-version-1.standardize-h2-scale
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/typography-and-consistency.md
    - .nevo-ai-local/ux-review/report/06-typography-and-consistency.md
    - tools/dashboard/src/components/status-board.tsx
    - tools/dashboard/src/components/spec-detail.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Standardize H2 scale (TYPO-2)

## Goal

`<h2>Status zadań</h2>` (`status-board.tsx:126-127`) uses `text-xl` (20px/600); `<h2>Ostatnie
rozmowy</h2>` (`spec-detail.tsx:313`) uses `text-lg` (18px/600) — same page, same semantic
heading level, two sizes. Standardize on 20px (`text-xl`) so "Status zadań" — the more
important section — doesn't shrink.

## Implementation constraints

- Change `spec-detail.tsx:313`'s `<h2>` from `text-lg` to `text-xl`; do not change
  `status-board.tsx`'s heading (already correct at 20px).
- Do not change any other heading level not flagged by the review.

## Acceptance criteria

1. Both `<h2>Status zadań</h2>` and `<h2>Ostatnie rozmowy</h2>` compute to the same font-size
   (20px). `inspection: read computed style at both sites`
2. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Any other heading level or component not measured in TYPO-2.
