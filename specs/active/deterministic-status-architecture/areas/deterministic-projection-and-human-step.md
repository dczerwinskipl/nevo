# Area: Deterministic projection and human step

## Responsibility

Own the one canonical deterministic task state projection (`TaskProjection`, D10) — pure
workflow/domain state, no runtime-dependent action availability — and the human-step
projection it composes (D5). This is the single source of truth every other consumer reads
for workflow *state*; `ExecutionReadiness`/`DashboardActionProjection`
(`areas/execution-readiness-and-session-bootstrap.md`,
`areas/dashboard-server-actions-wiring.md`) are the separate, higher layers that turn this
state into actionable, availability-checked application actions (D10).

This area replaces the change's original `deterministic-projection-and-human-interaction`
area outright, per D5 — no code from that design is being migrated forward.

## Current state

No canonical projection exists. `resolveWorkflowPosition(definition, task)`
(`tools/specs/workflow/step-runner.mjs`) already resolves current/next step purely from
`(workflow_progress, definition)` without consulting `task.status` — this area wraps and
extends that, it does not replace it. `areas/step-executor-model.md` adds `executor`,
transition `action` metadata, and per-transition `outcome` to the definition schema this
area reads. Legacy dependency satisfaction (`depsSatisfied`/`DEPENDENCY_SATISFYING_STATUSES`
in `tools/specs/lifecycle-primitives.mjs`) is off-limits to this area entirely (D8).

## Requirements

**Human-step projection** (built on `executor`, not on `HumanVerificationGate`):

- Exposes two tiers, kept structurally distinct (item 11):
  1. A **generic current/next-step descriptor**, always available regardless of activation
     state — `{ id, executor, purpose, expectedWork }`, read straight from the definition.
     This is what lets the UI render "Human action required — <purpose> — [Start review]"
     for a step in `waiting-for-step-start`, before it has ever been activated, without
     hardcoding a step id.
  2. A **human interaction actions descriptor**, present only when that step is the
     *currently active* step (`workflow_progress.state === 'active'`) and its
     `executor === 'human'` — `{ actions: [{ result, label, feedbackRequired }], artifacts?
     }`, built from that step's transition `action` metadata. `artifacts` stays
     present-but-unpopulated in this change.
- Must not check `currentStep === 'human-verification'` or any literal step name/id, and
  must not reintroduce a `kind: 'verification' | 'decision'` distinction — `executor` +
  `transitions` already carry that semantics.
- Remains correctly distinct from a step's own `entryGates`/`exitGates` (`type: human`): an
  `executor: agent` step with a pending human *gate* confirmation never populates the
  actions descriptor (it's still an agent step, merely blocked by a gate) — only tier 1's
  generic descriptor applies to it, same as any other agent step.

**Canonical deterministic task projection (`TaskProjection`, pure — D10):**

- One module exposing, per task, a state drawn from at least: `draft`, `blocked`, `ready`,
  `active`, `waiting-for-step-start`, `human-interaction`, `terminal`.
- Facts exposed: current step, **executor** (of the current/next step), current attempt,
  the generic next-step descriptor (tier 1 above) when finished-but-not-started
  (`waiting-for-step-start` — D37: only the next `step start`/`startHumanStep` advances
  `current_step`; applies identically regardless of the next step's executor, and
  identically on a review-fail loop back to an agent step — never auto-activated), blocking
  dependencies (from dependency satisfaction below), the human interaction actions
  descriptor (tier 2) when applicable, and terminal state/outcome
  (`success`/`failure`, D9).
- **Does not expose `availableActions`** or any other runtime/session/git-dependent field —
  that is `ExecutionReadiness`/`DashboardActionProjection`'s responsibility (D10). The
  human-step actions descriptor is the one exception explicitly permitted to stay here,
  because it is derived purely from the definition (transitions), not from readiness/git/
  session state.
- Before `workflow_progress` exists: `draft`/`ready`/`blocked` derive from the task's
  publish state (`workflow-task-publish-operation`'s `task.status: draft` vs.
  `approved`-as-published) and dependency satisfaction — never `isTaskReady()`.

**Deterministic dependency satisfaction (D9):**

- A dependency is satisfied only when the dependency task's workflow has reached a terminal
  transition whose `outcome` is explicitly `success`. Resolution: take the dependency
  task's `workflow_progress.history`'s last entry (`step`, `transitioned_to`, `result?`);
  look up that `step`'s declared `transitions` in the definition; find the transition whose
  `to === transitioned_to` (and `value === result` if conditional); read *that transition's*
  `outcome`. Never the step's name, never legacy `TERMINAL_STATUSES`/
  `DEPENDENCY_SATISFYING_STATUSES`. A task whose implementation finished but is still
  awaiting/under review, awaiting a human decision, sent back for changes, or reached an
  `outcome: failure` terminal transition, does not satisfy downstream dependencies.

## Constraints

- Pure/derived read logic only in this area — no new persisted field beyond what
  `workflow-task-publish-operation` and `step-executor-model` already introduce.
- Must not import `tools/specs/lifecycle-primitives.mjs` (D8) or any legacy mutation module.

## Interfaces and boundaries

Exposes: the pure task-projection function and the human-step projection function
(both tiers).

Consumed by: `areas/execution-readiness-and-session-bootstrap.md` (`ExecutionReadiness`,
built on top), `areas/dashboard-server-actions-wiring.md` (`DashboardActionProjection`,
composes this plus readiness), `areas/ui-dashboard-board-split.md`,
`areas/human-step-surface.md`.

## Area-specific acceptance criteria

- A task that just finished an agent step, with the next step (agent or human) not yet
  started, projects `waiting-for-step-start` with the generic next-step descriptor
  populated — never `active` or `human-interaction`, and never a fabricated actions
  descriptor before activation.
- The same distinct state applies after a review-fail loop back to an agent step.
- A downstream task depending on a task whose matched terminal transition has
  `outcome: success` is reported dependency-satisfied; `outcome: failure`, or non-terminal
  (including implemented-but-awaiting-review or awaiting a human decision), is reported
  unsatisfied.
- The human interaction actions descriptor is non-null exactly when the current step is
  active **and** `executor === 'human'` — proven for a step whose id is not literally
  `human-verification`.
- An `executor: agent` step with a pending `entryGate`/`exitGate` (`type: human`)
  confirmation never populates the actions descriptor — only the generic tier-1 descriptor
  applies, proven in the same test as the previous criterion.
- `TaskProjection`'s output contains no `availableActions` field or equivalent.
- No file in this area's module(s) references the literal string `'human-verification'`,
  `'owner-review'`, or `'acceptance'` as a control-flow condition.

## Dependencies

`areas/step-executor-model.md` (`executor`, transition `action` metadata, per-transition
`outcome` — all three schema fields this area's projections read).

## Out of scope

Any redesign of `entryGates`/`exitGates`' own scoping/persistence engine. A full
artifact/handover-attachment system. A full multi-outcome/retry terminal model beyond D9's
one field. `ExecutionReadiness`/`DashboardActionProjection` themselves (own areas).
