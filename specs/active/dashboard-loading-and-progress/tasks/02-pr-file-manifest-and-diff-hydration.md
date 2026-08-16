---
id: dashboard-loading-and-progress.pr-file-manifest-and-diff-hydration
status: draft
change: dashboard-loading-and-progress
depends_on: [dashboard-data-loading-contracts]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/pull-request-file-and-diff-loading.md
    - specs/active/dashboard-loading-and-progress/owner-decisions.md
    - tools/dashboard/server/providers/github.mjs
    - tools/dashboard/server/providers/service.mjs
    - tools/lib/github.mjs
    - tools/dashboard/server/index.mjs
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/components/changes-panel.tsx
  optional:
    - tools/dashboard/src/lib/types.ts
allowed_paths:
  - tools/dashboard/server/**
  - tools/lib/github.mjs
  - tools/dashboard/src/hooks/use-dashboard-data.ts
  - tools/dashboard/src/components/changes-panel.tsx
  - tools/dashboard/src/lib/types.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs.mjs
semantic_references:
  decisions: [D3, D5]
  constraints: [C2]
  dependency_contracts: [dashboard-data-loading-contracts]
---

# Task: PR file manifest and diff hydration

## Goal

Add a files-manifest route, a batch file-diff route, `headSha`-aware diff caching, and
priority-aware background hydration in the frontend, plus a separate on-demand full-diff
route — behind a provider abstraction exposing `load()`, `loadFiles()`,
`loadFileDiffs(paths, headSha)`, `loadFullDiff()`.

## Dependencies

Depends on task 01 — the PR-list route must already be lightweight-only before layering
file/diff loading on top of it.

## Implementation constraints

- Files-manifest route returns no `patch` field for any file.
- Batch diff route accepts `{ paths: [...] }`, default batch size ~10-20 (configurable,
  not a fixed contract detail).
- Diff cache key: `(provider, repository, pullRequestNumber, headSha, path)`.
- Frontend hydration priority: `load(request)` means "I need this now" (explicit user
  open, deduped by React Query against any concurrent preload); `preload(requests)` means
  "fetch these in the background" (re-runs when the visible set changes; React Query
  deduplicates in-flight and cached items automatically). The `useBatchQueries` primitive
  + `@yornaath/batshit` handle batching window and transport; the component never manages
  `inFlight`, `batchSize`, or fetch ordering directly.
- `providers/github.mjs`/`tools/lib/github.mjs` gain the four semantic operations;
  `providers/service.mjs`'s existing `provider.load()` registry pattern is extended,
  not replaced, so a future non-GitHub provider can implement the same shape.
- `getPullRequestFiles()`'s GitHub adapter must not force-download full `patch` content
  from upstream merely to build the manifest — do not simply reuse the existing REST
  `files` call (`tools/lib/github.mjs:156-174`, which always includes `patch`) and
  discard the field server-side; fetch the files listing through a surface that avoids
  patch expansion (e.g. GitHub's GraphQL `PullRequest.files`), exact surface is an
  implementation detail.
- Background batch diff requests must not re-fetch the PR's entire upstream files/diff
  payload per batch — upstream cost scales with the requested paths (or reuses
  whatever the manifest fetch already cached), not with the PR's total file count
  repeated on every batch.
- Per D3 in `owner-decisions.md`, include any additional cheaply-available manifest
  field from the existing GitHub files listing if useful.

## Acceptance criteria

1. Files-manifest response has no `patch` field. `automated: npm --prefix tools/dashboard test`
2. Two sequential opens of the same PR at the same `headSha` produce zero repeated diff
   fetches for already-cached paths. `automated: npm --prefix tools/dashboard test`
3. A `headSha` change invalidates that PR's cached diffs, not another PR's.
   `automated: npm --prefix tools/dashboard test`
4. A user-opened file's diff is requested via `load(request)`, which is deduped by React
   Query against any concurrent `preload()` — a file already in-flight or cached does
   not produce a second fetch. `automated: npm --prefix tools/dashboard test`
5. `GET .../pull-requests/:number/diff` is never called as a side effect of listing PRs
   or fetching the files manifest. `automated: npm --prefix tools/dashboard test`
6. The provider adapter's public surface is `load`/`loadFiles`/`loadFileDiffs`/`loadFullDiff`
   (backed by `getPullRequestMetadata`/`getPullRequestFiles`/`getPullRequestFilesWithPatches`/`getFullDiff`
   in `tools/lib/github.mjs`) — callers do not depend on whether GitHub returned a
   patch alongside metadata. `inspection: confirm provider module's exported surface`
7. `getPullRequestFiles()`'s upstream GitHub call does not request/return `patch`
   content. `inspection: confirm the upstream request surface used (e.g. GraphQL query
   shape, or REST call arguments) excludes patch expansion`
8. A background batch diff request's upstream cost is bounded by the server-side cache:
   the GitHub adapter fetches the full REST files+patch list exactly once per
   `(provider, repository, pullRequestNumber, headSha)` and serves all subsequent
   batch requests from that in-memory cache. The per-batch upstream cost therefore does
   not scale with repeated batches — only the first batch for a given PR version pays
   the upstream REST cost. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Grouping/filtering, generated-file detection (task 03).
- Operation progress (tasks 04-07).
