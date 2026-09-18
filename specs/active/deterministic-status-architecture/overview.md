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

**Corrective pass (2026-09-18, D5–D9):** the first full deterministic-flow test this change
was meant to enable failed at its very first step, before any of this change's own tasks had
been implemented. Rather than patch that failure in place, the owner directed a correction
of the architecture itself before implementation starts: the deterministic flow does not
need to stay compatible with what the original design here would have produced — only the
legacy flow needs to keep working, unaffected, throughout. The corrections (a generic
per-step `executor: agent | human` model replacing the literal `'human-verification'`
step-name/gate-based design; an enforced executor invariant; explicit wiring of the
canonical projection into the dashboard's actual action DTO; a split of the dashboard's own
mutation implementations; a tightened import boundary; and several readiness/session-scope
fixes) are recorded in D5–D9 and folded directly into the sections below and into
`areas/`/`tasks/` — this document does not keep a separate "what changed" log beyond the
decision records.

## Current architecture

Grounded in repository discovery (2026-09-17):

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
  `FileHumanVerificationStore`. The one gap: `handleWorkflowVerifyHuman`'s `--approve`/
  `--request-changes` branch hardcodes the literal string `'human-verification'` as the
  expected step name. Per D5, this change does **not** build its human-owned-step model on
  top of this gate mechanism — `entryGates`/`exitGates` (`type: human`) stay a distinct,
  unmodified mechanism (a gate blocks *another* executor's step pending confirmation); the
  new `executor: human` step model is a separate concept (a human *executes* the step and
  chooses its outcome). `handleWorkflowVerifyHuman`'s literal-string check is still the
  concrete coupling being removed, now via the executor model instead of a gate-shaped
  projection.
- **Workflow definitions** (`.nevo-ai/workflows/*.yaml`, five files: `exploratory`,
  `architectural`, `small`, `standard-v1`, `standard`) have no per-step `executor` field, no
  transition `action` (label/feedback) metadata, and no terminal-step `outcome` field today
  — all three are new, additive schema surface this change introduces (D6, D9), loaded via
  `tools/specs/workflow/definitions/{loader,schema}.mjs`.
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
  (additive schema: `executor`, transition `action` metadata, terminal `outcome`).
- `tools/specs/store.mjs` (read-only consumption of its existing generic writers; no
  changes to legacy semantics). `tools/specs/lifecycle-primitives.mjs` is explicitly **not**
  consumed by any deterministic module in this change (D8) — legacy consumption of it is
  unaffected.
- `tools/dashboard/server/specs/**`, including `actions.mjs` explicitly (deterministic
  action DTO wiring and legacy/deterministic mutation split), `data.mjs`/
  `status-stages.mjs` (board/lane projection).
- `tools/dashboard/ui/features/specifications/**`, `tools/dashboard/ui/features/agent-sessions/**`
  (UI composition-boundary split, including the shared human-review surface consumed by
  both `TaskDialog` and the chat surface).
- `.claude/skills/nevo-ai-spec-workflow/**` (or equivalent shared skill/instruction layer —
  lifecycle-specific instruction split, removing legacy-only assumptions from shared
  sections, not just adding a new deterministic reference).
- `docs/development/agent-workflow-protocol.md` (ownership boundary documentation,
  including the executor invariant).

## Options and trade-offs

Not applicable in the usual sense — per `owner-decisions.md` D1 (and the corrective pass
that produced D5–D9), the owner supplied the target architecture directly rather than
asking for an agent-derived option analysis. The genuinely open implementation-detail
decisions within that architecture are recorded individually: D2 (CLI default-task
resolution), D3 (ownership-boundary doc location), D6 (schema migration's default/backward-
compat choice, within the owner's "prefer the smallest migration" instruction), D7 (human
review surface consolidation direction — the owner posed this explicitly as an either/or),
D9 (the specific mechanism for defining "successful terminal," within the owner's "define
the smallest explicit rule" instruction).

## Owner decisions

See `owner-decisions.md`: D1 (scope/architecture is owner-directed, supersedes the earlier
draft), D2 (CLI default-task resolution requires an explicit task id), D3 (boundary docs
extend `agent-workflow-protocol.md`), D4 (this change stays `workflow.mode: legacy`), D5
(generic `executor` model replaces the `HumanVerificationGate`-based interaction design),
D6 (workflow-definition schema gets one bounded, explicitly migrated extension), D7 (human
review surface is a shared component reused by chat and `TaskDialog`, not a redirect), D8
(import boundary excludes all of `lifecycle-primitives.mjs` from deterministic code, no
blanket exemption), D9 (deterministic "successful terminal" is an explicit per-step
`outcome` field, not inferred).

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

A generic **step-executor model** (D5) is added to workflow definitions: every step
declares `executor: agent | human` (small, bounded migration of the five existing
definition files — D6), with its own execution protocol per executor. An agent step is
unchanged (`waiting-for-step-start` → dispatch → `workflow step start` → `active` → work →
`workflow step finish(result)` → transition). A human step never uses that protocol: it
goes `waiting-for-step-start` → a human explicitly opens/starts it (no auto-activation
merely because the previous step finished) → `active` with a human-interaction UI → the
human selects a result/supplies required input → the step completes and transitions
atomically through a dedicated human-decision operation, not `workflow step start`/`finish`.
`executor` is an **enforced invariant**, not a UI hint: `workflow step start` (and, for
defense in depth, `workflow step finish`) reject a human-owned step before any mutation with
a structured `WORKFLOW_STEP_EXECUTOR_MISMATCH` error (code, step id, executor, purpose,
expected work, available results — enough for an agent to stop rather than retry a
different lifecycle operation); the human-decision operation rejects an agent-owned step
the same way. The same guard function is reused, not duplicated, by the readiness policy for
session/execution bootstrap — an agent execution session can never be created for a
human-owned active step. `entryGates`/`exitGates` (`type: human`) remain a distinct,
unmodified mechanism — a gate blocks *another* executor's step pending confirmation; an
`executor: human` step is *executed* by a human, who chooses its outcome. The engine itself
stays generic (executor, possible results, transition target, required input) — it never
understands "owner-review," "acceptance," or "Approve" specifically; those come from the
workflow definition/projection, via minimal transition `action` metadata (label, whether
feedback is required).

Once `workflow_progress` exists for a task, a new **canonical deterministic task
projection** (one module, consumed everywhere) becomes the sole execution-state authority:
state (`draft`/`blocked`/`ready`/`active`/`waiting-for-step-start`/`human-interaction`/
`terminal`), current step, executor, current attempt, next step when finished-but-not-
started, blocking dependencies (satisfied only by an explicit per-step terminal `outcome:
success` — D9 — never legacy `implemented`/`verified` status alone), available actions,
pending human-step interaction (`{step: {id, executor, purpose, expectedWork}, actions:
[{result, label, feedbackRequired}], artifacts?}` — a **human-step projection**, replacing
the earlier `HumanVerificationGate`-based `verification`/`decision` design per D5), and
terminal outcome. One **readiness policy**, built on this projection and the executor
guard, is the single gate consumed by UI action projection, session/execution bootstrap
(distinguishing a genuinely new attempt, which still requires a clean worktree, from
resuming an already-active attempt, which does not), and `workflow step start` itself — so a
session or a direct CLI call cannot bypass what the UI merely hides. Only an authoritative
execution `taskId` (from "Start implementation"/"Start review," never a session's merely
contextual `taskIds`, and never auto-selected) triggers this check.

The canonical projection is explicitly wired into the dashboard's real action DTO
(`tools/dashboard/server/specs/actions.mjs`), replacing its current `task.status`/
`isTaskReady`/literal-`'human-verification'`/hardcoded-transition-name deterministic branch
— exposing state, current/next step, executor, attempt, blocked-by, available actions,
human-step metadata, and terminal outcome. That file's legacy (`approve`/`verify`/
`finalize`) and deterministic (human-workflow operation) mutation handling are split into
separate implementations under shared composition/routing, resolving `workflowMode` once,
with no cross-calls between them — covered by the same kind of import/call-boundary
regression test as the CLI-level guard.

The dashboard UI composition splits only at the lifecycle-specific surfaces — shared shell,
navigation, docs, PR info, sessions, chat runtime, and `TaskDetails`'s container role stay
common; `status-board`'s lane derivation and `TaskCard`'s visible state/tone/lane/blockedBy/
actions (not only its action footer — a deterministic card's status label must stop reading
`formatTaskStatus(task.status)` once a workflow has started) each grow a
deterministic-projection-driven path alongside the unchanged legacy path, rather than
deriving deterministic state from `stageForStatus`/`isTaskReady`. One reusable human-step
interaction surface (D7) is built once and rendered directly by both `TaskDialog` and the
existing chat surface — replacing chat's current separate implementation, not leaving it as
a second one.

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
  plus the import-boundary regression protection (tightened per D8).
- `areas/deterministic-task-publish.md` — `workflow task publish` and the CLI
  default-task-resolution fix.
- `areas/step-executor-model.md` — the `executor` schema extension and its enforced
  invariant guard (D5, D6).
- `areas/deterministic-projection-and-human-step.md` — the canonical task projection,
  dependency satisfaction (D9), and the human-step projection it composes (D5).
- `areas/execution-readiness-and-session-bootstrap.md` — the one shared readiness policy
  (now including the executor guard and the new-attempt-vs-resume distinction) and its
  wiring into session/chat bootstrap.
- `areas/dashboard-server-actions-wiring.md` — wires the canonical projection into
  `tools/dashboard/server/specs/actions.mjs`'s actual action DTO, and splits that file's
  legacy/deterministic mutation implementations.
- `areas/ui-dashboard-board-split.md` — deterministic-aware board/lane projection and
  `TaskCard`'s full visible-state split (not only its action footer).
- `areas/human-review-surface.md` — one reusable human-step interaction surface, consumed
  by both `TaskDialog` and chat (D7).
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
outcomes, retry semantics) beyond the one `outcome: success | failure` field D9 adds; a full
artifact/handover-attachment system on the human-step projection (the `artifacts?` field
stays extensible but unpopulated by this change); wiring the shared human-review surface
into entry points beyond `TaskDialog` and chat (task board, timeline/notifications remain
future work).
