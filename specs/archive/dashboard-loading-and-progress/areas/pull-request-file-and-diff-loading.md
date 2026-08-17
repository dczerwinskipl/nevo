# Area: Pull request file manifest and diff loading

## Responsibility

Give the Changes panel a lightweight file manifest per PR, then progressively and
priority-aware hydrate diffs in batches, cached by PR version (`headSha`), with full raw
diff available only on demand. Extends the provider abstraction so the dashboard never
depends on GitHub's raw response shape.

## Current state

- `providers/github.mjs`'s `fileProjection` (lines 22-36) already includes each file's
  `patch` and NEvo-shaped metadata (`path`, `previousPath`, `additions`, `deletions`,
  `status`, `rawUrl`, `blobUrl`); `mapGitHubPullRequest` (lines 38-73) bundles this and
  `fullDiff` into the single PR object returned by `/pull-requests`, described in
  `dashboard-data-loading-contracts.md`.
- `providers/service.mjs:14-42` defines a generic `provider.load(root, reference)`
  contract already usable by a future non-GitHub provider.
- `changes-panel.tsx`'s `FileChange` (lines 98-159) toggles `<DiffView>` mounting on
  local `open` state (`{open && (...)}`, line 122); no per-file fetch exists today
  because all patches already arrived in the single PR payload. This confirms collapse/
  expand is a pure render toggle, not something this area needs to change — the data
  layer is the actual target.
- No cache keyed by `headSha` exists; the whole PR payload (files + diffs) is refetched
  wholesale on every 30s poll regardless of whether the PR changed.

## Requirements

- `GET .../pull-requests/:number/files` returns a manifest only: path, change type,
  additions, deletions, rename info where applicable, classification metadata (whatever
  is cheaply available from the existing GitHub files listing) — no `patch` field.
- `POST .../pull-requests/:number/file-diffs` accepts `{ paths: [...] }` and returns
  diffs for exactly those paths, batched (default ~10-20 paths per request; the size is
  a config/default, not a fixed contract).
- Diff cache identity is `(provider, repository, pullRequestNumber, headSha, path)`.
  Re-opening the same PR at the same `headSha` must not refetch already-cached diffs. A
  new `headSha` naturally creates a new cache entry (old entries may be evicted/left to
  expire — no requirement to explicitly purge them in this change). This cache's
  correctness depends on the frontend actually learning about a new `headSha` in the
  first place — that discovery happens through the PR-list metadata refresh mechanism
  in `dashboard-data-loading-contracts.md` (focus-refetch/explicit refresh, not
  `specs-changed` SSE, per that area's owner correction), not through anything in this
  area.
- Frontend background hydration fetches diffs in batches without blocking user
  interaction; priority order: (1) the file the user just expanded, (2) currently
  visible/active group, (3) the PR's first N files, (4) remaining background batches. A
  user expanding a not-yet-hydrated file jumps its request ahead of queued background
  batches.
- `GET .../pull-requests/:number/diff` (full raw diff) is a separate, on-demand-only
  route — never fetched as a side effect of listing PRs or opening the files manifest.
- Provider abstraction exposes `getPullRequests()`, `getPullRequestFiles()`,
  `getFileDiffs(paths)`, `getFullDiff()` as semantically distinct operations; the
  GitHub adapter may internally batch/cache/reuse data from a single upstream call, but
  callers must not need to know whether GitHub happened to return a patch alongside
  metadata.
- The BE→FE payload trim (no `patch` in the manifest response) is necessary but not
  sufficient — the upstream GitHub→BE leg must not be forced to download full patch
  content merely to produce the manifest. The existing REST `files` listing
  (`tools/lib/github.mjs:156-174`) always includes `patch`; `getPullRequestFiles()`'s
  GitHub adapter must not simply reuse that call and discard the patch server-side —
  it should fetch the files listing through a surface that doesn't force patch
  expansion (e.g. GitHub's GraphQL `PullRequest.files` connection, requesting only
  `path`/`changeType`/`additions`/`deletions`, is one such surface; the exact API
  surface is an implementation detail, the "don't force-download the heavy field"
  requirement is not).
- Background diff-hydration batches (`getFileDiffs(paths)`) must not, as a side effect,
  re-fetch the *entire* upstream files/diff payload for the PR on every batch — each
  batch's upstream cost should scale with the paths actually requested (or with
  whatever the adapter's own upstream cache already holds from the manifest fetch), not
  with the PR's total file count repeated per batch.
- Per D3 in `owner-decisions.md`: if the existing GitHub files listing already includes
  a field beyond the ones named above (e.g. a `sha` per blob) that's useful and free,
  include it in the manifest.

## Constraints

- Batch size is configurable with a sane default; do not hardcode it as an unchangeable
  contract detail in the route shape.
- No AI-based classification of files (deterministic metadata only — grouping semantics
  belong to `changes-grouping-and-filtering.md`, not this area).

## Interfaces and boundaries

- Exposes: files-manifest, batch-diff, full-diff routes to the frontend.
- Consumes: the GitHub provider adapter (`tools/lib/github.mjs`,
  `providers/github.mjs`), extended with the four semantic operations above;
  `providers/service.mjs`'s existing `provider.load()` registry pattern.

## Area-specific acceptance criteria

- The files-manifest response contains no `patch` field for any file.
- A background hydration batch request never includes a path the user has not yet
  triggered directly or indirectly (visible group) ahead of an explicit user-open
  request still pending.
- Two sequential opens of the same PR at the same `headSha` result in zero repeated
  diff-fetch network calls for already-cached paths (verifiable via mock fetch call
  count in a frontend test).
- Simulating a `headSha` change invalidates that PR's diff cache entries and not another
  PR's.
- `GET .../pull-requests/:number/diff` is never called by the files-manifest or PR-list
  flows (verifiable via server route test / network trace).

## Dependencies

Depends on `dashboard-data-loading-contracts.md` (the PR-list route must already be
lightweight-only before file/diff loading is layered on top of it).

## Out of scope

- Grouping/filtering of the file manifest (next area).
- Generated-file/lockfile detection.
