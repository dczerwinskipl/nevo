---
id: dashboard-loading-and-progress.operation-progress-contract-and-transport
status: draft
change: dashboard-loading-and-progress
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
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs.mjs
  - tools/dashboard/src/components/**
semantic_references:
  constraints: [C1]
---

# Task: Operation progress contract and transport

## Goal

Define the shared `Operation`/`Steps` contract, move `actions.mjs` from blocking
`execFileSync` to `spawn`, add a step-emission helper for CLI commands to call, and
expose a per-operation snapshot + resumable SSE + cancel transport mirroring the
existing `getTurn`/`subscribeToTurn`/cancel pattern in `ai-routes.mjs`.

## Implementation constraints

- `Operation`: `{ id, type, steps: [...] }`; `Step`: `{ id, label, status, current?,
  total? }`. Event vocabulary: `operation.started`, `operation.step.started`,
  `operation.step.progress`, `operation.step.completed`, `operation.step.failed`,
  `operation.completed`, `operation.failed` (rename to fit existing repo conventions if
  a better fit exists — semantics must match).
- `actions.mjs` uses `spawn` instead of `execFileSync`; stdout is read incrementally,
  parsed line-by-line for step-event markers (additive to, not replacing, the existing
  final JSON result line).
- Provide one shared emission helper module that tasks 05/06 import from CLI command
  code — do not let each instrumented command re-implement event shaping.
- Snapshot route (current known state) + resumable SSE route (`afterSequence`/
  `lastEventId`-style resume) keyed by `operationId`, mirroring `getTurn`/
  `subscribeToTurn` (`ai-routes.mjs:190-224`) — do not overload the global
  `specs-changed` hub in `watcher.mjs` for this.
- `POST /operations/:id/cancel` kills the underlying child process; the operation's
  final state reflects cancellation distinctly from success/failure.
- No event-sourcing system beyond the snapshot+resumable-SSE shape already proven for
  AI turns.

## Acceptance criteria

1. Reconnecting mid-operation with a known `operationId` returns current step state, not
   an empty/reset state. `automated: npm --prefix tools/dashboard test`
2. An operation that completes with no client connected still reports its final status
   to a client connecting afterward. `automated: npm --prefix tools/dashboard test`
3. Cancelling an operation terminates its child process and the operation's status
   reflects cancellation. `automated: npm --prefix tools/dashboard test`
4. No dashboard-side code infers a step transition from elapsed time or raw stdout
   heuristics — every transition traces to an emitted event.
   `inspection: confirm the SSE/snapshot layer only reacts to parsed step-event markers`
5. A step's `failed` status and the operation's overall `failed` status are both present
   and distinguishable in the payload for a failing fixture.
   `automated: npm --prefix tools/dashboard test`
6. Existing `execFileSync`-based behavior for actions not yet instrumented (before tasks
   05/06 land) still completes successfully via the new `spawn`-based runner.
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
