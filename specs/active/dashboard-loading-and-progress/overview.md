---
id: spec.dashboard-loading-and-progress
type: change
title: Dashboard data loading and long-running operation progress
status: draft
change: dashboard-loading-and-progress
---

# Dashboard data loading and long-running operation progress

## Context

The local specification dashboard (`tools/dashboard/server`, `tools/dashboard/src`)
currently over-fetches on almost every panel: the PR list, opening a single
specification document, and the general dashboard poll all pull far more data than the
first useful view needs, and several of those heavy payloads are also refetched on a
fixed timer regardless of whether anything changed. Separately, every long-running CLI
operation the dashboard triggers (gate checks, verification, acceptance, test runs,
audits) is represented to the user as a single boolean "executing" state, even though
the underlying work has multiple discrete steps. This change addresses both: it does not
change workflow semantics, gate rules, or status transitions (see Out of scope).

## Current architecture

- **PR list is heavy by default.** `getPullRequestDetails` (`tools/lib/github.mjs:156-174`)
  issues three `gh api` calls per PR — metadata, a paginated `files` listing that
  includes each file's full `patch`, and the entire raw diff (`Accept:
  application/vnd.github.diff`). `mapGitHubPullRequest`/`fileProjection`
  (`tools/dashboard/server/providers/github.mjs:22-73`) forward `files[].patch` and
  `fullDiff` to the browser as part of `GET /api/specs/:source/:slug/pull-requests`
  (`tools/dashboard/server/index.mjs:228-246`). The frontend's `usePullRequests`
  additionally sets `refetchInterval: 30_000` with `refetchIntervalInBackground: true`
  (`tools/dashboard/src/hooks/use-dashboard-data.ts:106-124`), so this full payload is
  re-fetched every 30s while the panel is mounted, even backgrounded.
- **A single markdown document open fetches the whole spec.** `loadSpecificationContent`
  (`tools/dashboard/server/data.mjs:134-200`) always reads `overview.md`, every file
  under `areas/`, and every task file, returning `{ overview, areas, tasks }` as one
  object from `GET /api/specs/:source/:slug/content`
  (`tools/dashboard/server/index.mjs:208-226`). `spec-detail.tsx:478-479` triggers this
  fetch even when only a single task document is selected. The handler chain uses
  synchronous fs APIs (`existsSync`/`readFileSync`/`readdirSync`/`statSync`, imported at
  `data.mjs:1`) directly inside the HTTP request path. `useSpecificationContent` also
  polls this endpoint every 30s (`use-dashboard-data.ts:83-86`) *in addition to* SSE-driven
  invalidation of the same query on any `specs-changed` event
  (`use-dashboard-data.ts:47-58`) — both mechanisms independently trigger the same
  full-bundle refetch.
- **The SSE watcher is coarse.** `createSpecEventHub` (`tools/dashboard/server/watcher.mjs:11-56`)
  emits a single `specs-changed` event type with no changed-file information (only
  `{ eventType }`, `watcher.mjs:21-35`) and no event IDs/replay — a client that
  disconnects has no way to recover a specific missed event, only the next signal or the
  next poll.
- **No lightweight task-status contract exists.** Task status is only available nested
  inside the full `/api/dashboard` payload (`taskProjection`,
  `tools/dashboard/server/data.mjs:202-270`).
- **Long operations report only a final result.** `executeSpecificationAction`
  (`tools/dashboard/server/actions.mjs:116-153`) runs `specs.mjs` via a **blocking**
  `execFileSync` and parses one final JSON blob from stdout
  (`parseReport`/`JSON.parse`, `actions.mjs:29-35`); `tools/specs.mjs` command handlers
  print one final `console.log(JSON.stringify(...))` and nothing during execution. The
  frontend exposes only `executing: mutation.isPending`
  (`use-dashboard-data.ts:181`) — a boolean, not steps.
- **A working precedent for structured, resumable progress already exists — for AI
  turns only.** `AiTurnSnapshot` (`tools/dashboard/src/lib/types.ts:279-290`) has
  `turnId`, `status`, `lastEventId`, and an `events[]` array; `ai-routes.mjs:190-224`
  serves a snapshot (`getTurn`) plus a resumable SSE stream (`subscribeToTurn`, with
  `afterSequence: snapshot.lastEventId`) and a cancel endpoint
  (`POST /turns/:id/cancel`, `ai-routes.mjs:180-183`). None of this is reused today for
  gate/verification/test/acceptance operations.
- **The GitHub provider already renames fields into a NEvo shape** (`filename`→`path`,
  `head`/`base`→`branchProjection`, etc. — `providers/github.mjs:38-73`) but still
  carries GitHub-scale content (full patch text, full raw diff) inside that shape, and
  `providers/service.mjs:14-42` already defines a generic `provider.load()` contract a
  second provider could implement later.
- **Changes UX has no grouping.** `PullRequestCard` in `changes-panel.tsx:227-237`
  renders `pullRequest.files` as a flat, unordered list; the only existing heuristic is
  `collapseFilesInitially = files.length > 50` (line 163), which only affects default
  open/closed state. No `.gitattributes`, no glob-matching library as a direct
  dependency (only transitively via `tools/dashboard/package-lock.json`), no generated/
  lockfile detection exists anywhere in the dashboard.

## Problem

Users wait on data they don't need yet (PR diffs before seeing the PR list, the whole
spec tree before reading one task), pay that cost again every 30 seconds even when
nothing changed, get no useful signal during multi-step verification/gate/test
operations beyond a spinner, and see PR changes as an unordered flat list regardless of
size or file kind.

## Constraints

- **C1.** Do not change gate rules, status transitions, or agent/CLI/workflow
  responsibility split — see Out of scope.
- **C2.** Internal, file-backed, single-consumer dev tool (`tools/dashboard`) — no
  external published API contract, so breaking existing dashboard routes in place is
  acceptable and is the owner's stated preference ("cut the currently too-wide
  endpoints") rather than maintaining parallel deprecated routes.
- **C3.** New external dependencies require owner approval (`AGENTS.md`); see D1 in
  `owner-decisions.md`.
- **C4.** Node 22.x runtime for `tools/dashboard/server` (`tools/dashboard/package.json`
  `engines.node`).

## Affected modules

- `tools/dashboard/server/*.mjs` (routes, data loading, watcher, actions, provider
  adapters).
- `tools/dashboard/src/*` (hooks, components — PR/changes panel, spec detail/markdown,
  status board, stage progress).
- `tools/lib/github.mjs` and `tools/dashboard/server/providers/*.mjs` (provider
  abstraction).
- `tools/specs.mjs` (and any other CLI command that runs a multi-step operation the
  dashboard triggers) — new structured step-event emission, no change to what each
  command decides or how it decides it.
- `tools/dashboard/package.json` (new `picomatch` dependency, per D1).

## Options and trade-offs

See `owner-decisions.md` D1 and D2 for the two decisions that required an explicit
option analysis (new dependency; operation-progress wiring scope). All other contracts
in this change were specified in enough detail by the owner's original request that no
further architecture-level option analysis was needed — see each area's "Current state"
for the evidence and each task's acceptance criteria for the resulting shape.

## Owner decisions

See `owner-decisions.md`: D1 (picomatch dependency), D2 (wire all listed operation kinds
in this change), D3 (field lists in new lightweight contracts are a floor, not a
ceiling — add cheaply-available useful fields).

## Proposed architecture

Apply one rule everywhere: **overview/manifest fast, heavy content lazy/progressive,
polling only for light/dynamic state, event-driven invalidation for heavy data where
possible.** Concretely:

1. **Split existing overly-wide endpoints** rather than adding parallel ones:
   `GET /api/specs/:source/:slug/pull-requests` returns lightweight PR metadata only;
   `GET /api/specs/:source/:slug/content` becomes a document manifest, with a new
   per-document `GET .../content/:doc` route for actual markdown bytes. A new
   `GET /api/specs/:source/:slug/task-statuses` gives a small, fast-pollable payload
   (`revision` + per-task `status`, plus any other cheaply-available per-task field per
   D3).
2. **PR files and diffs become their own resources**, fetched only once a PR is opened
   (`GET .../pull-requests/:number/files` — manifest, no patch) and progressively
   hydrated in batches (`POST .../pull-requests/:number/file-diffs`), cached by
   `(provider, repository, number, headSha, path)` so re-opening the same PR at the same
   `headSha` costs nothing. Full raw diff moves to its own on-demand route
   (`GET .../pull-requests/:number/diff`).
3. **Markdown/PR content stop being polled on a timer.** Content queries move to
   effectively-infinite staleness with invalidation driven by the SSE watcher, which
   gains a granular `files` list per event so only the affected document's cache entry
   is invalidated (`{ slug, files: ["tasks/14.md"] }`) instead of the whole bundle.
   Task-status polling stays fast (a few seconds) since its payload is intentionally
   small.
4. **Changes UX becomes configurable and grouped.** A per-project `changeView.groups`
   config (path-glob rules, first-match-wins, `picomatch` per D1) drives Area/Directory/
   Flat grouping; a separate `generatedFiles` config drives a "hide generated" filter
   (lockfiles kept distinct from generated) that also suppresses background diff
   hydration for hidden files until explicitly opened.
5. **Long operations get a shared `Operation`/`Steps` contract**, sourced from the
   CLI/workflow layer (never inferred by the dashboard from stdout timing), transported
   over a resumable per-operation SSE stream mirroring the existing AI-turn pattern
   (snapshot + `afterSequence` resume) so a client that reconnects recovers current
   state and never loses a final status. `tools/dashboard/server/actions.mjs` moves from
   blocking `execFileSync` to `spawn` so step events can stream as they happen; a
   `spawn`-based child process also makes cancellation (`POST /operations/:id/cancel`)
   cheap to implement now rather than deferring the model.

## Compatibility and migration

Breaking changes to `tools/dashboard`'s own HTTP contract are in scope and expected
(splitting `/pull-requests` and `/content`); this is an internal, co-deployed
frontend+backend with no other consumer. `tools/specs.mjs`'s existing CLI output/exit
codes are unchanged — step-event emission is additive stdout, not a replacement of the
final JSON result line consumed by `actions.mjs` today.

## Areas

- `areas/dashboard-data-loading-contracts.md` — PR-list/markdown/task-status route
  splitting, sync-fs removal on the hot path, polling-vs-SSE overlap removal.
- `areas/pull-request-file-and-diff-loading.md` — file manifest, batch diff hydration,
  `headSha`-aware cache, priority queue, full-diff-on-demand, provider abstraction
  extension.
- `areas/changes-grouping-and-filtering.md` — configurable grouping, group-by modes,
  generated/lockfile detection, hydration-respects-filters.
- `areas/operation-progress-contract.md` — shared Operation/Steps model, SSE transport,
  `actions.mjs` execution model change, CLI step-event instrumentation across every
  listed operation kind.
- `areas/dashboard-operation-progress-ui.md` — rendering steps/progress/failure
  consistently across every wired operation kind.

## Change-wide acceptance criteria

- Several PRs' list renders without waiting for any PR's files or diffs.
  `inspection: network trace shows /pull-requests responding before any files/diffs request`
- Opening one PR does not fetch another PR's files or diffs.
- A PR's file list renders before its files' diffs are loaded.
- Opening a file whose diff has not loaded yet jumps ahead of background hydration.
- Re-opening the same PR at the same `headSha` serves diffs from cache, no refetch.
- A new `headSha` invalidates exactly that PR's diff cache, not other PRs'.
- Hidden generated files are not preloaded by background hydration.
- Opening one markdown document does not fetch the rest of the spec's documents.
- Heavy PR/diff/markdown payloads are not refetched on a fixed timer.
- Task statuses continue to refresh on a fast interval.
- A multi-step verification/gate/acceptance run shows steps completing in near
  real time, sourced from the CLI/workflow layer, not reconstructed from stdout timing.
- A failing step is visible as that step's failure and the operation's failure.
- A client that briefly disconnects during an active operation recovers current state
  on reconnect and does not miss the final status.

## Verification strategy

`npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
`node --test tools/tests/*.test.mjs` (for `tools/specs.mjs` step-emission changes),
`node tools/specs.mjs validate`, plus per-task inspection criteria for the request-count
and cache-behavior acceptance criteria above (browser network trace / test assertions on
mock fetch call counts — no new performance-measurement framework).

## ADR impact

Recommend a new ADR once task 04 (`operation-progress-contract-and-transport`) lands,
documenting the generalized Operation/Steps + resumable-SSE pattern (extracted from the
AI-turn precedent) as the standard shape for any future long-running dashboard
operation — this is a durable pattern future changes should reuse rather than
reinventing per feature. Authorship/timing is the owner's call, not decided in this
spec; task 04 records the recommendation in its own "Documentation impact" section.

## Out of scope

- Fingerprint normalization (LF/CRLF), gate rule changes, new status transitions.
- Agent/CLI/workflow instruction or responsibility rewrites.
- Knowledge-layer hardening.
- Publicly exposing the dashboard, authentication.
- Task-to-file provenance (a file stays unattributed to any single task).
- A full dashboard rewrite.
- AI-based file classification (grouping/generated-detection stays deterministic,
  config-driven).
