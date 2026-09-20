# Area: Step-executor model

## Responsibility

Give every deterministic workflow step an explicit `executor: agent | human` property with
its own execution protocol, enforce it as an invariant, add a per-transition `outcome`
field for terminal transitions, and build the human-step execution operations
(`startHumanStep`/`submitHumanStepResult`) as thin, generic wrappers over the engine's
existing activation/finish machinery — replacing the literal `'human-verification'`
step-name coupling, distinct from the existing `entryGates`/`exitGates` (`type: human`)
confirmation mechanism.

## Current state

No step in any of the five workflow definitions declares an `executor`. The only place
"this step needs a human" is expressed today is `handleWorkflowVerifyHuman`'s `--approve`/
`--request-changes` branch hardcoding `targetStep === 'human-verification'`
(`tools/specs/workflow/cli.mjs`) — a branch that otherwise already does almost everything
needed: it resolves the target step via `resolveWorkflowPosition`, already calls
`ensureStepActivated` to activate it when not active, and already calls the generic
`finishStep` with `{ result: 'pass'|'fail', feedback }`, which itself already matches
`result` against the active step's declared `transitions[].value`. Nothing prevents
`workflow step start` from being called against a would-be human step regardless of who is
meant to execute it. Transition metadata is currently `{ to }`/`{ value, to }` only — no
`action`/label/feedback metadata, no `outcome`.

Per-definition audit (2026-09-19, D6): `standard.yaml`/`standard-v1.yaml` (identical) have a
genuine standalone `human-verification` step with its own transitions
(`pass→verified`, `fail→implementation`) and no gates of its own — this is the only
human-owned step across all five definitions. `architectural.yaml`/`exploratory.yaml` each
have one agent step (`implementation`/`discovery`) whose `exitGates` include
`{type: human, required: true}` — a confirmation gate on an agent-executed step, not a
human-owned step; the step's own transition is unconditional (`{to: verified}`), no `value`.
`small.yaml` is agent-only, no human gate at all. Every terminal transition across all five
files currently targets `verified` — none currently models a failure-terminal transition.

## Requirements

**Schema (D6, D9):**

- Add `executor: agent | human` to the step schema (`tools/specs/workflow/definitions/schema.mjs`),
  validated by `tools/specs.mjs validate`. Absent `executor` defaults to `agent`.
- Add minimal transition `action` metadata: `{ label, feedback?: { required: boolean } }`
  per transition — additive, optional for an `executor: agent` step's transitions. For an
  `executor: human` step, **every** transition must declare `action.label` as a non-empty
  string (cross-field validation, item 6) — a human step with a selectable transition the
  UI cannot render a label for is a validation error, not a runtime UI gap. If present,
  `action.feedback.required` must be a boolean.
- Add `outcome: success | failure` on a **transition** whose `to` targets a terminal status
  (a member of `TERMINAL_STATUSES`, imported from `areas/shared-status-vocabulary.md`'s
  extracted module) — never on a step, since this engine has no "terminal step" concept;
  every transition's `to` is either a declared step (internal, no `outcome` needed/allowed)
  or a terminal status (requires `outcome` on any *newly authored* definition — fail-closed,
  no silent default).
- Migrate the five existing definitions per the audit above: `standard.yaml`/
  `standard-v1.yaml`'s `human-verification` step gets `executor: human` and `action`
  metadata on both its transitions (`pass` → e.g. `{label: Approve}`, `fail` → e.g.
  `{label: Request changes, feedback: {required: true}}` — exact wording is a product
  choice, not schema-mandated); every terminal transition in all five files (currently only
  `{to: verified}`/`{value: pass, to: verified}` shapes) gets `outcome: success`.
  `architectural.yaml`/`exploratory.yaml`/`small.yaml` get **no** `executor` field changes
  (their steps stay implicitly `executor: agent`) and their existing `type: human` gates
  are untouched.
- **`normalizeWorkflowDefinition()` must preserve the new fields and canonicalize `executor`
  (items 1 and 4).** Today it drops `executor` entirely and its `transitions.map(...)`
  copies only `value`/`to` — confirmed by reading the function directly. Every runtime
  consumer (`step-context.mjs`, `finish-operation.mjs`, and this change's own projections)
  reads the *normalized* object, never the raw parsed one, so a definition that validates
  successfully must not lose this metadata on normalization. The normalized step must
  always carry an explicit `executor` — `normalizedStep.executor = stepConfig.executor ??
  'agent'`, on every step, never left absent — so no downstream consumer re-derives the
  default itself; `step.executor === 'agent' | 'human'` is safe with no "undefined" case.
  The normalized transition must retain `action` and `outcome` (when present) alongside the
  existing `value`/`to`. The raw YAML source is unaffected by this — an agent-only
  definition still never needs to write `executor: agent`.
- **Unconditional human-step transitions (D16, item 7).** A human step may legally have a
  single unconditional transition (`transitions: [{ to: <step>, action: { label: ... } }]`,
  no `value`) — schema validation requires `action.label` on it exactly as for a conditional
  transition, but does **not** require or invent a `value`/`result` for it.

**Enforced invariant:**

- `workflow step start` rejects a step with `executor: human` before any mutation, with a
  structured error (code `WORKFLOW_STEP_EXECUTOR_MISMATCH`, step id, executor, purpose,
  expected work, available results/transitions) worded so an agent stops instead of
  retrying a different lifecycle operation. `workflow step finish` gets the same guard for
  defense in depth.
- `startHumanStep`/`submitHumanStepResult` (below) reject an `executor: agent` (or
  defaulted-absent) step the same way, symmetric error shape.
- One guard function implements both directions — not duplicated per call site. The same
  function is reused by `ExecutionReadiness` (`areas/execution-readiness-and-session-bootstrap.md`)
  for session/execution bootstrap.

**Human-step execution operations (D12 — reuse, not reinvention):**

- Both operations call `resolveWorkflowMode()` first and fail, before any mutation, if the
  spec resolves to legacy — `deterministic-mutation-guard` explicitly scoped itself to only
  the two pre-existing CLI entry points and deferred this guard, for these two new
  operations, to this area/task.
- `startHumanStep(change, task, definition, context)`: rejects unless the target step's
  `executor === 'human'`; otherwise calls the engine's existing, unmodified
  `ensureStepActivated` directly (`step-context.mjs`) — same function `workflow step start`
  already uses, same clean-worktree/finish-operation-settled preconditions (D13, preserved
  as-is). Unlike `handleWorkflowStepStart`, it does **not** call `autoBindAgentSession` —
  no AI execution session is created or bound for a human step.
- `submitHumanStepResult(change, task, definition, context, {result, feedback, artifacts})`:
  rejects unless the *active* step's `executor === 'human'`. `result` is required only when
  the active step's own transitions are conditional (more than one, or one declaring
  `value`) — for a single unconditional transition, `result` must be omitted, never
  fabricated (D16). Before calling `finishStep`, this operation resolves the selected
  transition itself (conditional: the one whose `value === result`; unconditional: the
  sole transition) and, when that transition's `action.feedback.required` is `true`,
  rejects a missing/blank `feedback` — **before any mutation** (item 3). This is the one
  authoritative server/domain validation path for this requirement; it is not enforced by
  `HumanStepSurface`, and it is not folded into the generic finish contract
  (`buildFinishContract`, which stays UI-metadata-agnostic — agent `workflow step finish`
  must not depend on `action.label`/`action.feedback` at all). Once resolved, it calls the
  engine's existing, unmodified `finishStep` directly (`finish-operation.mjs`) with the
  caller's inputs — `finishStep` still independently validates `result` against the step's
  declared transitions and runs the same fixed finalize stage sequence used for agent
  steps; this operation's own transition resolution is for the feedback-requirement check
  only, not a second, duplicate copy of `finishStep`'s own result-matching logic.
- `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch is replaced by these
  two operations: its literal `targetStep !== 'human-verification'` check becomes the
  executor check above; its `isApprove ? 'pass' : 'fail'` mapping becomes CLI-level
  compatibility sugar over a generic `result` parameter (the domain operation itself never
  hardcodes `'pass'`/`'fail'` as "approve"/"reject" — it only validates `result` against
  whatever the active step's transitions declare). `workflow verify-human --confirm` (the
  `entryGates`/`exitGates` gate-confirmation path) is completely untouched — different
  branch, different mechanism, unchanged code.

## Constraints

- `entryGates`/`exitGates` (`type: human`) are unmodified and untouched by this area — they
  remain "another executor's step, blocked pending human confirmation," a distinct concept
  from "this step is executed by a human." Do not merge the two mechanisms or let one
  subsume the other's schema/behavior.
- The engine's own transition-resolution logic (`finishStep`/`ensureStepActivated`/
  `resolveWorkflowPosition`) must not understand "owner-review," "acceptance,"
  "human-verification," or "Approve" specifically — those are definition/projection-level
  concepts, expressed only through `executor` and the generic `action` metadata.
- `startHumanStep`/`submitHumanStepResult` must not duplicate any logic already implemented
  by `ensureStepActivated`/`finishStep` — they are thin, executor-gated wrappers, not a
  parallel implementation (D12).

## Interfaces and boundaries

Exposes: the `executor`/`action`/`outcome` schema fields; the executor-guard function; the
`startHumanStep`/`submitHumanStepResult` domain operations.

Consumed by: `areas/deterministic-projection-and-human-step.md` (reads `executor`/`action`/
`outcome`), `areas/execution-readiness-and-session-bootstrap.md` (reuses the executor
guard), `areas/dashboard-server-actions-wiring.md` (the new generic transport route, D14,
calls these two operations directly, and the existing mutation split's deterministic branch
keeps calling `handleWorkflowVerifyHuman`, which itself now calls these operations
internally), `areas/human-step-surface.md` (calls them indirectly, through that transport).

## Area-specific acceptance criteria

- All five existing workflow definitions validate against the extended schema after
  migration; only `standard`/`standard-v1`'s `human-verification` step carries
  `executor: human`; every current terminal transition carries `outcome: success`.
- A newly authored definition with a human step whose transition lacks `action.label` fails
  validation. A newly authored definition with a transition targeting a terminal status but
  no `outcome` fails validation.
- A step with no `executor` declared defaults to `agent` and behaves exactly as before this
  area.
- `workflow step start`/`workflow step finish` against a step with `executor: human` fails
  with the structured error, before any mutation.
- `startHumanStep` against a step with `executor: human` and no active AI session
  requirement succeeds, activating via `ensureStepActivated` and never calling
  `autoBindAgentSession`. Against an `executor: agent` step it fails with the structured
  error, before any mutation.
- `submitHumanStepResult` with a `result` matching one of the active human step's
  transitions succeeds via `finishStep`, unchanged finalize behavior. Against an
  `executor: agent` active step it fails with the structured error, before any mutation.
- `startHumanStep`/`submitHumanStepResult` against a legacy spec each fail via
  `resolveWorkflowMode()`, before any mutation — the mode guard `deterministic-mutation-guard`
  explicitly deferred to this area.
- `workflow verify-human --confirm` behavior is byte-for-byte unchanged.
- The engine's transition-resolution logic contains no reference to `'human-verification'`,
  `'owner-review'`, `'acceptance'`, or `'Approve'` as literal strings.
- The object returned by both `parseWorkflowDefinition()` and `loadWorkflowDefinition()`
  (not just `validateWorkflowDefinition()`'s boolean result) carries `executor` on the
  migrated `human-verification` step, and `action`/`outcome` on its transitions, for all
  five definitions — proving normalization actually preserves this metadata, not just that
  validation accepts it.
- `submitHumanStepResult` called with `result: 'fail'` against a human step whose `fail`
  transition declares `action.feedback.required: true`, with no `feedback` (or blank
  `feedback`), fails before any mutation — `change.yaml`/`workflow_progress` unchanged.
  Called with valid feedback, it succeeds. Called against a transition where feedback is
  optional, it succeeds with or without feedback.
- `submitHumanStepResult` called against a human step with a single unconditional
  transition, with `result` omitted, succeeds and completes that transition — no fabricated
  `result` value is ever passed to `finishStep`.

## Dependencies

`areas/shared-status-vocabulary.md` (`TERMINAL_STATUSES` for `outcome` validation).

## Out of scope

Any change to `entryGates`/`exitGates` or `workflow verify-human --confirm`. A full
multi-named-outcome or retry-semantics terminal model (D9 — only one `outcome` field is
added, on the transition). Any UI rendering of this schema (owned by the projection/UI
areas).
