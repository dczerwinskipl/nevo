---
id: deterministic-status-architecture.dashboard-actions-lifecycle-split
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dashboard-server-actions-wiring.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/server/specs/actions/**
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ dashboard-deterministic-action-projection, human-step-execution-operations ]
---

# Task: Dashboard actions lifecycle split

## Goal

Split `actions.mjs`'s legacy (`approve`/`verify`/`finalize`) and deterministic
(human-workflow) mutation-handling code into two separate implementations under shared
composition that resolves `workflowMode` once — mirroring the CLI-level guard pattern —
with the deterministic side wired to call `submitHumanStepResult`
(`areas/step-executor-model.md`, task `human-step-execution-operations`) rather than
reimplementing result validation, and neither implementation calling into the other's
mutation operations.

## Dependencies

`dashboard-deterministic-action-projection` — this task splits the mutation side of the
same file that task already corrected on the read side. `human-step-execution-operations`
— provides `submitHumanStepResult`, wired in as the deterministic mutation implementation's
human-decision handler.

## Implementation constraints

- First establish, by reading the current file, exactly which functions in `actions.mjs`
  perform legacy mutation (calling into `tools/specs/{approve,verify}/operation.mjs` or
  finalize logic) versus deterministic mutation (today, the server-side counterpart of
  `workflow verify-human --approve`/`--request-changes`) — this task's own discovery, since
  the original architecture research did not trace this file's mutation call graph in
  depth.
- Extract each into its own module (e.g.
  `tools/dashboard/server/specs/actions/legacy-mutations.mjs` and
  `.../deterministic-mutations.mjs`), with `actions.mjs` (or a thin composition/routing
  layer) resolving `workflowMode` once and dispatching — no `if legacy / if deterministic`
  branch inside a single mutation-handling function.
- The deterministic mutation module's human-decision handler calls `submitHumanStepResult`
  directly — it does not itself match `result` against transitions or duplicate any
  validation `finishStep` already performs.
- Neither new module imports the other's mutation functions, and the deterministic module
  does not import `tools/specs/lifecycle-primitives.mjs`. Both may import shared, read-only
  utilities (`resolveWorkflowMode()`, the canonical projection) freely.
- A cross-mode mutation attempt through this route fails before any mutation — reuse the
  same guard pattern as `areas/lifecycle-boundary-guards.md`, not a new one.

## Acceptance criteria

- Legacy mutation behavior (approve/verify/finalize via this route) is unchanged for legacy
  specs. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- Deterministic mutation behavior (a human-step result submission via this route) is
  unchanged in outcome for deterministic specs, now served from the extracted module,
  calling `submitHumanStepResult`. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- No deterministic mutation module in this file's scope calls a legacy mutation function
  (`approveTask`/`verifyTask`/finalize) and vice versa — asserted by an import/call-boundary
  regression test. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- No deterministic mutation module in this file's scope imports
  `tools/specs/lifecycle-primitives.mjs`.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- A cross-mode mutation attempt through this route fails before any mutation, with the same
  side-effect assertions (no partial write, no session created) as the CLI-level guard test.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

The action DTO's read-side correction (already done by
`dashboard-deterministic-action-projection`). Any new dashboard API endpoint.
`submitHumanStepResult`'s own implementation (task `human-step-execution-operations`).
