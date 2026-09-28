---
id: deterministic-status-architecture.step-executor-guard
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/step-executor-model.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/executor-guard.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/step-executor-guard.test.mjs
  - tools/tests/workflow-cli.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ deterministic-mutation-guard, workflow-definition-schema-extensions ]
---

# Task: Step-executor guard

## Goal

Enforce `step.executor` as an invariant, not a UI hint: an agent entry point must reject a
human-owned step before any mutation, with a structured, agent-legible error. Build the one
shared guard function `human-step-execution-operations` (task 09) reuses for the reverse
direction.

## Dependencies

`deterministic-mutation-guard` (this guard sits alongside the mode guard in the same CLI
entry points), `workflow-definition-schema-extensions` (reads the `executor` field this
task adds).

## Implementation constraints

- New module (e.g. `tools/specs/workflow/executor-guard.mjs`) exposing one function that,
  given a step's resolved `executor` and the caller kind (`agent` | `human`), throws a
  structured error when they don't match — this is the single implementation every call
  site (this task's own CLI wiring, and task 09's `startHumanStep`/`submitHumanStepResult`)
  reuses.
- Error shape: `code: 'WORKFLOW_STEP_EXECUTOR_MISMATCH'`, `stepId`, `executor`, `purpose`,
  `expectedWork`, `availableActions` (derived from the step's transitions' `action`
  metadata, task 07), and a human-readable message worded so an agent stops instead of
  retrying a different lifecycle operation (e.g. "Step '<id>' is owned by a human and
  cannot be started by an agent. ... Human action is required. Do not execute, simulate, or
  complete this step.").
- Wire the guard into `handleWorkflowStepStart` and `handleWorkflowStepFinish`
  (`tools/specs/workflow/cli.mjs`) for the agent direction — each call happens before any
  mutation. This task does *not* wire the reverse (human-owned-caller-rejects-agent-step)
  direction into any CLI entry point itself — that is task 09's own wiring, reusing this
  task's exported guard function.
- Do not import `tools/specs/lifecycle-primitives.mjs` or any legacy mutation module.

## Acceptance criteria

- `workflow step start <change> <task>` against a step with `executor: human` fails with the
  structured `WORKFLOW_STEP_EXECUTOR_MISMATCH` error (all listed fields present) and
  `change.yaml` is unchanged. `automated: node --test tools/tests/step-executor-guard.test.mjs`
- `workflow step finish <change> <task>` against the same step fails identically (defense in
  depth). `automated: node --test tools/tests/step-executor-guard.test.mjs`
- `workflow step start` against an `executor: agent` step is unaffected — no new failure on
  the matching case. `automated: node --test tools/tests/step-executor-guard.test.mjs`
- The guard function is exported in a shape task 09 can import and call directly for the
  reverse direction — no logic duplicated between this task and task 09.
  `inspection: confirm the guard function is exported and importable, with no per-caller-direction duplication`

## Verification

```bash
node --test tools/tests/step-executor-guard.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`startHumanStep`/`submitHumanStepResult`'s own wiring of this guard for the reverse
direction (task `human-step-execution-operations`). The schema this guard reads (task
`workflow-definition-schema-extensions`). Wiring this guard into session/execution
bootstrap (task `execution-readiness-policy` reuses this function, it does not reimplement
it here).
