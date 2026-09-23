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
`areas/deterministic-sequential-queue.md` wrongly introduced **concurrent** execution of
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

**Corrective pass 11 (2026-09-22, D40–D46, corrections to D21/D28/D29/D31/D39): closing nine
remaining correctness gaps a fresh review found in pass 10's own design, before any of tasks
24–33 are implemented.** Grounded against real code read directly (not assumed) —
`dependency-satisfaction.mjs`, `task-projection.mjs`, `operation-record.mjs`,
`finish-operation.mjs`, `tools/dashboard/server/ai/sessions/turns/runtime.mjs`,
`tools/dashboard/server/ai/sessions/service.mjs`,
`tools/dashboard/server/specs/human-step-transport.mjs`:

1. **Dependency release modeled as "last history entry has the flag," not an epoch (D40).**
   `evaluateDependencySatisfaction` reads only `history.at(-1)` — confirmed by reading the
   function directly — so a release would appear to lapse the instant any further,
   non-invalidating transition happened (e.g. `review → human-verification` right after
   `implementation → review` released dependents). Corrected: a release is an epoch that
   remains valid until an explicit `invalidatesDependencyRelease: true` transition fires — no
   wording or logic based on a transition going "backward" to an "earlier step" (workflow
   steps form a graph, not a line).
2. **No single admission path; no race safety (D41).** `startStep()` could still create a
   session directly, bypassing any queue. Even a corrected queue's `nextRunnable: one item`
   answer is a read, not a claim — two simultaneous requests could both observe "free" and
   both create sessions. Corrected: one `admitAgentExecution(specId, candidate)` gate, reusing the
   exact promise-chain-mutex pattern `AgentTurnRuntime.#acquireStartLock` already proves
   (confirmed by reading it directly), keyed by `specId` instead of session id — every
   execution path (manual Start, batch Start, automatic continuation, remediation) funnels
   through it, with no second path capable of starting a session.
3. **The continuation trigger assumed a nonexistent global turn event (D42).** Confirmed by
   reading `runtime.mjs` directly: `#eventStream.emit` is keyed per-`turnId` for streaming,
   not a global "any turn completed" bus, and `startTurn()` returns before the turn actually
   completes (fired via `queueMicrotask`). Corrected to three real hook points:
   `AgentSessionService`'s own per-turn subscription (the real, existing centralization
   point), `human-step-transport.mjs`'s already-synchronous post-`submitHumanStepResult` call
   site (closing the gap where human "Request changes" → auto-continuation wasn't covered at
   all), and the existing `ensureReconciled()`-style boot/first-request hook.
4. **Remediation membership guessed from unpersisted state (D43).** "Tasks that became active
   while the release was in effect" cannot be reconstructed from `workflow_progress.history`
   alone, especially across multiple release/invalidate/re-release cycles. Corrected: a
   durable dependency-consumption record, written at admission time, names exactly which
   release epoch a consuming task/attempt relied on — remediation membership is an exact
   record match, never inferred.
5. **`TaskProjection` was about to lose its purity (D44).** `projectTask()` — confirmed still
   a pure function of its in-memory arguments, no file I/O — would have needed to read
   `.nevo-ai-local/remediation-groups/**` to carry a `suspensions` field directly, regressing
   D10's own established purity. Corrected: a new, separate `SuspensionProjection`, composed
   only at the `ExecutionReadiness` layer and above.
6. **First-Start provider/mode selection was conditional on an unresolved question (D21,
   further corrected).** Gating the picker on "does the provider need an explicit mode" can't
   run before the provider itself is chosen — the check assumed an answer to the very
   question it was meant to gate. Corrected: the picker always shows when no change-level
   policy exists, full stop.
7. **Whether a pending human decision pauses the whole queue was an accidental consequence,
   not a decision (D45).** Resolved explicitly: it does not — the single-execution invariant
   (D33) is scoped to agent-owned executions specifically, and pausing the entire queue behind
   one task's human gate would defeat the purpose of batching multiple tasks in the first
   place. Other agent-owned queued work continues; several human decisions may accumulate.
8. **Runtime terminology still said "batch orchestrator" after its content became sequential
   (D46).** Renamed throughout: `deterministic-batch-orchestrator` → task/area id
   `deterministic-sequential-queue`. "Batch" remains the correct word for the user-facing
   checkbox-picker selection; "queue" is the one runtime/orchestration concept.
9. **Publish's operation-record reuse documented a primitive that isn't exported, and the
   batch-publish path didn't match the real convention (D29, further corrected).** A fresh
   read of `operation-record.mjs` in full found `createOperationRecord` is private to
   `finish-operation.mjs` — only the four persistence functions are actually exported.
   Corrected: Publish defines its own small, local record-shaping helper, reusing only what's
   genuinely exported. Separately, `operationFilePath`'s real signature always produces a
   four-segment path; the original three-segment batch-publish path was corrected to match.

**Corrective pass 12 (2026-09-22, D47–D49, corrections to D27/D41/D42/D43/D45): closing the
remaining Git-ownership and provenance-timing gaps a fresh review found in pass 11's own
design, grounded against `human-step/operations.mjs`, `commit-and-push.mjs`, and
`AgentTurnRuntime`'s process boundary, read directly.**

1. **Auto-activating a human step still leaked dirty tracked state (D47).** Confirmed:
   `startHumanStep` mutates `workflow_progress` via `ensureStepActivated` with no commit of
   its own, and `CommitAndPushAction` always includes the change's own `change.yaml` in
   whatever it commits — so a different task's own agent-driven commit (legal to run
   concurrently under D45) could sweep a pending human step's uncommitted activation into an
   unrelated commit, recreating the exact Publish bug D29 already fixed. Corrected: the
   interaction becomes visible without any mutation (derived purely from the workflow
   definition), and Approve/Request-changes performs activation + submission + finalization
   as one self-owned operation, serialized against every other finalize operation
   (agent-driven `finishStep`, Publish) via a new, cross-process advisory file lock — an
   in-process mutex cannot serialize against an agent's own CLI subprocess, confirmed by
   reading `AgentTurnRuntime`'s process boundary directly.
2. **Dependency-consumption recording happened at session admission, not step activation
   (D48).** A session being admitted never guarantees `workflow step start` actually runs or
   succeeds. Corrected: recording moves inside workflow core, to the exact point a task's
   first step successfully activates — entirely within `tools/specs/workflow/**`, no
   dashboard involvement needed for correctness.
3. **One dependency per consumption record was insufficient (D48).** A task may depend on
   several upstream tasks simultaneously, more than one release-based. Corrected: one atomic
   record per attempt, holding an array of every release-based dependency it relies on;
   remediation lookup matches on any entry.
4. **Admission's claim lifecycle was underspecified (D49).** Corrected: `admitAgentExecution`
   (renamed from `admitExecution`) owns the full check-claim-through-to-durable-visibility
   boundary, with an explicit rollback path if session creation fails before the claim
   becomes durably visible — the candidate stays eligible/retryable, the spec is never left
   falsely occupied.
5. **"Admission" and "human dispatch" were still described as one shared path in places
   (D49).** Every reference describing human interaction activation as a form of "agent
   admission" is corrected — the two are explicit, separate branches of orchestrator dispatch.
6. **A stale conditional-picker sentence survived pass 11's own fix in one task's acceptance
   criteria (task 32).** Removed — the picker always shows when no change-level policy
   exists, consistently everywhere now.
7. **D27's own decision text still described the now-corrected auto-activation mechanism.**
   Corrected in place, pointing to D47 — the underlying goal (no meaningless manual "Start"
   click) is unchanged; only the mechanism is.

**Corrective pass 13 (2026-09-22, D50–D54, corrections to D27/D47/D48): closing the remaining
transaction/provenance correctness gaps a fresh review found in pass 12's own design,
grounded against `finish-operation.mjs`'s real `FINISH_STAGE_IDS` order and the crash/rework
scenarios pass 12 didn't yet cover.**

1. **The git-finalize lock self-deadlocked and protected the wrong window (D50).**
   `activateAndSubmitHumanStep` calling `withGitFinalizeLock` and then internally calling
   `submitHumanStepResult` → `finishStep`, which also calls `withGitFinalizeLock`, is a
   guaranteed self-deadlock against a non-reentrant lock. Separately, confirmed by reading
   `FINISH_STAGE_IDS` (`verify-gates, update-task, commit, push, transition`) directly:
   `update-task` (the tracked mutation) runs before `commit` — a lock held only "around" the
   commit stage leaves the mutation itself unprotected. Corrected: the lease wraps from
   before `update-task` through the commit; `withGitFinalizeLock(fn, existingLease?)` supports
   explicit lease-passing (never implicit reentrancy) so a combined operation acquires exactly
   one lease for its whole sequence and threads it into `finishStep` via a new, optional
   `finalizeLease` input.
2. **The lease had no crash recovery (D51).** A plain exclusive-create-then-`finally`-delete
   lock never releases if its holder is killed. Corrected: the lease file records
   `{ownerId, pid, createdAt}`; a stale lease (confirmed-dead pid via `process.kill(pid, 0)`)
   is safely reclaimed, a live one is never stolen, and release verifies ownership before
   deleting.
3. **Activation and its consumption record could land on opposite sides of a crash (D52).**
   Writing the consumption record as a separate step right after activation leaves a real
   crash window where `workflow_progress` shows the step active but no provenance exists —
   and once that happens, re-resolving fresh dependency state on retry could silently record
   the wrong epoch. Corrected: a new, durable, resumable start-operation record — distinct
   from `finish-operation.mjs`'s own record family — freezes the dependency snapshot before
   activation and completes both stages idempotently on resume, from that frozen snapshot,
   never a re-resolved one.
4. **"First-ever task activation" cannot represent rework (D53).** A task returned to
   `implementation` for a second attempt after its own dependency was invalidated-then-fixed
   must be able to consume the *new* release epoch then — which a first-activation-only gate
   forbids by construction. Corrected: a declarative, step-level `consumesDependencies: true`
   field (owned by task 25's schema, not hidden in task 27's implementation prose) triggers
   recording on every activation of a declared step, any attempt, with zero step-name checks.
   Record identity gains the consuming step (`<change>/<task>/<step>/attempt-<n>.json`),
   closing a real path-collision risk the previous two-segment identity had.
5. **Remediation matched any historical record, not the authoritative one (D54).** Once a
   task can record consumption more than once, matching an old, superseded record against a
   later-invalidated-but-already-abandoned epoch would falsely flag a task whose later,
   successful attempt already moved past that dependency state. Corrected: remediation
   lookup resolves each task's authoritative (latest-attempt) record per dependency and
   matches only against that one.

**Corrective pass 14 (2026-09-22, D55–D58, corrections to D54): closing the last two
correctness gaps — shared-worktree mutation arbitration while an agent is actively working,
and a real total order for dependency-consumption across arbitrary consuming steps.**

1. **The git-finalize lease protects only the mutate-then-commit instant, not the whole
   period an agent actively holds the shared worktree (D55).** A `workflow step start`
   mutates `change.yaml`, then the agent edits source files for the rest of its turn — the
   worktree stays genuinely dirty far longer than any lease-protected commit window. A
   concurrently-submitted human decision or Publish (legal under D45, which never gated
   either on "is an agent active") could encounter the agent's own dirty files, fail with a
   scope error, or interfere with its edits. Corrected: an explicit **workspace-writer**
   invariant — for one specification, at most one workspace-writing operation (an active
   agent execution, `activateAndSubmitHumanStep`, Publish, Batch Publish) holds the shared
   worktree at a time — a third primitive, distinct from and outer to both the agent-admission
   lock and the git-finalize lease, never conflated with either.
2. **The workspace-writer slot needs durable, `kind`-aware crash recovery, not one universal
   liveness check (D56).** An agent-kind claim's liveness is the dashboard's own session/turn
   state (a PID check is meaningless for the agent's own short-lived, repeated tool-call
   subprocess) — released via the same real hooks D42 already established. A non-agent
   claim's liveness is a PID check against the current process, since Publish/human-submit
   are short, dashboard-process-local operations — any claim whose pid doesn't match the
   current process at boot is unconditionally stale (single-server architecture).
3. **No deterministic priority existed between a pending user mutation and the next
   automatic agent item (D57).** Chosen now: an already-pending, explicitly user-submitted
   workspace mutation is serviced before the next automatically-dispatched agent-queue item —
   reusing the workspace-writer slot's own FIFO wait order, no new priority mechanism
   invented.
4. **D54's authoritative-record ordering (highest attempt within a step, falling back to
   `workflow_progress.history` position across steps) is not a reliable total order (D58).**
   The currently-activating step's own entry isn't yet in *completion* history at the moment
   it needs comparing, and attempt numbers carry no chronological relationship across two
   independently-numbered consuming steps. Corrected: a durable, monotonic
   `consumptionSequence`, allocated per task and frozen into the start-operation record
   before activation (crash-safe: retries reuse the frozen value, never re-allocate) —
   authoritative-record resolution becomes "highest `consumptionSequence` naming that
   dependency," full stop, safe under concurrency because only one workspace-writing
   operation can be active per spec at a time (D55).

**Corrective pass 15 (2026-09-22, D59–D67, corrections to D55/D56): the remaining
workspace-ownership correctness gaps — release timing, CLI parity, and identity.**

1. **Releasing the workspace-writer claim merely because the AI/session turn reached terminal
   is unsafe (D59/D60).** A failed/cancelled turn can leave `workflow step start`'s own
   mutation un-finalized (`finishStep` never invoked, worktree still dirty); a "completed"
   turn's own `finishStep` may itself never have fully settled. Corrected: an explicit
   **execution settlement** concept — `active` → `terminal-unsettled` → `settled` (release) or
   `recovery-required` (retain, block every subsequent writer) — where settlement is proven
   only from already-existing durable primitives (no in-flight start/finish-operation record,
   workflow position not `active`, no dirty file within the execution's own owned scope),
   never a raw `git status` check.
2. **Boot-time orphan reconciliation calling `forceReleaseWorkspaceWriter` unconditionally is
   unsafe (D61).** Corrected: every reconciliation path assesses settlement first;
   `forceReleaseWorkspaceWriter` is documented as callable only once settlement is already
   proven, never as the default "clean up an ambiguous owner" operation. An unsettled,
   genuinely-orphaned claim is marked `recovery-required` instead — no auto-clean, auto-stash,
   or auto-discard of any file, ever.
3. **The raw CLI (`workflow step start`/`finish`/`verify-human`) had no workspace-writer
   coverage at all — a second, arbitration-free path to the identical mutation (D62/D63).**
   Corrected: a new `cli-manual` workspace-writer kind covers direct/manual
   `workflow step start`/`finish` invocations, reusing the same settlement definition; and
   `workflow verify-human`'s `--approve`/`--request-changes` branch now delegates to the same
   `activateAndSubmitHumanStep` the dashboard uses, instead of retaining a legacy
   `startHumanStep`/`submitHumanStepResult` path outside arbitration entirely.
4. **Publish's arbitration lived only in one caller's own wiring, not in `publishTask()`
   itself (D64).** Corrected: `publishTask()` — the one function the CLI, the dashboard route,
   and any direct domain caller all invoke identically — now owns the acquisition itself, so
   safety no longer depends on which caller remembered to arrange it.
5. **The workspace-writer record was keyed by `specId`, so two different specs sharing this
   one physical checkout never arbitrated against each other at all (D65).** Corrected: the
   record is keyed by the physical worktree — one single, well-known file per checkout
   (`.nevo-ai-local/locks/workspace-writer.lock`), mirroring the git-finalize lease's own
   already-correct sibling convention — making arbitration correctly cross-spec.
6. **No documented ordering existed between the admission mutex and the workspace-writer
   claim (D66).** Corrected: admission mutex always acquired first and only by the agent path;
   workspace-writer claim second; no other path ever touches the admission mutex — removing
   any possibility of the two primitives deadlocking against each other.
7. **A low-level acquisition-retry timeout could turn a valid pending user mutation into an
   arbitrary failure merely because an agent ran long (D67).** Corrected: a durable,
   request-level `waiting-for-workspace`/`blocked-by-recovery` status, distinct from and
   outliving `acquireWorkspaceWriter`'s own internal bounded retry — a pending Publish or
   human-submit request re-attempts transparently rather than failing outright.

**Corrective pass 16 (2026-09-22, D68–D78, corrections to D56/D62/D64/D67): the two
remaining large workspace-ownership correctness issues — stale reconciliation acting on the
wrong claim, and user-submitted workspace mutations not actually being durable while
waiting.**

1. **Publish's workspace-writer claim was released right after the git-finalize-protected
   commit, before `push` ran (D68, corrects D64).** A second writer could then commit and push
   while the first Publish's own push was still in flight. Corrected: the claim is held
   through the whole operation, including `push` and the durable record reaching `completed`.
2. **A `cli-manual` claim was released the moment `finishStep` "returned successfully" (D69,
   corrects D62) — but a non-throwing `blocked`/`input-required`/`reconciliation-required`
   return is not settlement.** Corrected: release is always gated on
   `assessExecutionSettlement`, exactly as already established for the agent-kind case.
3. **`forceReleaseWorkspaceWriter({repoRoot})`/`markWorkspaceWriterRecoveryRequired({repoRoot})`
   were effectively worktree-global and unconditional (D70).** A delayed reconciliation event
   for a since-released execution A could act on whatever claim is *currently* live — a
   different execution B's — corrupting it. Corrected: ownership-conditional
   `releaseWorkspaceWriterIfOwned`/`markWorkspaceWriterRecoveryRequiredIfOwned`, requiring an
   `ownerId` match (the exact discipline the module's own normal release already applied,
   merely extended to the two reconciliation-only entry points that had skipped it). A
   genuinely unconditional primitive may remain, clearly marked unsafe, never called by
   ordinary orchestration code.
4. **The `ownerId` needed for that conditional check had no durable home for the boot-restart
   case (D71).** An in-memory closure cannot survive a restart. Corrected: `workspaceOwnerId`
   is persisted onto the same durable session/turn record (agent kind) or start-operation
   record (`cli-manual` kind) already read elsewhere — never a new file, never only in memory.
   Unestablished identity fails closed.
5. **D67's "durable, request-level waiting" status actually rested on an in-process pending-
   waiters list — lost on restart (D72).** Corrected: a new durable,
   physical-worktree-scoped workspace-request record family, persisted before contention
   begins, is now the authoritative source for that status and for D57's own scheduling.
6. **Human-submit had no durable request/operation record at all (D73)** — Publish already
   did (D29). Corrected: a new, minimal durable human-submit operation record, persisted
   before any workflow mutation, resumed identically after a restart.
7. **D57's dispatch-priority check queried `listPendingWorkspaceWriters(specId)` — scoped to
   one spec, even though D65 already made the underlying claim itself worktree-scoped (D74).**
   Spec B's pending Publish would not defer Spec A's next automatic agent item. Corrected: the
   dispatch check reads the durable request queue for the whole physical worktree.
8. **Restart reconciliation of pending workspace requests was undefined (D75).** Corrected:
   the same resume/no-op/`reconciliation-required` discipline already established for Publish
   (D29) and start-operations (D52), applied one layer up, at the request level.
9. **The workspace-request layer risked becoming a second, competing durability model for
   Publish (D76).** Corrected: it coordinates waiting/scheduling only, referencing Publish's
   own already-durable operation record (and the new human-submit record) by identity, never
   duplicating either's own stage machine.
10. **One generic request lifecycle, idempotent, storing its own acquired owner id (D77);
    race-safe promotion to `running`, safe against a crash between acquiring the workspace and
    persisting that fact (D78).** Reuses the workspace-writer slot's own atomicity rather than
    adding a second lock; a crash in that narrow window is recovered by matching a live claim
    back to its own request by identity.

**Corrective pass 17 (2026-09-23, D79–D86, corrections to D56/D71/D62/D77/D78): making the
workspace protocol genuinely race-safe and identity-safe.**

1. **A dead pid on a request-backed claim (`human-submit`/`publish`/`batch-publish`) was still
   grounds for unconditional deletion (D79, corrects D56).** These kinds are now backed by
   durable requests/operations — a dead process may have already mutated tracked state.
   Corrected: a dead pid triggers durable request/operation reconciliation, never a bare
   delete.
2. **D70's ownerId comparison was still a separate read then a later conditional write — a
   TOCTOU race (D80).** Corrected: a new, short-lived, cross-process workspace-control lock
   makes every workspace-writer record inspection-and-mutation one atomic critical section,
   never held while waiting for the workspace itself.
3. **`requestSequence` allocation ("scan for max, +1") was unlocked, and requests are created
   before workspace ownership is contended for — two concurrent requests could collide on the
   same value (D81).** Corrected: allocation happens under the same workspace-control lock.
4. **A crash-window claim was matched to its request by `kind`/`specId`/`taskId` — not unique
   when two requests share that triple (D82, corrects D78).** Corrected: the claim itself
   carries the exact `requestId`; reconciliation matches on that field alone.
5. **"Idempotent" transitions didn't prevent a stale-viewing processor from re-executing an
   already-completed request — workspace exclusivity proves only who holds it *now*, not
   whether a request has already run (D83, corrects D77).** Corrected: compare-and-set
   transitions with explicit `expectedStatus` preconditions.
6. **No documented ordering existed for the new control lock (D84).** Corrected: admission
   mutex → control lock (brief) → ... , with the control lock always innermost and briefest —
   proven cycle-free.
7. **A `cli-manual` claim's `workspaceOwnerId` lived in `start-operation.mjs`, which only
   exists for `consumesDependencies` steps — leaving any other direct CLI step with nowhere
   durable to store it (D85, corrects D71).** Corrected: a new, dependency-consumption-
   independent record.
8. **CLI reuse of a live `agent` claim was decided from spec/task equality alone — satisfiable
   by an unrelated manual invocation (D86, corrects D62).** Corrected: reuse requires the CLI's
   own trusted ambient execution identity (`readAgentExecutionContext`'s `sessionId`) to match.

**Corrective pass 18 (2026-09-24, D87–D91, corrections to D66/D73/D79/D86): completing one
end-to-end ownership chain — durable intent → exact request → exact workspace owner → exact
execution identity → mutation → proven settlement → exact release.**

1. **`activateAndSubmitHumanStep` released its workspace claim in a bare `finally`, regardless
   of whether the combined operation actually settled (D87, corrects the implicit design
   D59/D60 already ruled out for the agent/`cli-manual` cases).** `startHumanStep` may already
   have mutated tracked state before `finishStep` throws, returns `reconciliation-required`, or
   otherwise fails to land. Corrected: release is gated on `assessExecutionSettlement` (already
   fully generic, reused unchanged), and only after the durable operation/request records are
   marked terminal — never before, never unconditionally.
2. **D79 left reconciliation to whichever caller happened to encounter a dead claim, so every
   acquisition path would need to understand every other kind (D88, corrects D79's own
   "surfaces to caller" design).** Corrected: one shared `reconcileRequestBackedWorkspaceClaim`,
   dispatching by a small, explicit kind registry each owning task populates with its own
   settlement-checker — every acquisition path calls the identical function, ignorant of which
   kind it's reconciling.
3. **An agent's workspace claim was acquired before its session/turn identity existed, but D86
   requires exact `sessionId` matching — leaving a brand-new claim with nothing to match against
   (D89, extends D66).** Corrected: ownership-conditional enrichment
   (`updateWorkspaceWriterIfOwned`) merges the now-known identity into the exact claim once the
   session/turn exists, before the provider process is ever spawned.
4. **The human-submit operation record's own attempt-scoped path assumed one request per
   attempt, but D82 separately required distinct `requestId`s per request — an unresolved
   collision for two requests on the identical attempt (D90, extends D73).** Corrected: at most
   one non-terminal human-submit operation per `(change, task, step, attempt)` — a duplicate
   reuses it idempotently, a conflicting decision is rejected, never silently overwritten.
5. **Nothing previously stated, for every request-backed kind, that the underlying operation's
   own durable intent must exist before its paired workspace-request becomes durable (D91).**
   Corrected: an explicit, binding, cross-kind ordering — write intent first, then the request,
   then contend for the workspace — making a dangling `operationRef` impossible by construction.

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
- (corrective pass 9/10/11/12) `tools/specs/workflow/step-context.mjs` (`taskDefinition`,
  `requiredContext` — both inline content, D22–D24); `.nevo-ai/workflows/*.yaml`,
  `tools/specs/workflow/definitions/schema.mjs` (additive `continuation`, `execution`
  `{session, role}`, `releasesDependencies`, `invalidatesDependencyRelease`,
  `schedulingPriority`, `consumesDependencies` schema, D25/D26/D28/D34/D39/D40/D53);
  `tools/specs/workflow/dependency-satisfaction.mjs` (epoch-based release/invalidation, D40);
  `tools/specs/workflow/remediation-record.mjs`, `tools/specs/workflow/dependency-consumption.mjs`
  (new — durable remediation groups and step-scoped, multi-dependency, sequence-ordered
  consumption provenance, D31/D36/D53/D58); `tools/specs/workflow/start-operation.mjs` (new —
  durable, resumable activation-plus-consumption record with crash-safe `consumptionSequence`
  allocation, distinct from `finish-operation.mjs`'s own family, D52/D58);
  `tools/specs/workflow/cli.mjs` (`handleWorkflowStepStart` gains the start-operation call
  site for any step declaring `consumesDependencies`, D52/D53); `tools/specs/workflow/
  git-finalize-lock.mjs` (new — cross-process, PID-liveness-recoverable advisory lease with
  explicit lease-passing, D47/D50/D51), with its acquisition wrapping `finish-operation.mjs`'s
  own mutation-through-commit window (task 27), `human-step/operations.mjs`'s new
  `activateAndSubmitHumanStep` (task 29, threading one lease through its own `finishStep`
  call via `finalizeLease`), and `publish/operation.mjs`'s own standalone acquisition
  (task 31); `tools/specs/workflow/workspace-writer.mjs` (new — the durable, `kind`-aware
  workspace-writer slot, D55/D56, a third primitive nesting the git-finalize lease inside it,
  claimed by agent admission for the whole execution and by `activateAndSubmitHumanStep`/
  Publish for their own duration), **now keyed by the physical worktree at
  `.nevo-ai-local/locks/workspace-writer.lock` rather than by `specId` (D65), released only on
  proven `execution-settlement.mjs` (new, D59/D60) settlement rather than bare turn-terminal
  (D61), gaining a `cli-manual` kind so raw `workflow step start`/`finish` CLI invocations
  participate identically (D62), and gaining an ownership-conditional release/mark-recovery-
  required API (`releaseWorkspaceWriterIfOwned`/`markWorkspaceWriterRecoveryRequiredIfOwned`,
  D70), a dead pid on a request-backed claim now triggering reconciliation instead of an
  unconditional delete (D79), and every record mutation now wrapped in the new
  `workspace-control-lock.mjs` (D80) so compare-then-mutate is one atomic unit — the old
  unconditional functions renamed and no longer exported for ordinary use**;
  `tools/specs/workflow/workspace-control-lock.mjs` (new — a short-lived, cross-process lock
  purpose-distinct from the workspace-writer claim, the git-finalize lease, and the admission
  mutex, D80); `tools/specs/workflow/execution-settlement.mjs` (new — the reusable,
  session/liveness-agnostic settlement check every reconciliation path calls before releasing
  an `agent`/`cli-manual` claim, D60); `tools/specs/workflow/cli-workspace-execution.mjs` (new —
  the dependency-consumption-independent durable home for a `cli-manual` claim's
  `workspaceOwnerId`, working for any step regardless of `consumesDependencies`, D85);
  `tools/specs/workflow/workspace-request.mjs` (new — a durable, physical-worktree-scoped queue
  of pending user-submitted workspace mutations, coordinating but never duplicating Publish's/
  human-submit's own durable operation records, now the authoritative source for D57's dispatch
  priority and D67's request-level status, with atomic `requestSequence` allocation and
  compare-and-set `transitionWorkspaceRequest` transitions, D72/D74/D75/D76/D77/D78/D81/D83);
  `tools/specs/workflow/human-step/submit-request.mjs` (new — the minimal durable human-submit
  operation record D73 introduces, mirroring Publish's own D29 record);
  `tools/specs/workflow/suspension-projection.mjs` (new —
  `SuspensionProjection`, kept separate from the unmodified, pure `task-projection.mjs`, D44);
  `tools/specs/workflow/readiness-policy.mjs` (existing, verified file — gains an explicit
  suspension check, D44); `tools/specs/workflow/queue/**` (pure-domain sequential queue,
  single-active-execution invariant, zero dashboard imports, D33/D34/D38/D45);
  `tools/dashboard/server/ai/orchestration/**` (new — `admitAgentExecution` agent-admission
  gate with rollback, in the canonical lock order (D66), now also claiming/releasing the
  workspace-writer slot only on proven settlement, D41/D49/D55/D56/D59/D61; continuation
  reconciliation, D42; the dispatch-priority check reporting `waiting-for-workspace`/
  `blocked-by-recovery`, D57/D67), plus existing files it corrects rather than replaces —
  `tools/dashboard/server/ai/sessions/service.mjs` (per-turn reconciliation hook, now
  settlement-gated), `tools/dashboard/server/specs/human-step-transport.mjs` (post-submit
  reconciliation hook, now calling `activateAndSubmitHumanStep`), `tools/dashboard/server/specs/
  actions.mjs` (existing, verified task-14 file — gains the mutation-free human-interaction
  preview, D47), and `tools/specs/workflow/cli.mjs` (`handleWorkflowVerifyHuman`'s
  `--approve`/`--request-changes` branch now delegates to `activateAndSubmitHumanStep` instead
  of a legacy standalone `startHumanStep`/`submitHumanStepResult` path — D63, a distinct
  function from the same file's own `cli-manual` workspace-writer wrapping around
  `handleWorkflowStepStart`/`handleWorkflowStepFinish`, task 27, D62); `tools/specs/workflow/
  publish/operation.mjs` (`publishTask()` itself now owns its own workspace-writer/
  git-finalize acquisition, D64), `tools/dashboard/server/specs/routes.mjs` (durable Publish +
  atomic Batch Publish reusing `operation-record.mjs`'s actually-exported primitives, D29, with
  Batch Publish's own `kind: 'batch-publish'` workspace-writer claim); `tools/dashboard/ui/screens/
  specification-detail/**`, `tools/dashboard/server/ai/sessions/execution-policy-service.mjs`
  (new — change-level execution-policy transport, always shown on first Start, D21);
  `docs/development/agent-workflow-protocol.md` (D30 ownership taxonomy, extending the
  existing section, consistent with D3).

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
literal step name), D27 (the orchestrator makes a human-owned step's real declarative
interaction available immediately on arrival — the redundant manual "Start" click before it
is removed; **mechanism corrected by pass 12's D47** — the interaction preview is derived
from the workflow definition with no mutation, and `startHumanStep` fires only as part of the
user's own combined Approve/Request-changes operation, not automatically on arrival), D28 (a
transition may
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

**Corrective pass 11 decisions (2026-09-22):** D40 (dependency release is an epoch that
remains valid until an explicit `invalidatesDependencyRelease: true` transition fires — never
"the last history entry has the flag," never inferred from step-graph position; corrects
D28's satisfaction mechanism, not its placement). D41 (one spec-level `admitAgentExecution`
gate — renamed and its claim lifecycle strengthened by D49 — reusing `AgentTurnRuntime`'s own
proven promise-chain-mutex pattern keyed by `specId`, is the only path that can start a new
**agent-owned** execution — atomic, race-safe, no per-task worktrees or concurrency limit).
D42 (continuation reconciliation is one shared operation triggered from three real points —
`AgentSessionService`'s own per-turn subscription, `human-step-transport.mjs`'s post-submit
call, and boot/first-request reconciliation — never a nonexistent global turn event;
`finishStep` stays provider-neutral; the human branch corrected by D47 to expose a preview
rather than auto-activating). D43 (durable dependency-consumption provenance — recording
point and record shape corrected by D48 to fire at successful step activation, not admission,
and to cover multiple dependencies atomically — makes remediation-group membership an exact
record match rather than a guess from unpersisted state). D44 (`SuspensionProjection` is a
new, separate layer; `TaskProjection`/`projectTask()` stays exactly as pure as D10 already
established). D45 (a pending human decision never pauses the rest of the spec's queue — the
single-execution invariant is scoped to agent-owned executions only; several human decisions
may accumulate; re-verified by pass 12 once D47 closed the Git-ownership gap this claim
depended on).
D46 (renamed `deterministic-batch-orchestrator` → `deterministic-sequential-queue`
throughout; "batch" stays the user-facing selection word, "queue" the runtime concept). Three
further corrections in place: D21 (the picker always shows on first Start when no
change-level policy exists — never conditional on provider capability), D29 (Publish's own
record-shaping helper is locally defined, since `createOperationRecord` is private to
`finish-operation.mjs`, not exported; Batch Publish's path corrected to the real four-segment
`operationFilePath` convention), D39 (extended with `invalidatesDependencyRelease`).

**Corrective pass 12 decisions (2026-09-22):** D47 (a human interaction is visible before
activation, derived purely from the workflow definition, no mutation; Approve/Request-changes
performs `activateAndSubmitHumanStep` — activation + submission + finalization — as one
self-owned operation; a new cross-process `withGitFinalizeLock`, owned by workflow core,
serializes it against agent-driven `finishStep` and Publish — **lock boundary/reentrancy
corrected by pass 13's D50**). D48 (dependency-consumption recording moves to successful step
activation inside workflow core, never AI-session admission — **durability, trigger, and
identity corrected by pass 13's D52/D53/D54**). D49 (`admitExecution` renamed
`admitAgentExecution`; its claim lifecycle is atomic through to durable visibility with
rollback on failed session creation; human dispatch is an explicit, separate branch). Two
prior decisions corrected in place: D27 (the auto-activation *mechanism* is superseded by
D47; the no-meaningless-click *goal* is unchanged), D45 (re-verified — its guarantee now
holds for the right reason, D47's fix, not only the previously-checked one).

**Corrective pass 13 decisions (2026-09-22):** D50 (the git-finalize lease wraps from the
first tracked mutation through the commit, never narrower; `withGitFinalizeLock(fn,
existingLease?)` supports explicit lease-passing so a combined operation acquires exactly one
lease for its whole sequence — never implicit/recursive reentrancy — with `finishStep`
gaining an optional `finalizeLease` input). D51 (the lease supports stale-owner recovery via
`process.kill(pid, 0)` liveness checking, not lock-file age alone — a live owner is never
stolen, a confirmed-dead one is safely reclaimed, release verifies ownership first). D52 (step
activation and its dependency-consumption snapshot become durable together via a new,
resumable start-operation record, distinct from `finish-operation.mjs`'s own — retries resume
from the originally-frozen snapshot, never re-resolve to newer epochs). D53 (a declarative,
step-level `consumesDependencies: true` field — owned by task 25's schema — triggers
consumption recording on every activation of a declared step, any attempt, replacing
"first-ever task activation"; record identity gains the consuming step). D54 (remediation
lookup matches only a task's authoritative consumption record per dependency, never any
historical record a later attempt has already superseded — **ordering rule itself corrected
by pass 14's D58**).

**Corrective pass 14 decisions (2026-09-22):** D55 (a third, explicit **workspace-writer**
invariant — at most one workspace-writing operation, agent or otherwise, holds the shared
worktree at a time (scope corrected to the physical worktree by pass 15's D65) — distinct from
and never conflated with the agent-admission lock or the git-finalize lease; a pending,
not-yet-submitted human interaction is never a workspace writer, D45 unchanged). D56 (the
workspace-writer slot is a durable record reconciled by `kind` — an agent-kind claim via the
dashboard's own session/turn state through the existing D42 hooks, a non-agent claim via a PID
check against the current process at boot; failed admission releases both the admission and
workspace-writer claims together — **release timing itself corrected by pass 15's
D59/D60/D61**). D57 (an already-pending, explicitly user-submitted workspace mutation is
serviced before the next automatically-dispatched agent-queue item — reusing the
workspace-writer slot's own FIFO wait order). D58 (dependency-consumption's authoritative-
record ordering is a durable, monotonic `consumptionSequence`, allocated per task and frozen
into the start-operation record before activation — crash-safe, never re-allocated on retry,
safe under concurrency because D55 guarantees no overlapping workspace-writing operation for
the same spec; corrects D54's step/attempt/history-position rule, which could not reliably
order arbitrary consuming steps).

**Corrective pass 15 decisions (2026-09-22):** D59 (a workspace-writer claim releases only on
proven **execution settlement** — `active` → `terminal-unsettled` → `settled`/
`recovery-required` — never merely because the AI/session turn or CLI process reached
terminal). D60 (settlement is defined concretely from already-existing primitives — no
in-flight start/finish-operation record, workflow position not `active`, no dirty file within
the execution's own owned scope — never a raw `git status` check). D61 (reconciliation
assesses settlement before releasing an ambiguous claim; `forceReleaseWorkspaceWriter` is
constrained to callers who have already proven settlement, never the default recovery path; an
unsettled claim is marked `recovery-required` and retained, never auto-cleaned/stashed/
discarded — **the release/mark call itself corrected from unconditional to
ownership-conditional by pass 16's D70**). D62 (a new `cli-manual` workspace-writer kind brings
the raw CLI's `workflow step start`/`finish` into the same arbitration protocol as
dashboard-orchestrated agent executions — one canonical rule, no dashboard/CLI split — **its
own release timing corrected by pass 16's D69**). D63 (`workflow verify-human`'s CLI
human-decision path delegates to the same `activateAndSubmitHumanStep` the dashboard uses,
instead of a legacy arbitration-free `startHumanStep`/`submitHumanStepResult` path). D64
(`publishTask()` itself, not merely its callers, owns workspace-writer/git-finalize
arbitration, so the CLI, the dashboard route, and any direct caller are all protected
identically — **the claim's own release timing corrected by pass 16's D68**). D65 (the
workspace-writer record is keyed by the physical worktree — one well-known file per checkout,
mirroring the git-finalize lease's own convention — never by `specId`, making arbitration
correctly cross-spec). D66 (one canonical lock order — admission mutex, then workspace-writer
claim, on the agent path only; no other path ever touches the admission mutex — removing any
deadlock risk between the two primitives). D67 (a pending user-submitted workspace mutation
reports a durable, request-level `waiting-for-workspace`/`blocked-by-recovery` status, distinct
from and outliving `acquireWorkspaceWriter`'s own internal bounded retry timeout — **the
underlying durability itself corrected by pass 16's D72/D73**, since the in-process waiter list
this status actually read from did not survive a restart).

**Corrective pass 16 decisions (2026-09-22):** D68 (Publish's workspace-writer claim is held
through the whole operation, including `push` and the durable record reaching `completed` —
corrects D64's release-after-commit timing). D69 (a `cli-manual` claim releases only when
`assessExecutionSettlement` reports settled, never merely because `finishStep` returned without
throwing — corrects D62). D70 (workspace-writer claim mutation is ownership-conditional —
`releaseWorkspaceWriterIfOwned`/`markWorkspaceWriterRecoveryRequiredIfOwned`, requiring an
`ownerId` match — never an unconditional, worktree-global operation; a genuinely unconditional
primitive may remain internally, clearly marked unsafe, never called by ordinary orchestration
code). D71 (`workspaceOwnerId` is persisted onto the execution's own durable record — the same
session/turn record for `agent` kind, the same start-operation record for `cli-manual` kind —
never held only in an in-memory closure, so restart reconciliation can recover the exact claim
it must act on; unestablished identity fails closed — **the `cli-manual` durable home itself
corrected by pass 17's D85**). D72 (a durable,
physical-worktree-scoped workspace-request queue — not an in-process pending-waiter list — is
the authoritative record of a pending user-submitted workspace mutation, persisted before
contention begins). D73 (human-submit becomes a durable request, persisted with enough data to
resume safely before any workflow mutation). D74 (D57's dispatch-priority scheduling reads the
durable workspace-request queue for the whole physical worktree, never
`listPendingWorkspaceWriters(specId)` scoped to one spec). D75 (restart/first-request
reconciliation classifies every non-terminal durable workspace request — resumed, no-op, or
`reconciliation-required`, never blindly rerunning a mutation that may have already partially
landed). D76 (a workspace request coordinates waiting/scheduling only; it never duplicates
Publish's or human-submit's own durable operation — `operationRef` names the real operation's
identity). D77 (one generic workspace-request lifecycle, idempotent transitions, storing its
own acquired `workspaceOwnerId` — **the "idempotent" framing itself corrected by pass 17's
D83's compare-and-set semantics**). D78 (race-safe workspace-request acquisition — reusing the
workspace-writer slot's own atomicity, with a defined recovery rule for the narrow crash window
between acquiring the claim and persisting that fact into the request record — **the
identity-matching rule itself corrected by pass 17's D82**).

**Corrective pass 17 decisions (2026-09-23):** D79 (a dead pid on a request-backed workspace-
writer claim never releases it by itself — it only triggers durable request/operation
reconciliation, reusing D75's own resume/no-op/`reconciliation-required` discipline —
**the per-caller design itself corrected by pass 18's D88**). D80 (a
new, short-lived, cross-process workspace-control lock makes every workspace-writer record
inspection-and-mutation one atomic critical section — a distinct primitive from the
workspace-writer claim, the git-finalize lease, and the admission mutex, never held while
waiting for the workspace itself). D81 (`requestSequence` allocation happens under the
workspace-control lock, never an unlocked scan-max-plus-one). D82 (a request-backed
workspace-writer claim carries the exact `requestId` it belongs to; reconciliation matches on
that field alone, never `kind`/`specId`/`taskId`, which can collide across distinct requests).
D83 (workspace-request execution is idempotent under multiple processors via compare-and-set
`transitionWorkspaceRequest` calls with explicit `expectedStatus` preconditions — workspace
exclusivity alone does not prove a request has only one executor over its lifetime). D84 (one
documented, cycle-free lock ordering across the admission mutex, the workspace-control lock,
the workspace-writer claim, and the git-finalize lease — the control lock always innermost and
briefest). D85 (a `cli-manual` claim's durable `workspaceOwnerId` home is a new, small,
dependency-consumption-independent record — never `start-operation.mjs`, which exists only for
`consumesDependencies` steps and would leave any other direct CLI step with no durable home at
all). D86 (CLI reuse of a live `agent`-kind claim requires the CLI process's own trusted
ambient execution identity — `readAgentExecutionContext`'s resolved `sessionId`, never a CLI
argument — to match the claim's own recorded `sessionId`; spec/task equality alone is never
sufficient — **the acquisition-time-identity gap this left open closed by pass 18's D89**).

**Corrective pass 18 decisions (2026-09-24):** D87 (a human-submit workspace claim releases
only after the combined operation is proven settled via `assessExecutionSettlement`, reused
unchanged — durable records marked terminal first, claim released second — never a bare
`finally`). D88 (one shared, generic `reconcileRequestBackedWorkspaceClaim`, dispatching to a
per-kind settlement-checker each owning task registers, replaces D79's own per-caller
reconciliation design — no acquisition path needs to know which kind it's reconciling). D89
(an agent workspace claim is ownership-conditionally enriched with `sessionId`/`turnId` once
the session/turn exists, before the provider process is spawned — never left permanently
without the identity D86 requires; a crash before enrichment fails closed). D90 (at most one
non-terminal human-submit operation per `(change, task, step, attempt)` — a duplicate
resubmission reuses it idempotently, a conflicting decision is rejected, never silently
overwritten). D91 (a request-backed operation's own durable intent record is always written
before its paired workspace-request becomes durable, for human-submit, Publish, and Batch
Publish alike — a workspace-request can never survive a crash pointing at unwritten intent).

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
- `areas/workflow-continuation-and-session-handover.md` — (pass 9/10/11/12/14/15/16) the
  execution-mode/provider selection UX, **always shown** on first Start when no change-level
  policy exists (D21); the declarative continuation (eligibility, not immediate execution)
  and session-lineage/role model (D25/D26); the one spec-level `admitAgentExecution`
  agent-admission gate, atomic through to durable visibility with rollback on failure, in the
  canonical lock order (D66), now also claiming the workspace-writer slot for the whole
  admitted execution until proven settled and persisting its `workspaceOwnerId` durably
  (D41/D49/D55/D59/D71); continuation reconciliation from three real server-side points, which
  now assess execution settlement and reconcile ownership-conditionally before releasing the
  workspace-writer slot, never a bare or blind release (D42/D59/D60/D61/D70); the distinct
  human-dispatch branch — mutation-free interaction preview, a durable human-submit request
  persisted before any contention or mutation (D73), `activateAndSubmitHumanStep` claiming the
  workspace-writer slot then a nested git-finalize lease, never called "agent admission," now
  also the CLI's own `workflow verify-human` implementation (D27/D47/D49/D55/D63); a pending
  human decision never pauses the rest of the queue (D45); dispatch defers to an
  already-pending durable user mutation request, read for the whole physical worktree, before
  the next automatic agent item, reported as `waiting-for-workspace`/`blocked-by-recovery`
  (D57/D67/D72/D74).
- `areas/dependency-release-and-invalidation.md` — (pass 9/10/11/12/13/14/15/16) declarative,
  epoch-based dependency release with explicit invalidation (D28/D40); a correctly-bounded,
  lease-passing, crash-recoverable git-finalize lease (D47/D50/D51); the workspace-writer
  slot, a third primitive keyed by the physical worktree, with `kind`-aware crash recovery and
  a new `cli-manual` kind for raw CLI invocations, released only on proven settlement via the
  new `execution-settlement.mjs`, and only ownership-conditionally via `workspaceOwnerId`
  recovered from a durable record (D55/D56/D59/D60/D61/D62/D65/D70/D71); the new durable,
  physical-worktree-scoped `workspace-request.mjs` queue coordinating (never duplicating)
  Publish's and human-submit's own durable operations (D72/D75/D76/D77/D78); durable,
  declaratively-triggered, step-scoped dependency-consumption via a resumable start-operation,
  with a crash-safe, monotonic `consumptionSequence` giving a real cross-step total order
  (D52/D53/D58); automatic remediation-group derivation from each consumer's sequence-based
  authoritative record (D31/D58), including terminal consumers; a separate
  `SuspensionProjection` alongside the unmodified, pure `TaskProjection` (D44), surfaced via
  `suspensions` (D37), durable and extensible (D36).
- `areas/deterministic-sequential-queue.md` — (pass 9/10/11/14) a **sequential, single-execution**
  task queue (never concurrent, D33), pure domain logic under `tools/specs/workflow/queue/**`
  (D38), ordered by declarative `schedulingPriority` (D34); never blocked by a pending human
  decision elsewhere in the spec (D45); reused by D31's remediation-group fix runs. The
  checkbox-picker UI, the agent-admission/workspace-writer claim (D41/D49/D55), and the
  dispatch-priority check (D57) are all owned elsewhere.
- `areas/dependency-invalidation-remediation-review.md` — (pass 9/10/11/13/14) the one
  combined, cross-task-aware review pass for a dependency-invalidation remediation group
  (membership from D58's sequence-based authoritative evidence), adapting the existing legacy
  `implementation-review` two-pass design, terminal members reviewed read-only (D31).
- `areas/user-mutation-source-control-ownership.md` — (pass 9/12/13/14/15/16) Publish/Batch
  Publish own their own commit/push (D29); `publishTask()` itself — not merely one caller —
  claims the workspace-writer slot, held through the whole operation including `push`, then
  its own standalone git-finalize lease (D47/D50/D55/D64/D68) so a concurrently-active agent
  execution, for this spec or any other sharing the same physical worktree (D65), can neither
  absorb nor be interfered with by Publish's mutation; release is ownership-conditional
  (D70), and a durable workspace-request (D72/D76) persisted before contention begins reports
  `waiting-for-workspace`/`blocked-by-recovery` while pending (D67) and survives a restart; the
  explicit user-action/technical-activation/completed-mutation ownership taxonomy (D30).

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
