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
- **No lightweight task-status contract exists, and `/api/dashboard` itself is not
  actually cheap despite a small response body.** Task status is only available nested
  inside the full `/api/dashboard` payload (`taskProjection`,
  `tools/dashboard/server/data.mjs:202-270`), computed by `loadDashboardData`
  (`data.mjs:279-295`), which iterates every change under both `specs/active/` and
  `specs/archive/` and reads their task files from disk on every call. `useDashboardData`
  polls this route every 30s including in the background
  (`use-dashboard-data.ts:38-45`). The response payload itself is small (no markdown
  bodies, no diffs), but the *backend* work to produce it is not — full-tree disk I/O
  across every change, every 30 seconds, regardless of whether anything changed. This
  is exactly the "polling data that barely changes" problem this change's own stated
  target model exists to remove, and it must not be left out of scope just because its
  response is byte-light.
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
- `tools/lib/operation-progress.mjs` (new) — the shared step-emission helper, consumed
  by both `tools/dashboard/server` and `tools/specs.mjs`/CLI command code; lives outside
  either side's own module tree so the dependency direction stays downward-only from
  both.
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
ceiling — add cheaply-available useful fields), D4 (`GET /actions` must never run a
heavy check; `finalize` gets multi-step instrumentation), D5 (PR-list metadata refresh
must not rely on `specs-changed` SSE), D6 (cancellation removed from this change's
scope), D7 (tasks 05/06 must not be implemented in parallel), D8 (tasks 01/04 must not
be implemented in parallel), D9 (CLI progress vocabulary vs. Dashboard Operation API
scope boundary — dashboard only tracks operations it starts itself), D10 (task 07's UI
acceptance criteria must use real dashboard actions only, not CLI-only kinds).

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
3. **Markdown content and `/api/dashboard` stop being polled on a fixed timer — PR-list
   metadata needs a different mechanism, not the same one (owner correction,
   2026-08-15).** Content queries move to effectively-infinite staleness with
   invalidation driven by the SSE watcher, which gains a granular `files` list per event
   so only the affected document's cache entry is invalidated
   (`{ slug, files: ["tasks/14.md"] }`) instead of the whole bundle. `/api/dashboard`
   (change/task overview list) moves from an unconditional 30s poll to an initial fetch
   plus the same `specs-changed`-driven invalidation, with a much longer safety-refresh
   interval (minutes, not seconds) as a backstop — not a full endpoint rewrite, just the
   same polling-vs-event-driven fix, extended to this one remaining heavy-backend,
   fixed-interval poll; both read from `specs/active/`/`specs/archive/`, which
   `specs-changed` genuinely watches. **PR-list metadata cannot use `specs-changed`** —
   a `git push` to an open PR changes GitHub's `headSha` without touching any file
   `specs-changed` observes — so it uses initial fetch + refetch-on-focus + explicit
   refresh + an optional slow safety interval instead, still removing the old tight 30s
   poll without silently going stale the way relying on `specs-changed` would.
   Task-status polling stays fast (a few seconds) since its payload and its backend cost
   are both intentionally small.
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
   blocking `execFileSync` to `spawn` so step events can stream as they happen.
   Cancellation is explicitly out of scope for this change (owner correction,
   2026-08-15): a CLI command's own child processes — e.g. `dotnet test` under
   `handleSelfCheck` — are not guaranteed to terminate just because the top-level
   `spawn`ed process is killed, so this is not the "cheap because we moved to spawn"
   win it first looked like. The contract (`operationId`, `Operation`/`Step` shape)
   stays generic enough to add real cancellation later without a breaking change.
   **The Dashboard Operation API (`operationId`/snapshot/SSE) covers only operations the
   dashboard itself starts (owner correction, 2026-08-15; see D9 in
   `owner-decisions.md`)** — the CLI-side step vocabulary is a separate, neutral
   concern from the dashboard's own tracked-resource layer built on top of it:

   ```text
   user clicks dashboard action
           ↓
   POST dashboard action
           ↓
   backend creates operationId
           ↓
   backend spawns CLI command
           ↓
   CLI emits structured progress to stdout
           ↓
   dashboard backend parses it
           ↓
   operation snapshot + SSE
           ↓
   UI renders progress
   ```

   Every multi-step CLI command (`finalize`, the `verify`/`approve` gate re-check,
   `self-check`, `batch-review`, `audit`) emits the same shared `operation.*` stdout
   vocabulary regardless of how it was invoked — this is what gives `finalize`, `verify`,
   `self-check`, `batch-review`, and `audit` consistent, machine-readable output whether
   the dashboard triggered them or an agent/user ran them directly from the CLI. But if
   an agent or user independently runs, say, `node tools/specs.mjs self-check ...`, the
   dashboard does not discover that process, does not register it, does not attach to
   it, does not mint an `operationId` for it, and does not relay its progress through the
   dashboard SSE stream — external/agent-started CLI process discovery is explicitly out
   of scope (see Out of scope). See § "Responsibility boundaries" below for the full
   CLI/backend/frontend split.

## Responsibility boundaries (CLI vs. dashboard backend vs. frontend)

- **CLI/tools** owns the semantic progress vocabulary and emits it. Every multi-step CLI
  command emits structured `operation.*` step events to stdout via the neutral
  `tools/lib/operation-progress.mjs` helper, regardless of how it was invoked. The
  emitted events carry no dashboard `operationId` — the CLI has no notion of one.
- **Dashboard backend** owns `operationId`, the `Operation` snapshot, and the SSE
  transport — but only for processes it spawns itself via `actions.mjs`. It mints
  `operationId` at spawn time, reads that spawned child's stdout, and translates the
  parsed `operation.*` events into the persisted `Operation`/`Step` snapshot it serves.
- **Frontend** only displays `Operation` state received from the dashboard backend's
  snapshot/SSE routes. It never parses raw CLI stdout directly, and never discovers or
  observes an externally-started CLI process.

Raw stdout/logs may still be surfaced as diagnostic "details" text where convenient, but
they are never the frontend's source of truth for step/operation semantics outside the
dashboard backend's own parser.

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
- `areas/operation-progress-contract.md` — shared CLI progress vocabulary (every
  multi-step command, regardless of trigger source), plus the dashboard-only
  Operation/Steps snapshot, SSE transport, and `actions.mjs` execution model change for
  operations the dashboard itself starts.
- `areas/dashboard-operation-progress-ui.md` — rendering steps/progress/failure
  consistently for every operation kind actually reachable as a dashboard action.

## Change-wide acceptance criteria

- Several PRs' list renders without waiting for any PR's files or diffs.
  `inspection: network trace shows /pull-requests responding before any files/diffs request`
- Opening one PR does not fetch another PR's files or diffs.
- A PR's file list renders before its files' diffs are loaded.
- Opening a file whose diff has not loaded yet jumps ahead of background hydration.
- Re-opening the same PR at the same `headSha` serves diffs from cache, no refetch.
- A new `headSha` invalidates exactly that PR's diff cache, not other PRs'.
- A new push to an open PR (a `headSha` change with no local `specs/` file change)
  eventually reaches the frontend via focus-refetch/explicit refresh — not by relying
  on the `specs-changed` SSE watcher, which cannot observe it.
- Hidden generated files are not preloaded by background hydration.
- Opening one markdown document does not fetch the rest of the spec's documents.
- Heavy PR/diff/markdown payloads are not refetched on a fixed timer.
- `/api/dashboard`'s own fixed 30s poll is gone, replaced by an initial fetch plus
  SSE-driven invalidation (and, at most, a much longer safety-refresh interval).
- Task statuses continue to refresh on a fast interval.
- Triggering a POST-based action (verify/approve/finalize/instrumented run) returns an
  `operationId` before the action completes — never only after.
- The `GET` gate-probe used purely to compute button-enabled state never gains an
  `operationId`, steps, or an SSE stream.
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
- Dashboard discovery, registration, or SSE relay of a CLI process the dashboard did not
  itself spawn (e.g. an agent or user running `node tools/specs.mjs self-check ...` or
  `batch-review ...` directly) — no IPC, global operation bus, or CLI→dashboard callback
  API is added by this change (owner correction, 2026-08-15; see D9 in
  `owner-decisions.md`).
