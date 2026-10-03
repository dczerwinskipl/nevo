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
  homogeneous-by-contract model. This revision fixes all 4 gaps with direct code
  verification and corrects the architecture accordingly. Directory renamed from
  `execution-run-simplification` (obsolete) to `batch-execution-generalization`.

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

## Corrections and new facts (this round)

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

### Batch-completion handover: partition by canonical destination, not one-size-fits-all

Corrected from draft 2's "derive the subset needing another phase, admit one batch for
that subset" (too simple): a review batch's members can land on **different**
canonical destinations after the same review turn — e.g., `pass → human-verification`
(produces a human interaction, no new agent session at all) vs. `fail →
implementation/refinement` (becomes a candidate for one refiner batch). The handover
step must partition members by their actual resulting transition and
`continuation: auto`/owner-action policy — each member's own transition stays
authoritative, same as the single-task model already guarantees. "One handover" means
*at most one new agent-session admission is derived per distinct destination
grouping*, not literally always exactly one session regardless of outcome mix.

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
  the same step/role/session-policy (homogeneous)
    → batch-level compatibility: T2/T3's block-on-T1 is intra-batch, not an admission
      blocker; all three accepted as entry-step members (no incoming-transition
      requirement for fresh tasks — Gap 1)
    → ONE admission, ONE workspace-writer claim, ONE AgentSession
    → agent receives BatchContext with members[].dependsOn (filtered to in-batch ids)
    → agent implements T1, then T2/T3, in dependency order, inside the one session
      (possibly multiple turns if a provider failure requires an explicit resume —
      still the same session)
    → ONE batch finish: prevalidate every member against its own allowed scope,
      process members in topological order (T1 first) — as each member's transition
      is applied, record any other member's dependency-consumption of that
      newly-created release epoch (Gap 3) — ONE shared commit/push (Gap 2)
    → handover: partition members by actual destination (e.g. all → review batch;
      or some → human-verification with no new session, others → refiner batch)

Review batch (existing shape, corrected handover):
  user selects "review together" → batch-level compatibility (homogeneous, as today,
  unaffected by Gap 1/4 since review members are already individually ready)
    → ONE admission → ONE session → agent reviews all members → ONE batch finish
      (review report generation stays here, as the review-phase-specific artifact —
      Gap 2's generalized BatchFinish still supports it, just doesn't require it)
    → handover: pass-ing members → human-verification (no session); failing members
      → ONE refinement batch for that subset (not N independent refiner sessions)

Refinement batch:
  same shape as implementation batch, scoped to the subset of members a review batch's
  handover flagged — one session, dependency-ordered if the flagged members depend on
  each other (same Gap 1/3 mechanics), one batch finish.

Single-task execution:
  owner's preferred direction (this round): keep ExecutionScope {task|task-batch} as
  two scope shapes, but converge both onto one orchestration lifecycle — a one-task
  scope must not require fabricating group-reservation/batch metadata for
  architectural purity, but also must not retain a separate queue/scheduler/
  continuation system alongside the batch path. Still open precisely how (see below).
```

### Revised responsibility table

| Current responsibility | Needed in one-session batch model? | Target owner | Remove / generalize |
|---|---|---|---|
| Durable `{taskIds, eligibleAt}` FIFO, `enqueueTasks`/`dequeueTask`/`loadTaskQueue`/`evaluateTaskQueue`'s cross-task selection, `schedulingPriority` | No | — | **Remove**, unchanged from draft 2 — re-verified, still no caller once the queue-wide drain is gone |
| `executeBatchStart`'s per-member `assertBaseExecutionReadiness` replay | **Generalize** — becomes batch-level compatibility with the in-batch-dependency exception, evaluated once per batch, not re-derived per member against single-task rules | `reservation.mjs`/`batch-start/operation.mjs` | Generalize |
| `executeBatchStart`'s per-member incoming-transition + `session:fresh` requirement | **Generalize** — must accept entry-step members (no incoming transition) as normal | `batch-start/operation.mjs` | Generalize |
| `prevalidateBatchFinish`'s provenance check (excludes only the review report) | **Generalize** — must allow every member's own `allowed_paths`/`consequential_paths`, not just the report path | `batch-finish/preflight.mjs` | Generalize |
| `executeBatchFinish`'s unconditional review-report render/commit | **Generalize** — becomes an optional, review-phase-specific artifact | `batch-finish/operation.mjs` | Generalize |
| `executeBatchFinish`'s per-member `finishStep` call (N independent commit+push) | No, in its current N-commits shape | `batch-finish/operation.mjs`, reusing `finishStep`'s non-commit/push stages | **Remove the per-member commit/push**, replace with one shared source-control finalize |
| Dependency-consumption recording for intra-batch deps | **New timing, not new system** — same `recordDependencyConsumption` record, called during topologically-ordered batch finish instead of at start | `batch-finish/operation.mjs` | Generalize (reuse `dependency-consumption.mjs` as-is) |
| `BatchContext`'s member dependency representation | **Add** `members[].dependsOn` sourced from existing `depends_on` (no second graph) | `batch-context.mjs` | Generalize, minimal |
| `BatchContext`'s single shared `targetStepName` | Keep as-is — confirmed correct for homogeneous batches (Gap 4) | `batch-context.mjs` | No change |
| Per-member fresh-refiner dispatch (`batch-completion-settlement.mjs` Stage 4, N sessions) | No | Same file, rewritten | **Remove**, replace with destination-partitioned handover (at most one new session per distinct destination grouping) |
| `groupReservations`/barrier | Yes, unchanged (D31/D33/D36/D37) | Same module, re-homed storage (owner: in this change, no shim) | Keep logic, migrate storage |
| Workspace-writer claims, 3-outcome settlement, session fresh/reuse, execution policy | Yes, unchanged | Unchanged | None |
| UI dependency-satisfaction duplication | No, in current form | Canonical batch/dependency projection | **In scope** (owner's decision) |

## Self-review (owner's 6 questions, answered against this revision)

1. **Can an initial implementation batch actually start?** Not yet in the current
   code (Gap 1, confirmed blocking) — but the revised target flow fixes exactly this:
   entry-step members no longer need an incoming transition, and intra-batch
   dependency blocks no longer fail batch-level compatibility. Answered by design in
   this revision; still needs implementation.
2. **Can an implementation batch modify source files and finish with one commit/push?**
   Not in the current code (Gap 2, confirmed: N commits + N pushes today, plus a
   provenance check that would reject any source change outright). The revised
   `BatchFinish` target (one shared finalize, provenance scoped to every member's own
   allowed paths) is designed to answer yes; not yet implemented.
3. **Is dependency-consumption/remediation provenance preserved for intra-batch
   dependencies?** Not automatically today (Gap 3: batch-start never calls
   `recordDependencyConsumption` at all). The revised design reuses the existing
   record, moved to topologically-ordered batch-finish time. This is the least
   independently-verified part of this revision — it has not been checked against
   every remediation/invalidation consumer of `dependency-consumption.mjs` records
   (only the recording path was traced, not every reader). Flagged as the single
   highest-risk open item below, not asserted as fully safe.
4. **Is every batch homogeneous by execution contract?** Yes, by this revision's
   design (Gap 4, confirmed by `task-projection.mjs`'s blocked-task `nextStep`
   behavior) — the heterogeneous-batch idea from draft 2 is retracted.
5. **Can mixed review results produce human + one refinement batch without N refiner
   sessions?** Addressed by design (the "partition by canonical destination" handover
   correction above) — not yet verified against `batch-completion-settlement.mjs`'s
   actual destination-resolution code in enough depth to be certain the existing
   per-member transition data is sufficient to compute the partition without new
   plumbing. Listed as an open question below, not assumed solved.
6. **Is there anywhere left where moving from one task to another creates a new
   session?** The per-member fresh-refiner dispatch (Gap 2's cousin, in
   `batch-completion-settlement.mjs` Stage 4) was exactly this, and is explicitly
   targeted for removal above. No other such mechanism was found in this round's
   re-reading. The single-task-execution flow is still explicitly open (not asserted
   either way) — see below.

## Open questions

1. **Single-task-as-batch-of-one**: concretely, does a one-task `ExecutionScope`
   share `batch-start`/`batch-finish` code paths (with a trivial one-member batch
   underneath), or keep its own simpler admission/finish while both converge on
   shared primitives (gate verification, transition derivation) without a
   batch-reservation wrapper? Not decided; needs a concrete side-by-side comparison
   before implementation.
2. **Review-batch dependency semantics**: does review ever need intra-batch
   dependency ordering, or does it stay fully homogeneous (no ordering, as today)?
   Assumed the latter in this revision, not independently confirmed.
3. **Dependency-consumption provenance risk (Gap 3, highest-risk item)**: every
   *reader* of `.nevo-ai-local/dependency-consumption/**` records (remediation,
   invalidation, D52/D53/D58's sequence-based matching) needs to be checked against
   "recorded at batch-finish time, in topological order, for an intra-batch
   dependency" before this is trusted — only the recording call site was traced this
   round.
4. **Mixed review-result partitioning**: exact code path in
   `batch-completion-settlement.mjs` that would need to compute "which destination
   does each member's result resolve to" — not yet traced against the actual
   transition-matching logic used for routing.
5. Carried from the previous revision, still open: full list of `.mjs` test files
   importing `reservation.mjs` only transitively; whether any `specs/active/**` task
   depends on `groupReservations`.

## Owner decisions (recorded, not re-opened)

1. Target architecture: generalized `BatchExecution`/`ExecutionScope`, homogeneous by
   execution contract (not `ExecutionRun`, not heterogeneous mixed-step batches).
2. `groupReservations` storage migration happens in this same change, no compatibility
   shim.
3. UI dependency-satisfaction duplication is in scope for this change.
4. Directory/change id renamed `execution-run-simplification` →
   `batch-execution-generalization` (this revision) — the obsolete `ExecutionRun` name
   does not become permanent terminology.
