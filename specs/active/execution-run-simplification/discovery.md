---
id: spec.execution-run-simplification
type: discovery
title: "Simplify sequential task execution: generic durable queue -> ExecutionRun"
status: draft
change: execution-run-simplification
---

# Discovery: replace the generic sequential task queue with `ExecutionRun`

## Scope

Triggered by the runaway-session-creation incident on `ai-spec-history` (fixed in
`81bcfe45`: a never-bootstrapped task's turn failure was misclassified as `completed`,
letting the durable queue auto-readmit it indefinitely). While reviewing the fix, the
owner audited the whole `tools/specs/workflow/queue/**` mechanism directly and
concluded the generic durable sequential queue is bigger than the actual use case
("user selects N tasks, system runs the available ones one at a time, respecting
canonical workflow readiness") — and that this is a cause of the incident class, not
just this one instance. This report is pure discovery: facts about current
responsibilities, call sites, and coupling, so the owner can review a proposed target
architecture and its blast radius before any implementation starts.

Delegated the fact-gathering to two read-only researcher passes (queue call sites +
`schedulingPriority`; and D33-D38 + `groupReservations` coupling) to keep this
synthesis bounded. All citations below are grounded in those passes' verified
file:line evidence, cross-checked against this session's own direct reads of
`admission.mjs` and `execution-settlement.mjs`.

## Repository facts

### The queue directory's actual contents

`tools/specs/workflow/queue/` has exactly 4 files:

- **`store.mjs`** — durable JSON persistence at `.nevo-ai-local/task-queues/<changeSlug>.json`. `loadTaskQueue`/`saveTaskQueue` read/write one record per change: `{changeSlug, taskIds, eligibleAt, groupReservations, metadata, updatedAt}`. `enqueueTasks`/`dequeueTask` mutate `taskIds`/`eligibleAt` only.
- **`evaluator.mjs`** — `evaluateTaskQueue(params)`: for a selection of task ids, filters out barriered/not-ready/non-activation-only-blocked ones, then sorts the rest by `(schedulingPriority asc, task.order asc, eligibleAt asc)` and returns `{eligible, nextRunnable: eligible[0]||null, warnings}`.
- **`reservation.mjs`** — `createGroupReservation`/`releaseGroupReservation`/`validateBatchCompatibility`/`isTaskBarriered`/`getTaskReservation`/`assessBatchReservationSettlement`/`reconcileCrashedReservation`. Imports `loadTaskQueue`/`saveTaskQueue` directly from `./store.mjs` (`reservation.mjs:8`) and mutates `queueRecord.groupReservations` **in the same file and the same top-level record** that `enqueueTasks`/`dequeueTask` mutate.
- **`index.mjs`** — pure re-export barrel for both function sets.

**Fact:** `evaluator.mjs:8` imports `isTaskBarriered` from `./reservation.mjs` and calls it (`evaluator.mjs:123`) to exclude barriered tasks before sorting — the plain queue's own evaluator already depends on the reservation module.

**Fact:** `groupReservations` and the plain queue's `taskIds`/`eligibleAt` are **not separable at the storage layer today**, even though they are separable as exported function sets — they live in one JSON record, written by one `saveTaskQueue`.

### Call sites of the five named functions

| Function | Call site | What triggers it | Scope |
|---|---|---|---|
| `enqueueTasks` | `turns/routes.mjs:369` | manual "Start" (new session), after plan resolution | single task (UI never sends >1 id here) |
| `enqueueTasks` | `turns/routes.mjs:573` | manual "Start" (existing session) | single task |
| `enqueueTasks` | `reconciliation.mjs:102` | same-task auto-continuation, **gated** by `continuationPolicy === 'auto'` | single task |
| `dequeueTask` | `admission.mjs:625` | turn settled `resumable`, scope `kind:'task'` only | single task, cleanup not scheduling |
| `dequeueTask` | `reconciliation.mjs:502` | queue-wide maintenance: purge already-terminal ids | potentially multiple |
| `loadTaskQueue` | `deterministic-execution-plan.mjs:58` | read-only, seeds `eligibleAt` for *this request's own* candidate set only (explicitly not merged with the stored file, `deterministic-execution-plan.mjs:50-56`) | single task (request-scoped) |
| `loadTaskQueue` | `reconciliation.mjs:493,506` | queue-wide drain | multiple |
| `evaluateTaskQueue` | `deterministic-execution-plan.mjs:79-84` | every manual Start/continue-session HTTP call | single task — sort is a structural no-op with 1 candidate |
| `evaluateTaskQueue` | `reconciliation.mjs:105-110` | same-task auto-continuation (gated, see above) | single task |
| `evaluateTaskQueue` | `reconciliation.mjs:519-525` | **queue-wide drain, no `continuationPolicy` gate at all** | `refreshedQueue.taskIds` — whatever is left in the durable file |
| `reconcileContinuation` | `admission.mjs:579,586` (sole call site outside tests) | every turn that settles `outcome:'completed'` | — |

**Fact, directly answering "is single-task Start forced through the queue":** yes. Every
manual Start/continue call — even with exactly one task id — goes through
`loadTaskQueue` → `evaluateTaskQueue` (whose sort comparator has nothing to compare
against) → `enqueueTasks` (persists that one id into the same durable file multi-task
scenarios use) → `admitAgentExecution`. Confirmed at `turns/routes.mjs:325-412` (new
session) and `:519-573` (existing session).

**Fact, on `reconcileContinuation`'s two internal paths:**
1. Single-task path (`reconcileWorkflowPosition`, `reconciliation.mjs:478-483`) —
   gated: `if (continuationPolicy !== 'auto') return { action: 'noop', ... }`
   (`reconciliation.mjs:93-97`). Only proceeds if the *matched workflow transition*
   explicitly declares `continuation: auto` in the workflow YAML.
2. Queue-wide drain path (`reconciliation.mjs:485-590`) — reached only if path 1
   didn't return. **No `continuationPolicy` check anywhere in this path.**
   Unconditionally re-evaluates the entire durable queue file and admits
   `nextRunnable` if it isn't merely activation-only-blocked.

This asymmetry is itself a second, latent bug class beyond the one already fixed: any
task sitting in the durable queue (put there by an ordinary single-task Start) can in
principle be auto-admitted by this path without its own transition ever having
declared `continuation: auto`. This investigation found no evidence it has actually
fired that way in production (no log/test evidence either way) — flagged as an open
question, not an additional confirmed incident.

### `schedulingPriority`

**Fact:** default `0` (`definitions/schema.mjs:681`); only the `review` step sets it to
`10` in all three workflow definition files
(`.nevo-ai/workflows/standard-v1.yaml:41`, `standard.yaml:41`,
`templates/standard.yaml:42`). Comparator: `evaluator.mjs:179-202`, ascending — an
`implementation`-step task on a *different* task id is always preferred over a
`review`-step task when both are simultaneously `eligible`.

**Fact:** this comparison only ever has >1 *distinct* task id with *different* target
steps to compare when `evaluateTaskQueue` is called with a multi-id selection. The only
production call site that can do that is the queue-wide drain
(`reconciliation.mjs:519-525`, `selectedTaskIds: refreshedQueue.taskIds`). Every other
call site is scoped to exactly one task id. The UI never submits >1 task id to this
code path either (`specification-detail-content.tsx:167`; a >1-length `taskIds` array
only ever happens on the separate `reviewTogether`/batch-review branch, which never
touches `evaluateTaskQueue` at all).

**Conclusion of fact:** `schedulingPriority`'s cross-task-ordering semantics are reachable
*only* through the same queue-wide drain path that has no `continuationPolicy` gate — the
one mechanism the owner's target architecture removes entirely. No other call site can
ever exercise it. This directly evidences (not merely assumes) the owner's suspicion
that this semantic was never required by any real, currently-supported user flow.

### `groupReservations` / batch reservation vs. the plain queue

**Fact (storage coupling):** as above — same file, same record, same
`loadTaskQueue`/`saveTaskQueue` functions.

**Fact (call-graph independence):** batch-scope admission never calls
`enqueueTasks`/`dequeueTask`/`evaluateTaskQueue` as a batch unit. The batch-review HTTP
branch (`turns/routes.mjs:122-323`) calls `validateBatchCompatibility` →
`createGroupReservation` → `admitAgentExecution` directly (`routes.mjs:134,259,269-294`)
— the plain-queue functions are never invoked in that branch. Conversely, the
single-task branch never calls `validateBatchCompatibility`/`createGroupReservation`.
`admission.mjs`'s only `dequeueTask` call is explicitly gated
`capturedScope.kind === 'task'` (`admission.mjs:622`) — never reached for batch scope.

**Fact (per-member continuation after batch completion):**
`batch-completion-settlement.mjs`'s `executeBatchCompletionSettlement` releases the
batch's own barrier/reservation/claim first, then calls plain, single-task
`reconcileContinuation(change, task, {...})` **once per freed member** — i.e., batch
completion re-enters the *ordinary single-task* continuation path per member, after
the batch mechanism's own job is done. It imports `getGroupReservation`/
`releaseGroupReservation` directly from `reservation.mjs`, never via `index.mjs` or any
plain-queue function.

**Fact (decision grounding — `specs/archive/multi-task-agent-execution/owner-decisions.md`):**
D31 — barrier must be a provider-neutral workflow-core primitive "reusing the existing
durable queue reservation itself... as the canonical barrier state (per D36, avoiding a
third membership copy)" — i.e., the original design **deliberately** layered the
reservation on top of the plain queue's own storage, specifically to avoid a third
copy of task-membership truth. D36 — "no duplicated canonical batch membership across
barrier/reservation records": the reservation is the canonical queue/barrier answer,
`AgentSession.executionScope.taskIds` is the canonical ownership answer — "two records
with different jobs, not three copies of the same fact." D37 — the barrier must block
ordinary callers but never the authenticated batch-start's own bootstrap of its own
reserved members (base readiness vs. barrier-aware ordinary readiness, split by design,
no `force`/`ignoreBarrier` escape hatch). D33/D34/D35/D38 cover the batch
admission/bootstrap sequence, context-capacity preflight, Hook1 terminal ordering, and
the frozen `executionConfigSnapshot` — all specifically about the *batch* admission/
completion lifecycle, independent of the plain queue's own scheduling concerns.

**Consequence for migration:** the reservation/barrier mechanism's *call graph* is
already independent and should be kept exactly as designed (D31/D33/D36/D37's own
rationale is sound and unaffected by removing the plain queue). Its *storage* is not
independent today — re-homing it to its own file is real, scoped migration work, not a
no-op.

### ADR coverage

**Fact:** no ADR under `docs/decisions/` documents the sequential-queue or
batch-reservation architecture — zero matches for `batch-queue-reservation`,
`groupReservations`, `batchExecutionId`, or `multi-task-agent-execution`.
`ADR-0009-agent-admission-and-execution-ownership-model.md` (from
`deterministic-execution-follow-up-hardening`) mentions `evaluateTaskQueue` exactly
once, in a code-location map, in a document otherwise entirely about single-task
admission/ownership/settlement — it does not document the queue itself and does not
need superseding for this change.

**Inconsistency found:** `D33`-`D38` are **not globally unique** — both
`multi-task-agent-execution/owner-decisions.md` and
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (sourced from a
different, unnamed sibling change referenced in `batch-finish-operation.md:36` as
"`deterministic-status-architecture`") use the same D-numbers for unrelated decisions.
Anyone grepping ADRs for "D33"-"D38" without change-scoping will get false matches —
confirmed directly in this investigation.

**D45** (`specs/archive/deterministic-status-architecture/owner-decisions.md:1916-1945`,
found and read after the two research passes, since `evaluator.mjs`'s own header cites
it alongside D32-D34/D38): *"A pending human decision does not pause the rest of the
spec's sequential queue."* A human-owned step awaiting a decision never occupies the
spec's single-agent-execution slot — other **agent-owned** work among the same
selection may continue, one at a time; several pending human decisions may accumulate
across different tasks simultaneously, each surfaced independently.

**This is a real, still-needed requirement, and it is already compatible with the
owner's proposed model below** — "a blocked or human-waiting task may be skipped, a
different independent runnable selected task may run instead" is exactly D45's
behavior, stated independently by the owner before this decision was even looked up.
No re-scoping needed: whatever resolver replaces `evaluateTaskQueue`'s eligibility
filtering must keep excluding only the *blocked* task, never the rest of
`selectedTaskIds`, on the same basis D45 already established. Not a gap — carried
forward as a stated requirement of the new resolver, not the old queue.

## Current behavior (narrative)

A manual "Start" for one task, and a same-task auto-continuation after a settled turn,
both get routed through the exact same machinery built for genuinely ambiguous
multi-candidate scheduling: load a durable per-change JSON file, run a filter+sort
pipeline whose sort key (`schedulingPriority`) can only ever matter when ≥2 distinct
task ids with different target steps are being compared, and persist the single
resolved id into that file before admission. The one path that *can* actually receive
multiple distinct ids — `reconcileContinuation`'s queue-wide drain, reached whenever a
turn settles `completed` and no single-task continuation applied — has no check on the
destination transition's own declared `continuation` policy, unlike the single-task
path which does. This is the exact mechanism that, combined with the (now-fixed)
settlement-misclassification bug, produced the runaway session-creation incident: once
a task is misclassified as "completed" with nothing to resume, this path treats
whatever remains in the durable queue as fair game to auto-admit, repeatedly, with no
cap.

Batch review (atomic multi-task takeover for one review execution) is architecturally
independent of all of this in its call graph — it has its own reservation/barrier
module and its own completion saga — but shares physical storage with the plain queue
today, because the original design deliberately reused the queue's own record as the
canonical reservation-membership source (D31/D36) rather than inventing a third
membership copy.

## Affected areas

- `tools/specs/workflow/queue/` (`store.mjs`, `evaluator.mjs` removed/replaced;
  `reservation.mjs` re-homed to its own storage; `index.mjs` re-export surface changes)
- `tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs` (drops its
  `loadTaskQueue`/`evaluateTaskQueue` dependency for single-task resolution)
- `tools/dashboard/server/ai/orchestration/reconciliation.mjs` (`reconcileWorkflowPosition`
  kept, re-targeted to call the new `ExecutionRun` resolver instead of
  `enqueueTasks`/`evaluateTaskQueue`; the queue-wide drain section deleted outright)
- `tools/dashboard/server/ai/orchestration/admission.mjs` (`dequeueTask` call site
  removed; batch-scope branches unaffected)
- `tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs` (its
  per-member `reconcileContinuation` call needs to target whatever primitive replaces
  same-task continuation — a direct swap, not new design)
- `tools/specs/workflow/readiness-policy.mjs`, `cli.mjs`, `human-step/projection.mjs`,
  `human-step/operations.mjs` (all import `isTaskBarriered` directly from
  `queue/reservation.mjs` — **unaffected** by removing `evaluator.mjs`, since they don't
  depend on it)
- `tools/dashboard/ui/screens/specification-detail/specification-overview.tsx`
  (separately-confirmed duplicated dependency-satisfaction logic — see Owner's own
  finding, not re-litigated here; same area, different concern)
- Tests: `tools/tests/deterministic-task-queue.test.mjs` (directly tests
  `schedulingPriority` ordering — would need rewriting or deletion), plus every test
  file listed under "blast radius" below

## Constraints

- Workspace-writer claims, admission's three-outcome settlement model
  (`completed`/`resumable`/`recovery-required`, D1-D4/D59/D60), session fresh/reuse
  policy, and execution policy resolution are explicitly **not** in scope for removal —
  confirmed sound, independent invariants.
- The barrier/reservation mechanism's own call-graph independence and design rationale
  (D31/D33/D36/D37) are sound and should be preserved as-is; only its storage coupling
  to the plain queue changes.
- `batch-completion-settlement.mjs` must keep working during any migration — it calls
  `reconcileContinuation` per freed member today.

## Open questions

1. Whether `reconcileContinuation`'s queue-wide drain path (no `continuationPolicy`
   gate) has ever actually auto-admitted a task against its transition's own declared
   policy in real usage — structurally possible per the code, not independently
   observed.
2. Full list of `.mjs` test files that import `reservation.mjs` only transitively
   (via `queue/index.mjs` or fixtures) rather than directly — not individually
   traced in this pass; needed for a complete blast-radius list before implementation.
3. Whether any `specs/active/**` task (as opposed to the archived
   `multi-task-agent-execution`) currently depends on `groupReservations` — only
   `.mjs` source/test files were searched, not other active spec markdown.

## Proposed architecture (per owner's brief — presented for review, not yet approved)

```
Ordinary flow:
  user Start → ExecutionRun → canonical readiness → admission → workflow transition → advance run

Batch review flow (unchanged, kept separate):
  Review together → BatchReservation → batch execution → batch finish → release reservation
```

`ExecutionRun { id, specId/changeSlug, selectedTaskIds, state }` — persists only the
user's selection intent. Task state is never copied onto the run; it is always
recomputed live from canonical `TaskProjection`/`ExecutionReadiness`. Advancement
happens only after an authoritative, persisted workflow transition — never merely
because a provider turn reached a terminal event. Any provider error, quota, timeout,
or crash without a genuine workflow advancement pauses the run; there is no automatic
retry or re-admission of the same task (this is the existing `resumable` outcome's own
contract, D2: "a resumable attempt requires its own fresh explicit admission to
resume" — the run model just stops relying on a queue to (mis)decide this). The next
task is picked from `selectedTaskIds` by canonical readiness plus stable `task.order`
(no FIFO `eligibleAt`, no `schedulingPriority` — see evidence above that nothing
currently reachable needs them). Same-task `continuation: auto` stays a declarative
workflow property, resolved and admitted directly by the orchestrator, without
requiring durable queue membership.

### Responsibility table

| Current responsibility | Still needed? | Target owner | Removable? | Migration impact |
|---|---|---|---|---|
| Durable `{taskIds, eligibleAt}` FIFO record | No — `eligibleAt`/FIFO ordering has no remaining caller once the queue-wide drain is gone | `ExecutionRun.selectedTaskIds` (plain field, no timestamps) | Yes, in full | Low — only 3 call sites (`routes.mjs:369,573`; `reconciliation.mjs:102`), all already single-task |
| `evaluateTaskQueue`'s readiness/barrier filtering for one candidate | Yes, in spirit, but not as a "queue evaluator" — it's just "is this one task ready" | Direct call to `evaluateExecutionReadiness` (+ `isTaskBarriered`) from the `ExecutionRun` resolver | Yes (the wrapper), No (the underlying readiness check) | Low — same readiness function already exists and is already called today; only the queue-shaped wrapper around it goes away |
| `schedulingPriority` cross-task tie-break | No — only reachable via the queue-wide drain path being removed; no other caller exists (evidenced above) | — | Yes, in full | Delete `evaluator.mjs`'s sort comparator and the `schedulingPriority` schema field; rewrite/delete `tools/tests/deterministic-task-queue.test.mjs`'s AC4 |
| Single-task Start forced through enqueue+evaluate+persist | No | `ExecutionRun` resolves + admits directly | Yes, in full | Medium — touches both HTTP routes (`routes.mjs:325-412`, `:519-573`) and `deterministic-execution-plan.mjs` |
| Same-task auto-continuation (`continuationPolicy==='auto'` gate) | Yes — this is the correct, already-safe invariant | `reconcileWorkflowPosition`, kept, re-targeted to admit directly instead of via `enqueueTasks`+`evaluateTaskQueue` | No (the gate), Yes (its queue plumbing) | Low — logic already isolated in one function |
| Queue-wide durable drain, no continuation-policy gate | No — this is the mechanism responsible for the incident class | — | Yes, in full | High — `reconciliation.mjs:485-590` deleted outright; `batch-completion-settlement.mjs`'s per-member continuation call must be repointed at the new direct-admit primitive (clean swap, same call shape) |
| `groupReservations`/barrier (`createGroupReservation`/`releaseGroupReservation`/`isTaskBarriered`/`validateBatchCompatibility`/settlement) | Yes, unchanged — real, distinct requirement (D31/D33/D36/D37) | Same module (`reservation.mjs`), re-homed to its own storage file | No (logic), partial (storage) | Real migration work: new storage file/shape independent of `task-queues/<change>.json`; `store.mjs`'s `loadTaskQueue`/`saveTaskQueue` either drop the `groupReservations` field or get replaced for this module specifically |
| `isTaskBarriered` consumers outside the queue (`readiness-policy.mjs`, `cli.mjs`×2, `human-step/*.mjs`×2) | Yes, unchanged | Unchanged | No | None — these never depended on `evaluator.mjs` |
| Batch-scope admission/settlement (`admission.mjs`'s `task-batch` branch, `batch-completion-settlement.mjs`) | Yes, unchanged | Unchanged | No | Low — already independent of the plain queue call graph; only the per-member continuation call target changes |

## Inconsistencies

- `evaluator.mjs:1-5` and `store.mjs`/`index.mjs` headers describe the queue module as
  "Zero AI/session/dashboard awareness," yet `reservation.mjs`'s
  `assessBatchReservationSettlement` reaches toward session/operation state via
  `findInFlightStartOperation`/`findInFlightOperationRecord` (`reservation.mjs:12-13`)
  — it avoids importing dashboard code directly but is not fully "zero awareness" in
  spirit. Not blocking, but worth naming if `reservation.mjs` gets a new home.
- D-number collisions across specs (noted above under ADR coverage) — a
  repo-hygiene issue independent of this change, surfaced here because it directly
  affected this discovery's own research (false ADR-0006 matches).

## Owner decisions required

1. **Confirm the target architecture above** (`ExecutionRun` + unchanged batch
   reservation flow, with D45's multi-task/pending-human behavior carried forward as
   stated) as the direction to spec and implement — or redirect.
2. **`groupReservations` storage migration**: do it in the same change as the queue
   removal, or as a separate, later follow-up? (The reservation logic itself doesn't
   need to move for the queue removal to work — `reservation.mjs` would simply keep
   importing `loadTaskQueue`/`saveTaskQueue` from whatever replaces `store.mjs`, or a
   thin compatibility shim, until a dedicated follow-up re-homes it. Not doing it now
   shrinks this change's blast radius; doing it now avoids a second migration later.)
3. **Scope of this change vs. the separately-confirmed UI dependency-satisfaction
   duplication** (`specification-overview.tsx`'s local `isSatisfied` and
   `readyTaskIds` fallback logic) — same architecture area, different concern. Fix it
   as part of this change's `ExecutionRun`/canonical-readiness work, or as an
   independent, smaller follow-up?
