---
id: deterministic-status-architecture.dependency-release-and-invalidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/specs/workflow/remediation-record.mjs
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/start-operation.mjs
  - tools/specs/workflow/suspension-projection.mjs
  - tools/specs/workflow/readiness-policy.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
  - tools/tests/workflow-start-operation.test.mjs
  - tools/tests/workspace-writer.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/publish/**
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D50, D51, D52, D53, D55, D56, D58]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model. Implement D50/D51's corrected git-finalize lease.
Implement D55/D56's **workspace-writer** slot — a third, distinct primitive from agent
admission and the git-finalize lease — durable, recoverable, reconciled by `kind`. Implement
D52's durable start-operation record so step activation and its dependency-consumption
snapshot become jointly durable and crash-resumable, now also allocating and freezing a
durable, monotonic `consumptionSequence` (D58) before activation. Implement D53's declarative
`consumesDependencies`-driven recording trigger and step-scoped record identity. Implement
D58's sequence-based authoritative-record remediation matching (superseding D54's
step/attempt/history-based rule). Implement D31's evidence-based remediation-group derivation
and D44's separate `SuspensionProjection`.

## Implementation constraints

### Release/invalidation (D40)

- `dependency-satisfaction.mjs`: scan the full `workflow_progress.history` for the latest
  entry whose matched transition declares `releasesDependencies: true` (its `{step, attempt}`
  is the release epoch); satisfied via this path iff no **later** entry's matched transition
  declares `invalidatesDependencyRelease: true`. Unchanged terminal-`outcome:success` path.

### Git-finalize lease — corrected boundary and lease-passing (D50/D51)

- **`tools/specs/workflow/git-finalize-lock.mjs`** exports `acquireGitFinalizeLease({repoRoot,
  timeoutMs?})` (returns `{ownerId, release()}`) and `withGitFinalizeLock(fn, existingLease?)`.
  With no `existingLease`: acquire fresh, run `fn(lease)`, release in `finally`. With an
  `existingLease`: run `fn(existingLease)` directly — no new acquisition, no release.
- **`finish-operation.mjs`, small additive change:** lock acquisition wraps from **before
  `ensureUpdateTask` begins** through **after `ensureCommit` completes** (`finally`) — not
  merely around the commit call. `finishStep` gains an optional `finalizeLease` input
  (threaded via its existing `context`), used as `existingLease` when present. Do not
  restructure `FINISH_STAGE_IDS`'s own sequence.
- Lease file `.nevo-ai-local/locks/git-finalize.lock`: `{ownerId, pid, createdAt}`.
  Acquisition: exclusive create; on `EEXIST`, `process.kill(existing.pid, 0)` — `ESRCH` means
  stale (delete + retry); otherwise retry-with-backoff up to a bounded timeout, then fail
  clearly. Release verifies `ownerId` before deleting.

### Workspace-writer slot — a third, distinct primitive (D55/D56)

- **`tools/specs/workflow/workspace-writer.mjs` (new).** Durable record at
  `.nevo-ai-local/workspace-writers/<specId>.json`: `{ownerId, kind: 'agent'|'human-submit'|
  'publish'|'batch-publish', specId, taskId?, sessionId?, turnId?, pid?, createdAt}`. Exports:
  - `acquireWorkspaceWriter({repoRoot, specId, kind, ...identity})` — atomic exclusive-create
    acquisition; on `EEXIST`, branch reconciliation by the **existing** claim's `kind`:
    - `kind: 'agent'` — do **not** attempt any liveness check here; this module exposes the
      claim's `sessionId`/`turnId` for the *caller* (task 29, which has the real session/turn
      state) to decide staleness and call `forceReleaseWorkspaceWriter` if genuinely orphaned.
      This module itself never guesses agent liveness.
    - `kind !== 'agent'` — check `process.kill(existing.pid, 0)`; `ESRCH` means stale (release
      + retry); otherwise genuine contention.
    Either way, on genuine (live) contention: register the caller in an **in-process,
    dashboard-only** pending-waiters list (tagged by `kind` and `specId`) and retry with
    backoff until acquired or a bounded (generously long — an active agent execution may
    legitimately run for many minutes) timeout elapses.
  - `releaseWorkspaceWriter(lease)` — verifies `ownerId` before deleting; removes the caller
    from the pending-waiters list.
  - `forceReleaseWorkspaceWriter({repoRoot, specId})` — unconditional release, used only by
    task 29's own agent-turn/orphaned-turn reconciliation (D56) and by boot-time
    pid-mismatch clearing for non-agent claims.
  - `listPendingWorkspaceWriters(specId)` — returns the in-process pending-waiters list
    (`kind`, `requestedAt`) for D57's dispatch-priority check.
- This module never decides *when* to release an agent's claim (that requires session/turn
  state this module doesn't have) — only how the claim is stored, atomically acquired, and
  forcibly released when told to.

### Durable start-operation, sequence allocation (D52/D58) + declarative trigger (D53)

- **`tools/specs/workflow/start-operation.mjs` (new):** record family at
  `.nevo-ai-local/workflow-start-operations/<change>/<task>/<step>/attempt-<n>.json`, own
  atomic-write primitives (distinct from `operation-record.mjs`'s family). Exports
  `planStart`, `completeActivateStage`, `completeConsumptionStage`, `findInFlightStartOperation`.
  `planStart` computes `consumptionSequence` as one more than the current maximum found
  across **all** of the task's own durable `workflow-start-operations/**` and
  `dependency-consumption/**` records (in-flight or completed), and freezes it into the new
  record **before** activation — never an in-memory counter, never re-derived on resume.
- **`tools/specs/workflow/dependency-consumption.mjs`:** exports
  `recordDependencyConsumption({repoRoot, change, consumingTaskId, consumingStep,
  consumingAttempt, consumptionSequence, dependencies: [{taskId, releaseEpoch}]})` writing
  `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json`, and
  `findConsumersOfEpoch({repoRoot, change, dependencyTaskId, releaseEpoch})`.
- **Call-site insertion, `cli.mjs`'s `handleWorkflowStepStart`:** when the target step
  declares `consumesDependencies: true` (read from the normalized definition — never a
  literal step-name comparison):
  1. Check `findInFlightStartOperation` first (resume path) — reuse its frozen
     `dependencySnapshot` **and** `consumptionSequence` verbatim, completing whichever stages
     remain pending. On a live-state mismatch, fail closed with a clear reconciliation error.
  2. Fresh path: resolve dependency satisfaction, freeze release-based dependencies, call
     `planStart` (allocates+freezes `consumptionSequence`, writes `status: 'running'`).
  3. Call `ensureStepActivated`. Call `completeActivateStage`.
  4. Call `recordDependencyConsumption` with the frozen snapshot and sequence (neither
     re-resolved nor re-allocated). Call `completeConsumptionStage`.
- Safe under concurrency: this flow only ever runs during a task's own step activation, which
  — because only one agent execution can be active per spec (D33) and it holds the
  workspace-writer slot for its whole duration (D55) — never overlaps another
  workspace-writing operation for the same spec.

### Sequence-based authoritative matching (D58, supersedes D54)

- `findConsumersOfEpoch` resolves, per `(consumingTask, dependencyTaskId)` pair, the record
  with the **highest `consumptionSequence`** among **all** of that task's records (any
  consuming step) naming that dependency — its authoritative record — then matches only
  against it. Never step name, lexical step order, `consumingAttempt` alone, or
  `workflow_progress.history` position.

### Remediation-group derivation, suspensions, `SuspensionProjection` (D31/D37/D44)

- Unchanged in shape: evidence-based group derivation (via D58's sequence-based matching),
  `suspensions` (not `blockedBy`), durable `remediation-record.mjs`,
  `suspension-projection.mjs` kept fully separate from `task-projection.mjs` (forbidden path,
  untouched), one additive check in `readiness-policy.mjs`.

## Acceptance criteria

- A dependency released remains released across further non-invalidating transitions; a
  declared invalidation revokes it.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `finishStep` acquires its lease before `ensureUpdateTask` runs; a caller passing an
  already-held lease triggers zero additional acquisitions and does not deadlock; two
  independent callers with no shared lease serialize correctly; a lease file left by a
  confirmed-dead pid is reclaimed, a live one is never stolen.
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- `acquireWorkspaceWriter` grants at most one holder per spec at a time; a `kind !== 'agent'`
  claim left by a confirmed-dead pid is reclaimed via the same PID-liveness pattern; an
  `agent`-kind claim is **never** auto-reclaimed by this module itself — only via
  `forceReleaseWorkspaceWriter`, called by the caller with real session/turn knowledge.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- `listPendingWorkspaceWriters` correctly reports a queued non-agent acquisition attempt
  while the slot is held by another kind.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- A crash simulated between `ensureStepActivated` succeeding and the consumption write
  completing is fully recovered on the next `workflow step start` — the consumption record is
  completed from the original frozen snapshot **and** the original frozen
  `consumptionSequence`, neither re-resolved nor re-allocated.
  `automated: node --test tools/tests/workflow-start-operation.test.mjs`
- A task depending on two upstream tasks, both release-based, records both in one atomic
  write with one `consumptionSequence`; invalidating either epoch is found by
  `findConsumersOfEpoch`.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A task records dependency consumption again on a later attempt of a declared-consuming step
  (rework) — attempt 1 consumes epoch #1 at sequence N, attempt 2 (after invalidation and a
  fix) consumes a fresh epoch #2 at sequence N+1 (or higher).
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Two distinct declared-consuming steps whose attempt numbers do **not** reflect chronology
  (step A attempt 2 happened after step B attempt 1) are ordered correctly by
  `consumptionSequence`, not attempt number.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Invalidating the higher-`consumptionSequence` (authoritative) epoch finds the consumer;
  invalidating an earlier, superseded epoch does not.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A session created but whose `workflow step start` never actually runs (or fails before
  activation) produces no consumption record.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A newly-authored, arbitrarily-named step declaring `consumesDependencies: true` triggers
  the identical recording flow with zero step-name-specific branches anywhere in this task's
  code.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `task-projection.mjs`'s own test suite is completely unchanged.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- `readiness-policy.mjs`'s existing tests pass unchanged for non-suspended tasks; a suspended
  task's readiness is refused with a clear reason.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `finish-operation.mjs`'s own existing test suite passes unchanged except for the new
  lock-acquisition wrap.
  `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/git-finalize-lock.test.mjs
node --test tools/tests/workspace-writer.test.mjs
node --test tools/tests/workflow-start-operation.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`deterministic-sequential-queue`, task 28).
The combined cross-task-aware review and `suspensions`-clearing
(`dependency-invalidation-remediation-review`, task 30). The `releasesDependencies`/
`invalidatesDependencyRelease`/`consumesDependencies` schema fields themselves
(`workflow-continuation-schema`, task 25). Deciding *when* to reclaim an agent-kind
workspace-writer claim (owned by task 29, which has real session/turn state — this task only
provides `forceReleaseWorkspaceWriter` for it to call) and the dispatch-priority policy that
reads `listPendingWorkspaceWriters` (also task 29). The new combined human-decision operation
itself and its own lease/workspace-writer threading, and Publish's own acquisition calls
(owned by tasks 29 and 31 respectively — this task only provides the primitives and wires its
own `finish-operation.mjs` call site). Reopening a terminal task's workflow. Any external
locking library or new runtime dependency.
