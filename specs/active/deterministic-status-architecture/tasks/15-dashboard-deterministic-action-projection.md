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
  decisions: [D10]
---

# Task: Dashboard deterministic action projection

## Goal

Build `DashboardActionProjection` (D10): replace `computeTaskAvailableActions()`/
`computeTaskWorkflowProjection()` in `tools/dashboard/server/specs/actions.mjs` — confirmed
by reading them directly to hardcode `wp.current_step === 'implementation'`/`'review'`/
`'human-verification'`, literal destination-string comparisons, and action ids
`'start-implementation'`/`'start-review'`/`'approve'`/`'request-changes'` — with a call
composing `TaskProjection` **and** `ExecutionReadiness`, so the DTO the UI actually reads
carries real workflow state, an explicit tier-1 step descriptor (item 4), genuine action
availability, and generic action ids (D15, item 6) instead of step-name-derived ones.

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
  sourced from `TaskProjection`'s tier-1 generic descriptor, present *before* activation —
  item 4), the human-step interaction descriptor (tier 2) when applicable, and
  `availableActions` as **generic** action objects (D15, item 6):
  `{ type: 'start-agent-step', step: {...} }` for a ready agent step (never
  `'start-implementation'`/`'start-review'` as distinct ids), `{ type: 'start-human-step',
  step: {...} }` for a waiting human step, `{ type: 'submit-human-step-result' }` once a
  human step is active. Never derive which action applies by comparing a step's `id` to a
  literal string — only `executor` and `TaskProjection`'s state.
- The legacy action-derivation branch in this same file is untouched — read-only
  verification that its output is unchanged is part of this task's acceptance criteria, not
  a license to touch it.
- Do not change the mutation-handling code in this file yet — that split is
  `dashboard-actions-lifecycle-split`'s scope; this task only corrects the read-side action
  DTO.

## Acceptance criteria

- The deterministic action DTO for a task whose `status` is still the `approved`
  compatibility value but whose `workflow_progress.current_step` is `review` reflects
  `review`-appropriate state/actions, not a `status`-derived stale result (brief regression
  test #13's DTO half). `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `availableActions` reflects `ExecutionReadiness`'s output — a task blocked by an
  unsatisfied dependency or an executor mismatch reports the corresponding empty/blocked
  action set, not merely "whatever `TaskProjection`'s state implies."
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- The DTO includes `executor` and, when applicable, human-step metadata/actions exactly
  when `TaskProjection`'s human-interaction descriptor is non-null.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- The DTO's step descriptor is populated with real `purpose`/`expectedWork` for a task in
  `waiting-for-step-start` whose next step is human-owned, *before* that step activates.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `availableActions` for a ready agent step is `{ type: 'start-agent-step', step: {...} }`
  — never `'start-implementation'`/`'start-review'` as distinct string ids — for both
  `implementation` and `review` steps alike.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- Grepping `computeTaskAvailableActions()`/`computeTaskWorkflowProjection()`'s replacement
  for `task.status`, `isTaskReady`, or any literal step-name comparison
  (`'implementation'`, `'review'`, `'human-verification'`) returns none.
  `inspection: confirm the deterministic branch contains none of these references`
- The legacy action DTO's output is byte-for-byte unchanged for a legacy spec (regression
  test against existing fixtures). `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

Splitting this file's mutation implementations (task `dashboard-actions-lifecycle-split`).
Any UI change (the UI-split tasks consume this corrected DTO).
