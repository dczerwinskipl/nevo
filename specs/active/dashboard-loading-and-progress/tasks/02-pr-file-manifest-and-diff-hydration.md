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
  decisions: [D3]
  constraints: [C2]
  dependency_contracts: [dashboard-data-loading-contracts]
---

# Task: PR file manifest and diff hydration

## Goal

Add a files-manifest route, a batch file-diff route, `headSha`-aware diff caching, and
priority-aware background hydration in the frontend, plus a separate on-demand full-diff
route — behind a provider abstraction exposing `getPullRequests()`,
`getPullRequestFiles()`, `getFileDiffs(paths)`, `getFullDiff()`.

## Dependencies

Depends on task 01 — the PR-list route must already be lightweight-only before layering
file/diff loading on top of it.

## Implementation constraints

- Files-manifest route returns no `patch` field for any file.
- Batch diff route accepts `{ paths: [...] }`, default batch size ~10-20 (configurable,
  not a fixed contract detail).
- Diff cache key: `(provider, repository, pullRequestNumber, headSha, path)`.
- Frontend hydration queue priority: (1) just-expanded file, (2) currently visible
  group, (3) PR's first N files, (4) remaining background batches; an explicit user
  open jumps ahead of queued background work.
- `providers/github.mjs`/`tools/lib/github.mjs` gain the four semantic operations;
  `providers/service.mjs`'s existing `provider.load()` registry pattern is extended,
  not replaced, so a future non-GitHub provider can implement the same shape.
- Per D3 in `owner-decisions.md`, include any additional cheaply-available manifest
  field from the existing GitHub files listing if useful.

## Acceptance criteria

1. Files-manifest response has no `patch` field. `automated: npm --prefix tools/dashboard test`
2. Two sequential opens of the same PR at the same `headSha` produce zero repeated diff
   fetches for already-cached paths. `automated: npm --prefix tools/dashboard test`
3. A `headSha` change invalidates that PR's cached diffs, not another PR's.
   `automated: npm --prefix tools/dashboard test`
4. A user-opened file's diff request is issued ahead of any still-queued background
   hydration batch. `automated: npm --prefix tools/dashboard test`
5. `GET .../pull-requests/:number/diff` is never called as a side effect of listing PRs
   or fetching the files manifest. `automated: npm --prefix tools/dashboard test`
6. The provider adapter's public surface is `getPullRequests`/`getPullRequestFiles`/
   `getFileDiffs`/`getFullDiff` — callers do not depend on whether GitHub returned a
   patch alongside metadata. `inspection: confirm provider module's exported surface`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Grouping/filtering, generated-file detection (task 03).
- Operation progress (tasks 04-07).
