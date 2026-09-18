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

Build `DashboardActionProjection` (D10): replace `tools/dashboard/server/specs/actions.mjs`'s
deterministic action-derivation branch — currently reading `task.status`, calling
`isTaskReady`, checking the literal string `'human-verification'`, and hardcoding
transition-destination names — with a call composing `TaskProjection` **and**
`ExecutionReadiness`, so the DTO the UI actually reads reflects both real workflow state
and genuine action availability.

## Dependencies

`deterministic-task-projection` (`TaskProjection`, the pure state), `execution-readiness-policy`
(`ExecutionReadiness`, the availability layer) — this task composes both into the actual
action DTO; per D10, `availableActions` must never be derived from `TaskProjection` alone.

## Implementation constraints

- Locate and remove every `task.status`/`isTaskReady`/literal-`'human-verification'`/
  hardcoded-transition-name reference in `actions.mjs`'s deterministic branch; replace with
  a call into `TaskProjection` for state facts and `ExecutionReadiness` for
  `availableActions` (via `resolveWorkflowMode()` to select the branch, as established by
  the guard tasks).
- The returned deterministic action DTO exposes at least: `state`, `currentStep`,
  `nextStep`, `executor`, `attempt`, `blockedBy`, `availableActions` (from
  `ExecutionReadiness` — e.g. "Start implementation," "Start review," "Start human step,"
  "Submit result"), human-step metadata/actions when applicable (from `TaskProjection`'s
  human-interaction descriptor), and terminal outcome.
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
- Grepping the deterministic branch for `task.status`, `isTaskReady`, or the literal string
  `'human-verification'` returns none.
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
