---
id: ux-improvements-version-1.dedupe-recent-sessions
status: draft
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

## Goal

The same session cards render in both `AppSidebar` (via `AiSessionRow`, directly imported,
`app-sidebar.tsx:16,241`, called with `compact`) and `SpecDetail`'s "Sesje AI → Ostatnie
rozmowy" section (`spec-detail.tsx:313`, via `AiSessionList`, which also renders
`AiSessionRow`) — both already share the same underlying row component, so there is no
markup duplication to remove at that level. The duplication is that both locations currently
render the *same information density*: `AiSessionRow`'s `compact` prop
(`ai-session-list.tsx:73-96`) today only reduces padding (`p-3` vs `p-4`, line 112) — it does
not suppress the delete button (`app-sidebar.tsx:241` still passes `onDelete={handleDeleteSession}`)
or the subtitle line showing linked-task titles / "Kontekst całej specyfikacji"
(`ai-session-list.tsx:150-152`, rendered unconditionally regardless of `compact`). Extend the
existing shared component's presentation contract so the sidebar can be a short navigational
summary and the main panel keeps the full detail — without two independent renderers.

## Implementation constraints

- Do not remove either location entirely — give each one a distinct job, not "delete one of
  them."
- Do not copy `AiSessionRow`'s markup into `app-sidebar.tsx` or build a second row component —
  extend `AiSessionRow`/`AiSessionList` (`ai-session-list.tsx`) with a small, explicit
  presentation contract for the compact/navigation-summary case. Reuse or extend the existing
  `compact` prop, or add one clearly-named sibling prop — the exact prop name/shape is an
  implementation detail, not prescribed here.
- Sidebar usage (`app-sidebar.tsx:241`): must not render the delete button (drop the
  `onDelete` it currently passes, or have the component itself suppress delete when in
  compact/summary mode — pick one, but the rendered result must have no delete action), and
  must not render the linked-task/"Kontekst całej specyfikacji" subtitle line.
- Main panel usage (`spec-detail.tsx`'s "Ostatnie rozmowy" section, via `AiSessionList`):
  unchanged — keeps the full row (delete action, subtitle line).
- `AiSessionRow`'s other callers (currently: `AiSessionList`, used with its default/full
  presentation) must keep rendering exactly as they do today — this task only adds a new
  compact/summary behavior, it does not change the default.

## Acceptance criteria

1. The sidebar's session rows render with no delete action and no linked-task/"Kontekst całej
   specyfikacji" subtitle — click-to-open summary only.
   `inspection: read the rendered sidebar session row, confirm no delete icon and no subtitle line`
2. The main panel's session list (`spec-detail.tsx`'s "Ostatnie rozmowy") is unchanged: full
   subtitle line and delete action still present.
   `inspection: compare sidebar vs. main panel rendering side by side`
3. Both locations still use the same underlying row implementation (`AiSessionRow`) — no
   second, independent session-row renderer exists in `app-sidebar.tsx`.
   `inspection: read app-sidebar.tsx, confirm it still imports and calls AiSessionRow, not a local reimplementation`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

The archive-search desync (`NAV-2`) — a different component pair (spec list, not session
list); see `archive-search-shared-state` (task 10), which is independent of this task.
