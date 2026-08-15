---
id: dashboard-loading-and-progress.operation-progress-contract-and-transport
status: draft
change: dashboard-loading-and-progress
depends_on: [dashboard-data-loading-contracts]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/operation-progress-contract.md
    - specs/active/dashboard-loading-and-progress/owner-decisions.md
    - tools/dashboard/server/actions.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/src/lib/types.ts
  optional:
    - tools/dashboard/server/ai-services.mjs
    - tools/dashboard/server/index.mjs
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/src/lib/types.ts
  - tools/dashboard/tests/**
  - tools/lib/operation-progress.mjs
  - tools/tests/operation-progress.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs.mjs
  - tools/dashboard/src/components/**
  - tools/dashboard/server/data.mjs
  - tools/dashboard/server/watcher.mjs
  - tools/dashboard/server/providers/**
semantic_references:
  decisions: [D4, D6, D8, D9, D11]
  constraints: [C1]
  dependency_contracts: [dashboard-data-loading-contracts]
---

# Task: Operation progress contract and transport

## Goal

Define the shared `Operation`/`Steps` contract, move `actions.mjs` from blocking
`execFileSync` to `spawn`, add a step-emission helper for CLI commands to call, and
expose a per-operation snapshot + resumable SSE transport mirroring the existing
`getTurn`/`subscribeToTurn` pattern in `ai-routes.mjs`. Cancellation is explicitly out
of scope for this task/change (owner correction, 2026-08-15) — see Implementation
constraints. Per D9 in `owner-decisions.md`: the `operationId`/snapshot/SSE transport
this task builds is scoped exclusively to processes the dashboard backend itself spawns
via `actions.mjs` — it is not a general mechanism for observing arbitrary CLI
invocations (see Implementation constraints). Per D11 in `owner-decisions.md`: a
Dashboard Operation is exactly one spawned CLI process — this task removes
`executeSpecificationAction`'s current `taskGate`/`finalizeGate` `--check` pre-flight
spawn for `verify`/`approve`/`finalize`, so one POST triggers exactly one child
process, not two (see Implementation constraints).

## Dependencies

Depends on task 01 (`dashboard-data-loading-contracts`) — no content/contract
dependency between the two areas, but both may otherwise modify the same central files
(`tools/dashboard/server/index.mjs`, `tools/dashboard/src/lib/types.ts`); sequencing
after task 01 avoids two tasks racing to edit them in parallel (D8 in
`owner-decisions.md`, mirroring D7's treatment of tasks 05/06).

## Implementation constraints

- `Operation`: `{ id, type, steps: [...] }`; `Step`: `{ id, label, status, current?,
  total? }`. Event vocabulary: `operation.started`, `operation.step.started`,
  `operation.step.progress`, `operation.step.completed`, `operation.step.failed`,
  `operation.completed`, `operation.failed` (rename to fit existing repo conventions if
  a better fit exists — semantics must match).
- `actions.mjs` uses `spawn` instead of `execFileSync`; stdout is read incrementally,
  parsed line-by-line for step-event markers (additive to, not replacing, the existing
  final JSON result line).
- **`executeSpecificationAction` spawns exactly one child process per Dashboard
  Operation — never a `--check` pre-flight process followed by the real command (D11).**
  Remove the current `taskGate(runSpecs, root, slug, task)` call before
  `runSpecs(root, [action, ...])` for `verify`/`approve`, and the current
  `finalizeGate(runSpecs, root, slug)` call before `runSpecs(root, ['finalize', slug])`
  for `finalize` — spawn the real command directly in both cases. `handleVerify`/
  `handleApprove` already run `validateTransition` internally before mutating and
  already refuse to mutate (throw, exit non-zero) on failure; `handleFinalize` already
  runs `gatherFinalizeFacts`/`validateFinalize` unconditionally at its start, before any
  archive/push/merge, and already refuses to mutate on failure — the same call
  `--check` mode also uses (`tools/specs.mjs:1125-1136`). That existing internal
  validation is what task 05 instruments as the Operation's first semantic step(s); this
  task does not add a second validation path, only removes the redundant pre-flight
  spawn. Only the `taskGate`/`finalizeGate` call sites inside
  `executeSpecificationAction`'s POST path are removed — the helper functions
  themselves stay as-is. `taskGate` keeps its existing caller in the unaffected `GET
  /actions` read path (`loadSpecificationActions`, task-level probe, per D4). `finalizeGate`
  keeps its existing `GET`-path caller too, until task 05 replaces it with lightweight
  facts per D4 — this task removes only the POST-path pre-flight call for both helpers,
  not their (still-needed, for now) `GET`-path ones.
- Provide one shared emission helper module at `tools/lib/operation-progress.mjs` — a
  neutral location outside both `tools/dashboard/server/**` and `tools/specs.mjs`'s own
  territory — that tasks 05/06 import from CLI command code and this task itself imports
  from the dashboard server. Do not place it under `tools/dashboard/server/**`: CLI code
  (tasks 05/06) must never depend on the dashboard server's module tree (wrong
  dependency direction). Do not let each instrumented command re-implement event
  shaping. The helper's emitted events carry no `operationId` field and have no
  knowledge of the dashboard — `operationId` is minted and owned solely by the
  dashboard backend, at spawn time, for the one process it just spawned (D9).
- **The dashboard backend never discovers, registers, polls for, or attaches to a CLI
  process it did not itself spawn.** There is no mechanism in this task (or anywhere in
  this change) for the dashboard to become aware of a `node tools/specs.mjs self-check
  ...`/`batch-review ...`/etc. invocation started independently by an agent or user — no
  IPC, global operation bus, or CLI→dashboard callback API (D9). The only way a process's
  step events reach the dashboard's `Operation` snapshot/SSE is via the stdout of a child
  process this task's own `spawn`-based runner started.
- The endpoint that triggers a POST-based action returns `{ operationId }` immediately
  (an "accepted, in progress" response — exact HTTP status code is an implementation
  detail) — never blocks until the action finishes. Today's `executeSpecificationAction`
  blocks synchronously; this task changes that entry point specifically.
- `GET /api/specs/active/:slug/actions` (`loadSpecificationActions`) stays a plain,
  synchronous, read-only request — no `operationId`, no steps, no SSE, for both the
  task-level (`verify`/`approve`) and `finalize` gate probes. The task-level probe is
  unchanged (genuinely cheap). The `finalize` probe changes: it must stop calling
  `finalize --check` (which can run spec/docs validation, index checks, PR/review-state
  checks, and `dotnet build`/`dotnet test`) on every poll — replace it with lightweight,
  already-cheaply-available facts (task-completion status, branch/PR existence via the
  existing `worktreeLoader`/`branchLoader`), not a computed enabled/disabled-with-reason
  verdict. The authoritative `finalize` gate check moves into the `finalize` operation's
  own steps (task 05) — only a POST that actually starts an action becomes an
  `Operation`.
- Snapshot route (current known state) + resumable SSE route (`afterSequence`/
  `lastEventId`-style resume) keyed by `operationId`, mirroring `getTurn`/
  `subscribeToTurn` (`ai-routes.mjs:190-224`) — do not overload the global
  `specs-changed` hub in `watcher.mjs` for this.
- Do **not** implement `POST /operations/:id/cancel` or any cancellation behavior — a
  CLI command's own child processes (e.g. `dotnet test` under `handleSelfCheck`) are
  not guaranteed to terminate just because the top-level `spawn`ed process is killed,
  so this is not a safe "cheap because we moved to spawn" addition. Keep `operationId`
  as a stable handle and the `Operation`/`Step` shape generic enough that a later change
  can add real cancellation (with correct process-tree handling) without a breaking
  contract change.
- No event-sourcing system beyond the snapshot+resumable-SSE shape already proven for
  AI turns.

## Acceptance criteria

1. Triggering a POST-based action returns `{ operationId }` before the action
   completes — verified by asserting the response arrives while the underlying work is
   still running (e.g. a deliberately slow fixture), not just that the field is
   present. `automated: npm --prefix tools/dashboard test`
2. `GET /api/specs/active/:slug/actions` never returns or requires an `operationId` and
   never opens an SSE stream — it stays a plain synchronous read.
   `automated: npm --prefix tools/dashboard test`
3. `GET /api/specs/active/:slug/actions` never invokes `finalize --check` (or anything
   that runs `dotnet build`/`dotnet test`/spec/docs validation) to compute finalize's
   button state. `automated: npm --prefix tools/dashboard test`
4. Reconnecting mid-operation with a known `operationId` returns current step state, not
   an empty/reset state. `automated: npm --prefix tools/dashboard test`
5. An operation that completes with no client connected still reports its final status
   to a client connecting afterward. `automated: npm --prefix tools/dashboard test`
6. No dashboard-side code infers a step transition from elapsed time or raw stdout
   heuristics — every transition traces to an emitted event.
   `inspection: confirm the SSE/snapshot layer only reacts to parsed step-event markers`
7. A step's `failed` status and the operation's overall `failed` status are both present
   and distinguishable in the payload for a failing fixture.
   `automated: npm --prefix tools/dashboard test`
8. Existing `execFileSync`-based behavior for actions not yet instrumented (before tasks
   05/06 land) still completes successfully via the new `spawn`-based runner.
   `automated: npm --prefix tools/dashboard test`
9. No `POST /operations/:id/cancel` route (or any cancellation endpoint) exists.
   `inspection: confirm no cancel route is registered`
10. No route, IPC mechanism, or process-discovery code exists that lets the dashboard
    become aware of a CLI process it did not itself `spawn` — an `operationId` only ever
    exists for a process this task's runner started.
    `inspection: confirm operationId assignment only occurs at the point actions.mjs spawns a child process`
11. Triggering `verify`/`approve`/`finalize` via `POST` spawns exactly one child
    process — `executeSpecificationAction` no longer calls `taskGate`/`finalizeGate`
    (a `--check` pre-flight) before spawning the real action command; the same
    `validateTransition`/`gatherFinalizeFacts`+`validateFinalize` result the pre-flight
    used to compute is now observed from that one spawned process's own outcome (D11).
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Documentation impact

Recommend (do not yet write) a new ADR documenting the generalized Operation/Steps +
resumable-SSE pattern as the standard shape for future long-running dashboard
operations, once this task's transport is in place — see `overview.md` § "ADR impact".

## Out of scope

- Instrumenting any specific CLI command (tasks 05, 06).
- Frontend rendering (task 07).
