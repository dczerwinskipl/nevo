# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) as a **release epoch that
remains valid until an explicit, declarative invalidation transition fires** (D40). A release
means a downstream task may **enter the sequential queue's runnable set** (D33) — never that
it starts concurrently with the releasing task's own continued execution. When a release is
explicitly invalidated, this area derives the automatic remediation group using durable,
step-scoped, authoritative-record dependency-consumption provenance (D48/D52/D53/D58) —
never guessed from `workflow_progress` state or timestamps — **including consumers that have
already reached a terminal transition** (D31). Group membership persists durably (D36). This
area also owns `SuspensionProjection` (D44), kept strictly separate from the pure
`TaskProjection` (D10). It also owns two distinct correctness primitives, never conflated
(D55): the shared, cross-process **git-finalize lease** (D47/D50/D51) around the narrow
mutate-then-commit critical section, and the new, durable **workspace-writer slot** (D55/D56)
— at most one workspace-writing operation (an active agent execution, `activateAndSubmitHumanStep`,
Publish, Batch Publish) holding the shared worktree at a time, distinct from and outer to the
git-finalize lease. The cross-task-aware review of a remediation group's fix is a separate area
(`areas/dependency-invalidation-remediation-review.md`).

## Current state (grounded, 2026-09-22)

`evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) reads only `history.at(-1)`.
`projectTask()` (`task-projection.mjs`) takes only in-memory `(task, change, options)` and
does no file I/O — confirmed pure, must stay that way. `finishStep`'s own `FINISH_STAGE_IDS`
order is `verify-gates, update-task, commit, push, transition` — `ensureUpdateTask` (the
tracked mutation) runs *before* `ensureCommit` (the commit stage), confirmed by reading
`finish-operation.mjs` directly — any lock protecting the mutate-then-commit window must
start before `ensureUpdateTask`, not merely around `ensureCommit`. No dependency-consumption
provenance, no release-epoch concept, no start-operation concept, and no cross-process lock
of any kind exists yet. `blockedBy` is a plain `string[]` of task ids, read directly by three
UI call sites — must not be overloaded.

## Requirements

### Release and invalidation (D40)

`evaluateDependencySatisfaction`'s release path scans the **full**
`workflow_progress.history` for the latest entry whose matched transition declares
`releasesDependencies: true` (its `{step, attempt}` is the release epoch), then checks
whether any **later** entry's matched transition declares `invalidatesDependencyRelease:
true`. No later invalidation → still released, regardless of intervening non-invalidating
transitions. No wording or logic anywhere references a transition going "backward" or to an
"earlier step."

### Git-finalize lease — correct boundary, lease-passing, stale recovery (D50/D51)

- **`tools/specs/workflow/git-finalize-lock.mjs`** exports `acquireGitFinalizeLease()` and
  `withGitFinalizeLock(fn, existingLease?)`. A lease file at
  `.nevo-ai-local/locks/git-finalize.lock` holds `{ownerId, pid, createdAt}`.
- **Acquisition:** exclusive file creation. On `EEXIST`: check `process.kill(existingLease.pid,
  0)` — if the pid is confirmed dead (`ESRCH`), the lease is stale; delete and retry
  immediately. If the pid is alive (or the probe is inconclusive), retry with backoff up to a
  bounded overall timeout, then fail with a clear error naming the lock file and the current
  holder's pid — never hang indefinitely, never steal a live lease.
- **Release** verifies `ownerId` matches before deleting; a mismatch (already reclaimed by
  someone else) skips deletion rather than removing a lease this caller no longer owns.
- **Lease-passing, never implicit reentrancy.** `withGitFinalizeLock(fn)` (no lease argument)
  acquires fresh and releases in `finally` — this is `finishStep`'s own normal path and
  `publishTask`'s own path. `withGitFinalizeLock(fn, existingLease)` runs `fn(existingLease)`
  directly with **no** new acquisition and **no** release — the original acquirer remains
  solely responsible. A caller must explicitly know it already holds the lease; there is no
  automatic reentrancy detection.
- **Lock boundary is the first tracked mutation through the commit, never narrower.** This
  area inserts `finishStep`'s own acquisition **before** `ensureUpdateTask` and release
  **after** `ensureCommit` (`finally`) — `push`/`transition` run outside the lease (they
  don't mutate local tracked files a concurrent commit could sweep in).
- **`finishStep` accepts an optional `finalizeLease`** (threaded through its existing
  `context`), used as `existingLease` when present; when absent, `finishStep` acquires its
  own, unchanged from a normal CLI-driven `workflow step finish`.
- Cross-process by construction (PID-liveness works identically whether the two contenders
  are a CLI subprocess and the dashboard server, or two of either kind) — no in-process
  mutex, since an agent's `workflow step finish` runs in its own OS process.

### Workspace-writer slot — a third primitive, never conflated with admission or the git-finalize lease (D55/D56, identity and release corrected D59–D62/D65)

- **Three distinct roles.** Agent-admission lock (D41/D49, owned by task 29): in-process,
  dashboard-only, prevents two agent executions being *created* concurrently for one spec.
  **Workspace-writer slot (new, this area):** for one **physical worktree** (D65, corrected
  from "one specification" — this checkout routinely hosts many active specs at once, and all
  of them share the one real worktree the slot exists to protect), at most one
  workspace-writing operation holds it at a time — an active agent execution (from admission
  until its execution is proven *settled*, D59), a direct/manual CLI execution (`kind:
  'cli-manual'`, D62), `activateAndSubmitHumanStep`, Publish, Batch Publish. A *pending* (not
  yet submitted) human interaction is never a workspace writer (D45 unchanged). Git-finalize
  lease (D47/D50/D51): nested *inside* whichever operation holds the workspace-writer slot,
  around the mutate-then-commit instant specifically.
- **`tools/specs/workflow/workspace-writer.mjs` (new).** Durable record at
  `.nevo-ai-local/locks/workspace-writer.lock` — **one single, well-known file per checkout,
  never keyed by `specId`** (D65), mirroring `git-finalize-lock.mjs`'s own sibling file
  (`.nevo-ai-local/locks/git-finalize.lock`) in the same directory:
  `{ownerId, kind: 'agent'|'cli-manual'|'human-submit'|'publish'|'batch-publish', status:
  'active'|'recovery-required', specId, taskId?, sessionId?, turnId?, pid?, createdAt}`.
  `specId`/`taskId`/`sessionId`/`turnId` identify *who* holds the claim for attribution and
  caller-side reconciliation — they are never part of the file path, so a claim for one spec
  now correctly contends against an operation on a *different* spec sharing the same
  checkout. Atomic acquisition (exclusive create); release verifies `ownerId` first. A record
  whose `status` is `recovery-required` is an unconditional block on acquisition — a plain
  field check, never treated as ordinary live contention, never auto-reclaimed by any kind's
  staleness check. Also maintains an in-process (dashboard-only) record of currently-waiting
  acquisition attempts, tagged by `kind`, so a caller can ask "is any non-agent acquisition
  already pending" (D57) and can distinguish `waiting-for-workspace` from `blocked-by-recovery`
  (D67).
- **Release requires proven settlement, never merely turn-terminal (D59/D60/D61).** An
  `agent`- or `cli-manual`-kind claim moves through four states — `active` →
  `terminal-unsettled` → (`settled` → released) or → `recovery-required` (retained, blocking).
  Reaching AI/session turn-terminal (or CLI process exit) only triggers an *attempt* at
  settlement via `assessExecutionSettlement` (`tools/specs/workflow/execution-settlement.mjs`,
  new file, this area) — checking, from already-existing primitives only: no in-flight
  start-operation (D52) or finish-operation (D50) record remains for the task; the task's
  `workflow_progress` position for that attempt is not `active`; no dirty tracked change
  remains within the execution's own owned scope (`resolveTaskScope`/`resolveWorkflowOwnedPaths`,
  inverted from their existing `OUT_OF_SCOPE_WORKTREE_CHANGES` use). All four hold → settled →
  release via `forceReleaseWorkspaceWriter` (its only legitimate caller for an
  ambiguous/orphaned claim). Any fail → `markWorkspaceWriterRecoveryRequired` (new export) —
  the claim is retained, not deleted; no auto-clean/stash/discard of any file is ever
  performed. `kind !== 'agent', 'cli-manual'` (human-submit/publish/batch-publish): unchanged
  from D56 — liveness is a `pid` check against the *current* process's own `process.pid`; any
  claim whose recorded pid doesn't match the current process at boot-time reconciliation is
  unconditionally stale (single-server architecture; no clustering) and is cleared — these
  kinds never leave dangling tracked mutation across a process boundary the way `agent`/
  `cli-manual` can, so no settlement check is needed for them. Failed admission/session
  creation releases the workspace-writer claim in the same rollback path that already clears
  the admission "occupied" marker (D41/D49/D66).
- **`cli-manual` kind — every deterministic CLI entry point participates too (D62).**
  `cli.mjs`'s `handleWorkflowStepStart`/`handleWorkflowStepFinish` (task 27, already an
  allowed path) wrap `compileStepContext`'s own mutation (`ensureStepActivated`) in the same
  protocol: reuse an already-covering `agent`-kind claim when this CLI invocation is itself
  one of that execution's own tool-call subprocesses; otherwise acquire/release a `cli-manual`
  claim for the attempt's own duration, releasing it synchronously and in-process the moment
  `finishStep` returns successfully. A `cli-manual` claim abandoned by a crashed CLI process is
  reconciled lazily — attempted by the same `cli.mjs` wrapper the next time any caller tries
  to acquire the slot and finds it, via `assessExecutionSettlement`, exactly as Hooks 1/3
  reconcile an `agent`-kind claim.
- **Priority: pending user mutations before the next automatic agent item (D57).** Before
  dispatching the sequential queue's `nextRunnable` item through `admitAgentExecution`,
  `automatic-workflow-continuation` (task 29) checks whether a non-agent acquisition is
  already waiting for the workspace-writer slot; if so, it defers — the already-queued
  waiter resolves next via the slot's own FIFO wait order once the current holder releases.
  This area exposes the queryable pending-waiters view task 29 checks; it does not itself
  decide dispatch order.
- **Canonical lock ordering (D66).** Admission mutex (agent-only) always acquired before the
  workspace-writer claim, never the reverse, and no other kind ever touches the admission
  mutex at all — see `areas/workflow-continuation-and-session-handover.md` for the full
  ordering and rollback rule this area's primitives must support.

### Dependency-consumption provenance — declarative trigger, durable start-operation, step-scoped identity, sequence-based authoritative matching (D52/D53/D58)

- **Declarative trigger, not "first-ever activation" (D53).** A step-level schema field,
  `consumesDependencies: true` (task 25 owns the schema; this area only reads it), marks
  which steps snapshot/consume dependencies. `standard-v1.yaml`'s `implementation` declares
  it; `review`/`human-verification` do not. Recording triggers on **every** activation of a
  declared step, any attempt number — never a literal step-name check, never gated on the
  task's own history/attempt-count.
- **Durable start-operation, distinct from finish-operation records (D52), sequence
  allocated up front (D58).** A new record family,
  `.nevo-ai-local/workflow-start-operations/<change>/<task>/<step>/attempt-<n>.json` (own
  module, reusing the atomic-write/intent-then-verify *pattern* `operation-record.mjs`
  established, not its literal file family): (1) plan — resolve dependency satisfaction,
  freeze the release-based dependencies into a `dependencySnapshot`, **allocate
  `consumptionSequence` as one more than the current maximum found across all of this task's
  own durable start-operation and consumption records** (D58 — never a literal step-name
  check, never an in-memory counter), persist `status: 'running'` with `consumptionSequence`
  and per-stage markers; (2) activate — call `ensureStepActivated`, mark `activate:
  completed`; (3) record — call `recordDependencyConsumption` from the **frozen** snapshot and
  the **already-allocated** `consumptionSequence` (neither re-resolved nor re-allocated), mark
  `record-consumption: completed` and overall `status: 'completed'`. On resume: read the
  in-flight record, continue from whichever stage is still pending, reusing its frozen
  snapshot and sequence verbatim; on a live-state mismatch, fail closed with a clear
  reconciliation error, never guess. Safe under concurrency by construction: this plan step
  only ever runs while this task's own step activation is proceeding, which — because only
  one agent execution can be active per spec (D33) and that execution holds the
  workspace-writer slot for its whole duration (D55) — never overlaps another
  workspace-writing operation for the same spec, so the scan-then-allocate step has no
  concurrent writer to race.
- **Step-scoped record identity (D53).** Consumption records live at
  `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json` — shape:
  `{consumingTaskId, consumingStep, consumingAttempt, consumptionSequence, dependencies:
  [{taskId, releaseEpoch: {step, attempt}}]}`, one atomic write per attempt covering every
  release-based dependency it relies on.
- **Authoritative-record matching is sequence-based, not step/attempt/history-based (D58,
  corrected from D54).** For a given `(consumingTask, dependencyTaskId)` pair, the
  **authoritative** record is the one with the highest `consumptionSequence` among **all** of
  that task's records (across any consuming step) naming that dependency — never inferred
  from step names, lexical step order, `consumingAttempt` alone, or
  `workflow_progress.history` position (the currently-activating step's own entry is not yet
  present in *completion* history at the moment it would need to be compared). `findConsumersOfEpoch`
  matches only against each candidate's authoritative record by this rule — a task whose
  authoritative record already names a different, still-valid epoch is not a match, even if
  an older, superseded record of its own once named the now-invalidated one. This resolves
  correctly even when step A's attempt 2 and step B's attempt 1 both declare
  `consumesDependencies` and their attempt numbers carry no chronological relationship to
  each other — only `consumptionSequence` does.

### Remediation-group derivation and suspensions

When a release epoch is invalidated, the remediation group is: the releasing task, plus every
task whose **authoritative** (highest-`consumptionSequence`, D58) consumption record names
that exact epoch —
**regardless of that consumer's current state** (`active`, `waiting`, `completed`, or already
`terminal`). A terminal consumer is never reopened or reverted — flagged via `suspensions:
[{taskId, reason: 'dependency-invalidated', groupId}]` (additive, never merged into
`blockedBy`, D37) as advisory only. Durable, extensible remediation record at
`.nevo-ai-local/remediation-groups/<change>/<remediationId>.json` (D36) — only
`areas/dependency-invalidation-remediation-review.md` extends `discoveredMembers`.

### `SuspensionProjection` (D44)

A new function, `projectSuspensions(task, change)`
(`tools/specs/workflow/suspension-projection.mjs`), reads the remediation-group and
consumption records and returns a task's `suspensions`. `projectTask()` itself is **not
modified**. `ExecutionReadiness` (`readiness-policy.mjs`) composes `TaskProjection` +
`SuspensionProjection` and refuses readiness for a suspended task.

## Constraints

- No destructive rollback of a downstream task's already-completed work, and no reopening of
  a terminal task's workflow.
- `releasesDependencies`/`invalidatesDependencyRelease`/`consumesDependencies` are additive,
  optional schema fields owned by task 25; this area only reads them.
- `blockedBy`'s shape and meaning are never changed by this area.
- `projectTask()`/`task-projection.mjs` gain no new parameters, fields, or file I/O.
- Remediation-group membership is never inferred from current task state, timestamps, or any
  non-authoritative (superseded, by `consumptionSequence`) consumption record.
- No recursive acquisition of the git-finalize lease anywhere — every combined operation that
  needs one continuous critical section spanning multiple calls acquires exactly one lease
  and threads it through explicitly.
- The agent-admission lock, the workspace-writer slot, and the git-finalize lease are three
  distinct primitives with three distinct roles (D55) — no artifact describes one as a
  synonym or substitute for another.
- `consumptionSequence` is never allocated from an in-memory counter — always derived from
  and frozen into the durable start-operation record before activation (D58).
- A workspace-writer claim's release is never triggered by AI/session turn-terminal alone —
  always gated on a proven-settled result from `assessExecutionSettlement` (D59/D60); no file
  in this area calls `forceReleaseWorkspaceWriter` from a terminal/orphan-detection hook
  directly, only after that settlement check.
- No auto-clean, auto-stash, or auto-discard of any tracked or untracked file, ever, as part
  of workspace-writer reconciliation (D61).

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s epoch-aware release logic;
`acquireGitFinalizeLease`/`withGitFinalizeLock`; `workspace-writer.mjs`'s acquire/release/
mark-recovery-required/pending-waiters primitives; `execution-settlement.mjs`'s
`assessExecutionSettlement`; the start-operation module (D52, including `consumptionSequence`
allocation); `dependency-consumption.mjs`'s step-scoped write/read primitives and
sequence-based authoritative-record resolution; the remediation-group derivation function and
its durable record primitives; `projectSuspensions(task, change)`; `cli.mjs`'s
`handleWorkflowStepStart`/`handleWorkflowStepFinish` `cli-manual`-kind workspace-writer wrapping.

Consumed by: `tools/specs/workflow/cli.mjs` (the D52 start-operation flow for a
`consumesDependencies` step, and its own `cli-manual` workspace-writer wrapping around
`handleWorkflowStepStart`/`handleWorkflowStepFinish`, both owned by this area/task 27;
`handleWorkflowVerifyHuman`'s delegation to `activateAndSubmitHumanStep` is owned by task 29,
D63, a distinct function in the same file), `finish-operation.mjs` (acquires/accepts the
git-finalize lease), `automatic-workflow-continuation` (task 29 — reads release/invalidation
state; claims the workspace-writer slot for agent admission and for
`activateAndSubmitHumanStep`; threads one acquired git-finalize lease through
`activateAndSubmitHumanStep`; checks the pending-waiters view before dispatching the next
automatic agent item; imports `assessExecutionSettlement` for Hooks 1/3), `publish/operation.mjs`
(task 31 — `publishTask()` itself claims the workspace-writer slot and acquires its own
git-finalize lease, D64), `readiness-policy.mjs`, `areas/deterministic-sequential-queue.md`,
`areas/dependency-invalidation-remediation-review.md`.

## Area-specific acceptance criteria

- A dependency released at `implementation → review` remains released after the further,
  non-invalidating `review → human-verification` transition.
- A dependency released, then invalidated, no longer satisfies dependents via the release
  path.
- **Lease correctness:** `finishStep` acquires the lease before `ensureUpdateTask` runs
  (proven by a test that holds the lease externally and asserts the mutation itself waits,
  not only the commit). A combined caller that already holds a lease and passes it to
  `finishStep` never triggers a second acquisition (proven by asserting exactly one
  acquire/release pair for the whole combined sequence). Two concurrent independent callers
  (no shared lease) serialize correctly — the second's critical section begins only after the
  first's release.
- **Stale-lease recovery:** a lease file left behind by a process whose pid is confirmed dead
  is reclaimed by a new acquirer without manual intervention; a lease held by a live process
  is never stolen — a competing acquirer retries and eventually times out with a clear error
  if the holder never releases.
- **Start-operation durability:** a crash simulated between `ensureStepActivated` succeeding
  and the consumption write completing is fully recovered on the next `workflow step start`
  for that task/step — the consumption record is completed from the *original* frozen
  snapshot, not a newly-resolved one, even if upstream release/invalidation state changed in
  between.
- A task can record dependency consumption again on a later, declared-step attempt (rework) —
  proven for a fixture where attempt 1 consumes epoch #1 and, after invalidation and a fix,
  attempt 2 consumes a fresh epoch #2 of the same dependency.
- Invalidating epoch #2 (the task's authoritative record) finds this consumer; invalidating
  the earlier, superseded epoch #1 does **not** — proven directly against
  `findConsumersOfEpoch`.
- Two distinct declared-consuming steps with attempt numbers that do **not** reflect
  chronology (e.g. step A's attempt 2 happened after step B's attempt 1) are ordered
  correctly by `consumptionSequence`, not attempt number — proven directly.
- A start-operation retry (simulated crash-then-resume) preserves the **original**
  `consumptionSequence` — never allocates a new, higher one for the same logical activation.
- Two distinct declared-consuming-step attempts never collide on record path — proven by
  asserting both records persist independently.
- A newly-authored, arbitrarily-named step declaring `consumesDependencies: true` triggers
  the same recording flow with zero step-name-specific code.
- `projectTask()`'s existing test suite is unaffected.
- `readiness-policy.mjs`'s existing readiness checks are unaffected for a non-suspended task;
  a suspended task's readiness is refused with a clear reason.
- The durable remediation record, start-operation records, consumption records, and
  workspace-writer records all survive a simulated process restart with identical content.
- **Workspace-writer arbitration:** an active agent's workspace-writer claim blocks a
  concurrently-attempted `activateAndSubmitHumanStep`/Publish acquisition until the agent
  releases; neither the blocked operation nor the active agent can observe or absorb the
  other's uncommitted tracked mutation. This holds **across specs** sharing the same physical
  worktree, not only within one spec (D65).
- **Settlement-gated release:** a workspace-writer claim is released only when
  `assessExecutionSettlement` reports settled — a terminal/orphaned agent turn whose
  `finishStep` never completed, or whose step position is still `active`, or which left dirty
  tracked change within its own owned scope, moves the claim to `recovery-required` instead of
  releasing it; a subsequent acquisition attempt by any kind is blocked, not merely delayed,
  until that state is explicitly cleared. A `kind !== 'agent'/'cli-manual'` claim whose pid
  doesn't match the current process at boot is cleared unconditionally (unchanged, D56). A
  failed agent admission releases both the admission marker and the workspace-writer claim
  together.
- **`cli-manual` parity:** a direct/manual `workflow step start` invocation with no covering
  dashboard-orchestrated claim acquires its own `cli-manual` workspace-writer claim and is
  blocked identically by a concurrently-active agent execution or Publish; `workflow step
  finish` releases a `cli-manual` claim it owns immediately upon its own successful, in-process
  completion.
- **`workflow verify-human --approve`/`--request-changes`** acquires the workspace-writer slot
  and git-finalize lease via `activateAndSubmitHumanStep` identically to the dashboard's own
  combined submit — proven by racing it against an active agent execution the same way the
  dashboard path is raced.
- **`publishTask()` called directly** (no dashboard route, no CLI wrapper — a bare domain
  call) still waits for an active agent's workspace-writer claim and never absorbs its dirty
  state — proving the arbitration lives inside `publishTask()` itself, not only in one caller.

## Dependencies

`tasks/25-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`/
`invalidatesDependencyRelease`/`consumesDependencies`).

## Out of scope

Retrying, rolling back, or reopening a task's own completed work. The cross-task-aware
review pass (`areas/dependency-invalidation-remediation-review.md`). Running the group's
actual fix implementation attempts (`areas/deterministic-sequential-queue.md`). The new
combined human-decision operation itself, and the actual dispatch-priority check
(`automatic-workflow-continuation`, task 29 — this area only provides the primitives and the
pending-waiters view). `handleWorkflowVerifyHuman`'s delegation to `activateAndSubmitHumanStep`
(task 29, D63 — a distinct function in the same `cli.mjs` file this area also edits for
`handleWorkflowStepStart`/`handleWorkflowStepFinish`). Publish's own workspace-writer/lease
acquisition call sites inside `publishTask()`/`handleBatchPublish`
(`user-mutation-source-control-finalization`, task 31 — this area provides the primitives
only). Per-task Git worktrees, parallel branches, concurrent agent execution, or Git merge
orchestration — the workspace-writer slot is an arbitration rule, not workspace isolation. An
external locking library or new runtime dependency (both primitives are implemented from Node
built-ins and this repo's existing atomic-file convention). Resolving a `recovery-required`
claim (D61 — this pass defines the state and its blocking behavior; the actual reconciliation
workflow/tooling for an operator to clear it is a future task's own scope). **Cross-spec
workspace-writer arbitration is no longer out of scope — it is the explicit, required
behavior as of D65**, since the workspace-writer record is now keyed by the physical worktree,
not by `specId`.
