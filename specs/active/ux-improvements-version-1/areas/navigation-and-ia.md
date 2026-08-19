# Area: Navigation & Information Architecture

## Responsibility

Fix the duplicate session list and the search desync it causes, consolidate the four
document tabs into one, and move the connectivity indicator out of primary header chrome.
Does **not** cover the global-search, lifecycle-stepper, or supersedes-link proposals —
deferred (opportunities, not defects).

## Current state

- **Duplicate list (NAV-1):** the same 4 session cards render independently in the right
  sidebar and in the main "Przegląd" panel's "Sesje AI → Ostatnie rozmowy" section — zero
  content difference between the two renders.
- **Archive search desync (NAV-2, High):** typing a no-match query into "Szukaj w archiwum..."
  correctly empties the sidebar list ("Brak wyników") but the main content panel keeps showing
  the full, unfiltered 12-item list — two panels contradicting each other after the same user
  action. The review frames this as a consequence of NAV-1's duplication; direct code reading
  shows a narrower, independent cause: `App.tsx:50` already owns `search` state and passes it
  to `AppSidebar` (`App.tsx:224`), which filters `source` itself
  (`app-sidebar.tsx:120-122`) — but `App.tsx:206` passes `ListOverview` the unfiltered
  `source` directly, with no `search` prop at all. `ListOverview` (the main-panel spec list)
  and `AppSidebar`'s session list (NAV-1) are two different components rendering two
  different lists (specs vs. sessions); fixing one does not structurally fix the other.
- **Tab/screen granularity (NAV-3):** the "Przegląd" tab stacks six concerns on one screen
  (stats, session list, git/workflow status, spec summary counts, an "in progress" banner, the
  full kanban board); next to it, four tabs (Specyfikacja / Obszary / Opcje rozwiązań /
  Decyzje) each just render a markdown file — the "Obszary" tab is already internally a tree,
  one level shallower than it needs to be.
- **Connectivity indicator (NAV-6):** "Pliki połączone" (a technical SSE/connectivity status)
  sits permanently top-right with the same visual weight as the app name/logo, on every
  screen, for a local single-user file-backed tool.

## Requirements

Four tasks: `dedupe-recent-sessions`, `archive-search-shared-state`,
`consolidate-documentation-tabs`, `move-connectivity-indicator`.

## Constraints

`archive-search-shared-state` is independent of `dedupe-recent-sessions` — they fix two
different list components (spec list vs. session list; see "Current state" above for the code
evidence). Do not gate one on the other.

## Area-specific acceptance criteria

1. The session list renders from one shared data/component; the sidebar shows a short
   navigational summary (no "Kontekst całej specyfikacji" subtitle), the main panel shows the
   full list with actions (delete, open).
2. Typing a no-match archive search query produces the same (empty) result in both the
   sidebar and the main content panel — verified with the same `zzzzzznoresults` query the
   review used.
3. The four document tabs (Specyfikacja / Obszary / Opcje rozwiązań / Decyzje) become one
   "Documentation" view with a tree on the left.
4. The connectivity indicator is no longer in primary header chrome (moved to a footer/status
   element or collapsed to an icon-only state).

## Dependencies

None between this area's own tasks.

## Out of scope

NAV-4 (global search), NAV-5 (lifecycle stepper), NAV-7 (supersedes/superseded-by links) —
deferred, see `07-deferred-v2-proposals.md`.
