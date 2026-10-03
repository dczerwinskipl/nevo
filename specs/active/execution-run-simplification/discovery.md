---
id: spec.execution-run-simplification
type: discovery
title: "Generalize task-batch into the primary multi-task execution model"
status: draft
change: execution-run-simplification
---

# Discovery: generalize `task-batch`/`ExecutionScope` into the primary execution model

**Revision note:** this report's first draft proposed a scheduler-shaped
`ExecutionRun { selectedTaskIds, state }` that chose and admitted one task at a time.
The owner rejected that direction after further review: it is still a second scheduler
competing with the workflow engine, just with a different name. This revision keeps
the first draft's **facts about current code** (confirmed valuable) and replaces the
proposed architecture entirely with the owner's corrected direction: generalize the
*existing* `ExecutionScope: 'task' | 'task-batch'` + reservation/`BatchContext`/
batch-finish machinery — built today only for homogeneous "review together" — into the
primary model for implementation, review, and refinement, each as **one session per
batch**, with the agent executing the whole dependency-ordered group inside that one
session. No new `ExecutionRun` primitive. Still no implementation in this report.

## Scope

Triggered by the runaway-session-creation incident on `ai-spec-history` (fixed in
`81bcfe45`). While reviewing that fix, the owner audited `tools/specs/workflow/queue/**`
directly and the existing `task-batch` machinery, and concluded:

> Nie chcę modelu `selected tasks → choose next runnable → admit one task → finish →
> choose next → new execution/session`. Chcę `selected tasks → ONE batch execution →
> ONE agent session → agent executes the whole dependency-ordered group → ONE batch
> finish`.

Session handover happens **between roles/phases** (implementation batch → review
batch → optional refinement batch), never between tasks inside the same batch.

## Repository facts

### The queue directory's actual contents (unchanged from first draft, still accurate)

`tools/specs/workflow/queue/` has exactly 4 files:

- **`store.mjs`** — durable JSON persistence at `.nevo-ai-local/task-queues/<changeSlug>.json`. `loadTaskQueue`/`saveTaskQueue` read/write one record per change: `{changeSlug, taskIds, eligibleAt, groupReservations, metadata, updatedAt}`. `enqueueTasks`/`dequeueTask` mutate `taskIds`/`eligibleAt` only.
- **`evaluator.mjs`** — `evaluateTaskQueue(params)`: for a selection of task ids, filters out barriered/not-ready/non-activation-only-blocked ones, then sorts the rest by `(schedulingPriority asc, task.order asc, eligibleAt asc)` and returns `{eligible, nextRunnable: eligible[0]||null, warnings}`.
- **`reservation.mjs`** — `createGroupReservation`/`releaseGroupReservation`/`validateBatchCompatibility`/`isTaskBarriered`/`getTaskReservation`/`assessBatchReservationSettlement`/`reconcileCrashedReservation`. Imports `loadTaskQueue`/`saveTaskQueue` directly from `./store.mjs` (`reservation.mjs:8`) and mutates `queueRecord.groupReservations` **in the same file and the same top-level record** that `enqueueTasks`/`dequeueTask` mutate.
- **`index.mjs`** — pure re-export barrel for both function sets.

**Fact:** `evaluator.mjs:8` imports `isTaskBarriered` from `./reservation.mjs` — the plain queue's own evaluator already depends on the reservation module.

**Fact:** `groupReservations` and the plain queue's `taskIds`/`eligibleAt` are **not separable at the storage layer today** — one JSON record, one `saveTaskQueue`.

### Call sites of enqueue/dequeue/load/evaluate/reconcileContinuation (unchanged from first draft)

| Function | Call site | What triggers it | Scope |
|---|---|---|---|
| `enqueueTasks` | `turns/routes.mjs:369` | manual "Start" (new session) | single task |
| `enqueueTasks` | `turns/routes.mjs:573` | manual "Start" (existing session) | single task |
| `enqueueTasks` | `reconciliation.mjs:102` | same-task auto-continuation, gated by `continuationPolicy === 'auto'` | single task |
| `dequeueTask` | `admission.mjs:625` | turn settled `resumable`, scope `kind:'task'` only | single task cleanup |
| `dequeueTask` | `reconciliation.mjs:502` | queue-wide maintenance: purge terminal ids | potentially multiple |
| `loadTaskQueue` | `deterministic-execution-plan.mjs:58` | read-only, request-scoped | single task |
| `loadTaskQueue` | `reconciliation.mjs:493,506` | queue-wide drain | multiple |
| `evaluateTaskQueue` | `deterministic-execution-plan.mjs:79-84` | every manual Start/continue call | single task — sort is a no-op |
| `evaluateTaskQueue` | `reconciliation.mjs:105-110` | same-task auto-continuation (gated) | single task |
| `evaluateTaskQueue` | `reconciliation.mjs:519-525` | **queue-wide drain, no `continuationPolicy` gate** | whatever is in the durable file |
| `reconcileContinuation` | `admission.mjs:579,586` (sole call site outside tests) | every turn settling `outcome:'completed'` | — |

**Fact:** every manual Start/continue — even one task — goes through
`loadTaskQueue → evaluateTaskQueue (no-op sort) → enqueueTasks → admitAgentExecution`.

**Fact, `reconcileContinuation`'s two internal paths:** the single-task path
(`reconcileWorkflowPosition`) is gated on `continuationPolicy === 'auto'`
(`reconciliation.mjs:93-97`); the queue-wide drain path (`reconciliation.mjs:485-590`)
has **no such gate anywhere in its body** — this asymmetry is a second, latent bug
class beyond the one already fixed (not independently confirmed as having fired, but
structurally possible).

### `schedulingPriority` (unchanged from first draft)

Default `0`; only `review` sets `10` in all three workflow definition files. Its
cross-task ordering is reachable **only** through the queue-wide drain path with no
other caller (`evaluator.mjs:179-202` compared against every other call site, all
single-task). Directly evidences — not merely assumes — that this semantic was never
required by any currently-supported flow.

### NEW — `validateBatchCompatibility` assumes a homogeneous batch (confirmed, this is the core gap for generalizing to implementation)

Read directly, `tools/specs/workflow/queue/reservation.mjs:81-190`:

- Line 112-120: **every member must individually be `readiness.ready` (via
  `evaluateBaseExecutionReadiness`) before the batch is even compatible.** For a
  dependency-ordered implementation batch where `T2 depends_on T1` and both are
  selected together, `T2`'s own `evaluateBaseExecutionReadiness` call returns
  `ready: false, code: 'DEPENDENCY_UNSATISFIED'` (per `readiness-policy.mjs:44-54`,
  `projection.state === 'blocked'`) **because `T1` hasn't finished yet** — this
  rejects the whole batch today, exactly the gap the owner identified.
- Line 122-131: **every member must resolve to the same `targetStepId`.** A batch
  containing a fresh `T1` (targeting `implementation`) and a dependent `T2` that isn't
  even ready yet cannot satisfy this either — today's compatibility check assumes
  every member is already sitting at the identical step (true for "review together",
  false for a mixed-readiness implementation batch).
- Line 171-179: every member must also resolve to the same incoming-transition
  **role** — same homogeneity assumption, one more dimension.

**Fact — the dependency data needed to fix this already exists and requires no new
primitive:** `readiness-policy.mjs:44-54` + `task-projection.mjs` already compute
`projection.blockedBy: string[]` — the exact list of blocking dependency task ids —
whenever a task is blocked. A batch-aware compatibility check can inspect
`blockedBy` per member and classify each blocking id as either a member of the *same*
selected batch (not a hard blocker — determines topological order instead) or outside
it (genuine admission blocker) — exactly the semantic the owner specified. This is new
logic, but it consumes data that is already computed today; it does not require
inventing a new dependency representation.

### NEW — `BatchContext` has no dependency-graph or per-member-step awareness today

Read directly, `tools/specs/context/batch-context.mjs:151-240` (`buildBatchContext`):

- Members are sorted only by `(order asc, id asc)` (`batch-context.mjs:167-172`) — no
  topological/dependency ordering field anywhere in this function.
- `targetStepName` is resolved as **one shared value for the whole batch**
  (`batch-context.mjs:189-194`, taken from the first member's step context or the
  workflow definition's entry step) — there is no per-member target-step field in the
  returned context today.
- `members[].stepContext` is populated per task (`batch-context.mjs:174-185`), so
  per-member data already flows through — but nothing in this function represents
  "member A must finish before member B starts."

**Consequence:** generalizing to an implementation batch requires real, new additions
to `buildBatchContext` (a dependency graph among members, and either a per-member
target step or an explicit note that members may start at different steps) — not
merely a relaxation of `validateBatchCompatibility`'s checks. Both changes are in the
same conceptual place (`tools/specs/context/batch-context.mjs` and
`tools/specs/workflow/queue/reservation.mjs`), not scattered.

### NEW — today's per-member post-batch continuation is a fresh refiner per failed member, not a batch-level handover

Read directly, `tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs:648-689`
(Stage 4, "Per-member continuation dispatch"):

```js
for (const taskId of taskIds) {
  ...
  const dispatchResult = await reconcileContinuation(currentChange, task, {
    ...options, repoRoot, activeDir,
    parentSessionId: effectiveSessionId,
  });
  ...
}
```

Comment at the call site: "A fresh refiner gets `parentSessionId` equal to the batch
reviewer session id (D8, D35)." Today, after a review batch completes, **each member
that needs fixing gets its own, independent single-task refiner session** — N
sessions, not one. This is precisely the model the owner wants replaced: after a batch
completes, derive which members need another phase and admit **one** new batch
execution for that subset (falling back to a single-task-shaped execution only when
exactly one member needs it — see the "single-task as batch-of-one" question below),
not N independent per-member continuations.

### `groupReservations` / batch reservation — call-graph independence, storage coupling, decision grounding (unchanged from first draft)

Call-graph independent of the plain queue (batch-scope admission never calls
`enqueueTasks`/`dequeueTask`/`evaluateTaskQueue`; `admission.mjs`'s only `dequeueTask`
call is gated `capturedScope.kind === 'task'`, never reached for batch scope). Storage
is **not** independent — `reservation.mjs:8` imports `loadTaskQueue`/`saveTaskQueue`
from the same `store.mjs` the plain queue uses, and the same JSON record carries both.

D31/D36 (`specs/archive/multi-task-agent-execution/owner-decisions.md`): this coupling
was a **deliberate** original design choice — reusing the queue's own reservation
record as the canonical barrier state specifically to avoid a third membership copy.
D37: the barrier must block ordinary callers but never the authenticated batch-start's
own bootstrap of its own reserved members (base readiness vs. barrier-aware ordinary
readiness, no `force` escape hatch). D33/D34/D35/D38: batch admission/bootstrap
sequence, context-capacity preflight, Hook1 terminal ordering, frozen
`executionConfigSnapshot` — all already about the batch lifecycle specifically, and
unaffected by removing the plain queue.

**D45** (`specs/archive/deterministic-status-architecture/owner-decisions.md:1916-1945`):
*"A pending human decision does not pause the rest of the spec's sequential queue."*
Still a real, needed requirement — already compatible with the owner's model: a
blocked-on-human member may be skipped while other independent, runnable selected work
continues. Carried forward as a requirement of whatever replaces per-member
eligibility filtering, not superseded.

### ADR coverage (unchanged from first draft)

No ADR under `docs/decisions/` documents the sequential-queue or batch-reservation
architecture. `D33`-`D38` identifiers are **not globally unique** across specs — both
`multi-task-agent-execution` and (unrelated) `deterministic-status-architecture` use
the same numbers; confirmed directly by this investigation hitting false matches.

## Current behavior (narrative)

Two genuinely different batch concepts exist in the code today with the same name.
`ExecutionScope: {kind: 'task-batch', taskIds}` plus `validateBatchCompatibility` plus
`buildBatchContext` plus the reservation/barrier plus `batch-finish-operation` plus
`batch-completion-settlement` together implement **"review together"**: N tasks,
already individually ready, already at the identical step/role, reviewed in one
session. Every homogeneity assumption in `validateBatchCompatibility` and
`buildBatchContext` is correct *for that specific case* and nowhere else. Meanwhile,
ordinary single-task Start/continuation (implementation, and same-task
auto-continuation) is routed through a completely unrelated, generic FIFO queue
(`tools/specs/workflow/queue/{store,evaluator}.mjs`) that was never actually needed for
either case: single-task Start always had exactly one candidate (nothing to schedule
among), and the one path that *can* receive multiple candidates — the queue-wide drain
in `reconcileContinuation` — has no `continuationPolicy` gate and is the mechanism
responsible for the runaway-session incident.

The owner's correction: these should not be two unrelated mechanisms (a real batch
primitive for review, a scheduler-shaped queue for everything else). They should be
**one** mechanism — the existing batch primitive, generalized to also cover
dependency-ordered implementation batches and refinement batches — with ordinary
single-task execution handled as the trivial case of a batch with one member, not as a
separate code path.

## Affected areas

- `tools/specs/workflow/queue/reservation.mjs` — `validateBatchCompatibility` gains
  dependency-aware compatibility (inside-batch dependency ≠ blocker; outside-batch
  unsatisfied dependency = blocker) and drops the same-target-step/same-role
  requirement for implementation-phase batches.
- `tools/specs/context/batch-context.mjs` — `buildBatchContext` gains a dependency
  graph among members and per-member target-step awareness (no longer one shared
  `targetStepName` for every member).
- `tools/specs/workflow/batch-finish/` (`operation.mjs`, `preflight.mjs`) — becomes the
  one finalization boundary for every batch phase, not just review: prevalidate the
  whole batch, check each member's own result/gate/scope/source-control, then
  idempotently apply every member's own workflow transition plus one shared
  finalize/commit/push. (Per the existing area docs, `batch-finish-operation` already
  "applies each task's own existing single-task finish identity" per member inside one
  public operation — this part of the design is already close to right; what changes
  is which phases route through it.)
- `tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs` — Stage 4's
  per-member `reconcileContinuation` loop (fresh refiner per failed member) replaced by
  one batch-level handover: derive the subset of members needing another phase, admit
  **one** new batch (or single-member) execution for that subset.
- `tools/specs/workflow/queue/{store,evaluator}.mjs`, and every call site listed above
  — candidates for deletion once single-task execution also routes through the
  generalized batch primitive (see target flows below).
- `tools/dashboard/server/ai/sessions/turns/routes.mjs` — the non-batch branch
  (`:325-412`, `:519-573`) and the batch-review branch (`:122-323`) likely converge
  into one admission path parameterized by member count, rather than two branches.
- `tools/dashboard/ui/screens/specification-detail/specification-overview.tsx` — **in
  scope for this change** (owner's decision, see below): the new batch/dependency
  picker needs canonical dependency-satisfaction data; today's local `isSatisfied`
  (`:98-101`) and `readyTaskIds` fallback (`:52-55`) are a second, inconsistent source
  of truth that would otherwise need fixing twice.

## Constraints

- Workspace-writer claims, the three-outcome settlement model
  (`completed`/`resumable`/`recovery-required`), session fresh/reuse policy, and
  execution policy resolution are explicitly **not** in scope for removal.
- `BatchContext`, the reservation/barrier mechanism, and `batch-finish-operation`'s own
  idempotent per-task-transition-plus-shared-finalize shape are kept and generalized,
  not replaced.
- D45's "pending human decision doesn't block other independent selected work" must
  keep holding once eligibility filtering is reimplemented.

## Inconsistencies

- `evaluator.mjs`/`store.mjs`/`index.mjs` headers describe the queue as "zero
  AI/session/dashboard awareness," yet `reservation.mjs`'s
  `assessBatchReservationSettlement` reaches toward session/operation state via
  `findInFlightStartOperation`/`findInFlightOperationRecord`. Worth naming if/when
  `reservation.mjs` gets a new home as part of this change.
- D-number collisions across specs (`D33`-`D38` reused by unrelated changes) —
  repo-hygiene issue, not blocking, surfaced because it affected this investigation's
  own research.

## Open questions

1. Whether `reconcileContinuation`'s queue-wide drain (no `continuationPolicy` gate)
   has ever actually auto-admitted a task against its own transition's declared
   policy in real usage — structurally possible, not independently observed.
2. For a **review batch** specifically: does generalizing introduce any need for
   dependency-ordering there too, or does review genuinely stay homogeneous
   (same step, no intra-batch dependency ordering, as today)? This report assumes the
   latter (review's existing homogeneity assumption is correct for review, wrong only
   for implementation) but that should be confirmed, not assumed, before implementation.
3. Exact shape of the dependency graph to add to `BatchContext` — a flat
   `dependsOn`-per-member map (mirroring `change.yaml`'s own `depends_on`) is the
   simplest option and requires no new source of truth, but hasn't been reviewed
   against what the agent-facing contract actually needs to execute in order.
4. Full list of `.mjs` test files importing `reservation.mjs` only transitively — not
   individually traced.
5. Whether any `specs/active/**` task (as opposed to archived
   `multi-task-agent-execution`) depends on `groupReservations` — only `.mjs`
   source/test files were searched.

## Proposed architecture (revised per owner's correction — presented for review)

```
Implementation batch:
  user selects T1, T2(depends_on T1), T3(depends_on T1)
    → validateBatchCompatibility (dependency-aware: T2/T3's block-on-T1 is intra-batch, not a blocker)
    → ONE admission, ONE workspace-writer claim, ONE AgentSession, ONE provider turn
    → agent receives BatchContext with dependency graph + per-member step/context
    → agent implements T1, then T2/T3, in dependency order, inside the one session
    → ONE workflow batch finish: prevalidate whole batch, per-member transitions, ONE commit/push
    → batch-level handover: if any member needs review, admit ONE fresh review batch for that subset

Review batch (existing shape, unchanged):
  user selects "review together" → validateBatchCompatibility (homogeneous, as today)
    → ONE admission → ONE session → agent reviews all members → ONE batch finish
    → batch-level handover: members needing refinement become ONE refinement batch
      (not N independent refiner sessions)

Refinement batch:
  same shape as implementation batch, scoped to the subset of members a review batch
  flagged — one session, dependency-ordered if the flagged members depend on each
  other, one batch finish.

Single-task execution:
  the degenerate case of a batch with exactly one member. Open question (below): does
  it reuse the exact same admission/BatchContext/batch-finish path unmodified, or does
  that force an unnatural contract (e.g. a "dependency graph" of one node, a "batch
  finish" of one task) that's simpler to keep as a thin single-task-shaped wrapper
  calling the same underlying primitives? Needs a concrete comparison before deciding,
  not assumed either way here.
```

### Responsibility table (revised columns per owner's request)

| Current responsibility | Needed in one-session batch model? | Target owner | Remove / generalize |
|---|---|---|---|
| Durable `{taskIds, eligibleAt}` FIFO record, `enqueueTasks`/`dequeueTask`/`loadTaskQueue` | No | — | **Remove.** Nothing in the batch model needs a durable multi-task selection queue — the batch's own members are the selection, carried on the reservation/`BatchContext`, not a separate FIFO file. |
| `evaluateTaskQueue`'s cross-task `nextRunnable` selection | No | — | **Remove.** Replaced by dependency-aware batch compatibility + in-session agent-driven ordering, not a server-side "pick next" scheduler. |
| `schedulingPriority` | No | — | **Remove** (schema field, comparator, `deterministic-task-queue.test.mjs`'s AC4) — only ever reachable via the drain path being removed. |
| Same-task `continuation: auto` gate | **Generalize**, not remove — but its *purpose* changes: within a batch, member ordering is the agent's job inside one session, not a continuation between separate admissions. The gate's underlying idea (declarative, transition-level "does the next thing happen automatically") maps onto the **batch-level handover** decision (implementation batch -> review batch, review batch -> refinement batch), not onto per-task continuation. | `batch-completion-settlement.mjs`'s new one-shot handover step | Generalize: one handover decision per batch completion, not N |
| Per-member fresh-refiner dispatch (`batch-completion-settlement.mjs` Stage 4) | No, in its current N-sessions shape | Same file, rewritten | **Remove the per-member loop**, replace with: derive subset needing another phase -> admit one batch (or single-member) execution for that subset |
| `validateBatchCompatibility`'s same-step/same-role/individually-ready requirement | **Generalize** — correct for review, wrong for implementation. Needs an inside-batch-dependency exception. | `reservation.mjs` | Generalize, don't remove |
| `buildBatchContext`'s single shared `targetStepName`, order-only member sort | **Generalize** — add dependency graph, per-member step awareness | `batch-context.mjs` | Generalize, don't remove |
| `batch-finish-operation`'s per-task-transition-plus-shared-finalize shape | Yes, largely as-is — already the right shape (one public boundary, N internal per-task transitions, one commit/push) | Unchanged | Keep; extend to be reachable from every phase, not just review |
| `groupReservations`/barrier (`createGroupReservation`/`releaseGroupReservation`/`isTaskBarriered`/settlement) | Yes, unchanged — real, distinct, D31/D33/D36/D37-grounded requirement | Same module, **re-homed to its own storage** (owner's decision: do this now, no compatibility shim perpetuating the old queue file) | Keep logic, migrate storage |
| `isTaskBarriered` consumers outside the queue (`readiness-policy.mjs`, `cli.mjs`, `human-step/*.mjs`) | Yes, unchanged | Unchanged | None — never depended on `evaluator.mjs` |
| Workspace-writer claims, 3-outcome settlement, session fresh/reuse, execution policy | Yes, unchanged | Unchanged | None |
| UI dependency-satisfaction logic (`specification-overview.tsx`'s local `isSatisfied`/`readyTaskIds`) | No, in its current duplicated form | Canonical batch/dependency projection, consumed by the UI picker | **In scope for this change** (owner's decision) — replace, don't generalize; there is nothing worth keeping in the local heuristic once a canonical projection exists |

## Self-review: any remaining "one task = one session/execution" assumption?

Checked every section above against the rule the owner stated this correction exists
to enforce. Two places still implicitly carry it, flagged rather than silently fixed,
since fixing them is implementation, not discovery:

- The **single-task execution** target flow (above) is explicitly left as an open
  question rather than asserted to "obviously" reuse the batch path — asserting an
  answer here would smuggle a one-task-shaped special case back in without owner
  review, which is exactly the thing being corrected.
- `batch-finish-operation`'s description ("already the right shape... per-task
  finish identity") is a claim about the *existing, review-only* implementation. It
  has not been verified against what happens when batch finish must also run for a
  dependency-ordered implementation batch where members might reach *different*
  per-member outcomes in one finish call (e.g., two implemented cleanly, one needs
  rework) — this needs its own dedicated check before implementation, not assumed
  from the review case alone.

No other section describes or assumes a per-task admission, per-task session, or
per-task continuation as the primary path; every such mechanism found is explicitly
marked for removal or generalization above.

## Owner decisions

Recorded from the owner's direct correction (not re-opened as questions):

1. **Target architecture is generalized `BatchExecution`/`ExecutionScope`, not
   `ExecutionRun`.** One session per batch (implementation/review/refinement); the
   agent executes the whole dependency-ordered group inside that session; handover is
   between phases/roles, never between tasks inside the same batch.
2. **`groupReservations` storage migration happens in this same change**, once the
   generalized design is settled — no compatibility shim that perpetuates the old
   `task-queues` file as a dependency.
3. **UI dependency-satisfaction duplication is in scope for this change** — the new
   batch/dependency picker must consume the canonical projection; the existing local
   heuristic is not worth preserving even temporarily.

Still open (see "Open questions" above): review-batch dependency semantics (#2),
exact `BatchContext` dependency-graph shape (#3), and the single-task-as-batch-of-one
question — these need answers before a concrete implementation plan, not before this
discovery is accepted as the correct direction.
