---
id: dashboard-loading-and-progress.cli-step-instrumentation-gate-and-verification
status: draft
change: dashboard-loading-and-progress
depends_on: [operation-progress-contract-and-transport]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/operation-progress-contract.md
    - tools/dashboard/server/actions.mjs
    - tools/specs.mjs
    - tools/lib/operation-progress.mjs
  optional:
    - tools/specs/service.mjs
    - tools/specs/validation.mjs
allowed_paths:
  - tools/specs.mjs
  - tools/specs/**
  - tools/dashboard/server/actions.mjs
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D2, D4, D9, D10]
  constraints: [C1]
  dependency_contracts: [operation-progress-contract-and-transport]
---

# Task: CLI step instrumentation — gate checks and task verification

## Goal

Emit `Operation`/`Steps` events (via the helper from task 04) for every command below,
using the same shared vocabulary regardless of how the command is invoked (D9 in
`owner-decisions.md`). Three of these are genuine **dashboard-triggered Operations** —
reachable via a real `POST` action in `actions.mjs`, so the dashboard backend spawns
them, mints an `operationId`, and exposes snapshot/SSE for them:

1. the gate re-check that runs as a step *inside* a real, POST-triggered `verify`/
   `approve` action (`actions.mjs`'s `taskGate` call before
   `runSpecs(root, [action, ...])` executes, backed by `validateTransition`/status-
   transition checks in `tools/specs.mjs`) — a single, fast, atomic step;
3. task acceptance (`handleApprove`, the `draft`→`approved` transition) — POST-triggered
   `approve`, a single step;
4. `finalize`, as a **multi-step** operation (owner correction, 2026-08-15 — it is
   *not* atomic like the task-level gate probe): `finalize --check`
   (`validateFinalize`, `tools/specs.mjs:1125`) can run spec/docs validation, index
   checks, GitHub PR/review-state checks, and `dotnet build`/`dotnet test`. Emit one
   step per natural existing phase as `validateFinalize`/`handleFinalize` already
   perform them (e.g. `validate specs`, `check indexes`, `validate docs`,
   `check PR/review state`, `dotnet build`, `dotnet test`, `finalize`) — never a single
   collapsed "Checking gate..." step. This is the primary example of a long,
   dashboard-triggered gate/action flow — the one task 07 should verify against for
   real (D10).

One is **CLI-only** in this change — it emits the same shared structured stdout, but is
not reachable via any existing dashboard `POST` action, so it never becomes a Dashboard
Operation (no `operationId`/snapshot/SSE) here:

2. task verification/self-check (`handleSelfCheck`, `tools/specs.mjs:492+` — the runner
   that executes every command a task's own "## Verification" section names,
   sequentially, recording pass/fail per command) — one step per verification command.
   The dashboard's `verify` action calls `handleVerify` (a simple status transition, item
   1 above), not `handleSelfCheck` — self-check only runs via
   `node tools/specs.mjs self-check <change> <task>`, invoked directly by an agent or
   user, never spawned by the dashboard today. If a future change wires self-check as an
   actual dashboard action, its Dashboard Operation wiring reuses this same
   instrumentation for free — but that wiring is not part of this task.

Per task 04/area `operation-progress-contract.md`: the standalone
`GET /api/specs/active/:slug/actions` read is explicitly **not** in scope here for
either gate kind — no `operationId`, no steps, no SSE. The task-level probe there stays
exactly as it runs today (genuinely cheap). The `finalize` probe there changes:
`GET /actions` must no longer call `finalize --check` to compute finalize's button
state (that now only happens as the first steps of a real `finalize` operation) —
replace it with lightweight, already-cheaply-available facts (task-completion status,
branch/PR existence via the existing `worktreeLoader`/`branchLoader`), not a computed
enabled/disabled-with-reason verdict.

## Dependencies

Depends on task 04 for the contract/helper/transport to emit into.

## Implementation constraints

- `handleSelfCheck`'s per-verification-command loop is the closest existing match to
  the owner's own worked example (a task's declared verification commands running one
  after another) — map one step per verification command; do not fabricate finer-
  grained progress inside a single command unless that command's own output already
  exposes it cheaply (e.g. a test runner that prints a running count) — do not add new
  output-parsing complexity to reverse-engineer progress from arbitrary command output.
- The task-level (`verify`/`approve`) gate re-check step inside a real action is
  typically fast and largely atomic — represent it as a single step. `finalize` is the
  opposite case — it must be decomposed into its real natural phases (see Goal), never
  collapsed into one step, since that's exactly the gap the owner correction closed.
- `actions.mjs`'s `GET /api/specs/active/:slug/actions` handler for `finalize` changes:
  stop calling `finalizeGate`/`finalize --check` there; compute the button's
  availability from lightweight facts already available cheaply (task-completion
  status from the change data, branch/PR existence via `worktreeLoader`/
  `branchLoader`) instead. The task-level `GET` probe is unchanged.
- Do not change what any of these commands decide (transition validity, gate pass/fail
  criteria) — only add step-event emission around already-existing execution, and only
  change *when* the full `finalize` check runs (moved from every `GET` poll to inside
  the `finalize` operation itself), never *what* it decides.

## Acceptance criteria

1. Running a task's self-check emits `operation.step.*` events, one per verification
   command, ending in `operation.completed`/`operation.failed` matching the actual
   outcome. `automated: node --test tools/tests/*.test.mjs`
2. A failing verification command's step is reported as `failed` and does not stop
   later independent steps from being reported per existing self-check semantics
   (whatever the current continue/stop behavior is — unchanged by this task).
   `automated: node --test tools/tests/*.test.mjs`
3. A task-level gate-check probe (`verify`/`approve`) emits at least a `started`/
   `completed` (or `failed`) pair reflecting the same enabled/reason result
   `actions.mjs` already returns today. `automated: npm --prefix tools/dashboard test`
4. Task acceptance (`approve`) emits a step/operation completion consistent with the
   existing status transition outcome. `automated: node --test tools/tests/*.test.mjs`
5. `node tools/specs.mjs check`/`validate` output and exit codes for unrelated commands
   are unchanged. `automated: node tools/specs.mjs check`
6. `GET /api/specs/active/:slug/actions` emits no step/operation events and returns no
   `operationId`, before and after this task. `automated: npm --prefix tools/dashboard test`
7. Triggering `finalize` emits more than one step (matching `validateFinalize`/
   `handleFinalize`'s own real phases), never a single collapsed step, and the
   operation's final success/failure matches what `finalize --check`/`finalize` would
   have reported today. `automated: npm --prefix tools/dashboard test`
8. After this task, `GET /api/specs/active/:slug/actions` no longer invokes
   `finalize --check` (or triggers `dotnet build`/`dotnet test`/spec/docs validation) to
   compute finalize's button state — verified by asserting no such subprocess/validation
   call happens on a plain `GET`. `automated: npm --prefix tools/dashboard test`

## Verification

```text
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
node tools/specs.mjs check
```

## Out of scope

- Batch verification, test-run-as-a-standalone-operation (if distinct from self-check),
  final audits (task 06).
- Frontend rendering (task 07).
