# Area: Deterministic projection and human interaction

## Responsibility

Own the one canonical deterministic task state/readiness projection and the human-
interaction projection it composes — the single source of truth every other consumer
(dependency satisfaction, readiness policy, dashboard, `TaskCard`, `TaskDialog`, chat)
reads instead of re-deriving deterministic state from legacy helpers or a literal step name.

## Current state

No such projection exists. `resolveWorkflowPosition(definition, task)`
(`tools/specs/workflow/step-runner.mjs`) already resolves current/next step purely from
`(workflow_progress, definition)` without consulting `task.status` — this area wraps and
extends that, it does not replace it. Dependency satisfaction today
(`depsSatisfied`/`DEPENDENCY_SATISFYING_STATUSES` in `tools/specs/lifecycle-primitives.mjs`)
treats legacy `implemented`/`verified`/`archived` as satisfying — deliberately not reused for
deterministic tasks. `HumanVerificationGate` exists and is properly scoped
(`tools/specs/workflow/gates/human-gate.mjs`), but the one place that checks "is human
review pending" (`handleWorkflowVerifyHuman` in `tools/specs/workflow/cli.mjs`) hardcodes
the literal string `'human-verification'`.

## Requirements

**Human-interaction projection** (built first; the task projection composes it):

- A backend projection describing pending human interaction without naming a literal step:
  conceptually `{ kind: 'verification' | 'decision', actions: [...] }` — `verification`
  exposes `confirm`; `decision` exposes `approve`/`request-changes` plus whether feedback is
  required. Built from the existing `HumanVerificationGate`/`FileHumanVerificationStore`
  scoping (task/step/gate id/attempt), not a redesign of that engine.
- `null`/absent when no human interaction is currently pending for the task.

**Canonical deterministic task projection**:

- One module exposing, per task, a state drawn from at least: `draft`, `blocked`, `ready`,
  `active`, `waiting-for-step-start`, `human-interaction`, `terminal`.
- Facts exposed: current step, current attempt, the next step when the previous step
  completed but the next has not started (D37: `step finish` does not auto-advance —
  `waiting-for-step-start` is a first-class distinct state from an active next step, never
  conflated with it, including on a review-fail loop back to implementation), blocking
  dependencies (from the dependency-satisfaction requirement below), available deterministic
  actions, the pending human interaction (if any, from the human-interaction projection
  above), and terminal state/outcome.
- Derived read-only from `workflow_progress` + workflow definition + task's publish state
  (`task.status: draft` vs. `approved`-as-published, until `workflow_progress` exists) +
  the dependency-satisfaction result below. Never derived from `isTaskReady()`/
  `stageForStatus()`.

**Deterministic dependency satisfaction**:

- A dependency is satisfied only when the dependency task has reached a successful terminal
  workflow state (per its own workflow definition), derived from that task's own
  `workflow_progress` + definition — never from legacy `DEPENDENCY_SATISFYING_STATUSES`. A
  task whose implementation finished but is still awaiting/under review/awaiting a human
  decision/sent back for changes does not satisfy downstream dependencies.

## Constraints

- Pure/derived read logic only in this area — no new persisted field beyond what
  `workflow task publish` already introduced (area `deterministic-task-publish`).
- Must not import any legacy mutation module (guard area's regression test covers this).

## Interfaces and boundaries

Exposes: the projection function(s) (task state + facts) and the human-interaction
projection function.

Consumed by: `areas/execution-readiness-and-session-bootstrap.md` (readiness policy),
`areas/ui-dashboard-board-split.md`, `areas/ui-task-details-human-review.md` (human-review
surface), and chat/session bootstrap.

## Area-specific acceptance criteria

- A task that just finished implementation, with review not yet started, projects
  `waiting-for-step-start` (or equivalent distinct state) — never `active`/`human-interaction`.
- A task sent back for changes (review fail → next step implementation) projects the same
  `waiting-for-step-start`-shaped state pointing at implementation, not an auto-activated
  implementation attempt.
- A downstream task depending on a task that is implemented-but-awaiting-review is not
  reported as dependency-satisfied.
- A downstream task depending on a task that reached a successful terminal workflow state is
  reported as dependency-satisfied.
- The human-interaction projection is non-null exactly when `HumanVerificationGate` would
  currently block progress for that task/step/attempt, regardless of which step owns the
  gate — proven by testing it against a gate attached to a step other than one literally
  named `human-verification`.
- No file in this area's module(s) references the literal string `'human-verification'` as a
  control-flow condition (the existing hardcoded check in `workflow verify-human` is owned by
  this area to remove, per the human-interaction projection above).

## Dependencies

`areas/deterministic-task-publish.md` (a task's publish state is one of the projection's
inputs before `workflow_progress` exists).

## Out of scope

Any redesign of `HumanVerificationGate`'s own scoping/persistence engine. Any change to
legacy dependency semantics.
