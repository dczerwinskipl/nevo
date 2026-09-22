# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) as a **release epoch that
remains valid until an explicit, declarative invalidation transition fires** (D40). A release
means a downstream task may **enter the sequential queue's runnable set** (D33) — never that
it starts concurrently with the releasing task's own continued execution. When a release is
explicitly invalidated, this area derives the automatic remediation group using durable,
step-scoped, authoritative-record dependency-consumption provenance (D48/D52/D53/D54) —
never guessed from `workflow_progress` state or timestamps — **including consumers that have
already reached a terminal transition** (D31). Group membership persists durably (D36). This
area also owns `SuspensionProjection` (D44), kept strictly separate from the pure
`TaskProjection` (D10). It also owns the shared, cross-process **git-finalize lease**
(D47/D50/D51) — the correctness primitive every Git-tracked mutate-then-commit operation in
this change acquires to avoid absorbing another operation's uncommitted mutation. The
cross-task-aware review of a remediation group's fix is a separate area
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

### Dependency-consumption provenance — declarative trigger, durable start-operation, step-scoped identity, authoritative-record matching (D52/D53/D54)

- **Declarative trigger, not "first-ever activation" (D53).** A step-level schema field,
  `consumesDependencies: true` (task 25 owns the schema; this area only reads it), marks
  which steps snapshot/consume dependencies. `standard-v1.yaml`'s `implementation` declares
  it; `review`/`human-verification` do not. Recording triggers on **every** activation of a
  declared step, any attempt number — never a literal step-name check, never gated on the
  task's own history/attempt-count.
- **Durable start-operation, distinct from finish-operation records (D52).** A new record
  family, `.nevo-ai-local/workflow-start-operations/<change>/<task>/<step>/attempt-<n>.json`
  (own module, reusing the atomic-write/intent-then-verify *pattern*
  `operation-record.mjs` established, not its literal file family): (1) plan — resolve
  dependency satisfaction, freeze the release-based dependencies into a `dependencySnapshot`,
  persist `status: 'running'` with per-stage markers; (2) activate — call
  `ensureStepActivated`, mark `activate: completed`; (3) record — call
  `recordDependencyConsumption` from the **frozen** snapshot (never re-resolved), mark
  `record-consumption: completed` and overall `status: 'completed'`. On resume: read the
  in-flight record, continue from whichever stage is still pending, using the frozen
  snapshot; on a live-state mismatch, fail closed with a clear reconciliation error, never
  guess.
- **Step-scoped record identity (D53).** Consumption records live at
  `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json` — shape
  unchanged from D48: `{consumingTaskId, consumingStep, consumingAttempt, dependencies:
  [{taskId, releaseEpoch: {step, attempt}}]}`, one atomic write per attempt covering every
  release-based dependency it relies on.
- **Authoritative-record matching (D54).** `findConsumersOfEpoch` resolves, per
  `(consumingTask, dependencyTaskId)` pair, the record with the highest `consumingAttempt`
  among same-`consumingStep` records naming that dependency — its **authoritative** record —
  and matches only against that one. A task whose authoritative (latest) record already names
  a different, still-valid epoch is not a match, even if an older, superseded record of its
  own once named the now-invalidated one.

### Remediation-group derivation and suspensions

When a release epoch is invalidated, the remediation group is: the releasing task, plus every
task whose **authoritative** consumption record names that exact epoch (D54) —
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
  non-authoritative (superseded) consumption record.
- No recursive acquisition of the git-finalize lease anywhere — every combined operation that
  needs one continuous critical section spanning multiple calls acquires exactly one lease
  and threads it through explicitly.

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s epoch-aware release logic;
`acquireGitFinalizeLease`/`withGitFinalizeLock`; the start-operation module (D52);
`dependency-consumption.mjs`'s step-scoped write/read primitives and authoritative-record
resolution; the remediation-group derivation function and its durable record primitives;
`projectSuspensions(task, change)`.

Consumed by: `tools/specs/workflow/cli.mjs` (the one call site running the D52 start-operation
flow for a `consumesDependencies` step), `finish-operation.mjs` (acquires/accepts the
git-finalize lease), `automatic-workflow-continuation` (task 29 — reads release/invalidation
state; threads one acquired lease through `activateAndSubmitHumanStep`), `publish/operation.mjs`
(task 31 — acquires its own lease), `readiness-policy.mjs`, `areas/deterministic-sequential-
queue.md`, `areas/dependency-invalidation-remediation-review.md`.

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
- Two distinct declared-consuming-step attempts (hypothetical multi-step fixture) never
  collide on record path — proven by asserting both records persist independently.
- A newly-authored, arbitrarily-named step declaring `consumesDependencies: true` triggers
  the same recording flow with zero step-name-specific code.
- `projectTask()`'s existing test suite is unaffected.
- `readiness-policy.mjs`'s existing readiness checks are unaffected for a non-suspended task;
  a suspended task's readiness is refused with a clear reason.
- The durable remediation record, start-operation records, and consumption records all
  survive a simulated process restart with identical content.

## Dependencies

`tasks/25-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`/
`invalidatesDependencyRelease`/`consumesDependencies`).

## Out of scope

Retrying, rolling back, or reopening a task's own completed work. The cross-task-aware
review pass (`areas/dependency-invalidation-remediation-review.md`). Running the group's
actual fix implementation attempts (`areas/deterministic-sequential-queue.md`). The new
combined human-decision operation itself (`automatic-workflow-continuation`, task 29 — this
area only provides the lease it threads through). An external locking library or new runtime
dependency (the lease is implemented from Node built-ins and this repo's existing atomic-file
convention).
