---
id: ux-improvements-version-1.task-modal-clipped-by-sidebar
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/task-board-and-reviews.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix task-detail modal clipped behind the sidebar (TASK-1, High)

## Goal

At 1440×900, the task-detail modal (`spec-detail.tsx:217`) is centered against the full
window width, but the persistent left sidebar (300px, higher stacking order) covers roughly
the first 96px of it — every line of text loses its leading characters. Confirmed via DOM
inspection: `dialog.getBoundingClientRect() = {x: 272, width: 896, right: 1168}`, sidebar
ends at x≈368.

## Implementation constraints

- Fix by either (a) centering the modal against the content area (viewport width minus
  sidebar width) instead of the full window, or (b) raising the modal's stacking order above
  the sidebar so it isn't visually covered at all. Pick whichever is the smaller change given
  the actual CSS layout found during implementation — this is a layout rule fix, not a
  redesign.
- Confirmed desktop-specific: the mobile version of the same modal (full-screen, no
  persistent sidebar) is unaffected — do not change mobile behavior.

## Acceptance criteria

1. At 1440×900, the task-detail modal's bounding rect no longer overlaps the sidebar's
   bounding rect (`dialog.left >= sidebar.right`, or the modal renders above the sidebar with
   no visible clipping). `inspection: reproduce the 1440x900 measurement above, confirm no overlap`
2. Every character of modal content is visible (no leading characters cut off).
   `inspection: visually confirm no text is clipped behind the sidebar at 1440x900`
3. Mobile (full-screen modal) behavior is unchanged. `inspection: verify at 375px width`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Any other modal's positioning — this task fixes only the task-detail modal.
