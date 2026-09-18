---
id: spec.deterministic-status-architecture
type: change
title: "Deterministic workflow status architecture"
status: draft
change: deterministic-status-architecture
---

# Deterministic workflow status architecture

A focused architecture fix that cleanly separates legacy task lifecycle from deterministic
workflow lifecycle, and makes deterministic task execution usable end-to-end from the UI,
without building full deterministic spec/task authoring yet.

## Context

Legacy lifecycle (`approve`/`start`/`complete`/`verify`, `task.status`) and deterministic
workflow lifecycle (`workflow step start`/`workflow step finish`, `workflow_progress`,
declarative workflow definitions) both exist and both mutate the same `change.yaml` task
entries, but nothing today prevents the wrong lifecycle's mutating commands from running
against the wrong kind of specification, and the UI/CLI still read legacy `task.status` in
several places that should be deterministic-execution-authoritative once a deterministic
task's workflow has started. This blocks dogfooding deterministic execution end-to-end.

This overview supersedes the narrower framing of an earlier, uncommitted draft of this same
change (single yaml-derived status axis, a `refine` step, UI board configuration) — see
`owner-decisions.md` D1. That earlier draft's process-integrity note about D18/D37 in
`specs/archive/deterministic-workflow-foundation/owner-decisions.md` remains accurate context
(the owner disputes that those entries reflect genuine deliberated approval) but is not
re-litigated by this change; D4 records that this change deliberately keeps its own
`workflow.mode: legacy` so redesigning deterministic mode doesn't require deterministic mode
to already be correct.

**Corrective pass 1 (2026-09-18, D5–D9):** the first full deterministic-flow test this
change was meant to enable failed at its very first step, before any of this change's own
tasks had been implemented. Rather than patch that failure in place, the owner directed a
correction of the architecture itself before implementation starts: the deterministic flow
does not need to stay compatible with what the original design here would have produced —
only the legacy flow needs to keep working, unaffected, throughout. The corrections (a
generic per-step `executor: agent | human` model replacing the literal
`'human-verification'` step-name/gate-based design; an enforced executor invariant;
explicit wiring of the canonical projection into the dashboard's actual action DTO; a split
of the dashboard's own mutation implementations; a tightened import boundary; and several
readiness/session-scope fixes) were recorded in D5–D9.

**Corrective pass 2 (2026-09-19, D6/D8/D9 corrected + D10–D13):** self-review against the
*actual* engine implementation (`schema.mjs`, `finish-operation.mjs`, `step-context.mjs`,
`step-runner.mjs`, `cli.mjs`, `lifecycle-primitives.mjs`, and all five
`.nevo-ai/workflows/*.yaml` files, read directly rather than assumed) found pass 1 had
itself over-corrected in several places: it modeled `outcome` on a "terminal step with no
transitions" that doesn't exist in this engine (D9, corrected — outcome lives on the
terminal *transition*); it left no task actually removing the two real, pre-existing
`lifecycle-primitives.mjs` imports its own new regression test would immediately fail
against (D8, corrected — a dedicated extraction task now owns this); it assumed every
workflow definition has a human-owned step, when only `standard`/`standard-v1` actually do
— `architectural`/`exploratory` have an agent step with a human *confirmation gate*, which
must stay a gate, not become a human-owned step (D6, corrected); it proposed a "human
decision operation" built from scratch, when the engine's existing `finishStep` already
accepts a generic `{result, feedback}` input and `ensureStepActivated` already activates a
step identically regardless of caller — the fix reuses both, rather than reinventing them
(D12); and it incorrectly claimed the engine doesn't distinguish resuming an active attempt
from starting a new one, when `ensureStepActivated` already does exactly that (D13,
correction, not a new behavior). It also separated pure workflow-domain state from
readiness/action-availability into three explicit layers (D10) and generified naming away
from "review" (D11). This document, `owner-decisions.md`, and every `areas/`/`tasks/` file
reflect pass 2's corrected state directly — there is no separate "what changed" log beyond
the decision records themselves.

## Current architecture

Grounded in repository discovery (2026-09-17, deepened 2026-09-19 by reading the actual
engine source directly):

- **Legacy mutation**: `approve`/`start`/`complete`/`verify` each live in their own
  `tools/specs/<command>/{cli,index,operation}.mjs` folder, all calling
  `setTaskStatus(change, taskId, status)` (`tools/specs/store.mjs`). Status transitions
  (`TRANSITIONS`), the terminal set (`TERMINAL_STATUSES`), the dependency-satisfying set
  (`DEPENDENCY_SATISFYING_STATUSES`), and readiness (`isTaskReady` = `status === 'approved'`
  and `depsSatisfied`) are all defined in `tools/specs/lifecycle-primitives.mjs`. None of
  these four commands call `resolveWorkflowMode()` today.
- **Deterministic mutation**: `workflow step start`/`workflow step finish`/
  `workflow verify-human` live in `tools/specs/workflow/cli.mjs`, backed by
  `step-context.mjs`/`finish-operation.mjs`/`step-runner.mjs`. They write via the distinct
  `setTaskWorkflowState(change, taskId, { status, workflowProgress })` (`store.mjs`).
  `resolveWorkflowPosition()` resolves current/next step purely from
  `(workflow_progress, definition)` — `task.status` is never consulted there. Workflow
  *definitions* live at `.nevo-ai/workflows/*.yaml`, loaded by
  `tools/specs/workflow/definitions/loader.mjs` (not `tools/specs/workflow/definitions/`
  itself, which holds only the loader/schema code, no definition content).
- **`resolveWorkflowMode(change, options)`** already exists
  (`tools/specs/workflow/compatibility.mjs`) and correctly defaults missing `workflow` to
  legacy, but is consumed only by the deterministic `workflow` CLI subtree today — this is
  the concrete gap the hard command guards below close.
- **`workflow task publish` does not exist** — confirmed absent from the repository; it is
  wholly new surface.
- **`resolveDefaultTask()`** (`tools/specs/workflow/cli.mjs`) resolves an omitted task id for
  deterministic commands by scanning for legacy `status === 'in-implementation'` — the
  concrete legacy-reliance named in "CLI default task resolution" below.
- **`HumanVerificationGate`** already exists (`tools/specs/workflow/gates/human-gate.mjs`),
  properly scoped by task/step/gate id/attempt, backed by
  `FileHumanVerificationStore`, reached only via `workflow verify-human --confirm` — this
  `--confirm` path is untouched by this change (D5/D12). Per D5, this change does **not**
  build its human-owned-step model on top of this gate mechanism — `entryGates`/`exitGates`
  (`type: human`) stay a distinct, unmodified mechanism (a gate blocks *another* executor's
  step pending confirmation); the new `executor: human` step model is a separate concept (a
  human *executes* the step and chooses its outcome).
- **`handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch** (the *other* half
  of that same CLI command, separate from `--confirm`) already does almost everything the
  step-executor model needs: it resolves the target step from `resolveWorkflowPosition`
  (active→current, completed→next, new→entryStep), already calls `ensureStepActivated` to
  activate that step when it isn't active yet, and already calls the generic `finishStep`
  with `{ result: 'pass'|'fail', feedback }` — `finishStep` itself already matches `result`
  against the active step's declared `transitions[].value` generically, with no
  step-specific knowledge. The **only** two hardcoded parts are: the literal
  `targetStep !== 'human-verification'` check (`INVALID_HUMAN_DECISION_STEP`), and the
  CLI-level mapping of `--approve`/`--request-changes` flags to `result: 'pass'/'fail'`.
  This means the "generic human action" and "human activation" this change needs are mostly
  already present in the engine, generalized rather than rebuilt from scratch (D12).
- **`ensureStepActivated`** (`step-context.mjs`) already distinguishes resuming an active
  attempt from activating a new one correctly: for `phase === 'active'`/`'terminal'` it
  returns immediately with **no** dirty-worktree check at all; the dirty-worktree check
  (`git.getDirtyPaths`, excluding `.nevo-ai-local/`) runs only for `phase === 'new'`/
  `'completed'` — i.e. only when actually activating a step. This already is "new attempt +
  dirty baseline → fail; resume active attempt + dirty worktree → allowed" (D13) — no fix is
  needed here, only correcting this document's own prior claim that it wasn't already true.
- **Terminal transitions, not terminal steps**: every step declares `transitions`; a
  transition's `to` is validated (`definitions/schema.mjs`) to be either another declared
  step (internal) or a member of `TERMINAL_STATUSES` (never both, never neither) —
  `finish-operation.mjs`'s `discriminateTarget` makes this exact distinction at runtime.
  There is no "terminal step with no transitions" concept in this engine (D9, corrected).
- **`TERMINAL_STATUSES` import boundary**: exactly two files under `tools/specs/workflow/**`
  import it from `tools/specs/lifecycle-primitives.mjs` today —
  `finish-operation.mjs` and `definitions/schema.mjs`, both for this one constant only
  (grep-confirmed 2026-09-19, D8).
- **Workflow definitions** (`.nevo-ai/workflows/*.yaml`, five files) have no per-step
  `executor` field, no transition `action` (label/feedback) metadata, and no per-transition
  `outcome` field today — all new, additive schema surface (D6, D9). Read individually
  (2026-09-19): only `standard.yaml`/`standard-v1.yaml` (identical content) have a genuine
  human-owned step — `human-verification`, with its own transitions and no gates of its
  own. `architectural.yaml` and `exploratory.yaml` each have exactly one agent step
  (`implementation`/`discovery`) with a human **confirmation gate** on its exit gates
  (`{type: human, required: true}`) — not a human-owned step. `small.yaml` is agent-only
  with no human gate at all. Every terminal transition across all five files targets
  `verified` — none currently models a failure-terminal transition.
- **Dashboard UI**: `TaskCard` (inline in
  `tools/dashboard/ui/features/specifications/detail/status-board.tsx`) already branches on
  an `isDeterministic` prop for its action footer, but its shared status label still reads
  `formatTaskStatus(task.status)` for both legacy and deterministic cards. The kanban lane
  mapping is computed server-side by `stageForStatus()`
  (`tools/dashboard/server/specs/status-stages.mjs`), hardcoded to legacy `task.status`
  values, with no workflow-mode awareness at all. **`tools/dashboard/server/specs/actions.mjs`**
  is where the `actionGate`/`availableActions` DTO the UI actually reads is built — it
  currently derives deterministic actions from `task.status`, `isTaskReady`, the literal
  string `'human-verification'`, and hardcoded transition-destination names, and mixes
  legacy `approve`/`verify`/`finalize` handling with deterministic human-workflow operations
  in the same file. This is the concrete file the canonical projection must be wired into —
  it is not enough to introduce the projection module alone. The closest match to
  "TaskDetails," `TaskDialog`
  (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`), has **no**
  deterministic awareness today — no `isDeterministic` prop, a legacy-only single-action
  footer. Chat (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) already renders its own,
  separate Approve/Request-changes UI for deterministic sessions — a second, divergent
  implementation from whatever `TaskDialog` would build, not yet consolidated.
  `current_step`/`current_attempt` reach the UI only through the workflow bar today. Session
  creation (`useCreateAgentSession`) POSTs directly to `/api/agent-sessions` with no
  client-side readiness re-check at request time — the server-side route is where any
  readiness re-check would have to live. `CreateAgentSessionDialog` passes contextual
  `taskIds` (zero or many, discussion-only) but never an authoritative `taskId` — actual
  execution sessions are created from the "Start implementation"/"Start review" action paths
  in `specification-detail-content.tsx`/`agent-session-page.tsx`, which do pass an
  authoritative `taskId`; readiness/executor enforcement must cover those specific entry
  points, not the generic dialog.
- No existing architecture/import-boundary test enforces legacy/deterministic separation.
  No repository doc establishes ownership boundaries for `tools/specs/**` — the closest,
  `docs/development/package-boundaries.md`, covers only the .NET project-reference graph.

## Problem

1. Legacy mutating commands can run against a deterministic spec (and vice versa) with no
   guard, silently mixing the two lifecycles' state.
2. There is no deterministic-native way to mark a task's definition ready for execution
   without reusing legacy `approve` (which carries review/fingerprint semantics that don't
   belong to a transitional, pre-authoring-workflow publish step).
3. Once a deterministic task's workflow has started, several read paths (UI action
   projection, dashboard lanes, dependency satisfaction, CLI default-task resolution) still
   treat legacy `task.status` as authoritative, which can show or allow actions that
   contradict the actual `workflow_progress` state (e.g. a task stuck mid-review reads as
   "ready" to a downstream dependent).
4. A session, or a direct `workflow step start` call, can bypass a UI-hidden action button
   entirely, since nothing server-side independently re-validates deterministic readiness.
5. The UI has no way to show "review is next but hasn't started" as its own state — finish
   does not imply the next step is active.
6. Human review is coupled to the literal step name `'human-verification'` instead of a
   reusable, step-agnostic projection — and nothing prevents an agent from starting a
   step that should only ever be executed by a human, or a human decision endpoint from
   being invoked against a step an agent owns.
7. Even once a canonical projection exists, the dashboard's actual action DTO
   (`tools/dashboard/server/specs/actions.mjs`) is a separate, unwired file that mixes
   legacy and deterministic mutation handling together — introducing the projection module
   alone does not fix what the UI reads unless this file is explicitly corrected too.
8. Chat already has its own Approve/Request-changes implementation, independent of
   whatever `TaskDialog` would build — a second, divergent human-review UI is a live risk,
   not just a future one.
9. A canonical projection that also owns runtime-dependent "available actions" (readiness,
   git state, session state) is not actually pure — it creates a circular responsibility
   where projecting workflow state depends on facts workflow state shouldn't need.
10. Without a dedicated extraction, "no deterministic import of `lifecycle-primitives.mjs`"
    is unenforceable — two real imports already exist and would fail the guard test
    immediately.
11. "Every workflow definition has a human-owned step" is false — mechanically converting
    every `type: human` gate into a human-owned step would wrongly merge two distinct
    mechanisms (a confirmation gate on an agent step vs. a step a human executes).

## Constraints

- Backward compatibility is mandatory: specs without `workflow` resolve to legacy; explicit
  `workflow.mode: legacy` behaves unchanged; existing legacy commands, UI, status semantics,
  and skill behavior are unaffected.
- No migration of existing legacy specs.
- `task.status` stays in the schema; no full persistence separation in this change.
- No new external dependency, no new package/project, no CI/CD change — none of this
  change's areas need one.
- `docs/development/agent-workflow-protocol.md` already forbids agents from directly
  mutating `workflow.mode`/lifecycle state — this change's new `workflow task publish`
  operation must go through the same validated-CLI-only discipline, not a hand edit.

## Affected modules

- `tools/specs/{approve,start,complete,verify}/**` (legacy mutation — guard only, no
  behavior change).
- `tools/specs/workflow/**` (deterministic mutation, new `publish` operation, default-task
  resolution, executor guard, human-step/dependency/task projections, readiness policy).
- `.nevo-ai/workflows/*.yaml`, `tools/specs/workflow/definitions/{loader,schema}.mjs`
  (additive schema: `executor`, transition `action` metadata, per-transition `outcome`).
- `tools/specs/status-vocabulary.mjs` (new — extracted `TERMINAL_STATUSES`, D8).
- `tools/specs/store.mjs` (read-only consumption of its existing generic writers; no
  changes to legacy semantics). `tools/specs/lifecycle-primitives.mjs` re-exports the
  extracted vocabulary for legacy callers; no deterministic module imports it directly
  after this change (D8) — legacy consumption of it is unaffected.
- `tools/dashboard/server/specs/**`, including `actions.mjs` explicitly (deterministic
  action DTO wiring and legacy/deterministic mutation split), `data.mjs`/
  `status-stages.mjs` (board/lane projection).
- `tools/dashboard/ui/features/specifications/**`, `tools/dashboard/ui/features/agent-sessions/**`
  (UI composition-boundary split, including the shared `HumanStepSurface` consumed by both
  `TaskDialog` and the chat surface, D11).
- `.claude/skills/nevo-ai-spec-workflow/**` (or equivalent shared skill/instruction layer —
  lifecycle-specific instruction split, removing legacy-only assumptions from shared
  sections, not just adding a new deterministic reference).
- `docs/development/agent-workflow-protocol.md` (ownership boundary documentation,
  including the executor invariant).

## Options and trade-offs

Not applicable in the usual sense — per `owner-decisions.md` D1, the owner supplied the
target architecture directly rather than asking for an agent-derived option analysis, and
D5–D13 continue that same owner-directed correction across two corrective passes. The
genuinely open implementation-detail decisions are recorded individually: D2 (CLI
default-task resolution), D3 (ownership-boundary doc location), D6 (schema migration's
default/backward-compat choice and per-definition audit), D7 (human-step surface
consolidation direction), D9 (the specific mechanism for defining "successful terminal"),
D11 (naming).

## Owner decisions

See `owner-decisions.md` for the full record. Summary: D1 (scope/architecture is
owner-directed), D2 (CLI default-task resolution requires an explicit task id), D3
(boundary docs extend `agent-workflow-protocol.md`), D4 (this change stays
`workflow.mode: legacy`), D5 (generic `executor` model replaces the
`HumanVerificationGate`-based interaction design), D6 (workflow-definition schema
migration, individually audited per definition — only `standard`/`standard-v1` get a
human-owned step), D7 (human-step surface is a shared component reused by chat and
`TaskDialog`), D8 (extract `TERMINAL_STATUSES` into a neutral module — the only two real
deterministic imports of `lifecycle-primitives.mjs` are removed by a dedicated task, not
banned without a removal path), D9 (deterministic "successful terminal" is an explicit
field on the terminal *transition*, not a nonexistent "terminal step"), D10 (three-layer
separation: pure `TaskProjection` → `ExecutionReadiness` → `DashboardActionProjection`),
D11 (generic naming — `HumanStepSurface`, `startHumanStep`, `submitHumanStepResult`), D12
(the human-step operations reuse `ensureStepActivated`/`finishStep`, not a bespoke
implementation), D13 (the resume-vs-new-attempt distinction already exists in
`ensureStepActivated` and is preserved, not reimplemented).

## Proposed architecture

`resolveWorkflowMode()` becomes the one canonical classifier consulted by *both* lifecycles
before any mutation:

- **Legacy mutating commands** (`approve`/`start`/`complete`/`verify`) call
  `resolveWorkflowMode()` first and fail, before any state write, if the spec resolves to
  `deterministic` — naming the deterministic command surface to use instead.
- **Deterministic mutating commands** (`workflow step start`/`workflow step finish`/
  `workflow verify-human`, and the new `workflow task publish`) call the same function and
  fail, before any state write, if the spec resolves to `legacy`.
- No shared mutation handler branches internally on mode — each lifecycle's mutation code
  stays in its own module tree, importing only the shared, low-level, read-only
  `resolveWorkflowMode()`/generic store writers, never each other's mutation operations, and
  never `tools/specs/lifecycle-primitives.mjs` from the deterministic side (D8). An
  architecture-level regression test enforces this statically, and asserts the absence of
  side effects (manifest, HEAD, branch, worktree, workflow-operation state, execution
  session) on every guard failure, not only `change.yaml`.

A new deterministic **pre-execution model** reuses `task.status: draft`/`approved` purely as
transitional compatibility storage (product wording: "Draft"/"Ready"), written by a new,
independent `workflow task publish <change> <task>` operation that validates the task
definition, its dependencies, and that its workflow hasn't started — and never calls or
inherits legacy `approveTask`'s review/fingerprint semantics.

A shared, neutral **status-vocabulary module** (D8) extracts `TERMINAL_STATUSES` out of
`tools/specs/lifecycle-primitives.mjs` — the only piece of that file the deterministic
engine actually needs (already imported, today, by exactly `finish-operation.mjs` and
`definitions/schema.mjs`). Legacy code keeps importing it via `lifecycle-primitives.mjs`'s
re-export; the deterministic engine imports it directly, so the import-boundary regression
test can actually pass. `isTaskReady`, dependency-satisfying statuses, and legacy
transitions stay legacy-only, never extracted.

A generic **step-executor model** (D5) is added to workflow definitions: every step
declares `executor: agent | human` (audited, targeted migration — D6: only
`standard`/`standard-v1`'s `human-verification` step actually becomes `executor: human`;
`architectural`/`exploratory`'s agent steps keep their existing human *confirmation gates*
unchanged; `small` needs no change), with its own execution protocol per executor. An agent
step is unchanged (`waiting-for-step-start` → dispatch → `workflow step start` → `active` →
work → `workflow step finish(result)` → transition). A human step goes
`waiting-for-step-start` → a human explicitly opens/starts it via `startHumanStep` (no
auto-activation merely because the previous step finished) → `active` with a human
interaction UI → the human selects a result/supplies required input via
`submitHumanStepResult` → the step completes and transitions atomically. Per D12, neither
of these is new bookkeeping: `startHumanStep` calls the engine's existing
`ensureStepActivated` directly (the same function `workflow step start` already uses,
already activation-protocol-identical regardless of caller — D13), gated by an executor
check, and skips the agent-only `autoBindAgentSession` call; `submitHumanStepResult` calls
the engine's existing `finishStep` directly with a caller-supplied `{result, feedback,
artifacts}`, gated by the same executor check — `finishStep` already matches `result`
against the active step's declared transitions generically. `executor` is an **enforced
invariant**, not a UI hint: `workflow step start` (and, for defense in depth,
`workflow step finish`) reject a human-owned step before any mutation with a structured
`WORKFLOW_STEP_EXECUTOR_MISMATCH` error (code, step id, executor, purpose, expected work,
available results); `startHumanStep`/`submitHumanStepResult` reject an agent-owned step the
same way, via the same shared guard function (reused, not duplicated) also consumed by the
readiness layer for session/execution bootstrap. `entryGates`/`exitGates` (`type: human`)
remain a distinct, unmodified mechanism, reached only via the untouched
`workflow verify-human --confirm` path. The engine itself stays generic — it never
understands "owner-review," "acceptance," or "Approve" specifically; those come from the
workflow definition/projection, via minimal transition `action` metadata (label, whether
feedback is required — D6, with cross-field validation requiring at least a non-empty label
on every transition of an `executor: human` step, optional for agent steps).

Once `workflow_progress` exists for a task, a new **canonical deterministic task
projection** (`TaskProjection`, D10 — pure workflow/domain state, one module, consumed
everywhere else) becomes the execution-state authority: state
(`draft`/`blocked`/`ready`/`active`/`waiting-for-step-start`/`human-interaction`/
`terminal`), current step, executor, current attempt, next step when finished-but-not-
started, blocking dependencies (satisfied only by the *matched terminal transition's*
explicit `outcome: success` — D9, resolved from `workflow_progress.history`'s last entry
against the definition, never legacy `implemented`/`verified` status alone, never a "terminal
step" that doesn't exist in this engine), a generic current/next-step descriptor (`{id,
executor, purpose, expectedWork}`, available even before activation so the UI can render
"Human action required — <purpose> — [Start review]" without hardcoding a step id), and —
only while a human step is actually active — its interaction-actions descriptor (`actions:
[{result, label, feedbackRequired}]`, straight from that step's transitions). This
projection deliberately does **not** own runtime-dependent "available application actions"
(D10) — that would make it neither pure nor complete, since availability genuinely depends
on more than workflow-definition state.

`ExecutionReadiness` (D10) is the next layer: composes `TaskProjection` with the executor
guard and the engine's *existing* activation preconditions (D13 — `ensureStepActivated`'s
own clean-worktree-for-new-attempt / prior-finish-operation-settled checks, inspected/
reused via an exported query, never reimplemented) to answer "can this task start/continue
right now." It is the single gate consumed by `workflow step start`, `startHumanStep`, and
session/execution bootstrap — so a session or a direct CLI call cannot bypass what the UI
merely hides. Only an authoritative execution `taskId` (from "Start implementation"/"Start
review," never a session's merely contextual `taskIds`, and never auto-selected) triggers
this check; session bootstrap uses this same policy for a read-only preflight and never
itself calls `ensureStepActivated`.

`DashboardActionProjection` (D10) is the outermost layer: composes `TaskProjection` and
`ExecutionReadiness` into the dashboard's real action DTO
(`tools/dashboard/server/specs/actions.mjs`), replacing its current `task.status`/
`isTaskReady`/literal-`'human-verification'`/hardcoded-transition-name deterministic branch
— exposing state, current/next step, executor, attempt, blocked-by, `availableActions`
("Start implementation," "Start review," "Start human step," "Submit result," etc.),
human-step metadata, and terminal outcome. That file's legacy (`approve`/`verify`/
`finalize`) and deterministic (human-workflow operation, now backed by
`submitHumanStepResult`) mutation handling are split into separate implementations under
shared composition/routing, resolving `workflowMode` once, with no cross-calls between them
— covered by the same kind of import/call-boundary regression test as the CLI-level guard.

The dashboard UI composition splits only at the lifecycle-specific surfaces — shared shell,
navigation, docs, PR info, sessions, chat runtime, and `TaskDetails`'s container role stay
common; `status-board`'s lane derivation and `TaskCard`'s visible state/tone/lane/blockedBy/
actions (not only its action footer — a deterministic card's status label must stop reading
`formatTaskStatus(task.status)` once a workflow has started) each read from
`DashboardActionProjection` alongside the unchanged legacy path, rather than deriving
deterministic state from `stageForStatus`/`isTaskReady`. One reusable `HumanStepSurface`
(D7, D11) is built once and rendered directly by both `TaskDialog` and the existing chat
surface — replacing chat's current separate implementation, not leaving it as a second one.

The shared spec-workflow skill/instructions keep discovery, authoring, and owner-decision
policy common, and remove legacy-only lifecycle assumptions from those shared sections
(not merely add a new deterministic reference alongside them) — split into an explicit
legacy instruction set (permits legacy commands, forbids deterministic lifecycle mutations
including the executor-guarded human-decision operation) and an explicit deterministic
instruction set (permits `publish`/`workflow step start`/`workflow step finish`/
deterministic human actions, forbids legacy `approve`/`start`/`complete`/`verify`) — backed
by the CLI-level guards actually failing/rerouting rather than silently executing the wrong
lifecycle.

## Compatibility and migration

No migration. A spec with no `workflow` field, or `workflow.mode: legacy` explicitly, is
untouched in behavior — every new guard's legacy branch is a no-op pass-through for such
specs. `ai-spec-history` (the existing deterministic dogfood spec) is unaffected in scope;
this change's own guards apply to it going forward exactly as they apply to any other
deterministic spec.

## Areas

- `areas/lifecycle-boundary-guards.md` — hard cross-mode command guards before any mutation,
  plus the import-boundary regression protection (D8).
- `areas/shared-status-vocabulary.md` — extracts `TERMINAL_STATUSES` into a neutral module
  (D8), the prerequisite for the import-boundary test to actually pass.
- `areas/deterministic-task-publish.md` — `workflow task publish` and the CLI
  default-task-resolution fix.
- `areas/step-executor-model.md` — the `executor`/`action`/`outcome` schema extensions
  (individually audited per definition, D6/D9), the enforced executor-invariant guard, and
  the human-step execution operations that reuse `ensureStepActivated`/`finishStep` (D5,
  D12).
- `areas/deterministic-projection-and-human-step.md` — the pure canonical task projection,
  dependency satisfaction reading the matched terminal transition's `outcome` (D9), and the
  human-step projection it composes (D5, D10).
- `areas/execution-readiness-and-session-bootstrap.md` — `ExecutionReadiness`, composing
  the projection with the executor guard and the engine's existing, reused (not duplicated)
  activation preconditions (D10, D13), plus session/chat bootstrap wiring.
- `areas/dashboard-server-actions-wiring.md` — `DashboardActionProjection`, wiring
  `TaskProjection` + `ExecutionReadiness` into `tools/dashboard/server/specs/actions.mjs`'s
  actual action DTO (D10), and splitting that file's legacy/deterministic mutation
  implementations (including the generic human-step mutation).
- `areas/ui-dashboard-board-split.md` — deterministic-aware board/lane projection and
  `TaskCard`'s full visible-state split, reading from the corrected action DTO.
- `areas/human-step-surface.md` — one reusable `HumanStepSurface`, consumed by both
  `TaskDialog` and chat (D7, D11).
- `areas/skills-instruction-split.md` — removes legacy-only assumptions from shared
  sections and defines the explicit legacy/deterministic lifecycle instruction sets.
- `areas/ownership-boundary-docs.md` — documents the enforced boundary, including the
  executor invariant.

## Change-wide acceptance criteria

- A spec without `workflow`, and a spec with explicit `workflow.mode: legacy`, are
  unaffected in behavior by every task in this change (existing legacy test suites pass
  unchanged).
- No legacy mutating command can write any state to a spec that resolves to deterministic,
  and no deterministic mutating command can write any state to a spec that resolves to
  legacy — verified before-any-mutation in both directions.
- Shared specification functionality (docs, PR info, sessions list, chat transcript/composer,
  common UI shells) is unaffected for both modes.
- No task in this change removes `task.status` from the schema, adds a new external
  dependency, or changes CI/CD configuration.

## Verification strategy

`node tools/specs.mjs validate`, `node tools/docs.mjs validate` after every task; each
task's own `node --test tools/tests/<file>.test.mjs` (backend) or dashboard test command
(frontend); the full existing legacy-lifecycle and deterministic-workflow-engine test
suites must continue passing unchanged throughout.

## ADR impact

The legacy/deterministic mutation split itself formalizes an already de-facto separation
(two independent store functions, `setTaskStatus` vs. `setTaskWorkflowState`) and needs no
new ADR. The **step-executor model** (D5) is different: `executor: agent | human` as a
first-class, enforced workflow-definition concept, distinct from `entryGates`/`exitGates`,
is a genuinely new durable pattern future changes will need to know about — a strong
candidate for a follow-up ADR once this change ships and the pattern has proven itself in
practice. Not written now (D1: implement the smallest coherent fix first); flagged here so
it isn't silently dropped.

## Out of scope

Full deterministic Spec Writer/refinement workflow; a new permanent task-authoring state
model; removal of `task.status`; full persistence migration; handover automation; activity/
history feature expansion; a full generic action framework; full human-gate engine redesign
(`entryGates`/`exitGates` stay as-is — only a new, separate `executor` mechanism is added);
deterministic spec finalization redesign; unrelated cleanup/refactoring; UI board
configuration as project config (the disputed earlier-draft candidate-scope item — see D1);
a merged single status axis (also D1); a full terminal/outcome model (multiple named
outcomes, retry semantics) beyond the one per-transition `outcome: success | failure` field
D9 adds; a full artifact/handover-attachment system on the human-step projection (the
`artifacts?` field stays extensible but unpopulated by this change); wiring
`HumanStepSurface` into entry points beyond `TaskDialog` and chat (task board,
timeline/notifications remain future work); any change to `entryGates`/`exitGates`' own
engine or to the `workflow verify-human --confirm` gate-confirmation path.
