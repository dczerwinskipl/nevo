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
  - tools/dashboard/server/actions.mjs
semantic_references:
  decisions: [D3, D5]
  constraints: [C1, C2]
---

# Task: Dashboard data-loading contracts

## Goal

Split `GET /api/specs/:source/:slug/pull-requests` and
`GET /api/specs/:source/:slug/content` into lightweight-first contracts, add
`GET /api/specs/:source/:slug/task-statuses`, remove the sync-fs/hot-path I/O in
`data.mjs`, and stop polling the (now heavy-content) queries — including
`/api/dashboard` itself, whose small response hides real per-poll backend I/O across
every change — on a fixed short timer once event-driven invalidation covers them.

## Implementation constraints

- Strip `patch`/`fullDiff` from the PR-list response entirely; do not call GitHub's
  files/patch or full-diff endpoints from the list route at all (that work belongs to
  task 02).
- `/content` becomes a manifest (document list + metadata, no bodies); add a new route
  for a single document's body, cached with no `refetchInterval` and effectively
  infinite staleness client-side. Do not implement the manifest by reading every
  document's full body on each request merely to extract its title — cache the title
  server-side (invalidated by the same granular per-file SSE events below) or derive it
  without a full-file read.
- `/task-statuses` returns `{ revision, tasks: [{ id, status }] }` at minimum — per D3 in
  `owner-decisions.md`, add other per-task fields already available in
  `taskProjection`/`changeProjection` if they cost nothing extra to include.
- Replace `existsSync`/`readFileSync`/`readdirSync`/`statSync` in the code paths these
  three routes touch with `node:fs/promises` equivalents.
- Extend the `specs-changed` SSE payload with a `files` list (or equivalent) so a
  single-document cache entry can be invalidated without invalidating the whole
  manifest/content cache; keep the existing coarse behavior as a fallback if a change
  can't be attributed to specific files.
- Once invalidation is event-driven for the **content** query specifically, remove its
  `refetchInterval`; task-status polling keeps its own fast interval (a few seconds) —
  do not make task-status event-driven in this task (explicitly deferred, not required
  now, and the shape must not block adding it later).
- **PR-list is not part of the content/`specs-changed` fix (owner correction,
  2026-08-15) — it needs its own mechanism.** A `git push` to an open PR changes
  `headSha` on GitHub without touching any file `specs-changed` watches, so PR-list
  cannot rely on that SSE signal at all. Requirement: PR-list uses initial fetch +
  refetch-on-window-focus + an explicit user-triggered refresh, plus an optional slow
  safety-refresh interval (well above the removed 30s — minutes, not seconds) as a
  backstop. This still removes the old tight 30s poll; it does not replace it with
  `specs-changed` reliance the way content did.
- `/api/dashboard`'s own `useDashboardData` poll moves from a 30s `refetchInterval` to
  an initial fetch plus SSE-driven invalidation on `specs-changed`, with a much longer
  safety-refresh interval (minutes) as a backstop — same fix as **content**'s (not
  PR-list's — see above), applied to this one remaining fixed-interval heavy-backend
  poll. `specs-changed` is a real signal here since `/api/dashboard` reads from
  `specs/active/`/`specs/archive/`, unlike PR-list's GitHub-sourced data. Do not change
  what `loadDashboardData`/`taskProjection`/`changeProjection` compute — only when/why
  the request fires.

## Acceptance criteria

1. PR-list response contains no `patch`/`fullDiff` field for any file, for any PR.
   `automated: npm --prefix tools/dashboard test`
2. Requesting a single task document does not trigger a read of `overview.md` or any
   `areas/*.md` file. `automated: npm --prefix tools/dashboard test`
3. A second manifest request for the same spec, with no file changes in between, does
   not re-read every document's full body to recompute titles (e.g. verified via a
   read-call-count assertion, or by confirming a cache hit).
   `automated: npm --prefix tools/dashboard test`
4. `/task-statuses` returns a small payload with `revision` and per-task `status`.
   `automated: npm --prefix tools/dashboard test`
5. The content hook has no `refetchInterval`; task-status hook keeps a several-second
   interval; `useDashboardData` has no 30s `refetchInterval` (a much longer
   safety-refresh interval, or none, plus SSE invalidation, is acceptable). The PR-list
   hook refetches on window focus and explicit user request (not `specs-changed`), and
   any interval it keeps is well above the old 30s.
   `inspection: confirm use-dashboard-data.ts hook options`
6. Simulating a new `headSha` on GitHub (without any local `specs/` file change)
   eventually results in the PR-list query reflecting it — verified via focus-refetch
   or explicit-refresh, not via `specs-changed`. `automated: npm --prefix tools/dashboard test`
7. A change to one task file invalidates only that task's cached document client-side.
   `automated: npm --prefix tools/dashboard test`
8. No synchronous fs API is called from the manifest/content/task-status/PR-list route
   handlers. `inspection: grep for existsSync/readFileSync/readdirSync/statSync in the touched code paths`
9. `/api/dashboard`'s computed response content (`taskProjection`/`changeProjection`
   fields) is unchanged — only its fetch/polling behavior changes, per criterion 5.
   `automated: npm --prefix tools/dashboard test`

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
