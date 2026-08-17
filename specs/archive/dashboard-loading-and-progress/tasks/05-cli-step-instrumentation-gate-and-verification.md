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
  decisions: [D2, D4, D9, D10, D11]
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

1. the validation `handleVerify`/`handleApprove` already perform internally
   (`validateTransition`/status-transition checks in `tools/specs.mjs`), before
   mutating — instrument this as the **first semantic step of the one already-spawned
   `verify`/`approve` process itself** (D11 in `owner-decisions.md`: task 04 removes
   `actions.mjs`'s previous `taskGate` `--check` pre-flight spawn, so there is only ever
   one process to instrument here, not a separate pre-flight one) — a single, fast,
   atomic step, since the check is typically near-instant; the transition it gates
   (writing the new status) may share that same step or be a short second step in the
   same process, implementer's choice, as long as no second CLI process is ever
   spawned;
2. task acceptance (`handleApprove`, the `draft`→`approved` transition) — POST-triggered
   `approve`, a single step;
3. `finalize`, as a **multi-step** operation (owner correction, 2026-08-15 — it is
   *not* atomic like the task-level gate probe): `handleFinalize`'s own
   `gatherFinalizeFacts`/`validateFinalize` call — run unconditionally at the start of
   the one spawned `finalize` process, the same call `--check` mode also uses
   (`tools/specs.mjs:1125-1136`) — can run spec/docs validation, index checks, GitHub
   PR/review-state checks, and `dotnet build`/`dotnet test`. Emit one step per natural
   existing phase as that call already performs them (e.g. `validate specs`,
   `check indexes`, `validate docs`, `check PR/review state`, `dotnet build`,
   `dotnet test`, `finalize`) — never a single collapsed "Checking gate..." step, and
   never a separate pre-flight process from the mutation that follows in the same
   `finalize` run. This is the primary example of a long, dashboard-triggered
   gate/action flow — the one task 07 should verify against for real (D10).

One is **CLI-only** in this change — it emits the same shared structured stdout, but is
not reachable via any existing dashboard `POST` action, so it never becomes a Dashboard
Operation (no `operationId`/snapshot/SSE) here:

4. task verification/self-check (`handleSelfCheck`, `tools/specs.mjs:492+` — the runner
   that executes every command a task's own "## Verification" section names,
   sequentially, recording pass/fail per command) — one step per verification command.
   The dashboard's `verify` action calls `handleVerify` (a simple status transition, item
   1 above), not `handleSelfCheck` — self-check only runs via
   `node tools/specs.mjs self-check <change> <task>`, invoked directly by an agent or
   user, never spawned by the dashboard today. If a future change wires self-check as an
   actual dashboard action, its Dashboard Operation wiring reuses this same
   instrumentation for free — but that wiring is not part of this task.

Per task 04/area `operation-progress-contract.md`: the standalone
`GET /api/specs/active/:slug/actions` read uses the generic `evaluateGate('finalize', context, { mode: 'fast' })`
SSOT evaluator rather than invoking a subprocess `finalize --check`. In `fast` mode, cheap local checks
(`tasks-terminal`, `follow-ups-blocking`, `working-tree-clean`, `branch-not-behind`, `branch-pushed`) are
evaluated immediately, while expensive/upstream checks are skipped (`status: 'skipped'`), returning
`status: 'needs-full-check'` (enabling the action for full execution) or `status: 'blocked'` if any cheap check
fails. The spawned `finalize` action executes the full gate (`mode: 'full'`) as its operational steps.

## Dependencies

Depends on task 04 for the contract/helper/transport to emit into.

## Implementation constraints

- `handleSelfCheck`'s per-verification-command loop is the closest existing match to
  the owner's own worked example (a task's declared verification commands running one
  after another) — map one step per verification command; do not fabricate finer-
  grained progress inside a single command unless that command's own output already
  exposes it cheaply (e.g. a test runner that prints a running count) — do not add new
  output-parsing complexity to reverse-engineer progress from arbitrary command output.
- The task-level (`verify`/`approve`) validation is evaluated via `evaluateGate` — represent
  it as a semantic step of the spawned operation.
  `finalize` is decomposed into its real natural phases (see Goal), never collapsed into one step.
  Neither case involves a second CLI process — all are steps within the one process the dashboard
  spawns for that action.
- `actions.mjs`'s `GET /api/specs/active/:slug/actions` handler uses `evaluateGate('finalize', context, { mode: 'fast' })`
  to determine finalize availability without running expensive network/compilation probes on polling reads.
- Single source of truth (SSOT): All gate validations across CLI and dashboard share `evaluateGate` and
  `validatorRegistry` (`tools/specs/gates.mjs`). Fast evaluation never fabricates missing upstream facts
  (missing facts lead to `needs-full-check`, not false `passed`).

## Acceptance criteria

1. Running a task's self-check emits `operation.step.*` events, one per verification
   command, ending in `operation.completed`/`operation.failed` matching the actual
   outcome. `automated: node --test tools/tests/*.test.mjs`
2. A failing verification command's step is reported as `failed` and does not stop
   later independent steps from being reported per existing self-check semantics
   (whatever the current continue/stop behavior is — unchanged by this task).
   `automated: node --test tools/tests/*.test.mjs`
3. Triggering `verify`/`approve` emits, from that one spawned process, at least a
   `started`/`completed` (or `failed`) pair reflecting the same `validateTransition`
   enabled/reason result `taskGate`'s `GET`-path read already reports today — computed
   once, inside that process, never via a separate pre-flight spawn (D11).
   `automated: npm --prefix tools/dashboard test`
4. Task acceptance (`approve`) emits a step/operation completion consistent with the
   existing status transition outcome. `automated: node --test tools/tests/*.test.mjs`
5. `node tools/specs.mjs check`/`validate` output and exit codes for unrelated commands
   are unchanged. `automated: node tools/specs.mjs check`
6. `GET /api/specs/active/:slug/actions` emits no step/operation events and returns no
   `operationId`, before and after this task. `automated: npm --prefix tools/dashboard test`
7. Triggering `finalize` emits more than one step (matching `validateFinalize`/
   `handleFinalize`'s own real phases), never a single collapsed step, all from the one
   spawned `finalize` process (D11) — and the operation's final success/failure matches
   what `gatherFinalizeFacts`/`validateFinalize` would report either way (`--check` or
   for real, since it's the same call). `automated: npm --prefix tools/dashboard test`
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
