# Area: Dashboard server actions wiring

## Responsibility

Build `DashboardActionProjection` (D10) — composing `TaskProjection`
(`areas/deterministic-projection-and-human-step.md`) and `ExecutionReadiness`
(`areas/execution-readiness-and-session-bootstrap.md`) into the dashboard's actual action
DTO (`tools/dashboard/server/specs/actions.mjs`) — the file the UI really reads — replacing
its current legacy-derived deterministic branch with generic state fields, **one** generic
`start-step` lifecycle action (D15 — never a per-step or per-executor action id) and an
explicit tier-1 step descriptor; add the one new, generic HTTP transport `HumanStepSurface`
calls to reach `startHumanStep`/`submitHumanStepResult` (D14); and split `actions.mjs`'s
legacy and deterministic mutation implementations so neither calls the other.

## Current state

Read directly (2026-09-19): `computeTaskAvailableActions()` (`actions.mjs`) hardcodes
`wp.current_step === 'implementation'`/`'review'`/`'human-verification'` and the literal
destination strings `'human-verification'`/`'review'`/`'implementation'`/`'verified'` to
produce action ids `'start-implementation'`/`'start-review'`/`'approve'`/
`'request-changes'`/`'operator-reconciliation'`. `computeTaskWorkflowProjection()` exposes
only `{status, currentStep, attempt, workflowState}` — plain strings, no descriptor object,
so nothing today lets a client show `purpose`/`expectedWork` before a step is active.
`tools/dashboard/server/specs/routes.mjs`'s `handleHumanDecision` /
`tools/dashboard/server/specs/actions.mjs`'s `executeHumanDecision` are the one existing
deterministic mutation path: `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`
hardcodes its body to `{ decision: 'approve'|'request-changes', feedback }`, translates it
to `{ approve, requestChanges, feedback }`, and calls `handleWorkflowVerifyHuman` (the CLI
handler) directly. There is no route for explicitly activating a waiting human step
(`startHumanStep`), and no route accepting an arbitrary definition-driven `result`
(`submitHumanStepResult`) — introducing those two domain operations elsewhere in this
change (`areas/step-executor-model.md`) does not, by itself, give a browser any way to call
them.

## Requirements

**`DashboardActionProjection` (the DTO):**

- Replace `actions.mjs`'s deterministic action-derivation branch with a call composing
  `TaskProjection` **and** `ExecutionReadiness` (D10 — not `TaskProjection` alone, since
  `availableActions` is a readiness-dependent fact `TaskProjection` deliberately does not
  own) — the branch must no longer read `task.status`, call `isTaskReady`, or compare
  `wp.current_step`/a transition's `to` against a literal step name.
- The deterministic action DTO this file returns exposes at least: `state`, `executor`,
  `attempt`, `blockedBy`, terminal outcome, an explicit **current/next-step descriptor**
  (e.g. `currentStepDescriptor`/`nextStepDescriptor`, whichever is the relevant target for
  the task's present state — `{ id, executor, purpose, expectedWork }`, sourced from
  `TaskProjection`'s tier-1 generic descriptor, present *before* activation so
  `HumanStepSurface` never has to reconstruct `purpose`/`expectedWork` from a step id), the
  human-step interaction descriptor (tier 2) when applicable, and `availableActions` kept
  generic (D15, D18's frontend type note — `string[]`, not a new object-union type):
  `["start-step"]` when the current position is waiting for a start and `ExecutionReadiness`
  allows it, for **either** executor — never `'start-agent-step'`/`'start-human-step'`/
  `'start-implementation'`/`'start-review'` as distinct ids. The caller reads the step
  descriptor's own `executor` field to know which execution protocol `start-step` triggers;
  the action id itself never encodes it. The server never derives `availableActions` by
  comparing a step's `id`/`currentStep`/`nextStep` to a literal string anywhere in this
  branch.
- The legacy action-derivation branch (`approve`/`verify`/`finalize` and any other legacy
  read) is unchanged in behavior.

**Generic human-step transport (D14):**

- One new route, `POST /api/specs/:slug/tasks/:taskId/workflow/human-step` (plus the
  `:source/:slug` variant this file's other routes already have), body
  `{ action: 'start' } | { action: 'submit', result?, feedback?, artifacts? }` — `'start'`
  calls `startHumanStep` directly; `'submit'` calls `submitHumanStepResult` directly
  (`areas/step-executor-model.md`) — never through `handleWorkflowVerifyHuman`'s
  `--approve`/`--request-changes` compatibility layer, and never mapping a generic `result`
  back to `'approve'`/`'request-changes'`.
- Route-level body validation is generic and definition-driven: `action` is one of the two
  literals; `result`, when present, is passed through as an opaque string — its legality
  against the active step's actual transitions is `submitHumanStepResult`'s job, not this
  route's.
- Errors from the domain layer (executor mismatch, readiness failure, invalid transition
  result, missing required feedback — item 3) are returned as structured JSON (at minimum
  `code`, plus whichever of `stepId`/`executor`/`allowedResults` the specific error carries)
  with an appropriate HTTP status — never flattened into one generic `{error: string}` the
  way `executeHumanDecision`'s current catch-all does.
- The existing `/workflow/human-decision` route and `executeHumanDecision` are **not**
  removed or changed — they remain for `handleWorkflowVerifyHuman`'s own CLI-compatibility
  callers. This area adds the new route alongside it; it does not migrate the old one.

**Mutation split:**

- Split the file's *mutation* handling: shared composition/routing resolves `workflowMode`
  once, then dispatches to a legacy mutation implementation or a deterministic mutation
  implementation — two separate modules/functions, not one function with a large
  `if legacy / if deterministic` branch. Neither implementation calls into the other's
  mutation operations (mirrors the CLI-level guard pattern from
  `areas/lifecycle-boundary-guards.md`, applied here at the dashboard-server layer). This
  split covers the *existing* `executeHumanDecision`/`approveTask`/`verifyTask`/
  `finalizeChange` functions in `actions.mjs` — the new human-step transport route lives in
  its own, separately-owned module (`dashboard-human-step-transport`) and is not part of
  this split's file scope.
- Cover the split with the same shape of regression test the CLI guard area uses: an
  import/call-boundary check between the two mutation implementations, plus a
  before-any-mutation guard-failure check with the full side-effect assertion set.

## Constraints

- No change to the legacy action DTO's shape or values.
- No change to how the existing route/composition layer is reached from the UI for
  already-working paths — only the server-side derivation logic and the addition of the one
  new route change.

## Interfaces and boundaries

Exposes: the corrected deterministic action DTO (with tier-1 descriptor and generic
actions), consumed by `status-board.tsx`/`TaskCard` (`areas/ui-dashboard-board-split.md`)
and `TaskDialog`/chat (`areas/human-step-surface.md`); the new `workflow/human-step`
transport route, consumed by the one neutral `shared/lib` transport function
(`dashboard-human-step-transport`, a separate task) that each feature's own thin adapter
hook calls in turn (D17, `areas/human-step-surface.md`).

Consumed by: every dashboard UI surface that currently reads `actionGate`/
`availableActions` for a deterministic spec.

## Area-specific acceptance criteria

- The deterministic action DTO for a task whose `status` is still the `approved`
  compatibility value but whose `workflow_progress.current_step` is a non-`implementation`
  agent step (e.g. `hardening`) reflects that state accurately — not a `status`-derived
  stale result, and not something only correct for `implementation`/`review` specifically.
- The DTO's current/next-step descriptor is populated for a task in `waiting-for-step-start`
  whose next step is human-owned, *before* that step is activated — including its `purpose`/
  `expectedWork`. The human-step interaction descriptor (tier 2) remains absent until that
  step is actually active.
- `availableActions` is exactly `["start-step"]` when the current position is waiting and
  `ExecutionReadiness` allows it — identical for an agent step and a human step (the caller
  distinguishes protocol via the step descriptor's `executor`, not the action id) — never
  `start-agent-step`/`start-human-step`/`start-implementation`/`start-review`/any
  step-id-derived string.
- `availableActions` reflects `ExecutionReadiness`'s output, not a re-derivation of
  readiness inside `actions.mjs` itself — a task blocked by an unsatisfied dependency or an
  executor mismatch reports an empty action set.
- Two tasks, both `state: 'active'`, with different step ids (e.g. `review` and `hardening`)
  produce structurally identical DTO shapes differing only in their step descriptor's
  `id`/`purpose`/`expectedWork` — proving the DTO derivation never special-cases a
  particular step id.
- Grepping the deterministic branch (both the DTO derivation and the new transport module)
  for `task.status`, `isTaskReady`, or any literal step-name comparison (`'implementation'`,
  `'review'`, `'human-verification'`, or any other specific step id) returns none.
- The legacy action DTO's output is byte-for-byte unchanged for a legacy spec (regression
  test against existing fixtures).
- No deterministic mutation implementation in this file calls a legacy mutation function
  (`approveTask`/`verifyTask`/finalize) and vice versa — asserted by the import/call-boundary
  regression test.
- A cross-mode mutation attempt through this file's existing route fails before any
  mutation, with the same side-effect assertions as `areas/lifecycle-boundary-guards.md`'s
  CLI-level test.

## Dependencies

`areas/deterministic-projection-and-human-step.md` (`TaskProjection`),
`areas/execution-readiness-and-session-bootstrap.md` (`ExecutionReadiness` — both compose
into `DashboardActionProjection`, D10), `areas/step-executor-model.md`
(`startHumanStep`/`submitHumanStepResult`, called directly by the new transport, D14).

## Out of scope

Any change to the session-creation route
(`areas/execution-readiness-and-session-bootstrap.md` owns that). Removing or changing the
existing `/workflow/human-decision` route. Any per-step dispatch/execution-mode logic
whatsoever (D15 — this area emits only the one generic `start-step` action; there is no
adapter, transitional or otherwise, for this area or any other to own).
