---
id: spec.batch-execution-generalization
type: discovery
title: "Generalize task-batch into the primary multi-task execution model"
status: draft
change: batch-execution-generalization
---

# Discovery: generalize `task-batch`/`ExecutionScope` into the primary execution model

**Revision history:**
- Draft 1 proposed a scheduler-shaped `ExecutionRun` — rejected (still a second
  scheduler).
- Draft 2 proposed generalizing `task-batch` into one-session-per-batch with a
  heterogeneous mixed-step `BatchContext` — the owner confirmed the direction but
  found 4 concrete implementation-blocking gaps in `batch-start`/`batch-finish`, and
  rejected the heterogeneous-batch generalization in favor of a simpler,
  homogeneous-by-contract model. Directory renamed from `execution-run-simplification`
  (obsolete) to `batch-execution-generalization`.
- Draft 3 (this revision) accepted the homogeneous-batch direction but found 3 more
  gaps by reading `batch-finish`'s actual preflight/contract code and
  `dependency-consumption`'s actual production wiring: `BatchFinish`'s preflight is
  not phase-neutral even before provenance (requires a `result` field that an
  unconditional implementation step's own `finishStep` would reject); the
  dependency-consumption design must respect `planStart`'s pre-activation
  `consumptionSequence` freeze, not just move recording wholesale into `BatchFinish`;
  and batch-completion handover must partition by the *full* canonical execution
  contract (continuation policy, target step/executor, role, session policy,
  resolved execution policy — not just "pass vs fail"). Closes two previously-open
  questions (mixed-review-result partitioning, single-task convergence) with direct
  evidence. Self-review at the end: no new model-level blocker found.

Still no implementation. All claims below are grounded in this session's own direct
reads of the cited files (not restated from memory of the previous draft).

## Scope

> Nie chcę modelu `selected tasks → choose next runnable → admit one task → finish →
> choose next → new execution/session`. Chcę `selected tasks → ONE batch execution →
> ONE agent session → agent executes the whole dependency-ordered group → ONE batch
> finish`.

Corrected further this round: batches stay **homogeneous by execution contract**
(same target step, role, session policy, execution config) — no heterogeneous
mixed-step batch in v1. The one exception to ordinary readiness: a dependency
unsatisfied *only* by another member of the same reserved batch is not a blocker, it's
an in-batch ordering constraint. Unsatisfied dependency *outside* the batch still
blocks admission, same as today.

## Repository facts carried forward unchanged (still accurate, re-verified against current `feature/ai-spec-history`)

- `tools/specs/workflow/queue/{store,evaluator,reservation,index}.mjs` responsibilities, call sites of `enqueueTasks`/`dequeueTask`/`loadTaskQueue`/`evaluateTaskQueue`/`reconcileContinuation`.
- `schedulingPriority` reachable only via the queue-wide drain path (no other caller).
- `groupReservations` storage-coupled to the plain queue (`reservation.mjs:8` imports `loadTaskQueue`/`saveTaskQueue` from `store.mjs`), call-graph independent.
- D31/D33/D36/D37/D45 (`multi-task-agent-execution`/`deterministic-status-architecture` owner-decisions) and their rationale.
- No ADR documents this architecture; `D33`-`D38` numbers collide across specs.

(Full citations for all of the above are in this change's git history, commit
`b79afa68`, superseded only where the 4 gaps below require correction.)

## Round 2 corrections and new facts

### Gap 1 — `executeBatchStart` cannot admit any batch of brand-new tasks today, independent of `validateBatchCompatibility`

Read directly, `tools/specs/workflow/batch-start/operation.mjs:104-141`:

- Line 113: `assertBaseExecutionReadiness(task, change, 'agent', {definition, repoRoot})`
  is called **again**, per member, inside `executeBatchStart` itself — independent of
  whatever `validateBatchCompatibility` already decided when the reservation was
  created. **Loosening `validateBatchCompatibility` alone, as draft 2 proposed, does
  nothing** — this second, redundant check in the start operation would still throw
  `DEPENDENCY_UNSATISFIED` for any member blocked by another member of the same batch.
- Lines 116-140: for *every* member, resolves `targetStepName` via
  `resolveWorkflowPosition`, then calls
  `resolveIncomingExecution(task, definition, targetStepName)` and requires
  `incoming.transition` to exist and `incoming.session === 'fresh'`.
- **Confirmed by direct read, `tools/specs/workflow/resolve-incoming-execution.mjs:65-74`:**
  `resolveIncomingExecution` returns `{transition: null, error: 'NO_INCOMING_TRANSITION',
  reason: "...has no workflow history (entry step)."}` whenever `task.workflow_progress.history`
  is empty or absent — i.e., **every brand-new task that has never been activated**.
  `batch-start/operation.mjs:127-133` throws immediately when `incoming.transition` is
  null.

**Conclusion of fact, stated precisely:** the current `executeBatchStart` cannot admit
*any* batch whose members have never been activated before — not just
dependency-blocked members, *all* of them, including a hypothetical fully-independent
batch of three fresh tasks with no dependencies among them at all. An initial
implementation batch (the primary use case this whole change exists to enable) cannot
start today, for a reason unrelated to dependencies. This is more severe than draft
2's framing ("needs generalizing for dependency-ordering") — it's a hard blocker on
the most basic case.

**Target correction:** batch-level admission needs its own readiness/incoming-transition
semantics, not a per-member replay of the single-task checks verbatim:
- Compatibility: every member's *canonical* target step/role/session-policy must
  match (homogeneous-by-contract, confirmed sound by Gap 4 below) — but a member's
  individual `ready`/`DEPENDENCY_UNSATISFIED` status is evaluated with the in-batch
  exception (blocking id inside the same reserved batch ⇒ ordering constraint, not an
  admission blocker).
- Entry-step members (no incoming transition at all) must be accepted as a *normal*
  case, not required to resolve a transition that structurally cannot exist for a
  fresh task. `incoming.session === 'fresh'` only needs to be checked where an
  incoming transition actually exists; a fresh entry has no incoming transition to
  check in the first place and is, by construction, a fresh-session case.
- After batch-level validation succeeds, batch start may activate all members under
  the already-owned batch scope before the agent begins — the reservation/workspace
  claim is what makes that safe (unchanged from the owner's brief). Execution order
  within the session is then `depends_on`-derived.
- Explicitly **not** doing: no generic `force`/`ignoreDependencies` escape hatch on
  ordinary single-task readiness — the exception is scoped to batch admission only,
  mirroring how D37 scoped the barrier exception to the authenticated batch-start's
  own bootstrap rather than adding a generic bypass flag.

### Gap 2 — `BatchFinish` is review-specific at every stage, not "largely as-is"

Read directly, `tools/specs/workflow/batch-finish/preflight.mjs:324-358` (`prevalidateBatchFinish`):

- `computeDeltaFingerprint(repoRoot, {excludePath: canonicalReportPath})` excludes
  **only** the canonical batch review report path from the workspace-delta provenance
  check against the post-bootstrap baseline. Any other change to the worktree —
  exactly what an implementation or refinement batch must produce — fails
  `BATCH_PROVENANCE_VIOLATION` immediately (lines 352-357).

Read directly, `tools/specs/workflow/batch-finish/operation.mjs:106-212` (`executeBatchFinish`):

- Stage 1.5 (lines 106-120): **unconditionally** renders and writes the canonical
  batch *review* report via `renderBatchReport`, regardless of batch phase.
- Stage 3 (lines 136-163): commits **only** that report file in its own commit
  (`git.addAndCommitAsync(repoRoot, [canonicalReportPath], 'docs(review): batch review report ...')`).
- Stage 4 (lines 165-208): calls `finishStep({...})` once per member, sequentially.

Read directly, `tools/specs/workflow/finish-operation.mjs:27,548-654` (`finishStep`,
`FINISH_STAGE_IDS`):

- `FINISH_STAGE_IDS = ['verify-gates', 'update-task', 'commit', 'push', 'transition']`
  — `finishStep` is a complete 5-stage saga **per task**, including its own `commit`
  stage (line ~587-615, via the `commit-and-push` action with `push:false`) and its
  own `push` stage (line ~620-654, `git.pushAsync`), run independently for every
  member.

**Conclusion of fact, correcting draft 2 directly:** calling `finishStep` once per
member does not produce "one shared finalize/commit/push" — it produces **N commits
and N pushes**, one pair per member, plus a separate report-only commit in Stage 3.
Draft 2's claim that this was "already the right shape... one commit/push" was wrong;
retracted here with the exact evidence that contradicts it.

**Target correction:** a genuinely phase-neutral `BatchFinish`:
1. Prevalidate every member (results/gates/scope) — reusable as-is, this part doesn't
   assume review.
2. Provenance check against the whole batch's actual allowed change set (every
   member's own `allowed_paths`/`consequential_paths`, not "nothing except the review
   report") — review-report generation becomes one *optional* artifact a review-phase
   batch produces, not baked into the generic lifecycle.
3. Derive every member's transition (reusing `finishStep`'s own `verify-gates`/
   `update-task`/`transition` stages — these are not review-specific and don't need
   reinventing).
4. Apply every member's workflow-state transition idempotently (same durable,
   resumable-stage pattern `finishStep` already uses, just scoped per-member inside
   one batch operation instead of N independent operations).
5. **One** shared source-control finalize: one commit covering every member's changes
   (plus the review report, when phase is review), one push.
6. Settle the batch.

Per the owner's explicit preference: extract/reuse `finishStep`'s existing stage
*logic* (gate verification, task-state update, transition resolution) rather than
bolting `skipCommit`/`batchMode` flags onto the single-task function — the commit/push
stages specifically are what need to become a shared, batch-level operation, not a
parameter threaded through the single-task path.

### Gap 3 — intra-batch dependency-consumption provenance has no existing recording path, and must not be invented as a second system

Read directly, `.nevo-ai/workflows/standard-v1.yaml:14` — `implementation` step
declares `consumesDependencies: true`.

Read directly, `tools/specs/workflow/cli.mjs:385-454` (`handleWorkflowStepStart`,
ordinary single-task path): when `consumesDependencies === true`, for each
`depends_on` entry, calls `evaluateDependencySatisfaction(depTask, change, definition)`
and, if it returns a `releaseEpoch`, pushes `{taskId, releaseEpoch}` into a
`dependencySnapshot`, then calls
`recordDependencyConsumption({..., dependencies: startOp.dependencySnapshot})`
(`tools/specs/workflow/dependency-consumption.mjs:29-55`, persisted at
`.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json`).

Read directly, `tools/specs/workflow/batch-start/operation.mjs:174-199` (member
activation loop): calls only `ensureStepActivated(change, task, definition, {...})`
per member — **`recordDependencyConsumption` is never called anywhere in
`batch-start/operation.mjs`.** Batch-start today does not attempt dependency-
consumption recording at all, for any member, dependency or not.

**Why this matters specifically for intra-batch dependencies:** for `T2 depends_on T1`
both in the same implementation batch, at batch-start time `T1` has not been
implemented yet — `evaluateDependencySatisfaction(T1, ...)` has no `releaseEpoch` to
return, because `T1`'s own implementation transition (the thing that creates its
release epoch) hasn't happened yet. Recording T2's consumption *at start* is
structurally impossible for an intra-batch dependency, unlike the ordinary case where
the upstream task already finished in a prior, separate execution.

**Target correction (reuse existing record, change only the timing):**
`recordDependencyConsumption`/`loadDependencyConsumption`'s existing shape
(`dependencies: [{taskId, releaseEpoch: {step, attempt}}]`) can represent an
intra-batch dependency's epoch *once that epoch exists* — no new provenance
representation is needed. What changes is *when* it's recorded: `BatchFinish`
processes members in `depends_on` topological order; once a member's own
implementation transition is applied (creating its release epoch, as part of Gap 2's
"derive every member's transition" stage), any *other* member whose dependency
snapshot pointed at that now-resolved task records its consumption of that exact
epoch before its own transition is applied. This is the same function, called in a
different place at a different time — consistent with the owner's instruction not to
invent a second provenance system.

### Gap 4 — heterogeneous batches rejected; homogeneous-by-contract confirmed sufficient

Read directly, `tools/specs/workflow/task-projection.mjs:66-100` (`projectTask`,
blocked-pre-start branch): for a published task with an unsatisfied dependency
(`state: 'blocked'`), the projection still returns `nextStep: entryStepDescriptor`
(line 89-96) — **the canonical next step is populated identically whether or not the
task is currently blocked.** A fresh `T2 depends_on T1`, both targeting
`implementation`, reports `nextStep.id === 'implementation'` regardless of whether
`T1` has finished — confirming the owner's claim directly: `T1`/`T2`/`T3` can be one
homogeneous implementation batch (same canonical target step for all three) even
though only `T1` is individually `ready` before admission. No heterogeneous
mixed-step `BatchContext` is needed to support dependency-ordered implementation
batches — only the admission-time exception from Gap 1.

**Consequence:** draft 2's proposed `BatchContext` dependency-graph/per-member-step
generalization is simplified. `BatchContext.members[]` needs a `dependsOn` field
(sourced directly from each member's existing `task.depends_on`, filtered to ids
inside the same batch — no second, duplicated graph structure) for the agent to
determine execution order. It does **not** need a per-member target step field; the
batch's single shared `targetStepName` (already how `buildBatchContext` works today,
`batch-context.mjs:189-194`) stays correct, because every member's canonical next step
is the same by construction of "homogeneous batch."

If selected tasks require incompatible roles/providers/session policies, they are not
one batch — this is a hard constraint on what the picker (and the UI
dependency-duplication fix already in scope) must enforce at selection time, not
something the batch machinery needs to tolerate.

## Round 3 corrections and new facts

### Gap 5 — `BatchFinish`'s preflight is not phase-neutral even before provenance/source-control

Read directly, `tools/specs/workflow/batch-finish/preflight.mjs:287-295`
(`prevalidateBatchFinish`): unconditionally requires `taskResult.result` to be defined
for **every** member — `throw ... 'Missing result for batch member task'` otherwise.

Read directly, `tools/specs/workflow/finish-operation.mjs:217-248`: `isConditional`
is `transitions.length > 1 || (transitions.length === 1 && transitions[0].value !== undefined)`.
For an unconditional step (exactly one transition, no `value`), supplying a non-null
`result` throws `UNEXPECTED_TRANSITION_RESULT` (lines 237-246) — the opposite problem
from the missing-result case, but equally fatal.

Read directly, `.nevo-ai/workflows/standard-v1.yaml:14-28`: `implementation`'s own
`transitions` is exactly one entry (`{to: review, continuation: auto, ...}`, no
`value`) — **unconditional**, by the same test `finish-operation.mjs:218` uses.

**Conclusion of fact:** for an implementation-phase batch, `prevalidateBatchFinish`'s
blanket "every member needs a `result`" requirement would itself be satisfiable only
by supplying a `result` that `finishStep` then rejects for that same member when the
transition is actually applied in Stage 4 — the preflight and the per-member finish
stage disagree about whether `result` is even a valid field for this step, before any
provenance or source-control concern is reached. This is a second, independent
blocker from Gap 2's provenance check, not a restatement of it.

Read directly, `tools/specs/workflow/step-context.mjs:75-118` (`buildFinishContract`):
`parameters.result` is added **only when `isConditional`** (line 95-103); every step's
own contract also always includes whatever the step's `finalize` actions require —
for `implementation`/`review` (`finalize: [{id: commit-and-push}]`), that's
`commit.title` (required) and `commit.message` (optional), confirmed directly in
`tools/specs/workflow/actions/commit-and-push.mjs:15-23,268-300`. So today, every
member's own `finishContract` independently demands its own `commit.title` — one
title per member, for what should be one shared commit.

**Target correction:** `BatchFinish` must validate each member against *its own*
canonical `finishContract` (derived the same way `buildFinishContract` already does,
per member's actual step) rather than assuming a shared `result` field exists
everywhere. Split inputs into two groups:
- **Per-member workflow inputs** — `result` only where that member's own target step
  is conditional (e.g. review's pass/fail), plus `feedback`/`artifacts`.
- **Shared batch-finalize inputs** — `commit.title`/`commit.message`, supplied once
  for the whole batch, not once per member. The agent should never be asked for N
  independent commit contracts when the batch produces one shared commit.

`BatchContext` should expose this as an explicit `batchFinishContract`: a map of
per-member contracts (workflow fields only, commit fields excluded) plus one shared
commit-contract object — computed the same way individual contracts are today, just
assembled once per batch instead of trusted as homogeneous.

### Gap 6 — dependency-consumption must respect `planStart`'s pre-activation sequence freeze; production remediation wiring is incomplete today (name this precisely)

Read directly, `tools/specs/workflow/start-operation.mjs:153-188` (`planStart`):
scans existing start-operation records for this **task** (`scanMaxConsumptionSequence(repoRoot, change, task)`,
line 18, called at line 177 — scoped per consuming task, not change-wide), allocates
`consumptionSequence = maxSeq + 1`, and freezes it into a durable record **before**
`ensureStepActivated` ever runs (`cli.mjs:432-442`: `planStart` →
`ensureStepActivated` → `recordDependencyConsumption`, in that order). This sequence
freeze is a real invariant (D52/D58) — round 2's proposal to record dependency
consumption only at batch-finish time, with no batch-start involvement at all, skips
this invariant entirely rather than satisfying it.

**Target correction (reusing `planStart`, not replacing it):** `BatchStart` creates/
maintains a per-member start-operation and allocates each member's own
`consumptionSequence` before that member's activation — same function, same freeze
guarantee, just called once per member inside the batch loop instead of once for a
single task. For each member's `depends_on` list: a dependency **outside** the batch
already has a real `releaseEpoch` (or the batch wouldn't have been admitted at all,
per Gap 1's corrected compatibility check) — snapshot it immediately, exactly like the
single-task path does today. A dependency **inside** the batch has no `releaseEpoch`
yet by construction (its own implementation hasn't happened) — recorded as a
*pending* entry in the same `dependencySnapshot` array shape
(`{taskId, releaseEpoch: null}` or an explicit `pending: true` marker — a schema
detail, not a new system) alongside the already-allocated `consumptionSequence`.

`BatchFinish`, processing members in topological order: once an upstream member's own
transition is applied (creating its `releaseEpoch`, as part of Gap 2's "derive every
member's transition" stage), any downstream member's pending entry pointing at that
task is *materialized* — the real `releaseEpoch` is filled in and
`recordDependencyConsumption` is called using the **already-allocated**
`consumptionSequence` from that member's own start-operation (never a new one — this
is what preserves `planStart`'s frozen-snapshot invariant exactly, since the sequence
number was reserved before any member activated, independent of execution order). The
member's own `record-consumption` stage closes, then its own `finishStep` applies.
This reuses `dependency-consumption.mjs`'s existing record shape and
`start-operation.mjs`'s existing sequence allocation — no second provenance system,
per the owner's instruction.

**Important precision, found by direct call-site search (not assumed):**
`findConsumersOfEpoch` (`dependency-consumption.mjs:95`) and `createRemediationRecord`
(`remediation-record.mjs:28`) are each defined and exported, but a repo-wide search
(`grep -rn "findConsumersOfEpoch(\|createRemediationRecord(" --include=*.mjs .`,
excluding `node_modules`) found **zero production call sites** — every call is from a
test file (`deterministic-dependency-satisfaction.test.mjs`, `orchestration-e2e.test.mjs`,
`dependency-invalidation-remediation-review.test.mjs`, `deterministic-task-queue.test.mjs`).
**This discovery must not describe dependency-consumption provenance as a complete,
working end-to-end production path.** It is a real, existing data *contract*
(D52-D58) worth preserving and extending to intra-batch edges — the *recording* half
(`recordDependencyConsumption`, called from `cli.mjs`) is live in production. The
*consumption* half (finding who consumed an epoch, building a remediation record when
an epoch turns out to be invalid) is only exercised by tests today. Generalizing
batch-start/finish to record intra-batch consumption correctly is still worth doing —
it keeps the data available for whenever the remediation-consumer side does get wired
up — but this discovery does not claim that wiring already works, and implementing
this gap does not, by itself, complete it.

### Batch-completion handover: partition by full canonical execution contract, not just destination

Corrected again from both draft 2 ("one subset, one batch") and round 2's first
correction ("partition by destination transition alone"): two members both
transitioning to `implementation` after a failed review are not necessarily
batch-compatible with each other — `taskOverrides` (confirmed to exist,
`tools/dashboard/server/ai/sessions/execution-policy-service.mjs:76-91`, allowing
per-task `provider`/`model`/`mode` overrides) can make their *resolved* execution
policy differ even though their canonical target step is identical. The partition key
for "how many new agent sessions does this handover produce, and which members go in
each" must be the full tuple: **continuation policy + target step/executor +
incoming role + session policy + resolved execution policy** (provider/model/mode/
taskOverrides) — not destination transition alone. Human destinations
(`continuation: owner-action`/no agent executor) never produce a session regardless.
Agent destinations produce exactly one new session per group of members that share
every element of that tuple — a typical review failure still produces one refiner
batch, but only when its failing members actually share the same contract; if they
don't, it's more than one.

**Closing the "mixed review-result partitioning" open question (round 2), with
evidence:** `tools/tests/batch-finish-operation.test.mjs:218-247` already proves
`t1: pass, t2: pass, t3: fail` processed in one existing `executeBatchFinish` call,
with the resulting `change.yaml` containing **both** `transitioned_to: verified` and
`transitioned_to: implementation` for the respective members, read directly out of
each member's own `workflow_progress.history` after the call. The data needed to
partition a handover already exists and is already correctly per-member — generalizing
the handover is a **dispatch-logic change** (group already-recorded transitions by the
full contract tuple above, then admit one session per group), not a new workflow-state
concept.

**Closing the single-task convergence open question (round 1/2), per owner's
decision:** keep `ExecutionScope {task | task-batch}` as two scope shapes. Both
converge onto one shared orchestration lifecycle and shared primitives (gate
verification, transition derivation, the generalized `BatchFinish`/dependency-
consumption mechanics above). A one-task scope is not required to fabricate a
group-reservation/`BatchContext` wrapper merely for architectural uniformity, but it
also retains no separate queue/scheduler/continuation engine alongside the batch
path — the convergence is at the level of shared primitives and invariants, not a
shared literal data structure for every scope size.

### Wording correction: "ONE provider turn" → "one batch execution / one logical session"

Draft 2 repeatedly said "ONE provider turn" per batch. Corrected: the invariant is one
batch execution / one logical session per phase. A provider failure followed by an
explicit resume may legitimately produce *another turn in the same session* — this is
exactly the existing `resumable` outcome's contract (D2, already relied on by the
single-task model: "a resumable attempt requires its own fresh explicit admission to
resume"). The forbidden behavior is creating a **new session** merely because
execution moved from one member task to another inside the same batch — not
prohibiting more than one turn total.

## Revised target flows

```
Implementation batch:
  user selects T1, T2(depends_on T1), T3(depends_on T1) — all canonically targeting
  the same step/role/session-policy/resolved-execution-policy (homogeneous)
    → batch-level compatibility: T2/T3's block-on-T1 is intra-batch, not an admission
      blocker; all three accepted as entry-step members (no incoming-transition
      requirement for fresh tasks — Gap 1)
    → ONE admission, ONE workspace-writer claim, ONE AgentSession
    → batch-start allocates each member's own consumptionSequence before that
      member's activation (reusing planStart per member — Gap 6); external
      dependencies snapshot their real releaseEpoch now; intra-batch dependencies are
      recorded pending (no epoch yet)
    → agent receives BatchContext with members[].dependsOn (filtered to in-batch ids)
      and a batchFinishContract (per-member workflow-only fields + one shared
      commit.title/commit.message — Gap 5)
    → agent implements T1, then T2/T3, in dependency order, inside the one session
      (possibly multiple turns if a provider failure requires an explicit resume —
      still the same session)
    → ONE batch finish: prevalidate every member against its own canonical
      finishContract (no blanket `result` requirement — Gap 5) and its own allowed
      scope; process members in topological order (T1 first) — as each member's
      transition is applied, materialize any pending dependency-consumption entries
      that pointed at it, using each downstream member's already-allocated
      consumptionSequence (Gap 6) — ONE shared commit/push (Gap 2)
    → handover: partition members by the full contract tuple (continuation policy +
      target step/executor + role + session policy + resolved execution policy) —
      e.g. all → one review batch; or some → human-verification (no session), others
      → one refiner batch, only if those failing members actually share one contract

Review batch (existing shape, corrected handover):
  user selects "review together" → batch-level compatibility (homogeneous, as today,
  unaffected by Gap 1/4 since review members are already individually ready; no
  intra-batch dependency ordering assumed for review — open question below)
    → ONE admission → ONE session → agent reviews all members → ONE batch finish
      (review report generation stays here, as the review-phase-specific artifact —
      Gap 5's generalized BatchFinish still supports it, just doesn't require it)
    → handover: partition by full contract tuple — passing members → human-verification
      (no session); failing members sharing one contract → ONE refinement batch each
      (proven possible with existing per-member transition data — Gap 6's closing
      evidence, `batch-finish-operation.test.mjs:218-247`)

Refinement batch:
  same shape as implementation batch, scoped to one partition group from a review
  batch's handover — one session, dependency-ordered if that group's members depend
  on each other, one batch finish.

Single-task execution (owner's decision, closed):
  ExecutionScope {task|task-batch} stays as two scope shapes. Both converge onto one
  shared orchestration lifecycle and shared primitives (gate verification, transition
  derivation, the generalized BatchFinish/dependency-consumption mechanics above) — a
  one-task scope fabricates no group-reservation/BatchContext wrapper, but also keeps
  no separate queue/scheduler/continuation engine alongside the batch path.
```

### Revised responsibility table

| Current responsibility | Needed in one-session batch model? | Target owner | Remove / generalize |
|---|---|---|---|
| Durable `{taskIds, eligibleAt}` FIFO, `enqueueTasks`/`dequeueTask`/`loadTaskQueue`/`evaluateTaskQueue`'s cross-task selection, `schedulingPriority` | No | — | **Remove** — re-verified, still no caller once the queue-wide drain is gone |
| `executeBatchStart`'s per-member `assertBaseExecutionReadiness` replay | **Generalize** — batch-level compatibility with the in-batch-dependency exception, evaluated once per batch | `reservation.mjs`/`batch-start/operation.mjs` | Generalize |
| `executeBatchStart`'s per-member incoming-transition + `session:fresh` requirement | **Generalize** — must accept entry-step members (no incoming transition) as normal | `batch-start/operation.mjs` | Generalize |
| Dependency-consumption recording (`planStart`'s `consumptionSequence` freeze) | **Generalize, not relocate** — per-member allocation stays at batch-start time (pre-activation), pending intra-batch entries materialized at batch-finish | `batch-start/operation.mjs` (allocate), `batch-finish/operation.mjs` (materialize) | Generalize; reuses `start-operation.mjs`/`dependency-consumption.mjs` as-is |
| `findConsumersOfEpoch`/`createRemediationRecord` (remediation/invalidation consumer side) | Not addressed by this change — confirmed zero production call sites today (Gap 6) | Unchanged | Out of scope — do not claim this gets "generalized," it isn't wired up to generalize |
| `prevalidateBatchFinish`'s blanket per-member `result` requirement | **Generalize** — validate against each member's own canonical `finishContract` (result only if that member's step is conditional) | `batch-finish/preflight.mjs` | Generalize |
| `prevalidateBatchFinish`'s provenance check (excludes only the review report) | **Generalize** — must allow every member's own `allowed_paths`/`consequential_paths` | `batch-finish/preflight.mjs` | Generalize |
| `executeBatchFinish`'s unconditional review-report render/commit | **Generalize** — optional, review-phase-specific artifact | `batch-finish/operation.mjs` | Generalize |
| `executeBatchFinish`'s per-member `finishStep` call (N independent commit+push, N independent `commit.title` contracts) | No, in its current N-commits shape | `batch-finish/operation.mjs`, reusing `finishStep`'s non-commit/push stages | **Remove the per-member commit/push and per-member commit contract**, replace with one shared `batchFinishContract` commit section |
| `BatchContext`'s member dependency representation | **Add** `members[].dependsOn` sourced from existing `depends_on` (no second graph) | `batch-context.mjs` | Generalize, minimal |
| `BatchContext`'s single shared `targetStepName` | Keep as-is — confirmed correct for homogeneous batches (Gap 4) | `batch-context.mjs` | No change |
| `BatchContext`'s finish-contract exposure | **Add** `batchFinishContract` (per-member workflow fields + one shared commit section) | `batch-context.mjs` | New, minimal field |
| Per-member fresh-refiner dispatch (`batch-completion-settlement.mjs` Stage 4, N sessions) | No | Same file, rewritten | **Remove**, replace with full-contract-partitioned handover (one new session per distinct `{continuation, step/executor, role, session policy, resolved execution policy}` group) |
| `groupReservations`/barrier | Yes, unchanged (D31/D33/D36/D37) | Same module, re-homed storage (owner: in this change, no shim) | Keep logic, migrate storage |
| Workspace-writer claims, 3-outcome settlement, session fresh/reuse, execution policy | Yes, unchanged | Unchanged | None |
| UI dependency-satisfaction duplication | No, in current form | Canonical batch/dependency projection | **In scope** (owner's decision) |

## Self-review, round 3 (owner's 6 questions, re-answered against this revision)

1. **Can an initial implementation batch actually start?** Still not in current code
   (Gap 1) — the design fix (entry-step members accepted, intra-batch blocks excepted)
   is unchanged from round 2 and still holds after this round's corrections.
2. **Can an implementation batch modify source files and finish with one commit/push?**
   Still not in current code (Gaps 2 and 5, both confirmed, independently: provenance
   rejects any source change, *and* the preflight's blanket `result` field would be
   rejected by `finishStep` for an unconditional step even before provenance is
   reached). The target design (per-member canonical `finishContract` + one shared
   `batchFinishContract` commit section) answers both; not yet implemented.
3. **Is dependency-consumption/remediation provenance preserved for intra-batch
   dependencies?** Design now concrete and reuses existing primitives exactly
   (`planStart`'s sequence freeze, `recordDependencyConsumption`'s record shape) —
   but precision matters here: the *recording* half can be made correct by this
   change; the *consumption* half (remediation/invalidation reading these records) has
   **zero production call sites today** (Gap 6, confirmed by direct grep) — this
   change does not complete an end-to-end path that doesn't exist yet, it keeps the
   recorded data correct and available for whenever that consumer side is built.
4. **Is every batch homogeneous by execution contract?** Yes — reaffirmed and
   sharpened this round: homogeneity now explicitly includes resolved execution
   policy (`taskOverrides`/provider/model/mode), not just target step/role/session
   policy (Gap 6's handover-partition correction).
5. **Can mixed review results produce human + one refinement batch without N refiner
   sessions?** Closed this round with direct evidence
   (`batch-finish-operation.test.mjs:218-247` proves per-member transitions already
   persist correctly for mixed pass/fail in one batch-finish call) — the remaining
   work is a dispatch-logic change (group by full contract tuple), not new workflow
   state. No longer an open question.
6. **Is there anywhere left where moving from one task to another creates a new
   session?** No new instance found this round. The single-task-execution flow is no
   longer open either — closed by owner decision (shared lifecycle/primitives, no
   fabricated batch wrapper, no separate scheduler).

**Conclusion: no new model-level blocker found this round.** The three gaps raised
this round (preflight contract mismatch, dependency-consumption sequencing,
full-contract handover partitioning) are all generalizations of existing,
well-understood mechanisms (`buildFinishContract`, `planStart`, per-member transition
data already proven correct) — none required inventing a new primitive or revealed a
reason the overall direction is unworkable. Recommend proceeding to a concrete
spec/task breakdown; the residual items below are implementation-level risks to carry
as explicit tasks/acceptance criteria, not reasons to keep discovering.

## Open questions (residual, implementation-level — not direction-blocking)

1. **Dependency-consumption pending-entry schema**: exact representation of a pending
   intra-batch edge in the `dependencySnapshot` array (`releaseEpoch: null` vs. an
   explicit `pending: true` flag) — a schema detail to settle during task-writing, not
   a design risk.
2. **Crash recovery interaction**: what happens if the process crashes after
   batch-start allocates per-member `consumptionSequence`s but before batch-finish
   materializes a pending intra-batch epoch? Plausibly already safe (each member's own
   start-operation record shows its `record-consumption` stage incomplete, same
   resumability pattern `reconcileCrashedReservation` already uses elsewhere) but not
   independently traced this round — should be a specific acceptance criterion, not
   assumed.
3. **Review-batch dependency semantics**: does review ever need intra-batch ordering,
   or does it stay fully homogeneous/unordered (assumed in this revision)?
4. Carried, still open, low priority: full list of `.mjs` test files importing
   `reservation.mjs` only transitively; whether any `specs/active/**` task depends on
   `groupReservations`.

## Owner decisions (recorded, not re-opened)

1. Target architecture: generalized `BatchExecution`/`ExecutionScope`, homogeneous by
   full execution contract — target step/executor, role, session policy, *and*
   resolved execution policy (not `ExecutionRun`, not heterogeneous mixed-step
   batches).
2. `groupReservations` storage migration happens in this same change, no compatibility
   shim.
3. UI dependency-satisfaction duplication is in scope for this change.
4. `BatchFinish` becomes genuinely phase-neutral: per-member canonical
   `finishContract` validation (not a blanket `result` field), one shared
   `batchFinishContract` commit section, review-report generation as an optional
   phase-specific artifact rather than baked into the generic lifecycle.
5. Dependency-consumption for intra-batch edges reuses the existing record/sequence
   primitives (`planStart`, `recordDependencyConsumption`) with new *timing*
   (allocate at batch-start, materialize at topologically-ordered batch-finish) — no
   second provenance system. The remediation/invalidation *consumer* side of this
   contract is out of scope (it has no production wiring to generalize).
6. Batch-completion handover partitions by the full execution-contract tuple, not
   destination transition alone.
7. Single-task execution keeps `ExecutionScope {task|task-batch}`, converging on
   shared orchestration primitives without a separate scheduler and without
   fabricating batch metadata for a one-task scope.
8. Directory/change id renamed `execution-run-simplification` →
   `batch-execution-generalization` — the obsolete `ExecutionRun` name does not
   become permanent terminology.

**Next step, per owner: if no new model-level blocker surfaced in this self-review
(none did), proceed to writing the concrete spec/task breakdown. Still no
implementation in this discovery report itself.**
