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
  (`tools/dashboard/server/ai-routes.mjs:180-224`). This area generalizes that shape
  rather than inventing a new one — no event-sourcing system, just the same
  snapshot+resumable-stream+cancel shape applied to a generic `Operation`.
- The global `specs-changed` SSE hub (`watcher.mjs`) has no event IDs/replay and is
  unrelated to per-operation progress; it must not be reused/overloaded for this
  purpose — operations get their own scoped stream so per-operation resume/backfill
  works (the global hub's "refetch everything on any signal" model cannot express
  step-level state).

## Requirements

- Shared contract: an `Operation` has an `id`, a `type` (e.g. `task-verification`,
  `gate-check`), and `steps[]`; each step has `id`, `label`, `status`
  (`pending`/`running`/`completed`/`failed`), and optionally numeric progress
  (`current`/`total`). Event vocabulary: `operation.started`,
  `operation.step.started`, `operation.step.progress`, `operation.step.completed`,
  `operation.step.failed`, `operation.completed`, `operation.failed` (names may adapt to
  existing repo conventions; semantics must match).
- `tools/dashboard/server/actions.mjs` moves from `execFileSync` to `spawn` so step
  events can be read from the child process as they're emitted, not only after exit.
- `tools/specs.mjs` (and any other CLI command invoked for a long operation) emits step
  events as additive, line-delimited structured stdout (exact framing is an
  implementation detail — e.g. a prefixed NDJSON line) alongside its existing final
  JSON result line; the final result line's shape/meaning is unchanged.
- A small shared emission helper (used by every instrumented command in tasks 05/06)
  avoids duplicating the event-shaping logic per command.
- Transport: a per-operation snapshot endpoint (current known state, for a client that
  wasn't connected when steps ran) plus a resumable SSE stream keyed by `operationId`,
  mirroring `getTurn`/`subscribeToTurn`. A client that reconnects mid-operation recovers
  current state; a client that reconnects after completion still sees the final status
  (nothing is lost to a dropped connection).
- Cancellation: since `spawn` gives a live child-process handle, implement
  `POST /operations/:id/cancel` in this change (killing the child process) rather than
  only reserving the shape for later — the owner's stated bar ("implement now if cheap
  and naturally supported by the process model") is met by moving to `spawn`.
- Every operation kind listed in the change overview — gate checks, spec verification,
  implementation verification, AI verification, task acceptance, batch verification,
  test runs, final audits — emits step events through this same contract (split across
  tasks 05/06 by group, per D2).
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

- Exposes: `Operation` snapshot/SSE/cancel routes to the frontend; a step-emission
  helper to CLI command implementations.
- Consumes: the AI-turn snapshot+SSE+resume pattern as a structural precedent (not a
  shared implementation — the AI-turn runtime itself is out of scope for reuse/coupling
  here beyond copying its shape).

## Area-specific acceptance criteria

- Starting an operation and disconnecting mid-way, then reconnecting with the returned
  `operationId`, yields the operation's current step state, not a restart from nothing.
- An operation that completes while no client is connected still reports its final
  status to a client that connects afterward.
- Cancelling an operation terminates the underlying child process and the operation's
  final state reflects cancellation, not a fabricated success/failure.
- No dashboard-side code infers a step transition from elapsed time or stdout
  heuristics — every step transition in a test corresponds to an emitted event from the
  CLI layer.
- A step's `failed` status is distinguishable from the overall operation's `failed`
  status in the payload (a mid-operation step failure must not be silently swallowed
  into just an overall failure with no indication of which step).

## Dependencies

None on the other areas in this change — this is backend/CLI plumbing independent of
the PR/markdown data-loading work. `dashboard-operation-progress-ui.md` depends on this
area.

## Out of scope

- Frontend rendering (next area).
- Any change to gate rules, verification criteria, or status transitions themselves.
- A general-purpose event-sourcing/durable job queue.
