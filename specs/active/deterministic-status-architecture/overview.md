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

**Corrective pass 3 (2026-09-19, D14–D16, narrow):** pass 2 fixed the architecture's model;
this pass closes remaining execution/wiring gaps a direct reading of the current dashboard
call sites (`routes.mjs`, `actions.mjs`) and the engine's normalization/finish-contract code
surfaced, without reopening any pass-2 decision: `normalizeWorkflowDefinition()` silently
drops `executor`/`action`/`outcome` today — validating a definition successfully and then
losing that metadata on normalization would be a real, silent bug (task 07, corrected); no
task actually owned a transport `startHumanStep`/`submitHumanStepResult` could be called
through — the only existing route hardcodes `decision: 'approve'|'request-changes'` and
calls the CLI compatibility layer, not the generic operations (D14, new task 16); the
generic finish contract hardcodes `feedback.required: false` regardless of what a
transition's own `action.feedback.required` declares, so nothing server-side actually
enforced it (task 09, corrected); the dashboard DTO exposed only strings
(`currentStep`/`nextStep`) with no way for `HumanStepSurface` to show `purpose`/
`expectedWork` before activation (task 14, corrected); "Start implementation"/"Start
review"/"Start human step" were described together as session-creation entry points, which
is wrong for the human case (areas/tasks 13/15/20, corrected); `start-implementation`/
`start-review` as distinct hardcoded action ids reintroduced exactly the step-name coupling
this change removes elsewhere (D15, new generic `start-agent-step` action plus an isolated,
explicitly transitional UI adapter); and a human step's single unconditional transition has
no `result` to submit, which nothing previously said explicitly (D16).

**Corrective pass 4 (2026-09-19, D17, final narrow cleanup):** self-review against the
repository's own enforced frontend architecture test
(`tools/dashboard/tests/architecture-boundaries.test.mjs`) and the task graph's
dependency-vs-contract-introduction ordering found four remaining inconsistencies, none of
them architectural: task 20 placed the shared `HumanStepSurface` under
`features/specifications/` while also requiring `features/agent-sessions/` to import it
directly — a sibling-feature import the boundary test explicitly forbids; the component
moves to `shared/workflow/`, feature-neutral and prop-driven, with the transport call
itself split into one neutral `shared/lib` request function plus a thin, feature-local hook
per feature (D17). `session-bootstrap-readiness-wiring` (order 15, was 14) consumed the
`start-agent-step` DTO contract `dashboard-deterministic-action-projection` (order 14, was
15) introduces, without depending on it — the two tasks are reordered and the dependency
added. `human-step-projection` (task 10) still described every projected human-step action
as unconditionally carrying `result`, contradicting D16 — corrected to make `result`'s
presence conditional on the transition actually declaring one, never fabricated, never
`undefined`. `normalizeWorkflowDefinition()`'s `executor` default (`agent` when absent) was
left for every downstream consumer to re-derive — task 07 now makes normalization itself
materialize the canonical `executor` value on every step, so nothing downstream needs an
`undefined`/absent case.

**Corrective pass 5 (2026-09-19, D15 superseded, D18): the deterministic workflow step —
not "implementation"/"review" — has always been the abstraction.** A fresh review found
that pass 4's own D15 ("transitional UI adapter" mapping `implementation`/`review` to
edit-mode/agent-mode dispatch) was itself an architectural mistake, not a bounded stopgap:
isolating a step-id lookup at one call site is still a step-id lookup, and by pass 4 it had
already spread — `start-agent-step`/`start-human-step` as distinct action ids,
"review-appropriate lane," "Ready for review," "Start review" — into areas/tasks that
treated it as load-bearing target behavior rather than a narrow, disposable gap. This pass
supersedes D15 outright (never amended in place — the whole *question* was wrong, not just
its answer) and adds D18: **one** generic lifecycle action, `start-step`, replaces
`start-agent-step`/`start-human-step`/`start-implementation`/`start-review` everywhere;
`executor` still determines the execution *protocol* (agent session vs. `startHumanStep`,
D12/D16, unchanged), never the step's *meaning*; no `switch`/`if`/lookup keyed on a literal
step id may exist anywhere in `TaskProjection`, `ExecutionReadiness`,
`DashboardActionProjection`, session-bootstrap client code, or board/lane projection; an
agent session's initial trigger is one generic, visible message, never a step-id-derived
semantic prompt — the real work contract continues to come entirely from the *existing*,
already-correct `StepContext`/`finishContract` mechanism (`compileStepContext()`,
`resolveDeterministicWorkflowInfo()` + `formatNevoWorkflowContext()` in
`tools/dashboard/server/ai/sessions/service.mjs`), which needed no redesign, only two real,
grounded bugs fixed in place: a single-item contextual `taskIds` array was silently
promoted to a session's authoritative `activeTaskId` (contradicting this change's own
"contextual selection is never authoritative" principle), and an explicit
`workflowContext` override missing its own `step` could still surface the literal string
`'implementation'` via unused-in-the-automatic-path default parameters. Board/lane
projection is corrected the same way: lane derives from `TaskProjection.state` (and,
where genuinely useful, `executor`), never from `currentStep`.

**Corrective pass 6 (2026-09-20, D19, D20): closing the UI-ownership wiring gap around the
generic `start-step` action.** Pass 5 corrected the *model* — one generic `start-step`
action, executor as protocol only — but a fresh read of the actual client code (not just the
prior spec text) found the real UI never finished wiring it: `specification-detail-content.tsx`'s
`handleWorkflowAction` still branched on the literal strings `'start-implementation'`/
`'start-review'`/`'approve'`/`'request-changes'` and built step-id-derived prompts
(`` `Implement task…` ``/`` `Review task…` ``); `agent-session-page.tsx`'s
`handleStartReviewTask` sent an equivalent literal `` `Review task ${taskId}` `` prompt; and
`agent-session-chat-surface.tsx` still rendered `'approve'`/`'request-changes'`/
`'start-review'` action-id-gated buttons — the exact pre-D15 vocabulary, still live in three
places pass 5 didn't touch. Worse, `tasks/19-task-card-lifecycle-split.md` and
`tasks/20-human-step-surface-consolidation.md` directly contradicted each other: task 19
required the board card to render an active human interaction's own result buttons inline,
while task 20 declared wiring `HumanStepSurface` into the board out of scope — the same
surface, required and forbidden by two different tasks. D19 resolves the wiring: one
composition-level `startStep(task, stepDescriptor)` dispatcher per screen
(`specification-detail-content.tsx` for the board/dialog; `agent-session-page.tsx` for chat),
branching only on `stepDescriptor.executor` — agent creates/reuses a session and sends the
generic trigger; human calls `startHumanStep` directly through the shared transport, no
session involved — reusing the *existing* prop-bubbling pattern already present
(`onWorkflowAction` → `StatusBoard`) rather than new plumbing, since a screen already legally
composes both `features/specifications` and `features/agent-sessions`. `TaskCard`/`TaskDialog`
never branch on `executor` themselves; they only call an `onStartStep`/renamed equivalent
prop supplied from above. D20 resolves the task-19/20 contradiction: `DeterministicTaskCard`'s
scope shrinks to state label/tone, step descriptor, generic Start, and a compact "human
action required" indicator that opens `TaskDialog` — never the interaction's own result
buttons, never `HumanStepSurface`, keeping exactly one implementation of the full interaction
surface. `HumanStepSurface` itself narrows correspondingly to the active-interaction case
only (`{interaction, loading, error, onSubmit}`); the generic waiting-state "Start" control
is a separate, executor-agnostic piece each caller renders itself.

**Corrective pass 7 (2026-09-20, strictly mechanical): fixing task-ownership defects in
pass 6's own wiring correction, not the architecture it produced.** A fresh audit found
three mechanical errors in how pass 6 assigned its own work, not in the wiring model itself
(D19/D20 stand unchanged). First, `session-bootstrap-readiness-wiring`'s `allowed_paths`
named a file that has never existed —
`tools/dashboard/ui/features/specifications/detail/specification-detail-content.tsx` — while
the real file, confirmed by reading the repository directly, is
`tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx` (a screen,
not a feature file); every reference across this specification is corrected to the real path,
and no duplicate is created under `features/specifications`. Second, pass 6 had
`session-bootstrap-readiness-wiring` (task 15) build the real `startStep`/renamed-chat-handler
*implementations* and pass them into `StatusBoard`/`TaskDialog`/the chat surface — but the
prop *contracts* those implementations plug into are introduced by
`task-card-lifecycle-split` (task 19) and `human-step-surface-consolidation` (task 20), both
of which depend on task 15. Task 15 would have had to satisfy its own acceptance criteria
using a prop that only its own dependents define — an unsatisfiable ordering. Corrected by
narrowing task 15 to a producer-only task (the frontend DTO type plus a pure,
`buildAgentStepTriggerMessage(taskId)` trigger-message primitive with no session/UI
mechanics of its own), moving `agent-session-page.tsx` into task 20 (so the parent-handler
rename and the child's prop-rename happen inside the one task that owns both files), and
adding a small final task, `specification-detail-composition-wiring` (order 23), that
depends on all four tasks whose contracts it fills (`session-bootstrap-readiness-wiring`,
`dashboard-human-step-transport`, `task-card-lifecycle-split`,
`human-step-surface-consolidation`) and owns nothing but the real dispatcher and its wiring
into the two already-defined `onStartStep` contracts. Third, D17's own written prop contract
for `HumanStepSurface` (`{ stepDescriptor, interaction, loading, error, onStart, onSubmit }`)
had gone stale the moment D19/D20 moved the generic waiting-state control out of the
component and narrowed it to the active-interaction case alone — D17 is corrected in place
to the current, canonical shape (`{ interaction, loading, error, onSubmit }`), with the
feature-adapter split clarified: `features/agent-sessions/human-step-mutations.ts`
additionally exposes a `start` method for chat's own generic waiting control, since chat
never needs the composition-layer indirection the board/dialog case requires.

**Corrective pass 9 (2026-09-21, D21–D30, new areas + tasks 24–32): dogfooding findings
from the first real execution of `ai-spec-history` (task `activity-core-model-and-contracts`,
`workflow: standard-v1`).** Tasks 01–23 above proved the deterministic engine itself works —
`publish → ready → start → workflow step start → implementation → workflow step finish → next
step = review` completed correctly end-to-end for the first time. That same real run exposed
a distinct, second layer of gaps this change had not yet addressed: **agent/session
orchestration and dashboard UX** around the now-working engine. Grounded against the actual
current code (`tools/specs/workflow/step-context.mjs`, `dependency-satisfaction.mjs`,
`task-projection.mjs`, `finish-operation.mjs`, `publish/operation.mjs`,
`tools/dashboard/server/ai/sessions/**`, `tools/dashboard/server/specs/{human-step-transport,
routes}.mjs`, `tools/dashboard/ui/screens/specification-detail/**`,
`tools/dashboard/ui/features/agent-sessions/**`, `.nevo-ai/workflows/standard-v1.yaml`,
`definitions/schema.mjs`) — never assumed:

1. **Execution-mode/provider selection is silently skipped on the first Start** (D21).
   `startStep()` (`specification-detail-content.tsx`) calls `createSession.create({ provider:
   defaultProvider, taskId, taskIds: [taskId] })` with no `mode` field at all — confirmed by
   reading the function directly. The server resolves an omitted `mode` to `'edit'`
   (`DEFAULT_AGENT_EXECUTION_MODE = 'edit'`, `contracts.mjs`), not `'agent'` — this is the
   existing, correct provider contract (unchanged), but it means a real Claude session opened
   in `edit` mode, which requires command approval the dashboard's non-interactive dispatch
   cannot satisfy, so `workflow step start` repeatedly reported "This command requires
   approval" until the user manually switched the session to `agent` mode. A separate,
   already-existing `CreateAgentSessionDialog` (`features/agent-sessions/`) *does* let a user
   pick provider + Ask/Edit/Agent mode, with its own default-mode logic (defaults to `'agent'`
   when supported) — but `startStep` never opens it; it is wired only to the generic "new
   session" affordance in `SpecificationOverview`, a different entry point entirely.
2. **`StepContext` omits the task's own document** (D22). `compileStepContext()`'s returned
   `task` field is only `effectiveTask.id` — confirmed by reading the function directly. No
   task file path or content is included anywhere in the object, even though
   `change.yaml → tasks[].file` deterministically names it and the (separate, legacy)
   `buildContextPacket()` in `tools/specs/context.mjs` already resolves and surfaces exactly
   this (`task.file`, full frontmatter) for the legacy path. The agent had to `find`/grep the
   repository to discover its own task file — defeating the spec-anchored workflow's premise
   that discovery happens once, at spec-authoring time.
3. **Task-declared `context.required` is not distinguished from routing-derived
   `relevantDocs`** (D23). `relevantDocs` in `compileStepContext()` comes only from
   `resolveRelevantDocs(allowedPaths, routingIndex)` — routing-rule matches against affected
   paths — confirmed by reading the function; it has no dependency on the task frontmatter's
   own `context.required`/`optional` list. `buildContextPacket()` (legacy) already resolves
   `context.required`/`optional` from the task frontmatter, but `compileStepContext()` never
   reads it. The two concepts (task-declared execution contract vs. routing-inferred
   repository rules) are real and already partially built for the legacy path, just not
   connected to the deterministic one.
4. **`StepContext` exposes internal finalize-action facts, and duplicates one field under two
   names** (D24). `context.sourceControl` is `CommitAndPushAction.check()`'s full factual
   context (`changedFiles`, `stagedFiles`, `taskAffectedFiles`, `currentBranch`, `baseBranch`,
   `existingCommits`, `unpushedCommits`) — confirmed by reading `commit-and-push.mjs` and the
   single shared `normalizeSourceControlFacts()` both `compileStepContext` and `planFinish`
   consume; `existingCommits` in particular is effectively full branch history from `main`.
   Separately, `finishContract.parameters` and `finishContract.requiredInputs` are, as
   implemented today, the identical object reference (`requiredInputs: parameters`) — two
   field names for one shape, confirmed by reading `compileStepContext`'s return statement
   directly.
5. **Engine-to-engine transitions stop instead of continuing** (D25). After `workflow step
   finish` transitions a task to `waiting-for-step-start` with `nextStep: review`, nothing
   creates the next session automatically — confirmed: `agent-session-page.tsx`'s
   `onTurnCompleted` only refreshes the action projection; `handleStartAgentStep` exists but
   fires only from a manual "Start" click (`agent-session-chat-surface.tsx`). No field in
   `.nevo-ai/workflows/standard-v1.yaml`/`definitions/schema.mjs` distinguishes "continue
   automatically" from "stop for an owner action" — confirmed absent from both.
6. **Review can reuse the implementer's own session** (D26). `binding-service.mjs`'s
   `listSessions`/`listSessionsSync` filter candidate sessions by `taskId`
   (`activeTaskId`/`taskIds`) only — confirmed by reading the filter directly; `step` is
   already a field on each *binding* (`binding.step`) but is never used as a session-selection
   filter. No `parentSessionId`/`previousSessionId`/session-lineage concept, and no
   execution-role (`implementer`/`reviewer`/`refiner`) concept, exists anywhere in
   `tools/dashboard/server/ai/**` today — confirmed absent by grep.
7. **A human-owned step needs a meaningless Start click before showing its real interaction**
   (D27). Confirmed: reaching a human step's `waiting-for-step-start` state renders only a
   generic "Start" control (`status-board.tsx`, `agent-session-chat-surface.tsx`,
   `specification-detail-content.tsx`'s `postHumanStepAction({action:'start'})`) — the real
   `HumanStepSurface` interaction never appears until that click resolves.
8. **The definition-driven `HumanStepSurface` model itself is correct and must not
   regress.** Confirmed by reading `human-step-surface.tsx` directly: it renders from
   `interaction.actions[].{result, label, feedbackRequired}` alone, with no hardcoded
   action-name string anywhere. No finding here requires a fix — this pass's own orchestration
   changes (D25–D27) must not reintroduce a hardcoded "Approve"/"Request changes" anywhere in
   the new continuation/activation code path.
9. **Dependency satisfaction has no earlier release point, and no invalidation
   consequence** (D28, OQ-A). Confirmed: `evaluateDependencySatisfaction` requires the
   dependency's last history entry to resolve to a declared transition whose `to` is a
   `TERMINAL_STATUSES` member **and** whose own `outcome === 'success'` — there is no earlier
   release point today, and no `stale`/`suspend`/`revalidation-required` concept exists
   anywhere in `dependency-satisfaction.mjs`/`task-projection.mjs`
   (repository-wide `provenance`/`stale`/`suspend` hits are all legacy-lifecycle concepts —
   `tools/specs/lifecycle/{stage,provenance}.mjs` — unconnected to deterministic dependency
   tracking). This blocked `ai-spec-history` tasks 02/03 for the full duration of task 01's
   review, even though task 01's implementation artifact already existed.
10. **No deterministic batch/orchestration scheduler exists** (OQ-B). Confirmed: legacy
    `batch-*` (`tools/specs/batch/{cli,operation}.mjs`, `tools/specs/lifecycle/batch.mjs`)
    has no deterministic equivalent — `specs/archive/deterministic-workflow-foundation`'s own
    D16 explicitly deferred one ("`batch-*` … has no deterministic-workflow equivalent yet;
    explicitly out of scope"). The deterministic UI supports only one task's `startStep()` at
    a time.
11. **`workflow task publish` does not own its own Git mutation** (D29). Confirmed by reading
    `publishTask()` end to end: it validates, calls `setTaskStatus(change, taskId,
    'approved')`, and returns — no commit/push call anywhere in `publish/operation.mjs` or
    `store.mjs`. In the real dogfooding run this left `change.yaml`'s Publish mutation dirty
    in the worktree, and the next agent's own `commit-and-push` finalize action (already a
    reusable, registered action — `defaultActionRegistry.require('commit-and-push')`, the same
    one `finish-operation.mjs` already calls) absorbed the unrelated Publish mutation into its
    own implementation commit.
12. **No documented ownership boundary distinguishes a standalone user mutation from a
    technical activation from a completed lifecycle mutation** (D30) — the exact ambiguity
    that produced Finding 11.

This pass narrows, rather than removes, two of this change's own standing "Out of scope"
exclusions (see below): "handover automation" and "full archetype/handover/
provider-selection design for agent orchestration" are addressed only to the bounded extent
D25/D26/D28/OQ-B require — a declarative per-transition continuation policy, a three-value
session-reuse policy plus a lineage field, and a first deterministic batch scheduler — not a
general-purpose action/dispatch framework. Two sub-questions this pass's own findings raise
(the dependency-invalidation consequence, Finding 9's second half; and the batch scheduler's
default selection mode/concurrency limit, Finding 10) have no existing repository precedent
to ground a decision in and are recorded as **open, owner-facing questions (OQ-A, OQ-B)**
below, not as decided — see "Owner decisions."

**Corrective pass 8 (2026-09-20, strictly mechanical): fixing task 23's own real composition
path and a resulting over-claim in task 20.** A fresh re-review found `specification-detail-content.tsx`
does not render `StatusBoard` directly — confirmed by reading the repository directly, it
renders `SpecificationOverview` (`tools/dashboard/ui/screens/specification-detail/specification-overview.tsx`),
which owns the actual `onWorkflowAction?: (task, action: string) => void | Promise<void>`
prop forwarded into `StatusBoard`; `TaskDialog` alone is rendered directly by
`specification-detail-content.tsx`. Task 23, owning only `specification-detail-content.tsx`,
had no file capable of forwarding its `startStep` dispatcher into `StatusBoard` at all.
Corrected: task 23's `allowed_paths` gains `specification-overview.tsx`; the real chain is
`SpecificationDetailContent.startStep` → `SpecificationOverview.onStartStep` →
`StatusBoard.onStartStep`, replacing `SpecificationOverview`'s `onWorkflowAction` prop with a
pure rename/forward — confirmed safe because `onWorkflowAction` is read only inside
`TaskCard`'s `isDeterministic` branch, entirely separate from the
`SpecificationOwnerAction`-typed `onDirectTaskAction`/`onBatchTaskAction` pair legacy cards
use. This same review found task 20 had claimed it could prove `TaskDialog`'s activation
POSTs `{ action: 'start' }` — impossible, since `TaskDialog`'s `onStartStep` is intentionally
only a test double within task 20's own scope (its real implementation is task 23's to
supply). Corrected: task 20 now proves active-interaction *submission* identically for both
entry points (its real scope) and chat's own waiting-state *activation* for real (chat is
fully self-contained), while `TaskDialog`'s waiting-state control is proven only to *call*
`onStartStep` with a test double; the real `TaskDialog`→transport proof moves to task 23,
alongside the equivalent, already-present proof for `TaskCard` — both real entry points are
now asserted to route through the identical `startStep` function instance. Finally, task 15's
own acceptance criterion claiming `buildAgentStepTriggerMessage(taskId)` produces
"byte-for-byte identical output for two different `taskId`s" was self-contradictory (the
message legitimately includes the task id, so it must differ across tasks) — corrected to
the precise invariant: for the **same** task, changing the workflow step never changes the
message, and the builder's signature structurally accepts only `taskId`, nothing step-shaped.

**Corrective pass 10 (2026-09-21, D33–D39, corrections to D21/D25/D26/D29/D31/D32, renumbered
tasks 24–33): fixing a wrong concurrency assumption pass 9 itself introduced, before any of
tasks 24–33 were implemented.** Pass 9 correctly identified the orchestration gaps a real
dogfooding run exposed, but its own D32 (batch defaults) and
`areas/deterministic-batch-orchestrator.md` wrongly introduced **concurrent** execution of
multiple tasks from one specification — "a concrete bounded concurrency limit... defaulted to
a small, configurable value" and "start two independently-ready tasks" language throughout.
That was never the intended model, and is corrected here as a **deliberate architecture
invariant**, not merely an initial implementation limitation (D33): for one specification, at
most one agent-owned execution — implementation, review, refinement, hardening, discovery, or
any future agent-owned step kind — may be running at a time. A batch means Nevo creates a
deterministic **queue** and executes selected tasks **one by one**, recomputing readiness
after every transition, never two sessions running concurrently. This also means no per-task
Git worktrees, merge strategy, or workspace-isolation architecture is required or introduced
by this change — an entire category of complexity the wrongly-assumed concurrent model would
have needed. Six further gaps a fresh self-review found alongside the concurrency
correction, all resolved before any of tasks 24–33 are implemented: (1) pass 9 conflated
"no owner decision required" (`continueOnSuccess`) with "execute immediately" — corrected by
renaming to `continuation: auto | owner-action` (D25) and giving the sequential queue its own
declarative `schedulingPriority` ordering (D34), so several simultaneously-eligible items
(e.g. `T1 review` alongside `T2`/`T3 implementation`) are ordered without step-name coupling;
(2) pass 9 left the continuation trigger implicitly owned by a React page
(`agent-session-page.tsx`'s `onTurnCompleted`), which only fires while that tab is open —
corrected to a server-side hook on `AgentTurnRuntime`'s own `turn.completed`/`turn.failed`
event plus idempotent reconciliation reusing this repository's own existing
`reconcileOrphanedTurns()` precedent (D35); (3) pass 9 left `sessionPolicy`'s canonical
location and `role`'s vocabulary open — settled as a transition-level, workflow-declared
`execution: {session, role}` (D26 corrected), since `implementation` has two distinct inbound
transitions that may legitimately want different policies; (4) pass 9 assumed
`commit-and-push` alone gives Publish `finishStep`-grade crash safety — it does not; Publish
is corrected to a durable operation reusing `operation-record.mjs`'s actual intent-then-verify
primitives, with Batch Publish's atomicity (prevalidate-all-then-mutate-all-then-one-commit)
decided rather than left open (D29 corrected); (5) pass 9's remediation-group definition
excluded already-terminal downstream consumers — unsafe, since a task that finished while
built against a later-invalidated release is not retroactively correct; corrected to include
terminal consumers (flagged advisory, never reopened) and made durable
(`.nevo-ai-local/remediation-groups/**`) since cross-task review can extend a group beyond
pure derivation (D31 corrected, D36); (6) the existing `blockedBy: string[]` dashboard
contract is preserved unchanged — remediation/invalidation state gets its own additive
`suspensions` field instead of overloading it (D37) — and the new sequential queue is placed
as pure domain logic under `tools/specs/workflow/queue/**`, with the session/turn-aware
orchestration kept in a separate `tools/dashboard/server/ai/orchestration/**` application
layer, preserving the existing, correct workflow-core → never-imports-dashboard direction
(D38). Tasks 24–33 are renumbered so `change.yaml`'s presentation order matches actual
dependency order (previously, order 33 appeared before order 32).

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
- **`normalizeWorkflowDefinition()`** (`definitions/schema.mjs`) does not copy `executor`
  onto a normalized step, and its `transitions.map(...)` only copies `value`/`to` — never
  `action`/`outcome` — onto a normalized transition, confirmed by reading the function
  directly (2026-09-19). A definition can validate successfully and still lose this
  metadata the moment any runtime consumer (`step-context.mjs`, `finish-operation.mjs`,
  the new projections) reads the *normalized* object, which every real caller does.
- **`buildFinishContract()`** (`step-context.mjs`) always sets
  `parameters.feedback = { type: 'string', required: false, ... }`, regardless of any
  transition metadata — confirmed by reading the function directly. It has no way to know
  about a transition's `action.feedback.required` today (that field doesn't exist yet, and
  this function isn't transition-`action`-aware even once it does), so nothing server-side
  would enforce a human transition's declared "feedback required" without an explicit,
  separate validation step.
- **`tools/dashboard/server/specs/routes.mjs`/`actions.mjs`**, read directly (2026-09-19):
  `computeTaskAvailableActions()` (`actions.mjs`) hardcodes exactly
  `wp.current_step === 'implementation'`/`'review'`/`'human-verification'` and the literal
  destination strings `'human-verification'`/`'review'`/`'implementation'`/`'verified'` to
  produce action ids `'start-implementation'`/`'start-review'`/`'approve'`/
  `'request-changes'`/`'operator-reconciliation'`. `computeTaskWorkflowProjection()`
  exposes only `{status, currentStep, attempt, workflowState}` — plain strings, no
  descriptor object. The one deterministic mutation route,
  `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`
  (`handleHumanDecision`/`executeHumanDecision`), hardcodes its request body to
  `{ decision: 'approve'|'request-changes', feedback }`, translates it to
  `{ approve, requestChanges, feedback }`, and calls `handleWorkflowVerifyHuman` (the CLI
  handler) directly — there is no route for explicitly activating a waiting human step, and
  no route accepting an arbitrary definition-driven `result`.
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
12. `normalizeWorkflowDefinition()` silently drops `executor`/transition `action`/`outcome`
    today — a definition can validate and then lose exactly the metadata every runtime
    consumer needs, the moment it's read back normalized.
13. `startHumanStep`/`submitHumanStepResult` exist only as domain operations with no HTTP
    transport a browser can reach — the one real dashboard route hardcodes
    `decision: 'approve'|'request-changes'` and calls the CLI compatibility layer, not the
    generic operations.
14. The generic finish contract hardcodes `feedback.required: false` — nothing
    server-side enforces a human transition's own declared `action.feedback.required`,
    so a direct API/domain call could submit a "request changes"-shaped result with no
    feedback even though the definition requires it.
15. The dashboard DTO exposes only plain strings (`currentStep`/`nextStep`) — `HumanStepSurface`
    has no way to show `purpose`/`expectedWork` for a step that hasn't activated yet without
    reconstructing them from a step id, which is exactly the hardcoding this change removes
    elsewhere.
16. "Start implementation"/"Start review"/"Start human step" were described together as
    session-creation entry points — wrong for the human case, where starting the step must
    never create or bind an AI execution session.
17. Hardcoded `start-implementation`/`start-review` action ids reintroduce literal-step-name
    coupling at the DTO layer, the same problem this change removes from `stageForStatus`/
    `isTaskReady` elsewhere.
18. A human step's single unconditional transition has no `result` to submit — nothing
    previously said whether to omit it or fabricate one.
19. Pass 4's own "explicitly transitional" `implementation`/`review` dispatch adapter was
    itself a step-id special case, not a bounded stopgap — isolating a lookup at one call
    site doesn't stop it from breaking the moment a definition adds a third agent step, and
    by the time it was found, `start-agent-step`/`start-human-step`, "review-appropriate
    lane," and "Ready for review" had already spread it into several areas/tasks as if it
    were generic target behavior.
20. The board/lane requirements contradicted themselves — "derive lane from
    `TaskProjection.state`" alongside "a `review` step lands in a review-appropriate lane"
    cannot both be true for two different `active` steps named `review` and `hardening`.
21. `AgentSessionService#createSession()` silently promotes a single-item contextual
    `taskIds` array to the session's authoritative `activeTaskId` — `{ taskIds:
    ['draft-task'] }` alone should never become execution intent, regardless of list
    length, and the existing code's own comment argues for exactly the assumption this
    change rejects.
22. `formatNevoWorkflowContext`'s own default parameters, and a fallback in
    `AgentSessionService`'s turn-bootstrap path, can still surface the literal string
    `'implementation'` for a caller-supplied `workflowContext` override missing its own
    `step` — dead weight contradicting "never fabricate `step`/`attempt`," even though the
    automatic, `resolveDeterministicWorkflowInfo()`-driven path is unaffected.
23. D15's corrected model (one generic `start-step` action, executor as protocol only) had
    no real client caller reaching it: `specification-detail-content.tsx`'s
    `handleWorkflowAction`, `agent-session-page.tsx`'s `handleStartReviewTask`, and
    `agent-session-chat-surface.tsx`'s action-bar rendering all still used the pre-D15
    `'start-implementation'`/`'start-review'`/`'approve'`/`'request-changes'` vocabulary and
    step-id-derived prompts — confirmed by reading each file directly (2026-09-20). A
    human-owned step's "Start" control was a dead click in practice, since no path called
    `startHumanStep` from any UI entry point.
24. `tasks/19-task-card-lifecycle-split.md` and `tasks/20-human-step-surface-consolidation.md`
    directly contradicted each other: task 19 required the board card to render an active
    human interaction's own result buttons inline; task 20 declared wiring
    `HumanStepSurface` into the board out of scope. The same surface was simultaneously
    required and forbidden by two different tasks in the same change.
25. Pass 6's own task assignments had three mechanical defects, confirmed by reading the
    repository and the task files directly (2026-09-20): `session-bootstrap-readiness-wiring`'s
    `allowed_paths` named a file that has never existed
    (`features/specifications/detail/specification-detail-content.tsx`) instead of the real
    screen file (`screens/specification-detail/specification-detail-content.tsx`); that same
    task was required to build the real `startStep`/chat-handler implementations and pass
    them into `StatusBoard`/`TaskDialog`/chat, but the prop contracts those implementations
    plug into are introduced by `task-card-lifecycle-split` and
    `human-step-surface-consolidation` — both of which depend on it, making the dependency
    unsatisfiable; and D17's written `HumanStepSurface` prop contract
    (`stepDescriptor`/`onStart` included) had gone stale the moment D19/D20 moved the
    waiting-state control out of the component, but was never updated to match.
26. Pass 7's own task 23 had a further real-path defect, confirmed by reading the repository
    directly (2026-09-20): `specification-detail-content.tsx` does not render `StatusBoard`
    directly, it renders `SpecificationOverview`, which owns the actual `onWorkflowAction`
    prop forwarded into `StatusBoard` — a task 23 that owned only
    `specification-detail-content.tsx` had no file capable of wiring `onStartStep` into the
    board at all. The same review found task 20 claiming a real
    `TaskDialog`→`{action: 'start'}` proof it structurally cannot make, since `TaskDialog`'s
    `onStartStep` is only a test double until task 23 supplies the real implementation; and
    task 15's trigger-message criterion claimed byte-for-byte identical output across
    *different* task ids, which is self-contradictory once the message includes the task id.
27. `startStep()` silently omits `mode`, which the provider contract then defaults to `'edit'`
    — a real Claude session opened this way cannot satisfy the dashboard's non-interactive
    `workflow step start` command-approval requirement (Finding 1, corrective pass 9).
28. `StepContext` (`compileStepContext()`) carries only the task id, never the task's own file
    path or content, forcing an executing agent to rediscover its own task file by searching
    the repository (Finding 2, pass 9).
29. `StepContext`'s `relevantDocs` is routing-derived only; the task's own frontmatter-declared
    `context.required`/`optional` (already resolved for the legacy path by
    `buildContextPacket()`) is never surfaced to the deterministic path (Finding 3, pass 9).
30. `StepContext.context.sourceControl` exposes `CommitAndPushAction.check()`'s full internal
    factual context, including effectively the complete branch history
    (`existingCommits`), to the agent; `finishContract.parameters`/`.requiredInputs` are the
    same object under two names (Finding 4, pass 9).
31. No workflow-definition metadata distinguishes an automatic engine-to-engine continuation
    from a stop requiring an owner action; nothing creates the next step's session after
    `workflow step finish` transitions to it (Finding 5, pass 9).
32. Session selection for a new step matches only on `taskId`, never `step` — an existing
    implementer session can be reused for review, and no session-lineage
    (`parentSessionId`)/execution-role concept exists to model "fresh reviewer session" as a
    first-class relationship (Finding 6, pass 9).
33. Reaching a human-owned step requires a manual, meaningless "Start" click before the actual
    definition-driven interaction (`HumanStepSurface`) appears (Finding 7, pass 9).
34. Dependency satisfaction has no earlier release point than the dependency's own successful
    terminal transition, and no modeled consequence if a released dependency's own review
    later fails after a downstream task has already started against it (Finding 9, pass 9;
    release resolved by D28, invalidation resolved by D31).
35. No deterministic equivalent of legacy `batch-*` exists; the deterministic UI can only
    start one task at a time even when several are simultaneously ready (Finding 10, pass 9;
    resolved by D32).
36. `workflow task publish` mutates `change.yaml` (`status: approved`) and returns without
    committing or pushing, leaving a standalone user mutation to be silently absorbed into
    whichever agent's finalize commit happens to run next (Finding 11, pass 9).
37. No documentation distinguishes a standalone user mutation (must own its own
    commit/push) from a technical activation (may be finalized by the attempt it belongs to)
    from a completed lifecycle mutation (already owns its own finalize) — the ambiguity that
    produced item 36 (Finding 12, pass 9).

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
  action DTO wiring, tier-1 descriptor, the one generic `start-step` action, D15, and
  legacy/deterministic mutation split), `routes.mjs` (new generic `workflow/human-step`
  transport route, D14), `data.mjs`/`status-stages.mjs` (board/lane projection, corrected to
  read only `TaskProjection.state`, never `currentStep`, D15).
- `tools/dashboard/server/ai/sessions/service.mjs` (D18 — the `primaryTaskId` single-task
  bug and the `'implementation'` fallback, both corrected in place; the existing
  `resolveDeterministicWorkflowInfo()`/`formatNevoWorkflowContext()` bootstrap mechanism
  itself is unchanged).
- `tools/dashboard/ui/features/specifications/types.ts` (frontend DTO type, corrected to the
  new projection shape, D18).
- `tools/dashboard/ui/features/specifications/**`, `tools/dashboard/ui/features/agent-sessions/**`
  (UI composition-boundary split, each with its own thin `human-step-mutations.ts` adapter,
  D17), `tools/dashboard/ui/shared/workflow/human-step-surface.tsx` (the shared, prop-driven
  `HumanStepSurface`, D11/D17 — feature-neutral, consumed by both `TaskDialog` and the chat
  surface without either importing the other), `tools/dashboard/ui/shared/lib/human-step-request.ts`
  (the one neutral transport function both features' adapters call, D14/D17).
- `.claude/skills/nevo-ai-spec-workflow/**` (or equivalent shared skill/instruction layer —
  lifecycle-specific instruction split, removing legacy-only assumptions from shared
  sections, not just adding a new deterministic reference).
- `docs/development/agent-workflow-protocol.md` (ownership boundary documentation,
  including the executor invariant).
- (corrective pass 9/10) `tools/specs/workflow/step-context.mjs` (`taskDefinition`,
  `requiredContext` — both inline content, D22–D24); `.nevo-ai/workflows/*.yaml`,
  `tools/specs/workflow/definitions/schema.mjs` (additive `continuation`, `execution`
  `{session, role}`, `releasesDependencies`, `schedulingPriority` schema, D25/D26/D28/D34/D39);
  `tools/specs/workflow/dependency-satisfaction.mjs`, `tools/specs/workflow/
  remediation-record.mjs` (new — declarative release and durable, terminal-consumer-inclusive
  remediation groups, D28/D31/D36); `tools/specs/workflow/queue/**` (new — pure-domain
  sequential queue, single-active-execution invariant, zero dashboard imports, D33/D34/D38);
  `tools/dashboard/server/ai/orchestration/**` (new — server-side continuation trigger hooked
  to `AgentTurnRuntime`, idempotent reconciliation, session lineage/role creation, D25–D27/
  D35/D38); `tools/specs/workflow/publish/operation.mjs`, `tools/specs/workflow/
  operation-record.mjs`, `tools/dashboard/server/specs/routes.mjs`
  (durable Publish + atomic Batch Publish reusing `operation-record.mjs`'s primitives, D29);
  `tools/dashboard/ui/screens/specification-detail/**`,
  `tools/dashboard/server/ai/sessions/execution-policy-service.mjs` (new — change-level
  execution-policy transport, D21); `docs/development/agent-workflow-protocol.md` (D30
  ownership taxonomy, extending the existing section, consistent with D3).

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
`ensureStepActivated` and is preserved, not reimplemented), D14 (one generic
`workflow/human-step` route/transport, `{action: 'start'|'submit'}`, is the one thing
`HumanStepSurface` calls — the existing `/workflow/human-decision` route stays only for
CLI-compatibility callers), D15 (**superseded, corrective pass 5** — one generic `start-step`
lifecycle action replaces `start-agent-step`/`start-human-step`/`start-implementation`/
`start-review`; no step-id dispatch anywhere in projection, readiness, DTO, session
bootstrap, or board/lane projection; an agent session's initial trigger is a generic
message, never a step-id-derived semantic prompt — the real work contract stays entirely in
the existing `StepContext`/`finishContract` mechanism), D16 (a human step's unconditional
transition submits with no `result` — never a fabricated placeholder value), D17
(`HumanStepSurface` lives in `shared/workflow/`, purely prop-driven; its transport is one
neutral `shared/lib` function plus one thin adapter hook per consuming feature — never a
feature-owned component/hook the sibling feature imports directly, which the repository's
own `architecture-boundaries.test.mjs` forbids; **prop contract corrected, seventh pass** —
`{ interaction, loading, error, onSubmit }` only, no `stepDescriptor`/`onStart` — the
component owns the active human interaction alone, never the generic waiting-state control),
D18 (frontend DTO type owned by `session-bootstrap-readiness-wiring`; two real, grounded bugs
in `tools/dashboard/server/ai/sessions/service.mjs` — a single-item contextual `taskIds`
silently becoming authoritative, and a reachable `'implementation'` fallback — corrected in
place, owned by `execution-readiness-policy`). D19 (**corrective pass 6, task decomposition
corrected in the seventh pass** — one composition-level `startStep(task, stepDescriptor)`
dispatcher per screen, branching only on `executor`, closes the gap between D15's model and
the real client code; `TaskCard`/`TaskDialog` only ever call an `onStartStep`/
renamed-equivalent prop supplied from the composition layer above them; the real dispatcher
now lives in a dedicated final task, `specification-detail-composition-wiring`, that depends
on the three tasks introducing the contracts it fills, rather than in
`session-bootstrap-readiness-wiring`, which would otherwise have consumed contracts only its
own dependents introduce), D20 (`DeterministicTaskCard` never embeds the active
human-interaction result form — it shows a compact indicator and defers to `TaskDialog`;
`HumanStepSurface` narrows to the active-interaction case only, resolving the direct
contradiction between the pass-5 versions of tasks 19 and 20).

**Corrective pass 9 decisions (2026-09-21):** D21 (the first explicit Start for an
`executor: agent` step must let the user choose provider/execution mode, reusing
`CreateAgentSessionDialog`'s existing concept rather than inventing a second one; the
resolved choice becomes a persisted execution policy so later automatic handovers don't
re-ask), D22 (`StepContext` gains an explicit `taskDefinition: {id, path, content}` field —
the agent never rediscovers its own task file), D23 (`StepContext` models task-declared
`requiredContext` — from `context.required`, contents bundled inline — as a distinct field
from routing-derived `relevantDocs`; neither replaces the other), D24 (`StepContext` exposes
only the source-control facts an agent genuinely needs to act, never
`CommitAndPushAction.check()`'s full internal context; `finishContract` keeps one canonical
field, `parameters` — `requiredInputs` is dropped as a pure duplicate), D25 (a declarative
per-transition continuation policy — `continueOnSuccess: auto | owner-action` — replaces
inferring continuation from step names; a new orchestration layer, not `finishStep` itself,
creates the next step's session when `auto` applies), D26 (session policy is declarative —
`sessionPolicy: reuse | fresh` per step/role; `standard-v1`'s `review` step uses `fresh`; a
new `parentSessionId` lineage field and an execution-role concept
(`implementer`/`reviewer`/`refiner`) are added to session identity, never derived from a
literal step name), D27 (the orchestrator auto-activates a human-owned step immediately on
arrival via the existing `startHumanStep`, pausing there for the real declarative
interaction — the redundant manual "Start" click before it is removed), D28 (a transition may
declare `releasesDependencies: true` to satisfy dependents before its own workflow reaches a
terminal transition; the default, unmarked behavior is unchanged — dependents wait for
`outcome: success` on a terminal transition exactly as today), D29 (`workflow task publish`/
Batch Publish validate → mutate → commit → push in one operation, reusing the existing,
already-registered `commit-and-push` action with an auto-generated `chore(workflow): publish
<task-id>` message — the user is never asked to type a commit message for this), D30 (three
explicit, documented source-control ownership categories — standalone user mutation,
technical activation, completed lifecycle mutation — govern which future dashboard actions
must commit their own change vs. may be finalized by the attempt they belong to). **Two
findings initially raised open questions with no repository precedent to decide from — routed
to the owner rather than decided by inference, per `references/decision-policy.md`
("silence is not agreement") — both are now resolved, in the owner's own direction rather
than any of the originally offered options, superseding the option lists this document first
presented:

- **OQ-A (Finding 9, invalidation) → resolved by D31.** Not a simple suspend/warn/require-ack
  choice among the original three options: the owner's actual workflow fixes a failed
  dependency and every task that consumed its premature release *together*, as one
  automatically-derived remediation group, reviewed in one combined, cross-task-aware pass
  that can flag an unlisted group member for adjustment too (e.g. t2 needing a fix because of
  a change to t1, even though t2 wasn't independently broken) — see D31 for the full model,
  which reuses the existing legacy `implementation-review` cross-task-integration design as
  its pattern.
- **OQ-B (Finding 10, batch defaults) → resolved by D32.** Not three named selection "modes"
  with a chosen default: the owner's actual workflow is a checkbox-based task picker,
  pre-selected with ready tasks, freely adjustable, warning (never hard-blocking) when the
  current selection includes a task blocked by a dependency outside the selection — see D32.

**Corrective pass 10 decisions (2026-09-21):** D33 (**fundamental correction, supersedes
D32's concurrency assumption in full**) — for one specification, at most one agent-owned
execution runs at a time; a batch is a deterministic sequential queue, never concurrent
sessions; no per-task worktrees/merge orchestration/workspace isolation is needed or
introduced. D34 (declarative `schedulingPriority` per step, ascending, default `0`, tie-break
on the existing `task.order` field — resolves ordering among several simultaneously-eligible
items with no step-name coupling; `standard-v1`'s `review` step gets `schedulingPriority:
10`). D35 (the continuation trigger is server-side — `AgentTurnRuntime`'s own
`turn.completed`/`turn.failed` event, plus idempotent reconciliation reusing this
repository's own `reconcileOrphanedTurns()` precedent — never a React page callback). D36 (a
durable `.nevo-ai-local/remediation-groups/**` record for each remediation group, since
cross-task review can extend membership beyond what pure `workflow_progress` derivation alone
produces). D37 (`blockedBy` keeps its existing `string[]` shape; remediation/invalidation
state gets its own additive `suspensions` field). D38 (the sequential queue is pure domain
logic under `tools/specs/workflow/queue/**`, with zero dashboard/AI-runtime imports; the
session/turn-aware orchestration lives in a separate `tools/dashboard/server/ai/
orchestration/**` application layer — preserving the existing, correct workflow-core →
dashboard dependency direction). D39 (the consolidated `continuation`/`releasesDependencies`/
`execution`/`schedulingPriority` schema shape, implemented as one coherent extension). Five
prior decisions corrected in place rather than superseded outright (the placement/reasoning
each already recorded stands; only the specific gap the fresh self-review found is fixed):
D21 (execution policy is change-level, not task-level, with a real server transport — no
longer "decide during implementation"), D23 (`requiredContext` bundles content inline,
finalized, not conditional on payload size), D25 (renamed `continueOnSuccess` →
`continuation`; eligibility, not immediate execution; full `standard-v1` transition audit),
D26 (`execution: {session, role}` is canonical on the **transition**, `role` is an
extensible workflow-declared string), D29 (Publish is a durable operation reusing
`operation-record.mjs`'s real intent-then-verify primitives — `commit-and-push` alone does
not inherit `finishStep`'s crash safety; Batch Publish's atomicity is decided, not deferred),
D31 (remediation-group derivation includes already-terminal consumers, flagged advisory and
never reopened).

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
artifacts}` — `result` is present only when the active step's own transitions are
conditional; a human step with a single unconditional transition submits with no `result`,
never a fabricated placeholder (D16) — gated by the same executor check.
`submitHumanStepResult` additionally resolves the selected transition and, when its
`action.feedback.required` is `true`, rejects a missing/blank `feedback` before calling
`finishStep` at all — the engine's own generic finish contract otherwise always treats
`feedback` as optional, so nothing server-side would enforce this without this explicit
step (this validation lives in `submitHumanStepResult` itself, not duplicated into
`finishStep`'s generic contract, which stays UI-metadata-agnostic for agent steps too).
`finishStep` already matches `result` against the active step's declared transitions
generically. `executor` is an **enforced invariant**, not a UI hint: `workflow step start`
(and, for defense in depth,
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
on every transition of an `executor: human` step, optional for agent steps). Validating a
definition successfully must not silently lose this metadata on load:
`normalizeWorkflowDefinition()` (`definitions/schema.mjs`) is corrected to preserve
`executor` and every transition's `action`/`outcome` in its returned, normalized shape —
today it drops both, a gap the original schema task left implicit.

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
"Human action required — <purpose> — [Start]" (or the identical, generic "[Start]" for a
waiting agent step — D15, no step-id-derived wording either way) without hardcoding a step
id), and
— only while a human step is actually active — its interaction-actions descriptor (`actions:
[{result?, label, feedbackRequired}]` — `result` present only for a conditional step's
transitions, absent for a single unconditional one, D16 — straight from that step's
transitions). This
projection deliberately does **not** own runtime-dependent "available application actions"
(D10) — that would make it neither pure nor complete, since availability genuinely depends
on more than workflow-definition state.

`ExecutionReadiness` (D10) is the next layer: composes `TaskProjection` with the executor
guard and the engine's *existing* activation preconditions (D13 — `ensureStepActivated`'s
own clean-worktree-for-new-attempt / prior-finish-operation-settled checks, inspected/
reused via an exported query, never reimplemented) to answer "can this task start/continue
right now." It is shared by both executors, but what happens *after* a positive answer
diverges and must stay explicitly distinct (a repeated wording problem in earlier passes,
corrected here): for an agent-owned step, a positive readiness answer is followed by
creating or reusing an authoritative AI execution session bound to the task, then
`workflow step start`; for a human-owned step, a positive answer is followed by
`startHumanStep` directly — **no AI execution session is created or bound**, whether or not
a contextual chat session happens to already exist and display the human surface. Only an
authoritative execution `taskId` (never a session's merely contextual `taskIds`, and never
auto-selected) triggers this check for either kind; session bootstrap uses this same policy
for a read-only preflight and never itself calls `ensureStepActivated`.

`DashboardActionProjection` (D10) is the outermost layer: composes `TaskProjection` and
`ExecutionReadiness` into the dashboard's real action DTO
(`tools/dashboard/server/specs/actions.mjs`), replacing its current, grounded, concretely
confirmed `computeTaskAvailableActions()`/`computeTaskWorkflowProjection()` — which today
hardcode `wp.current_step === 'implementation'`/`'review'`/`'human-verification'` and
literal action ids `'approve'`/`'request-changes'`/`'start-review'`/`'start-implementation'`
— with: state, executor, attempt, blocked-by, terminal outcome, an explicit
**current/next-step descriptor** (`{id, executor, purpose, expectedWork}`, present for the
relevant target step whether or not it's activated yet, so `HumanStepSurface` never has to
reconstruct `purpose`/`expectedWork` from a step id), human-step interaction metadata
(tier 2, only once active), and **one generic lifecycle action** — `availableActions:
["start-step"]` (a plain string, D15 superseding the original D14/D15 wording that had
proposed `start-agent-step`/`start-human-step` as separate ids) — present exactly when the
current position is waiting for a start and `ExecutionReadiness` allows it, for **either**
executor; the caller reads the step descriptor's own `executor` to know which execution
protocol `start-step` triggers, the action id itself never encodes it, and no application
code anywhere derives `availableActions` by comparing a step id. `HumanStepSurface` reaches
`startHumanStep`/`submitHumanStepResult` through one new, generic transport route,
`POST .../workflow/human-step` (`{action: 'start'}` / `{action: 'submit', result?,
feedback?, artifacts?}` — D14), returning structured domain/readiness/executor errors
rather than an opaque failure; the existing `/workflow/human-decision` route (hardcoded
`decision: 'approve'|'request-changes'`) stays, unchanged, for its existing CLI-compatibility
caller only. `actions.mjs`'s legacy (`approve`/`verify`/`finalize`) and deterministic
mutation handling are split into separate implementations under shared composition/routing,
resolving `workflowMode` once, with no cross-calls between them — covered by the same kind
of import/call-boundary regression test as the CLI-level guard.

**Agent-owned `start-step` never constructs a semantic prompt (D15).** Clicking `start-step`
for an `executor: agent` task creates or reuses the task's authoritative execution session
and sends one generic, visible trigger — conceptually "Execute the current workflow step
for task `<task>`" — never "Implement task…"/"Review task…"/any wording derived from the
step's id or purpose. The real work contract still comes entirely from the *existing*,
unmodified bootstrap mechanism already implemented in
`tools/dashboard/server/ai/sessions/service.mjs`: `resolveDeterministicWorkflowInfo()`
resolves the task's authoritative current step/attempt from real `workflow_progress` (fail-
closed — it throws rather than guessing), and `formatNevoWorkflowContext()` injects a hidden
`[Nevo Workflow Context]` header instructing the agent to run
`node tools/specs.mjs workflow step start <change> <task>` before touching any file — that
command's own `StepContext` (`currentStep`, `attempt`, `instructions`,
`stepContract.purpose`/`.expectedWork`/`.hints`, `expectedWork.allowedPaths`/
`.forbiddenPaths`, `relevantDocs`, `previousTransition`, `finishContract`) is the one and
only place step-specific instructions come from — the dashboard never builds a second,
parallel instruction system. This pass corrects two real bugs in that same file rather than
redesigning it (D18): `formatNevoWorkflowContext`'s own default parameters and a
turn-bootstrap fallback could still surface the literal string `'implementation'` for an
explicit `workflowContext` override missing its own `step` — removed, fail-closed instead;
and `AgentSessionService#createSession()`'s `primaryTaskId` computation silently promoted a
single-item contextual `taskIds` array to the session's authoritative `activeTaskId` —
removed, so contextual `taskIds` of any length (0, 1, or many) never sets it. Neither fix
touches the correct, already-generic parts of this mechanism.

The dashboard UI composition splits only at the lifecycle-specific surfaces — shared shell,
navigation, docs, PR info, sessions, chat runtime, and `TaskDetails`'s container role stay
common; `status-board`'s lane derivation and `TaskCard`'s visible state/tone/lane/blockedBy/
actions (not only its action footer — a deterministic card's status label must stop reading
`formatTaskStatus(task.status)` once a workflow has started) each read from
`DashboardActionProjection` alongside the unchanged legacy path, rather than deriving
deterministic state from `stageForStatus`/`isTaskReady`. `TaskCard`'s own active-human-
interaction rendering is a compact indicator that opens `TaskDialog`, not the interaction's
own result buttons rendered inline (D20). One reusable `HumanStepSurface` (D7, D11),
scoped to the active human interaction only (D20), is built once and rendered directly by
both `TaskDialog` and the existing chat surface — replacing chat's current separate
implementation, not leaving it as a second one. The generic waiting-state "Start" control
(identical for both executors) is a separate small piece each of `TaskCard`, `TaskDialog`,
and chat renders itself, calling one composition-level `startStep`/renamed-chat-handler
dispatcher that branches only on `executor` (D19) — `TaskCard`/`TaskDialog` never branch on
`executor` or import `features/agent-sessions`/the human-step transport themselves.

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
  actual action DTO (D10, carrying the tier-1 step descriptor and the one generic
  `start-step` action, D15), the new generic `workflow/human-step` transport route
  `HumanStepSurface` calls (D14), and splitting `actions.mjs`'s legacy/deterministic
  mutation implementations.
- `areas/ui-dashboard-board-split.md` — deterministic-aware board/lane projection, derived
  only from `TaskProjection.state` (never `currentStep`, D15), and `TaskCard`'s full
  visible-state split, reading from the corrected action DTO; the board's own generic
  `onStartStep` wiring and compact human-interaction indicator, not a duplicated interaction
  surface (D19/D20).
- `areas/human-step-surface.md` — one reusable `HumanStepSurface`, scoped to the active
  interaction only, consumed by both `TaskDialog` and chat (D7, D11, D20).
- `areas/skills-instruction-split.md` — removes legacy-only assumptions from shared
  sections and defines the explicit legacy/deterministic lifecycle instruction sets.
- `areas/ownership-boundary-docs.md` — documents the enforced boundary, including the
  executor invariant.
- `areas/agent-step-bootstrap-and-context.md` — (corrective pass 9) extends `StepContext`
  with the task's own document, task-declared `requiredContext` distinct from routing-derived
  `relevantDocs`, and separates internal finalize context from the agent-facing payload
  (D22–D24).
- `areas/workflow-continuation-and-session-handover.md` — (pass 9/10) the execution-mode/
  provider selection UX for the first explicit Start and its persisted, **change-level**
  execution policy with a real server transport (D21); the declarative continuation
  (eligibility, not immediate execution) and session-lineage/role model, triggered
  server-side off `AgentTurnRuntime`'s own events with idempotent reconciliation, never a
  React page (D25–D27/D35); every eligible destination is handed to the sequential queue
  (D33), never scheduled directly by this area.
- `areas/dependency-release-and-invalidation.md` — (pass 9/10) declarative per-transition
  dependency release (D28); automatic remediation-group derivation including terminal
  consumers, durable and extensible, suspended via a separate `suspensions` field (D31/D36/
  D37).
- `areas/deterministic-batch-orchestrator.md` — (pass 9/10) a **sequential, single-execution**
  task queue (never concurrent, D33), pure domain logic under `tools/specs/workflow/queue/**`
  (D38), ordered by declarative `schedulingPriority` (D34), with a checkbox-picker selection
  model and a cross-selection dependency warning (D32); reused by D31's remediation-group fix
  runs.
- `areas/dependency-invalidation-remediation-review.md` — (pass 9/10) the one combined,
  cross-task-aware review pass for a dependency-invalidation remediation group, adapting the
  existing legacy `implementation-review` two-pass design, terminal members reviewed
  read-only (D31).
- `areas/user-mutation-source-control-ownership.md` — (pass 9) Publish/Batch Publish own their
  own commit/push (D29); the explicit user-action/technical-activation/completed-mutation
  ownership taxonomy (D30).

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
- No file in `tools/specs/workflow/**` (projection/readiness/DTO layers), the dashboard
  server's deterministic action derivation, the client-side session-bootstrap/board-lane
  code, or `HumanStepSurface` contains a `switch`/`if`/lookup-object keyed on a literal
  workflow step id — a newly authored agent-owned step (any id) works with zero
  application-code changes (D15; verified concretely by task 15's generic fixture, item 15).
- `TaskCard`, `TaskDialog`, and the chat surface each have a working generic `start-step`
  control for both `executor` values — none is a no-op — and no file in
  `tools/dashboard/ui/**` contains `'start-implementation'`, `'start-review'`,
  `onStartReviewTask`, or `onApproveTask` after this change (D19, item 23/5).

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
engine or to the `workflow verify-human --confirm` gate-confirmation path; a real,
declarative per-step agent-dispatch/execution-mode metadata system (D15 — `start-step` uses
one consistent existing session/provider default for every agent step, independent of
which step it is; no per-step mode/archetype is designed here, and no step-id-keyed
adapter of any size is introduced to work around that); full archetype/handover/
provider-selection design for agent orchestration (narrowed, not removed, by corrective pass
9 — see below); removal or redesign of the existing `/workflow/human-decision` route and its
CLI-compatibility callers.

**Corrective pass 9 narrows two of the exclusions above, does not remove them.** "Handover
automation" and "full archetype/handover/provider-selection design for agent orchestration"
are addressed only to the bounded extent D25/D26/D28/D31/D32 require: a declarative
per-transition continuation policy (`continueOnSuccess`), session-reuse policy
(`sessionPolicy`, `role`, `parentSessionId` lineage), a checkbox-picker batch scheduler
(D32), and one cross-task-aware remediation-review pass for a dependency-invalidation
remediation group (D31) — not a general-purpose action/dispatch framework, not per-provider
handover routing, and not a full artifact/attachment system beyond the `parentSessionId`
lineage field itself. Still explicitly out of scope after this pass: Activity History as a
feature (`ai-spec-history` remains the dogfooding workload, never the owner of these
workflow-runtime fixes); any redesign of `entryGates`/`exitGates` or the
`workflow verify-human --confirm` path; unrelated dashboard visual redesign; a fully general
batch/orchestration framework beyond the one sequential, single-execution queue D33 defines;
rolling back or destructively reverting a task's own completed work as part of dependency
invalidation (D31 is forward-only suspension plus grouped re-fix, never rollback); a general
multi-change/cross-spec remediation mechanism beyond one change's own task graph. **Corrective
pass 10 adds, explicitly:** any form of concurrent/parallel agent execution within one
specification (D33 — a deliberate invariant, not a limitation to relax later); per-task Git
worktrees, merge strategy, or parallel-branch integration/workspace isolation of any kind
(none of it is needed once execution is sequential); reopening a terminal task's workflow as
part of remediation (D31 corrected — flagged advisory only, a future decision if it ever
proves necessary); a general declarative-priority system beyond the one
`schedulingPriority`/`task.order` ordering pair D34 defines.
