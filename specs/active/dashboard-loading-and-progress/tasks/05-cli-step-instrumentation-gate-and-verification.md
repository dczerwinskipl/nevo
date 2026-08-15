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
  decisions: [D2]
  constraints: [C1]
  dependency_contracts: [operation-progress-contract-and-transport]
---

# Task: CLI step instrumentation — gate checks and task verification

## Goal

Emit `Operation`/`Steps` events (via the helper from task 04) for the gate re-check that
runs as a step *inside* a real, POST-triggered `verify`/`approve` action (`actions.mjs`'s
`taskGate`/`finalizeGate` call before `runSpecs(root, [action, ...])` executes, backed by
`validateTransition`/status-transition checks in `tools/specs.mjs`), task verification/
self-check (`handleSelfCheck`, `tools/specs.mjs:492+` — the runner that executes every
command a task's own "## Verification" section names, sequentially, recording pass/
fail per command), and task acceptance (`handleApprove`, the `draft`→`approved`
transition). Per task 04/area `operation-progress-contract.md`: the standalone
`GET /api/specs/active/:slug/actions` gate probe (button-enabled-state polling) is
explicitly **not** in scope here — it stays a plain synchronous read with no
`operationId`, no steps, no SSE, regardless of how much of the same gate logic it calls
internally.

## Dependencies

Depends on task 04 for the contract/helper/transport to emit into.

## Implementation constraints

- `handleSelfCheck`'s per-verification-command loop is the closest existing match to
  the owner's own worked example (a task's declared verification commands running one
  after another) — map one step per verification command; do not fabricate finer-
  grained progress inside a single command unless that command's own output already
  exposes it cheaply (e.g. a test runner that prints a running count) — do not add new
  output-parsing complexity to reverse-engineer progress from arbitrary command output.
- The gate re-check step inside a real action is typically fast and largely atomic —
  represent it as a single step unless the underlying check genuinely has multiple
  separable phases already. The standalone `GET /api/specs/active/:slug/actions`
  button-state probe is out of scope for this task entirely — see Goal.
- Do not change what any of these commands decide (transition validity, gate pass/fail
  criteria) — only add step-event emission around already-existing execution.

## Acceptance criteria

1. Running a task's self-check emits `operation.step.*` events, one per verification
   command, ending in `operation.completed`/`operation.failed` matching the actual
   outcome. `automated: node --test tools/tests/*.test.mjs`
2. A failing verification command's step is reported as `failed` and does not stop
   later independent steps from being reported per existing self-check semantics
   (whatever the current continue/stop behavior is — unchanged by this task).
   `automated: node --test tools/tests/*.test.mjs`
3. A gate-check probe (task or finalize) emits at least a `started`/`completed` (or
   `failed`) pair reflecting the same enabled/reason result `actions.mjs` already
   returns today. `automated: npm --prefix tools/dashboard test`
4. Task acceptance (`approve`) emits a step/operation completion consistent with the
   existing status transition outcome. `automated: node --test tools/tests/*.test.mjs`
5. `node tools/specs.mjs check`/`validate` output and exit codes for unrelated commands
   are unchanged. `automated: node tools/specs.mjs check`
6. `GET /api/specs/active/:slug/actions` emits no step/operation events and returns no
   `operationId`, before and after this task. `automated: npm --prefix tools/dashboard test`

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
