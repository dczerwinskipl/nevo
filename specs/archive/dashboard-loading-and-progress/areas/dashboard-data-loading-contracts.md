# Area: Dashboard data-loading contracts

## Responsibility

Split the currently over-wide `/pull-requests` and `/content` routes into
lightweight-first contracts, add a dedicated fast-pollable task-status endpoint, and
remove the redundant polling/SSE overlap and synchronous fs I/O on these hot paths. Does
not cover PR file/diff loading (that's `pull-request-file-and-diff-loading.md`) or
grouping/filtering (`changes-grouping-and-filtering.md`).

## Current state

- `GET /api/specs/:source/:slug/pull-requests` (`tools/dashboard/server/index.mjs:228-246`)
  returns full PR metadata plus `files[].patch` and `fullDiff` per PR
  (`providers/github.mjs:38-73`), sourced from three `gh api` calls per PR
  (`tools/lib/github.mjs:156-174`). `usePullRequests` polls it every 30s including in
  the background (`use-dashboard-data.ts:106-124`).
- `GET /api/specs/:source/:slug/content` (`index.mjs:208-226`) always returns
  `{ overview, areas, tasks }` in full (`loadSpecificationContent`,
  `data.mjs:134-200`), reading via synchronous `existsSync`/`readFileSync`/
  `readdirSync`/`statSync` (`data.mjs:1`, used at lines 86-89, 91-100, 121, 149-155).
  `spec-detail.tsx:478-479` fetches this bundle even when only one task document is
  selected. `useSpecificationContent` polls every 30s
  (`use-dashboard-data.ts:83-86`) *and* the SSE `specs-changed` handler invalidates the
  same query key on every relevant file change anywhere in `specs/active`/`specs/archive`
  (`use-dashboard-data.ts:47-58`, `watcher.mjs:5-9,21-35` — coarse, no per-file
  information).
- No task-status-only endpoint exists; task status is nested inside the heavier
  `/api/dashboard` payload (`taskProjection`, `data.mjs:202-270`), computed by
  `loadDashboardData` (`data.mjs:279-295`), which walks every change under
  `specs/active/`/`specs/archive/` and reads their task files on every call.
  `useDashboardData` polls this route every 30s, including in the background
  (`use-dashboard-data.ts:38-45`) — small response payload, but real per-poll backend
  I/O cost across the whole spec tree.

## Requirements

- `GET /api/specs/:source/:slug/pull-requests` returns PR-list metadata only: provider/
  repository, number/id, title, author, branch, baseBranch, state/status, headSha,
  createdAt, updatedAt, url — plus, per D3 in `owner-decisions.md`, any other field
  already produced by today's `mapGitHubPullRequest` mapping that costs nothing extra to
  keep (e.g. draft flag, mergeable state, if already present in the metadata call this
  route still needs to make). It must not call the files/patch or full-diff GitHub
  endpoints at all.
- `GET /api/specs/:source/:slug/content` becomes a manifest: which documents exist
  (overview, each area, each task) plus enough metadata to render navigation (title,
  last-modified) but not their bodies. Producing that manifest must not read every
  document's full body on every request just to extract a title from its H1 — that
  would still do full-tree I/O per manifest fetch, just without shipping the bodies to
  the browser. Cache the extracted title server-side (invalidated by the same granular
  per-file SSE events this task already introduces), or derive it more cheaply (e.g. a
  fast partial read instead of the full file); a working implementation is not required
  to re-parse full document content on every manifest request.
- A new route serves one document's body on demand (exact path is an implementation
  detail — e.g. `GET /api/specs/:source/:slug/content/:docId`), cached client-side with
  effectively-infinite staleness and no `refetchInterval`.
- A new `GET /api/specs/:source/:slug/task-statuses` route returns `{ revision,
  tasks: [{ id, status, ... }] }` — small enough to poll every few seconds. `revision`
  only needs to change when something in the payload changes; delta polling is not
  required now but the shape must not preclude adding it later (e.g. don't make
  `revision` meaningless/random).
- The manifest, per-document, and task-status routes read via async fs APIs
  (`fs/promises`) on the request path, not the sync APIs used today.
- The SSE watcher gains enough granularity that a per-document content cache entry can
  be invalidated individually (e.g. `{ slug, files: ["tasks/14.md"] }`) instead of
  invalidating the whole content query; task-status polling stays interval-driven
  regardless (it's cheap by design, not worth the added complexity of event-driven
  invalidation for a payload this small).
- Once the **document/content** query moves to event-driven invalidation, remove its
  `refetchInterval` — the `specs-changed` SSE watcher genuinely observes
  `specs/active/**`/`specs/archive/**` file changes, so this is a real trigger, and
  polling plus SSE invalidation must not both apply to the same heavy content query.
- **The PR-list query is a different case (owner correction, 2026-08-15): it must not
  rely on `specs-changed` SSE as its refresh mechanism.** A `git push` to an open PR
  changes GitHub's `headSha` without touching any file under `specs/active/`/
  `specs/archive/` — `specs-changed` has no way to observe it, so removing PR-list's
  poll and relying only on SSE (as the earlier draft of this area did) would mean a new
  push is never noticed until a manual page reload. Requirement: PR-list metadata uses
  initial fetch + refetch-on-window-focus + an explicit user-triggered refresh action,
  plus an optional slow safety-refresh interval (well above the old 30s — minutes, not
  seconds) as a backstop; this is not the same "polling on a fixed short timer" this
  change removes elsewhere, and it stays independent of `specs-changed`. This is about
  the **lightweight PR-list metadata only** — files/diffs (task 02) are still never
  polled on any timer; a new `headSha` reaching the frontend through this mechanism is
  what naturally invalidates task 02's `(headSha, path)` diff cache for the new version,
  since the cache key changes.
- `/api/dashboard`'s own 30s `refetchInterval` moves to SSE-driven invalidation
  (`specs-changed`) plus an initial fetch, with a much longer safety-refresh interval
  (minutes, not seconds) as a backstop — this is the same fix already applied to
  content/PR-list, extended to `/api/dashboard`'s own poll, not a rewrite of what
  `loadDashboardData`/`taskProjection`/`changeProjection` compute.

## Constraints

- No change to what `taskProjection`/`changeProjection` *compute* for `/api/dashboard`
  — this area adds a narrower, faster read path alongside it, and separately fixes how
  often/why `/api/dashboard` is re-fetched (its own `refetchInterval`, per the
  Requirements above). Removing now-redundant fields from its payload is out of scope
  unless trivial and requested during review — that's a payload-shape change, distinct
  from the polling-behavior fix that is in scope.
- Must not change gate/status-transition semantics — this is a read-path change only.

## Interfaces and boundaries

- Exposes: the three routes above, consumed by `tools/dashboard/src/hooks/use-dashboard-data.ts`.
- Consumes: `tools/dashboard/server/data.mjs` (extended, not replaced), `watcher.mjs`
  (extended event payload).

## Area-specific acceptance criteria

- The PR-list route's response contains no `patch` or `fullDiff` field for any file.
- Requesting one task document does not read `overview.md` or any `areas/*.md` file
  from disk (verifiable via a spy/mock on the fs read function in a server test).
- The content query has no `refetchInterval` once event-driven invalidation is wired.
- The PR-list query refreshes on window focus and on explicit user request, and does
  not rely on `specs-changed` SSE to notice a new `headSha`; any fixed-interval safety
  refresh it keeps is well above the old 30s. Task-status polling interval stays a few
  seconds.
- A file change under one task's markdown invalidates only that task's cached document
  client-side (not the whole spec content cache), verifiable by asserting which query
  keys `invalidateQueries` is called with in a hook/unit test.

## Dependencies

None — this is the first task in the change; `pull-request-file-and-diff-loading.md`
depends on the route-splitting pattern established here.

## Out of scope

- PR file manifest, diff batching/hydration, diff caching by `headSha` (next area).
- Changes grouping/filtering UI.
- Operation progress (separate area).
