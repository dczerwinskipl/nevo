# Area: Operation progress contract

## Responsibility

Define one shared `Operation`/`Steps` model and transport for every long-running
CLI-triggered operation the dashboard exposes, sourced from the CLI/workflow layer
(never inferred by the dashboard from stdout timing), and instrument every listed
operation kind to emit it (per D2 in `owner-decisions.md`: full wiring in this change,
not a single reference operation). Does not include the frontend rendering of this data
(`dashboard-operation-progress-ui.md`) or any change to gate/verification/acceptance
semantics themselves.

## Current state

- `executeSpecificationAction` (`tools/dashboard/server/actions.mjs:116-153`) runs
  `specs.mjs` via a **blocking** `execFileSync` (`defaultSpecsRunner`, lines 21-27) and
  parses one final JSON blob from captured stdout (`parseReport`, lines 29-35) — no
  intermediate output is streamed.
- `tools/specs.mjs` command handlers print one final
  `console.log(JSON.stringify(...))` (e.g. lines 185, 191, 245, 272) with no
  intermediate/structured progress markers during execution.
- `stage-progress.tsx` is unrelated to in-flight operation progress — it's a static bar
  of task *counts per lifecycle stage*, not a live operation view.
- A working, resumable per-operation pattern already exists for AI turns:
  `AiTurnSnapshot` (`tools/dashboard/src/lib/types.ts:279-290`: `turnId`, `status`,
  `lastEventId`, `events[]`), served via `getTurn` (snapshot) + `subscribeToTurn`
  (resumable SSE with `afterSequence`) + `POST /turns/:id/cancel`
  (`tools/dashboard/server/ai-routes.mjs:180-224`). This area generalizes the
  snapshot+resumable-stream shape (not the cancel endpoint — see Requirements below) —
  no event-sourcing system, just that shape applied to a generic `Operation`.
- The global `specs-changed` SSE hub (`watcher.mjs`) has no event IDs/replay and is
  unrelated to per-operation progress; it must not be reused/overloaded for this
  purpose — operations get their own scoped stream so per-operation resume/backfill
  works (the global hub's "refetch everything on any signal" model cannot express
  step-level state).

## Requirements

- **Two distinct things share this area, and must stay separate (D9 in
  `owner-decisions.md`):** the CLI-side structured progress *vocabulary* (emitted by
  every multi-step CLI command, regardless of who invoked it) and the dashboard-only
  `Operation` *resource* (`operationId`, snapshot, SSE — created only for processes the
  dashboard backend itself spawns). The shape below describes both: the vocabulary is
  what a CLI command emits to stdout; the `Operation`/`Step` shape is what the dashboard
  backend builds from parsing that vocabulary for a process it spawned. A CLI command
  run directly (self-check, batch-review, audit, or `finalize` run from a terminal) still
  emits the same vocabulary — useful directly to an agent/user — but no `Operation`
  resource, `operationId`, snapshot, or SSE stream is ever created for it, and the
  dashboard has no mechanism to discover or attach to such a process. No IPC, global
  operation bus, or CLI→dashboard callback API is added.
- Shared contract: an `Operation` has an `id`, a `type` (e.g. `task-verification`,
  `gate-check`), and `steps[]`; each step has `id`, `label`, `status`
  (`pending`/`running`/`completed`/`failed`), and optionally numeric progress
  (`current`/`total`). Event vocabulary: `operation.started`,
  `operation.step.started`, `operation.step.progress`, `operation.step.completed`,
  `operation.step.failed`, `operation.completed`, `operation.failed` (names may adapt to
  existing repo conventions; semantics must match). The events a CLI command emits to
  stdout carry no `operationId` field — that id is minted and owned solely by the
  dashboard backend when it spawns the process; the CLI has no notion of one.
- **Starting an operation is a distinct step from streaming it.** The endpoint that
  triggers a POST-based action (verify/approve/finalize/any instrumented CLI run) must
  return an `operationId` immediately — before the underlying work finishes — mirroring
  the existing AI-turn precedent exactly (`ai-routes.mjs`'s start-turn returns `turnId`
  before streaming begins; see task 05 of `ai-sessions-live-chat-integration` for the
  same rule applied to that endpoint). Today's `executeSpecificationAction`
  (`actions.mjs:116-153`) blocks and only returns once the whole action is done — this
  changes here: the trigger response is `{ operationId }` (an HTTP 202-style "accepted,
  in progress" shape, exact status code an implementation detail), and the operation's
  actual result (success/failure/step detail) is read from the snapshot/SSE routes
  below, never from the trigger response body itself.
- **Only explicitly user-triggered, POST-based actions become an `Operation`, and
  `GET /api/specs/active/:slug/actions` must never run a heavy check synchronously
  (owner correction, 2026-08-15).** The existing `GET` read
  (`loadSpecificationActions`, `actions.mjs:82-114`) runs a `--check` gate probe per
  actionable task purely to compute button-enabled state, on every poll. For a task's
  `verify`/`approve` gate this probe genuinely is cheap (a status-transition check). It
  is **not** cheap for `finalize`: `finalizeGate` calls
  `runSpecs(root, ['finalize', slug, '--check'])`, and `finalize --check`
  (`validateFinalize`, `tools/specs.mjs:1125`) can itself run spec/docs validation,
  index-currency checks, GitHub PR/review-state checks, and — depending on what the
  change's own verification commands are — `dotnet build`/`dotnet test`. Running that on
  every poll is exactly the kind of "cheap because the response is small" trap this
  change already corrected for `/api/dashboard` (see `dashboard-data-loading-contracts.md`)
  — a periodic `GET` must never trigger it. Requirement: `GET /actions` reports only
  lightweight, already-cheaply-available state for `finalize` (e.g. task-completion
  status, branch/PR existence — the same cheap git facts `loadSpecificationActions`
  already computes via `worktreeLoader`/`branchLoader` — not a computed enabled/
  disabled-with-reason verdict that required running `finalize --check`). The full,
  authoritative gate check moves into the `finalize` `Operation`'s own steps (below) —
  triggering it is how the owner actually learns whether finalize would pass, not a
  polled `GET`. A task's `verify`/`approve` gate probe is unaffected — it stays on `GET`
  exactly as before, since it genuinely is cheap. Neither probe gains an `operationId`,
  steps, or an SSE stream regardless.
- **`finalize`'s natural existing phases become this operation's semantic steps —
  never one collapsed "Checking gate..." step.** `finalize --check`
  (`validateFinalize`) already evaluates multiple distinct things; when a POST triggers
  `finalize`, emit one step per natural phase as the CLI already performs them, e.g.:
  `validate specs`, `check indexes`, `validate docs`, `check PR/review state`,
  `dotnet build`, `dotnet test`, `finalize` (merge/archive). Exact step ids/labels are
  an implementation detail matching whatever `validateFinalize`/`handleFinalize`
  actually do internally — the requirement is per-phase steps, not the phase list
  above verbatim. This is the same "map to real, already-existing structure, never
  invent granularity" rule the rest of this area already applies to self-check and
  batch review, extended to `finalize` specifically since it turned out not to be an
  atomic check like the task-level gate probes.
- `tools/dashboard/server/actions.mjs` moves from `execFileSync` to `spawn` so step
  events can be read from the child process as they're emitted, not only after exit.
- `tools/specs.mjs` (and any other CLI command invoked for a long operation) emits step
  events as additive, line-delimited structured stdout (exact framing is an
  implementation detail — e.g. a prefixed NDJSON line) alongside its existing final
  JSON result line; the final result line's shape/meaning is unchanged.
- A small shared emission helper (used by every instrumented command in tasks 05/06)
  avoids duplicating the event-shaping logic per command. It lives in a
  provider/consumer-neutral location — `tools/lib/operation-progress.mjs` — not inside
  `tools/dashboard/server/**`: `tools/specs.mjs`/`tools/specs/**` (tasks 05/06) must
  never import from the dashboard server's own module tree (wrong dependency
  direction — the CLI does not depend on the dashboard), and this task's own
  `forbidden_paths` already exclude `tools/specs.mjs`, so the helper cannot live inside
  either side's exclusive territory. `tools/lib/` already hosts other repo-wide-neutral
  modules (e.g. `tools/lib/git.mjs`, `tools/lib/github.mjs`) consumed by both the CLI and
  the dashboard server today, so this follows an established pattern rather than
  inventing a new one.
- Transport: a per-operation snapshot endpoint (current known state, for a client that
  wasn't connected when steps ran) plus a resumable SSE stream keyed by `operationId`,
  mirroring `getTurn`/`subscribeToTurn`. A client that reconnects mid-operation recovers
  current state; a client that reconnects after completion still sees the final status
  (nothing is lost to a dropped connection).
- Cancellation is out of scope for this change (owner correction, 2026-08-15): moving
  `actions.mjs` to `spawn` gives a live child-process handle for the *direct* child, but
  CLI commands (e.g. `handleSelfCheck` running `dotnet test`) spawn their own child
  processes in turn — killing the top-level process does not guarantee the whole process
  tree terminates, so "cheap because we moved to spawn" was not actually true. Do not
  implement `POST /operations/:id/cancel` or any cancellation behavior in this change.
  The `Operation` model must still not preclude adding it later: keep `operationId` as
  a stable handle and the contract shape (`Operation`/`Step`, snapshot, SSE) generic
  enough that a future change can add real cancellation (with correct process-tree
  handling) without a breaking contract change.
- Every operation kind listed in the change overview — gate checks, spec verification,
  implementation verification, AI verification, task acceptance, batch verification,
  test runs, final audits — emits step events through this same shared vocabulary (split
  across tasks 05/06 by group, per D2). Only the subset of these actually reachable via
  a `POST` action in `actions.mjs` today (the task-level gate re-check, task acceptance,
  and `finalize`) becomes a Dashboard `Operation` with an `operationId`/snapshot/SSE;
  the rest (e.g. `self-check` run standalone, `batch-review`) emit the same vocabulary
  as CLI-only structured stdout, with no dashboard-tracked `Operation` created for them
  in this change (D9).
- Raw stdout may still be captured as supplementary "details/logs" but is never the
  primary source the dashboard parses for progress state.

## Constraints

- Must not change what any gate/verification/acceptance/test command decides or how it
  decides it — only how it reports its own already-existing steps. If a command
  currently has no clearly separable internal steps, do not invent artificial ones; keep
  it as a single step rather than fabricating granularity that doesn't exist.
- Must not build a general-purpose event-sourcing system for the dashboard — the
  snapshot+resumable-SSE shape already proven for AI turns is the ceiling of complexity
  here, not a floor to exceed.

## Interfaces and boundaries

- Exposes: `Operation` snapshot/SSE routes to the frontend (no cancel route — see
  Requirements above); a step-emission
  helper (`tools/lib/operation-progress.mjs`) imported by both `tools/dashboard/server`
  (to build the transport) and `tools/specs.mjs`/CLI command code (tasks 05/06, to emit
  events) — the dependency direction is both sides depending downward on this neutral
  module, never on each other.
- Consumes: the AI-turn snapshot+SSE+resume pattern as a structural precedent (not a
  shared implementation — the AI-turn runtime itself is out of scope for reuse/coupling
  here beyond copying its shape).

## Area-specific acceptance criteria

- Starting an operation and disconnecting mid-way, then reconnecting with the returned
  `operationId`, yields the operation's current step state, not a restart from nothing.
- An operation that completes while no client is connected still reports its final
  status to a client that connects afterward.
- No dashboard-side code infers a step transition from elapsed time or stdout
  heuristics — every step transition in a test corresponds to an emitted event from the
  CLI layer.
- A step's `failed` status is distinguishable from the overall operation's `failed`
  status in the payload (a mid-operation step failure must not be silently swallowed
  into just an overall failure with no indication of which step).
- `GET /api/specs/active/:slug/actions` never triggers `dotnet build`/`dotnet test`/
  spec or docs validation as a side effect of computing finalize's button state.
- Triggering `finalize` emits more than one step, corresponding to
  `validateFinalize`/`handleFinalize`'s own real phases — never a single step covering
  the whole check.

## Dependencies

None on the other areas in this change architecturally — this is backend/CLI plumbing
independent of the PR/markdown data-loading work. `dashboard-operation-progress-ui.md`
depends on this area. At the *task* level, task 04 is nonetheless sequenced after task 01
(`dashboard-data-loading-contracts`) purely to avoid two tasks concurrently modifying the
same central files (`tools/dashboard/server/index.mjs`, `tools/dashboard/src/lib/types.ts`)
— see D8 in `owner-decisions.md`. This does not make the areas themselves dependent.

## Out of scope

- Frontend rendering (next area).
- Any change to gate rules, verification criteria, or status transitions themselves.
- A general-purpose event-sourcing/durable job queue.
- Dashboard discovery, registration, or SSE relay of a CLI process the dashboard did not
  itself spawn — no IPC, global operation bus, or CLI→dashboard callback API (D9).
