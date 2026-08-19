---
id: ux-improvements-version-1.dedupe-recent-sessions
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - .nevo-ai-local/ux-review/report/03-navigation-and-ia.md
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/spec-detail.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/01-desktop-home.png
allowed_paths:
  - tools/dashboard/src/components/app-sidebar.tsx
  - tools/dashboard/src/components/spec-detail.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Deduplicate the "Recent sessions" list (NAV-1)

## Goal

The same 4 session cards render independently in `AppSidebar` and in `SpecDetail`'s "Sesje AI
→ Ostatnie rozmowy" section (`spec-detail.tsx:313`) with zero content difference. Give each
location one distinct job instead of two copies of the same component: the main panel keeps
the full list with actions (delete, open); the sidebar becomes a short, visually distinct
navigational summary (no "Kontekst całej specyfikacji" subtitle, just enough to jump to a
session).

## Implementation constraints

- Do not remove either location entirely — the report's fix is "one job per location," not
  "delete one of them."
- Sidebar version: drop the "Kontekst całej specyfikacji" subtitle and any action buttons;
  keep it click-to-open only.
- Main panel version (`spec-detail.tsx`): keeps full detail + actions, unchanged in that
  respect.

## Acceptance criteria

1. The sidebar's session list no longer renders the "Kontekst całej specyfikacji" subtitle or
   delete actions — click-to-open summary only. `inspection: compare sidebar vs. main panel rendering`
2. The main panel's session list (`spec-detail.tsx`) keeps full session detail and delete
   action, unchanged.
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

The archive-search desync (`NAV-2`) — a different component pair (spec list, not session
list); see `archive-search-shared-state` (task 10), which is independent of this task.
