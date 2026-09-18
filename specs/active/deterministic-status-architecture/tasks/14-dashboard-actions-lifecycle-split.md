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
depends_on: [ deterministic-actions-projection-wiring ]
---

# Task: Dashboard actions lifecycle split

## Goal

Split `actions.mjs`'s legacy (`approve`/`verify`/`finalize`) and deterministic
(human-workflow) mutation-handling code into two separate implementations under shared
composition that resolves `workflowMode` once — mirroring the CLI-level guard pattern —
with neither implementation calling into the other's mutation operations, covered by a
regression test.

## Dependencies

`deterministic-actions-projection-wiring` — this task splits the mutation side of the same
file that task already corrected on the read side.

## Implementation constraints

- First establish, by reading the current file, exactly which functions in `actions.mjs`
  perform legacy mutation (calling into `tools/specs/{approve,verify}/operation.mjs` or
  finalize logic) versus deterministic mutation (calling into the deterministic
  human-decision operation) — this task's own discovery, since the original architecture
  research did not trace this file's mutation call graph in depth.
- Extract each into its own module (e.g.
  `tools/dashboard/server/specs/actions/legacy-mutations.mjs` and
  `.../deterministic-mutations.mjs`), with `actions.mjs` (or a thin composition/routing
  layer) resolving `workflowMode` once and dispatching — no `if legacy / if deterministic`
  branch inside a single mutation-handling function.
- Neither new module imports the other's mutation functions. Both may import shared,
  read-only utilities (`resolveWorkflowMode()`, the canonical projection) freely.
- A cross-mode mutation attempt through this route fails before any mutation — reuse the
  same guard pattern as `areas/lifecycle-boundary-guards.md`, not a new one.

## Acceptance criteria

- Legacy mutation behavior (approve/verify/finalize via this route) is unchanged for legacy
  specs. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- Deterministic mutation behavior (the human-decision operation via this route) is unchanged
  in outcome for deterministic specs, now served from the extracted module.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- No deterministic mutation module in this file's scope calls a legacy mutation function
  (`approveTask`/`verifyTask`/finalize) and vice versa — asserted by an import/call-boundary
  regression test. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- A cross-mode mutation attempt through this route fails before any mutation, with the same
  side-effect assertions (no partial write, no session created) as the CLI-level guard test.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

The action DTO's read-side correction (already done by
`deterministic-actions-projection-wiring`). Any new dashboard API endpoint.
