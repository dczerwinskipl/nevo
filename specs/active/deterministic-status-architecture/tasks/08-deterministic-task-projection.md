---
id: deterministic-status-architecture.deterministic-task-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-projection-and-human-interaction.md
allowed_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/tests/deterministic-task-projection.test.mjs
forbidden_paths:
  - tools/specs/lifecycle-primitives.mjs
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
depends_on: [ human-interaction-projection, deterministic-dependency-satisfaction ]
---

# Task: Deterministic task projection

## Goal

Build the one canonical deterministic task state/readiness projection — composing the
human-interaction projection and dependency-satisfaction result — that every other
deterministic-aware consumer (readiness policy, dashboard, `TaskCard`, `TaskDialog`, chat)
reads instead of re-deriving state from legacy helpers.

## Dependencies

`human-interaction-projection`, `deterministic-dependency-satisfaction` — this task
composes both.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/task-projection.mjs`) exposing a function that,
  given a task and its change, returns a state from at least: `draft`, `blocked`, `ready`,
  `active`, `waiting-for-step-start`, `human-interaction`, `terminal`, plus the facts listed
  in `areas/deterministic-projection-and-human-interaction.md` (current step, current
  attempt, next step when finished-but-not-started, blocking dependencies, available
  actions, pending human interaction, terminal outcome).
- `waiting-for-step-start` is derived directly from D37's `state: active|completed` model
  (`resolveWorkflowPosition`/`workflow_progress.state`) — the previous step is `completed`
  but `current_step` has not advanced (D37: only the next `step start` advances it). This
  applies identically on a review-fail loop back to implementation — the projection reports
  `waiting-for-step-start` pointing at implementation, never an auto-activated attempt.
- Before `workflow_progress` exists: derive `draft`/`ready`/`blocked` purely from the
  task's publish state (`task.status: draft` vs. the `workflow-task-publish-operation`
  task's `approved`-as-published compatibility value) and the dependency-satisfaction
  result — never from `isTaskReady()`.
- This module is read-only/derived — it must not write any state.
- Do not import `tools/specs/lifecycle-primitives.mjs`'s `isTaskReady`/`stageForStatus`-style
  legacy helpers as the source of any deterministic fact (facts may still be computed from
  raw `task.status` where that's explicitly the publish-state input, per the area doc).

## Acceptance criteria

- A task that just finished implementation, with review not yet started, projects
  `waiting-for-step-start`, never `active` or `human-interaction` (brief regression test
  #12). `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- The same distinct state applies after a review-fail loop back to implementation — the
  projection never auto-activates the new implementation attempt.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- A draft, unpublished task projects `draft` and reports no available execution actions.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- A published task with an unsatisfied dependency projects `blocked` and names the specific
  blocking dependency task(s). `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- A task with a pending human interaction projects `human-interaction` and includes the
  human-interaction projection's descriptor. `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- A task at a successful terminal workflow state projects `terminal` with its outcome.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/workflow-step-runner.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The readiness policy that consumes this projection to gate execution — task
`deterministic-readiness-policy`. Any UI rendering of this projection.
