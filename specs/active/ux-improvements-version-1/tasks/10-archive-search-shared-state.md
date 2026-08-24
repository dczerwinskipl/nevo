---
id: ux-improvements-version-1.archive-search-shared-state
status: verified
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

- Required end state, unambiguous: `App.tsx` owns `mode` and `search` state (already does).
  Exactly one place — in `App.tsx` — computes "mode-selected list, filtered by `search`" (a
  plain `useMemo`/computed value is sufficient; no new file or abstraction is required for
  this). The resulting filtered list is passed down to both `ListOverview` (replacing today's
  unfiltered `changes={source}`) and `AppSidebar`.
- `AppSidebar`'s own independent `source`/`query`/`visible` computation
  (`app-sidebar.tsx:119-123`) must be deleted, not left in place alongside the new
  `App.tsx`-level filtering. `AppSidebar` renders the filtered list it receives — it does not
  re-run the search/mode filter on data it's given.
- `AppSidebar` still needs the raw, unfiltered `active` list for its other, unrelated
  computations (`activeSpecIds`, `activeTasks` at `app-sidebar.tsx:124-126`, which are not
  search-related) — keep those working from the raw list; only the *rendered spec list* must
  switch to the shared filtered result.
- Do not extract a separate helper module (e.g. a `spec-search.ts`-style file) for this — a
  computed value in `App.tsx` is enough for the amount of logic involved, and a second file
  whose only job is to be imported by two components is not simpler than passing the already-
  computed result down as a prop. Do not create an abstraction whose only purpose is to let
  two components filter independently while nominally sharing a predicate — the requirement is
  one execution of the filter, not one shared function definition invoked twice.
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
