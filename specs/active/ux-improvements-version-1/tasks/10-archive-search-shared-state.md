---
id: ux-improvements-version-1.archive-search-shared-state
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - .nevo-ai-local/ux-review/report/03-navigation-and-ia.md
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/list-overview.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/03-archive-search-desync.png
allowed_paths:
  - tools/dashboard/src/App.tsx
  - tools/dashboard/src/components/list-overview.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix archive search desync between sidebar and main panel (NAV-2)

## Goal

Typing a no-match query (e.g. `zzzzzznoresults`) into "Szukaj w archiwum..." correctly empties
the sidebar's list (`app-sidebar.tsx:120-122` already filters `source` by `search`) but
`ListOverview` (`App.tsx:206`) keeps showing the full, unfiltered list — it never receives
`search` at all. Fix: pass the same filtered state (or the `search` value plus the same query
logic) into `ListOverview` so both panels agree.

## Implementation constraints

- `App.tsx:50` already owns `search` state; `app-sidebar.tsx:120-122` already implements the
  filter query (`change.title...includes(query) || change.slug.includes(query)`, locale
  `'pl'`). Reuse that exact query logic — do not write a second, possibly-diverging
  implementation. Prefer lifting the filter into `App.tsx` (computing one filtered list) over
  duplicating the filter function in both components.
- This is independent of `dedupe-recent-sessions` (task 09) — `ListOverview` renders the spec
  list, not the session list; the two components don't share code today.

## Acceptance criteria

1. Typing `zzzzzznoresults` into the archive search box produces the same empty result in
   both the sidebar and the main content panel. `inspection: reproduce the exact query the review used, compare both panels`
2. A real, matching query filters both panels identically (not just the empty case).
   `inspection: type a query matching a known archived spec title, verify both panels agree`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Global/full-text search across tasks, sessions, reviews (`NAV-4`) — deferred; this task only
makes the existing title/slug search consistent across both panels that already show it.
