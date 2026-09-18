# Area: Dashboard server actions wiring

## Responsibility

Wire the canonical deterministic task projection into the dashboard's actual action DTO
(`tools/dashboard/server/specs/actions.mjs`) — the file the UI really reads — replacing its
current legacy-derived deterministic branch, and split that file's legacy and deterministic
mutation implementations so neither calls the other.

## Current state

`tools/dashboard/server/specs/actions.mjs` currently derives deterministic actions from
`task.status`, `isTaskReady`, the literal string `'human-verification'`, and hardcoded
transition-destination names — introducing the canonical projection module elsewhere in
this change does not, by itself, fix what the UI reads, since nothing in the original task
set named this file explicitly. The same file mixes legacy `approve`/`verify`/`finalize`
mutation handling with deterministic human-workflow mutation operations (the server-side
counterpart of `workflow verify-human`/the executor-guarded human-decision operation).

## Requirements

- Replace `actions.mjs`'s deterministic action-derivation branch with a call into the
  canonical task projection (`areas/deterministic-projection-and-human-step.md`) — the
  branch must no longer read `task.status`, call `isTaskReady`, check the literal string
  `'human-verification'`, or hardcode a transition-destination name.
- The deterministic action DTO this file returns exposes at least: `state`, `currentStep`,
  `nextStep`, `executor`, `attempt`, `blockedBy`, `availableActions`, human-step metadata/
  actions when applicable (from the human-step projection), and terminal outcome.
- The legacy action-derivation branch (`approve`/`verify`/`finalize` and any other legacy
  read) is unchanged in behavior.
- Split the file's *mutation* handling: shared composition/routing resolves `workflowMode`
  once, then dispatches to a legacy mutation implementation or a deterministic mutation
  implementation — two separate modules/functions, not one function with a large
  `if legacy / if deterministic` branch. Neither implementation calls into the other's
  mutation operations (mirrors the CLI-level guard pattern from
  `areas/lifecycle-boundary-guards.md`, applied here at the dashboard-server layer).
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
(`areas/human-review-surface.md`).

Consumed by: every dashboard UI surface that currently reads `actionGate`/
`availableActions` for a deterministic spec.

## Area-specific acceptance criteria

- The deterministic action DTO for a task whose `status` is still the `approved`
  compatibility value but whose `workflow_progress.current_step` is `review` reflects
  `review`-appropriate state/actions — not a `status`-derived stale result.
- The DTO includes `executor` for the current/next step, and human-step metadata/actions
  exactly when the human-step projection is non-null.
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

`areas/deterministic-projection-and-human-step.md` (the projection this area wires in).

## Out of scope

Any change to the session-creation route (`areas/execution-readiness-and-session-bootstrap.md`
owns that). Any new dashboard API endpoint — this area corrects the existing one.
