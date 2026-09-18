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
  expected step name.
- **Dashboard UI**: `TaskCard` (inline in
  `tools/dashboard/ui/features/specifications/detail/status-board.tsx`) already branches on
  an `isDeterministic` prop for its action footer. The kanban lane mapping is computed
  server-side by `stageForStatus()` (`tools/dashboard/server/specs/status-stages.mjs`),
  hardcoded to legacy `task.status` values, with no workflow-mode awareness at all. The
  closest match to "TaskDetails," `TaskDialog`
  (`tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx`), has **no**
  deterministic awareness today — no `isDeterministic` prop, a legacy-only single-action
  footer. `AgentSessionWorkflowBar` is the only place `current_step`/`current_attempt`
  reaches the UI today. Session creation (`useCreateAgentSession`) POSTs directly to
  `/api/agent-sessions` with no client-side readiness re-check at request time — the
  server-side route is where any readiness re-check would have to live.
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
   reusable, step-agnostic projection.

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
  resolution, human-interaction projection).
- `tools/specs/lifecycle-primitives.mjs`, `tools/specs/store.mjs` (read-only consumption;
  no changes to legacy semantics).
- `tools/dashboard/server/specs/**` (new deterministic board/lane and readiness/projection
  server logic).
- `tools/dashboard/ui/features/specifications/**`, `tools/dashboard/ui/features/agent-sessions/**`
  (UI composition-boundary split).
- `.claude/skills/nevo-ai-spec-workflow/**` (or equivalent shared skill/instruction layer —
  lifecycle-specific instruction split).
- `docs/development/agent-workflow-protocol.md` (ownership boundary documentation).

## Options and trade-offs

Not applicable in the usual sense — per `owner-decisions.md` D1, the owner supplied the
target architecture directly rather than asking for an agent-derived option analysis. The
two genuinely open implementation-detail decisions within that architecture (CLI
default-task resolution; ownership-boundary doc location) are recorded as D2/D3.

## Owner decisions

See `owner-decisions.md`: D1 (scope/architecture is owner-directed, supersedes the earlier
draft), D2 (CLI default-task resolution requires an explicit task id), D3 (boundary docs
extend `agent-workflow-protocol.md`), D4 (this change stays `workflow.mode: legacy`).

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
  `resolveWorkflowMode()`/projection utilities, never each other's mutation operations. An
  architecture-level regression test enforces this statically.

A new deterministic **pre-execution model** reuses `task.status: draft`/`approved` purely as
transitional compatibility storage (product wording: "Draft"/"Ready"), written by a new,
independent `workflow task publish <change> <task>` operation that validates the task
definition, its dependencies, and that its workflow hasn't started — and never calls or
inherits legacy `approveTask`'s review/fingerprint semantics.

Once `workflow_progress` exists for a task, a new **canonical deterministic task
projection** (one module, consumed everywhere) becomes the sole execution-state authority:
current step/attempt, the "finished a step, next step not yet started" state, blocking
dependencies (satisfied only by successful terminal workflow state, never legacy
`implemented`/`verified` status alone), available actions, and pending human interaction
(via a new human-interaction projection decoupled from the literal `'human-verification'`
step name). One **readiness policy**, built on this projection, is the single gate consumed
by UI action projection, session/execution bootstrap, and `workflow step start` itself — so
a session or a direct CLI call cannot bypass what the UI merely hides.

The dashboard UI composition splits only at the lifecycle-specific surfaces — shared shell,
navigation, docs, PR info, sessions, chat runtime, and `TaskDetails`'s container role stay
common; `status-board`'s lane derivation, `TaskCard`'s action footer, and `TaskDialog`'s
review surface each grow a deterministic-projection-driven path alongside the unchanged
legacy path, rather than deriving deterministic state from `stageForStatus`/`isTaskReady`.

The shared spec-workflow skill/instructions keep discovery, authoring, and owner-decision
policy common, and split only the lifecycle-mutation instruction set: legacy instructions
permit legacy commands and forbid deterministic ones; deterministic instructions permit
`publish`/`workflow step start`/`workflow step finish`/deterministic human actions and
forbid legacy `approve`/`start`/`complete`/`verify`.

## Compatibility and migration

No migration. A spec with no `workflow` field, or `workflow.mode: legacy` explicitly, is
untouched in behavior — every new guard's legacy branch is a no-op pass-through for such
specs. `ai-spec-history` (the existing deterministic dogfood spec) is unaffected in scope;
this change's own guards apply to it going forward exactly as they apply to any other
deterministic spec.

## Areas

- `areas/lifecycle-boundary-guards.md` — hard cross-mode command guards before any mutation,
  plus the import-boundary regression protection.
- `areas/deterministic-task-publish.md` — `workflow task publish` and the CLI
  default-task-resolution fix.
- `areas/deterministic-projection-and-human-interaction.md` — the canonical task projection,
  dependency satisfaction, and the human-interaction projection it composes.
- `areas/execution-readiness-and-session-bootstrap.md` — the one shared readiness policy and
  its wiring into session/chat bootstrap.
- `areas/ui-dashboard-board-split.md` — deterministic-aware board/lane projection and
  `TaskCard`'s legacy/deterministic split.
- `areas/ui-task-details-human-review.md` — `TaskDialog` gains deterministic projection and
  a reusable human-review surface.
- `areas/skills-instruction-split.md` — shared vs. legacy vs. deterministic lifecycle
  instruction sets.
- `areas/ownership-boundary-docs.md` — documents the enforced boundary.

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

None anticipated — this formalizes an already de-facto separation (two independent store
functions, `setTaskStatus` vs. `setTaskWorkflowState`) rather than introducing a new durable
pattern that isn't already implicit in the codebase. Revisit if task execution surfaces a
genuinely new durable pattern worth recording.

## Out of scope

Full deterministic Spec Writer/refinement workflow; a new permanent task-authoring state
model; removal of `task.status`; full persistence migration; handover automation; activity/
history feature expansion; a full generic action framework; full human-gate engine redesign;
deterministic spec finalization redesign; unrelated cleanup/refactoring; UI board
configuration as project config (the disputed earlier-draft candidate-scope item — see D1);
a merged single status axis (also D1).
