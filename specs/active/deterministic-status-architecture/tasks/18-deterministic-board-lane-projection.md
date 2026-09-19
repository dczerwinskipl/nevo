---
id: deterministic-status-architecture.deterministic-board-lane-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ui-dashboard-board-split.md
allowed_paths:
  - tools/dashboard/server/specs/status-stages.mjs
  - tools/dashboard/server/specs/data.mjs
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ deterministic-task-projection ]
semantic_references:
  decisions: [D15]
---

# Task: Deterministic board lane projection

## Goal

Give deterministic specs a board/lane derivation based on the canonical `TaskProjection`
state instead of legacy `stageForStatus()`, while leaving every legacy spec's lane
derivation completely unchanged.

## Dependencies

`deterministic-task-projection` — this task's lane mapping reads that projection's state
(a pure domain-state fact — lane placement does not need `ExecutionReadiness`).

## Implementation constraints

- In `tools/dashboard/server/specs/data.mjs`, branch the `stage`/lane assignment on
  `resolveWorkflowMode()` (or the already-resolved `workflowMode` the route has available):
  legacy specs keep calling `stageForStatus(task.status)` unchanged; deterministic specs
  call a new lane-derivation function reading `TaskProjection`'s `state` instead.
- Do not modify `stageForStatus()` itself or its legacy call sites — add the new
  deterministic path alongside it in the same file (or a small new sibling module) rather
  than branching inside `stageForStatus()`.
- Map the projection's states (`draft`, `blocked`, `ready`, `active`,
  `waiting-for-step-start`, `human-interaction`, `terminal`) — and, only if genuinely useful
  for presentation, `executor` — onto the existing 6-lane set
  (`new/design/ready/implementation/review/done` from `lane-presentation.ts`) unless a
  state genuinely needs a lane none of the six represent — prefer reuse. **Never map by
  `currentStep`/`nextStep` (D15, item 11)** — the mapping function's only inputs are
  `state` (and optionally `executor`); it must not receive or branch on a step id at all.
  If the legacy lane names (`implementation`, `review`, etc.) are reused as the
  deterministic bucket names too, that reuse is a presentation/compatibility convenience
  only — document it as such in the code — not a claim that a `review`-named lane means
  "the step is literally named review." Two `active` tasks with step ids `review` and
  `hardening` must land in the identical lane.

## Acceptance criteria

- A deterministic task whose `status` is still the `approved` compatibility value but whose
  `TaskProjection.state` is `active` renders in the active-state lane, not a
  `stageForStatus('approved')`-derived lane (brief regression test #13's board half).
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- Two deterministic tasks, both `state: 'active'`, whose step ids are `review` and an
  arbitrary non-standard fixture (e.g. `hardening`, item 15), render in the identical lane —
  proving the mapping function never received or branched on the step id.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- A legacy spec's lane assignment is unchanged — regression-tested against existing fixture
  data. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- No deterministic task's lane is computed via `stageForStatus()` or `isTaskReady()`, and
  the lane-derivation function's signature takes no `currentStep`/`nextStep`/step-id
  parameter at all. `inspection: confirm the deterministic lane path never calls stageForStatus/isTaskReady and its function signature has no step-id input`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions.test.mjs
```

## Out of scope

Board/lane configurability as project config (D1, out of scope for the whole change).
`TaskCard`'s own rendering (task `task-card-lifecycle-split`).
