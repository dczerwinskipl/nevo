# Area: Deterministic projection and human step

## Responsibility

Own the one canonical deterministic task state/readiness projection and the human-step
projection it composes (D5) — the single source of truth every other consumer (readiness
policy, dashboard `actions.mjs`, `TaskCard`, the human-review surface, chat) reads instead
of re-deriving deterministic state from legacy helpers, a literal step name, or a
`HumanVerificationGate`-shaped `verification`/`decision` model.

This area replaces the change's original `deterministic-projection-and-human-interaction`
area outright, per D5 — no code from that design is being migrated forward; nothing was
implemented against it before this correction.

## Current state

No canonical projection exists. `resolveWorkflowPosition(definition, task)`
(`tools/specs/workflow/step-runner.mjs`) already resolves current/next step purely from
`(workflow_progress, definition)` without consulting `task.status` — this area wraps and
extends that, it does not replace it. `areas/step-executor-model.md` adds `executor`,
transition `action` metadata, and terminal `outcome` to the definition schema this area
reads. Legacy dependency satisfaction (`depsSatisfied`/`DEPENDENCY_SATISFYING_STATUSES` in
`tools/specs/lifecycle-primitives.mjs`) is off-limits to this area entirely (D8) — not just
"deliberately not reused," but structurally unimportable.

## Requirements

**Human-step projection** (built on `executor`, not on `HumanVerificationGate`):

- A backend projection returning, for a task's current step: `null` when the step's
  `executor` is `agent` or no human interaction is currently pending, or a descriptor
  shaped `{ step: { id, executor: 'human', purpose, expectedWork }, actions: [{ result,
  label, feedbackRequired }], artifacts? }` when the step is human-owned and active. `purpose`/
  `expectedWork` come straight from existing step metadata (no new fields beyond what
  `areas/step-executor-model.md` adds); `actions` come from that step's transition `action`
  metadata. `artifacts` stays present-but-unpopulated in this change (extensibility point
  only — D9/out-of-scope: no artifact/handover system built now).
- Must not check `currentStep === 'human-verification'` or any literal step name/id, and
  must not reintroduce a `kind: 'verification' | 'decision'` distinction — `executor` +
  `transitions` already carry that semantics; a single `actions` list (one result for a
  confirm-only step, two-plus for a multi-outcome step) covers both without a separate
  taxonomy.
- Remains correctly distinct from a step's own `entryGates`/`exitGates` (`type: human`):
  an `executor: agent` step with a pending human *gate* confirmation is not reported by this
  projection as a human-owned active step (it's still an agent step, merely blocked by a
  gate) — that distinction is asserted explicitly by this area's acceptance criteria.

**Canonical deterministic task projection**:

- One module exposing, per task, a state drawn from at least: `draft`, `blocked`, `ready`,
  `active`, `waiting-for-step-start`, `human-interaction`, `terminal`.
- Facts exposed: current step, **executor** (of the current/next step), current attempt,
  next step when the previous step completed but the next has not started
  (`waiting-for-step-start` — D37: only the next `step start` advances `current_step`; this
  applies identically after a review-fail loop back to an agent step, never auto-activated),
  blocking dependencies (from dependency satisfaction below), available actions, the pending
  human-step projection (if any), and terminal state/outcome.
- Before `workflow_progress` exists: `draft`/`ready`/`blocked` derive from the task's
  publish state (`workflow-task-publish-operation`'s `task.status: draft` vs.
  `approved`-as-published) and dependency satisfaction — never `isTaskReady()`.

**Deterministic dependency satisfaction (D9):**

- A dependency is satisfied only when the dependency task's workflow has reached a terminal
  step whose definition-level `outcome` is explicitly `success` (`areas/step-executor-model.md`)
  — never a legacy status value, and never inferred from a step being named a particular
  way. A task whose implementation finished but is still awaiting/under review, awaiting a
  human decision, sent back for changes, or reached a `outcome: failure` terminal, does not
  satisfy downstream dependencies.

## Constraints

- Pure/derived read logic only in this area — no new persisted field beyond what
  `workflow-task-publish-operation` and `step-executor-model` already introduce.
- Must not import `tools/specs/lifecycle-primitives.mjs` (D8) or any legacy mutation module.

## Interfaces and boundaries

Exposes: the task-projection function and the human-step projection function.

Consumed by: `areas/execution-readiness-and-session-bootstrap.md` (readiness policy),
`areas/dashboard-server-actions-wiring.md` (the actual action DTO), `areas/ui-dashboard-board-split.md`,
`areas/human-review-surface.md`, and chat.

## Area-specific acceptance criteria

- A task that just finished an agent step, with the next step (agent or human) not yet
  started, projects `waiting-for-step-start` — never `active` or `human-interaction` —
  regardless of the next step's executor.
- The same applies after a review-fail loop back to an agent step: the projection never
  auto-activates the new attempt.
- A downstream task depending on a task whose current terminal step's `outcome` is
  `success` is reported dependency-satisfied; `outcome: failure`, or non-terminal
  (including implemented-but-awaiting-review or awaiting a human decision), is reported
  unsatisfied.
- The human-step projection returns a correct non-null descriptor for a step whose
  `executor: human` and whose id/purpose is not literally `human-verification` — proving
  the mechanism is executor-driven, not name-driven.
- An `executor: agent` step with a pending `entryGate`/`exitGate` (`type: human`)
  confirmation is projected as an agent step blocked on a gate — never as the human-step
  projection's non-null "human-owned active step" result. The two mechanisms' outputs are
  asserted distinct in the same test.
- No file in this area's module(s) references the literal string `'human-verification'`,
  `'owner-review'`, or `'acceptance'` as a control-flow condition.

## Dependencies

`areas/step-executor-model.md` (`executor`, transition `action` metadata, terminal
`outcome` — all three schema fields this area's projections read).

## Out of scope

Any redesign of `entryGates`/`exitGates`' own scoping/persistence engine (unchanged, kept
distinct). A full artifact/handover-attachment system (the `artifacts?` field stays
extensible but unpopulated). A full multi-outcome/retry terminal model beyond D9's one field.
