---
id: ux-improvements-version-1.archive-search-shared-state
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/list-overview.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/App.tsx
  - tools/dashboard/src/components/list-overview.tsx
  - tools/dashboard/src/components/app-sidebar.tsx
  - tools/dashboard/src/lib/spec-search.ts
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix archive search desync between sidebar and main panel (NAV-2)

## Goal

Typing a no-match query (e.g. `zzzzzznoresults`) into "Szukaj w archiwum..." correctly empties
the sidebar's list but the main content panel keeps showing the full, unfiltered list — because
today the query/filter logic exists **twice**, independently: `App.tsx:59` computes
`source = mode === 'active' ? data?.active ?? [] : data?.archive ?? []` (mode-selected, but
*not* search-filtered) and passes it straight to `ListOverview` (`App.tsx:206`) with no
`search` prop at all; separately, `app-sidebar.tsx:119-123` independently recomputes the same
mode-selection (`source = mode === 'active' ? active : archive`) *and* the same text-match
query (`query = search.trim().toLocaleLowerCase('pl')`, then `.filter(...)` on title/slug) to
produce its own `visible`. Fix this so the query/filter logic has exactly one implementation,
and both `ListOverview` and `AppSidebar` render its result — not two independent
re-implementations that happen to look similar today and can silently diverge later.

## Implementation constraints

- Required end state: exactly one place computes "mode-selected list, filtered by `search`."
  Preferred approach: compute it once in `App.tsx` (which already owns both `mode` and
  `search` state) and pass the resulting filtered list down to both `ListOverview` (replacing
  today's unfiltered `changes={source}`) and `AppSidebar` (replacing its own independent
  `source`/`query`/`visible` computation at `app-sidebar.tsx:119-123`, which must be deleted,
  not left in place alongside the new App.tsx-level filtering — do not end up with App.tsx
  filtering once and `AppSidebar` filtering the same data again).
- `AppSidebar` still needs the raw, unfiltered `active` list for its other, unrelated
  computations (`activeSpecIds`, `activeTasks` at `app-sidebar.tsx:124-126`, which are not
  search-related) — keep those working from the raw list; only the *rendered spec list* must
  switch to the shared filtered result.
- Alternative, also acceptable: extract the query predicate itself into one small shared
  function (e.g. `tools/dashboard/src/lib/spec-search.ts`, pre-authorized in `allowed_paths`
  for this reason) imported by both `App.tsx`/`ListOverview` and `AppSidebar`, if reading the
  current component structure makes that cleaner than lifting full state — but even then,
  both consumers must apply it to the *same* mode-selected source list and reach the same
  result; do not keep two hand-written copies of the `.trim().toLocaleLowerCase('pl')` +
  title/slug match logic.
- Preserve the exact matching behavior already implemented in `app-sidebar.tsx:120-122`
  (locale `'pl'`, case-insensitive, matches on `change.title` or `change.slug`) — this task
  unifies *where* the query runs, not what it matches.

## Acceptance criteria

1. Typing a no-match query (e.g. `zzzzzznoresults`) into the archive search box produces the
   same empty result in both the sidebar and the main content panel.
   `inspection: type a no-match query, compare both panels`
2. A real, matching query filters both panels identically (not just the empty case).
   `inspection: type a query matching a known archived spec title, verify both panels agree`
3. The mode-selection + text-match query exists in exactly one place in the codebase after
   this fix — `app-sidebar.tsx` no longer contains its own independent copy of that logic.
   `inspection: read app-sidebar.tsx, confirm no separate filter/query implementation remains there`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Global/full-text search across tasks, sessions, reviews (`NAV-4`) — deferred; this task only
makes the existing title/slug search consistent across both panels that already show it.
