# Area: Dashboard server actions wiring

## Responsibility

Build `DashboardActionProjection` (D10) — composing `TaskProjection`
(`areas/deterministic-projection-and-human-step.md`) and `ExecutionReadiness`
(`areas/execution-readiness-and-session-bootstrap.md`) into the dashboard's actual action
DTO (`tools/dashboard/server/specs/actions.mjs`) — the file the UI really reads — replacing
its current legacy-derived deterministic branch, and split that file's legacy and
deterministic mutation implementations (including wiring the generic
`submitHumanStepResult` operation) so neither calls the other.

## Current state

`tools/dashboard/server/specs/actions.mjs` currently derives deterministic actions from
`task.status`, `isTaskReady`, the literal string `'human-verification'`, and hardcoded
transition-destination names — introducing the projection module elsewhere in this change
does not, by itself, fix what the UI reads, since nothing in the original task set named
this file explicitly. The same file mixes legacy `approve`/`verify`/`finalize` mutation
handling with deterministic human-workflow mutation operations (the server-side counterpart
of `workflow verify-human`'s `--approve`/`--request-changes` branch, replaced by
`submitHumanStepResult` per `areas/step-executor-model.md`).

## Requirements

- Replace `actions.mjs`'s deterministic action-derivation branch with a call composing
  `TaskProjection` **and** `ExecutionReadiness` (D10 — not `TaskProjection` alone, since
  `availableActions` is a readiness-dependent fact `TaskProjection` deliberately does not
  own) — the branch must no longer read `task.status`, call `isTaskReady`, check the
  literal string `'human-verification'`, or hardcode a transition-destination name.
- The deterministic action DTO this file returns exposes at least: `state`, `currentStep`,
  `nextStep`, `executor`, `attempt`, `blockedBy`, `availableActions` (from
  `ExecutionReadiness` — "Start implementation," "Start review," "Start human step,"
  "Submit result," etc.), human-step metadata/actions when applicable (from the human-step
  projection's tier-2 descriptor), and terminal outcome.
- The legacy action-derivation branch (`approve`/`verify`/`finalize` and any other legacy
  read) is unchanged in behavior.
- Split the file's *mutation* handling: shared composition/routing resolves `workflowMode`
  once, then dispatches to a legacy mutation implementation or a deterministic mutation
  implementation — two separate modules/functions, not one function with a large
  `if legacy / if deterministic` branch. The deterministic mutation implementation wires in
  `submitHumanStepResult` (`areas/step-executor-model.md`) as its human-decision handler —
  it does not reimplement result validation/transition matching, it calls that operation.
  Neither implementation calls into the other's mutation operations (mirrors the CLI-level
  guard pattern from `areas/lifecycle-boundary-guards.md`, applied here at the
  dashboard-server layer).
- Cover the split with the same shape of regression test the CLI guard area uses: an
  import/call-boundary check between the two mutation implementations, plus a
  before-any-mutation guard-failure check with the full side-effect assertion set (no
  partial write, no session created, etc., as applicable to this layer).

## Constraints

- No change to the legacy action DTO's shape or values.
- No change to how the route/composition layer is reached from the UI — only the
  server-side derivation logic changes.

## Interfaces and boundaries

Exposes: the corrected deterministic action DTO, consumed by `status-board.tsx`/`TaskCard`
(`areas/ui-dashboard-board-split.md`) and `TaskDialog`/chat
(`areas/human-step-surface.md`).

Consumed by: every dashboard UI surface that currently reads `actionGate`/
`availableActions` for a deterministic spec.

## Area-specific acceptance criteria

- The deterministic action DTO for a task whose `status` is still the `approved`
  compatibility value but whose `workflow_progress.current_step` is `review` reflects
  `review`-appropriate state/actions — not a `status`-derived stale result.
- The DTO includes `executor` for the current/next step, and human-step metadata/actions
  exactly when the human-step projection's tier-2 descriptor is non-null.
- `availableActions` reflects `ExecutionReadiness`'s output, not a re-derivation of
  readiness inside `actions.mjs` itself — a task blocked by an unsatisfied dependency or an
  executor mismatch reports the corresponding empty/blocked action set.
- A `submitHumanStepResult`-backed mutation request through this route validates `result`
  against the active step's declared transitions via that operation, not a second,
  ad hoc check in `actions.mjs`.
- Grepping the deterministic branch for `task.status`, `isTaskReady`, or the literal string
  `'human-verification'` returns none.
- The legacy action DTO's output is byte-for-byte unchanged for a legacy spec (regression
  test against existing fixtures).
- No deterministic mutation implementation in this file calls a legacy mutation function
  (`approveTask`/`verifyTask`/finalize) and vice versa — asserted by the import/call-boundary
  regression test.
- A cross-mode mutation attempt through this file's route fails before any mutation, with
  the same side-effect assertions as `areas/lifecycle-boundary-guards.md`'s CLI-level test.

## Dependencies

`areas/deterministic-projection-and-human-step.md` (`TaskProjection`),
`areas/execution-readiness-and-session-bootstrap.md` (`ExecutionReadiness` — both compose
into `DashboardActionProjection`, D10), `areas/step-executor-model.md`
(`submitHumanStepResult`, wired into the deterministic mutation split).

## Out of scope

Any change to the session-creation route (`areas/execution-readiness-and-session-bootstrap.md`
owns that). Any new dashboard API endpoint — this area corrects the existing one.
