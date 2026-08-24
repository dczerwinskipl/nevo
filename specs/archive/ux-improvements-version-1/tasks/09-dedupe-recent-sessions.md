---
id: ux-improvements-version-1.dedupe-recent-sessions
status: verified
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/ai-session-list.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/app-sidebar.tsx
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Give the sidebar and main-panel session lists one distinct job each (NAV-1)

> **Note (Owner Decision D6):** The global recent sessions section in `AppSidebar` has been intentionally removed in favor of strictly spec-scoped AI sessions. Sessions are owned by specifications and rendered exclusively within spec views (`SpecDetail`'s "Ostatnie rozmowy" section via `AiSessionList`).

## Goal

Previously, session cards rendered in both `AppSidebar` and `SpecDetail`'s "Sesje AI → Ostatnie rozmowy" section with duplicate information density. Per Owner Decision D6, global recent sessions in `AppSidebar` were superseded and removed entirely: sessions belong strictly to specifications (`/specs/:source/:slug/sessions/:provider/:providerSessionId`) and are listed in the specification's own detail view.

## Implementation constraints

- Per Owner Decision D6, `AppSidebar` does not render global AI sessions.
- Main panel usage (`spec-detail.tsx`'s "Ostatnie rozmowy" section, via `AiSessionList`): full row with task context and delete action.
- Shared presentation row `AiSessionRow` supports configurable density / options.

## Acceptance criteria

1. Per Owner Decision D6, `AppSidebar` no longer contains global recent AI sessions.
   `inspection: read app-sidebar.tsx, confirm no global session query or session list exists`
2. The main panel's session list (`spec-detail.tsx`'s "Ostatnie rozmowy") renders the spec's sessions with full detail (task context, delete action, status).
   `inspection: view spec detail AI sessions list`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

The archive-search desync (`NAV-2`) — a different component pair (spec list, not session
list); see `archive-search-shared-state` (task 10), which is independent of this task.
