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
  `/api/dashboard` payload (`taskProjection`, `data.mjs:202-270`).

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
  last-modified) but not their bodies.
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
- Once a document/PR-list query moves to event-driven invalidation, remove its
  `refetchInterval` — polling and SSE invalidation must not both apply to the same heavy
  query.

## Constraints

- No change to what `taskProjection`/`changeProjection` compute for `/api/dashboard` —
  this area only adds a narrower, faster read path alongside it; `/api/dashboard` itself
  is out of this area's scope unless removing now-redundant fields from it is trivial and
  requested during review.
- Must not change gate/status-transition semantics — this is a read-path change only.

## Interfaces and boundaries

- Exposes: the three routes above, consumed by `tools/dashboard/src/hooks/use-dashboard-data.ts`.
- Consumes: `tools/dashboard/server/data.mjs` (extended, not replaced), `watcher.mjs`
  (extended event payload).

## Area-specific acceptance criteria

- The PR-list route's response contains no `patch` or `fullDiff` field for any file.
- Requesting one task document does not read `overview.md` or any `areas/*.md` file
  from disk (verifiable via a spy/mock on the fs read function in a server test).
- The content and PR-list queries have no `refetchInterval` once event-driven
  invalidation is wired; task-status polling interval is a few seconds.
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
