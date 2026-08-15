---
id: dashboard-loading-and-progress.dashboard-data-loading-contracts
status: draft
change: dashboard-loading-and-progress
context:
  required:
    - specs/active/dashboard-loading-and-progress/overview.md
    - specs/active/dashboard-loading-and-progress/areas/dashboard-data-loading-contracts.md
    - specs/active/dashboard-loading-and-progress/owner-decisions.md
    - tools/dashboard/server/index.mjs
    - tools/dashboard/server/data.mjs
    - tools/dashboard/server/watcher.mjs
    - tools/dashboard/src/hooks/use-dashboard-data.ts
  optional:
    - tools/dashboard/server/providers/github.mjs
    - tools/dashboard/src/components/spec-detail.tsx
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/src/hooks/use-dashboard-data.ts
  - tools/dashboard/src/lib/types.ts
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs.mjs
  - tools/lib/github.mjs
semantic_references:
  decisions: [D3]
  constraints: [C1, C2]
---

# Task: Dashboard data-loading contracts

## Goal

Split `GET /api/specs/:source/:slug/pull-requests` and
`GET /api/specs/:source/:slug/content` into lightweight-first contracts, add
`GET /api/specs/:source/:slug/task-statuses`, remove the sync-fs/hot-path I/O in
`data.mjs`, and stop polling the (now heavy-content) queries on a fixed timer once
event-driven invalidation covers them.

## Implementation constraints

- Strip `patch`/`fullDiff` from the PR-list response entirely; do not call GitHub's
  files/patch or full-diff endpoints from the list route at all (that work belongs to
  task 02).
- `/content` becomes a manifest (document list + metadata, no bodies); add a new route
  for a single document's body, cached with no `refetchInterval` and effectively
  infinite staleness client-side.
- `/task-statuses` returns `{ revision, tasks: [{ id, status }] }` at minimum — per D3 in
  `owner-decisions.md`, add other per-task fields already available in
  `taskProjection`/`changeProjection` if they cost nothing extra to include.
- Replace `existsSync`/`readFileSync`/`readdirSync`/`statSync` in the code paths these
  three routes touch with `node:fs/promises` equivalents.
- Extend the `specs-changed` SSE payload with a `files` list (or equivalent) so a
  single-document cache entry can be invalidated without invalidating the whole
  manifest/content cache; keep the existing coarse behavior as a fallback if a change
  can't be attributed to specific files.
- Once invalidation is event-driven for content/PR-list, remove their
  `refetchInterval`; task-status polling keeps its own fast interval (a few seconds) —
  do not make task-status event-driven in this task (explicitly deferred, not required
  now, and the shape must not block adding it later).

## Acceptance criteria

1. PR-list response contains no `patch`/`fullDiff` field for any file, for any PR.
   `automated: npm --prefix tools/dashboard test`
2. Requesting a single task document does not trigger a read of `overview.md` or any
   `areas/*.md` file. `automated: npm --prefix tools/dashboard test`
3. `/task-statuses` returns a small payload with `revision` and per-task `status`.
   `automated: npm --prefix tools/dashboard test`
4. Content and PR-list hooks have no `refetchInterval`; task-status hook keeps a
   several-second interval. `inspection: confirm use-dashboard-data.ts hook options`
5. A change to one task file invalidates only that task's cached document client-side.
   `automated: npm --prefix tools/dashboard test`
6. No synchronous fs API is called from the manifest/content/task-status/PR-list route
   handlers. `inspection: grep for existsSync/readFileSync/readdirSync/statSync in the touched code paths`
7. Existing dashboard behavior outside these three routes (e.g. `/api/dashboard`) is
   unchanged. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- PR file manifest, batch diffs, `headSha` cache (task 02).
- Grouping/filtering (task 03).
- Operation progress (tasks 04-07).
