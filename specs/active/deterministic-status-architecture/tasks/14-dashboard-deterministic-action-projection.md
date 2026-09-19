---
id: deterministic-status-architecture.dashboard-deterministic-action-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dashboard-server-actions-wiring.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ deterministic-task-projection, execution-readiness-policy ]
semantic_references:
  decisions: [D10, D15]
---

# Task: Dashboard deterministic action projection

## Goal

Build `DashboardActionProjection` (D10): replace `computeTaskAvailableActions()`/
`computeTaskWorkflowProjection()` in `tools/dashboard/server/specs/actions.mjs` — confirmed
by reading them directly to hardcode `wp.current_step === 'implementation'`/`'review'`/
`'human-verification'`, literal destination-string comparisons, and action ids
`'start-implementation'`/`'start-review'`/`'approve'`/`'request-changes'` — with a call
composing `TaskProjection` **and** `ExecutionReadiness`, so the DTO the UI actually reads
carries real workflow state, an explicit tier-1 step descriptor, genuine action
availability, and **one** generic `"start-step"` lifecycle action (D15) instead of
step-name-derived ones.

## Dependencies

`deterministic-task-projection` (`TaskProjection`, the pure state), `execution-readiness-policy`
(`ExecutionReadiness`, the availability layer) — this task composes both into the actual
action DTO; per D10, `availableActions` must never be derived from `TaskProjection` alone.

## Implementation constraints

- Locate and remove every `task.status`/`isTaskReady`/literal-step-name-comparison
  reference in `computeTaskAvailableActions()`/`computeTaskWorkflowProjection()`; replace
  with a call into `TaskProjection` for state facts and `ExecutionReadiness` for
  `availableActions` (via `resolveWorkflowMode()` to select the branch, as established by
  the guard tasks).
- The returned deterministic action DTO exposes at least: `state`, `executor`, `attempt`,
  `blockedBy`, terminal outcome, an explicit **current/next-step descriptor** (e.g.
  `currentStepDescriptor`/`nextStepDescriptor` — name it clearly for whichever is the
  relevant target given the task's state; `{ id, executor, purpose, expectedWork }`,
  sourced from `TaskProjection`'s tier-1 generic descriptor, present *before* activation),
  the human-step interaction descriptor (tier 2) when applicable, and `availableActions`
  kept as `string[]` (D18's frontend-type note — not a new object-union shape): exactly
  `["start-step"]` when the current position is waiting for a start and `ExecutionReadiness`
  allows it, for **either** executor (D15) — never `'start-agent-step'`/`'start-human-step'`/
  `'start-implementation'`/`'start-review'`, and never derived by comparing a step's `id`/
  `currentStep`/`nextStep` to a literal string. A consumer that needs to know *which*
  protocol `start-step` triggers reads the step descriptor's own `executor` field — the
  action id itself carries no protocol information.
- The legacy action-derivation branch in this same file is untouched — read-only
  verification that its output is unchanged is part of this task's acceptance criteria, not
  a license to touch it.
- Do not change the mutation-handling code in this file yet — that split is
  `dashboard-actions-lifecycle-split`'s scope; this task only corrects the read-side action
  DTO.

## Acceptance criteria

- The deterministic action DTO for a task whose `status` is still the `approved`
  compatibility value but whose `workflow_progress.current_step` is any agent step (tested
  for both `review` and an arbitrary non-standard step, e.g. `hardening`, item 15) reflects
  the same `state`-derived shape for both — not a `status`-derived stale result, and not a
  result that differs by step id (brief regression test #13's DTO half).
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `availableActions` reflects `ExecutionReadiness`'s output — a task blocked by an
  unsatisfied dependency or an executor mismatch reports an empty action set, not merely
  "whatever `TaskProjection`'s state implies."
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- The DTO includes `executor` and, when applicable, human-step metadata/actions exactly
  when `TaskProjection`'s human-interaction descriptor is non-null.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- The DTO's step descriptor is populated with real `purpose`/`expectedWork` for a task in
  `waiting-for-step-start` whose next step is human-owned, *before* that step activates.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `availableActions` for a ready agent step is exactly `["start-step"]` — never
  `'start-implementation'`/`'start-review'`/`'start-agent-step'` as distinct string ids —
  identically for `implementation`, `review`, and an arbitrary agent step (`hardening`,
  item 15) alike; the only difference between them is the step descriptor's own `id`/
  `purpose`/`expectedWork`.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `availableActions` for a ready **human** step is also exactly `["start-step"]` — the same
  action id as the agent case; only the step descriptor's `executor` field differs.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- Grepping `computeTaskAvailableActions()`/`computeTaskWorkflowProjection()`'s replacement
  for `task.status`, `isTaskReady`, or any literal step-name comparison
  (`'implementation'`, `'review'`, `'human-verification'`, or any other specific step id)
  returns none. `inspection: confirm the deterministic branch contains none of these references`
- The legacy action DTO's output is byte-for-byte unchanged for a legacy spec (regression
  test against existing fixtures). `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

Splitting this file's mutation implementations (task `dashboard-actions-lifecycle-split`).
Any UI change (the UI-split tasks consume this corrected DTO).
