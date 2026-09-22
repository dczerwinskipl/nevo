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
  - tools/specs/workflow/workspace-request.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
  - tools/tests/workflow-start-operation.test.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/execution-settlement.test.mjs
  - tools/tests/workspace-request.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/publish/**
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D50, D51, D52, D53, D55, D56, D58, D59, D60, D61, D62, D65, D66, D69, D70, D71, D72, D74, D75, D76, D77, D78]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model. Implement D50/D51's corrected git-finalize lease.
Implement D55/D56's **workspace-writer** slot — a third, distinct primitive from agent
admission and the git-finalize lease — durable, recoverable, reconciled by `kind`, now
**keyed by the physical worktree, not `specId`** (D65) and releasable **only on proven
execution settlement**, never bare turn-terminal (D59/D60/D61), **and only via an
ownership-conditional API** — no reconciliation path may mutate a claim it does not currently
own (D70), using a durable `workspaceOwnerId` recoverable after restart (D71). Implement the
new `execution-settlement.mjs` primitive (D60). Implement the `cli-manual` workspace-writer
kind so raw CLI invocations of `workflow step start`/`workflow step finish` participate in the
same arbitration as dashboard-orchestrated agent executions (D62), releasing it only once
`assessExecutionSettlement` — never a bare non-throwing `finishStep` return — reports settled
(D69). Implement the new `workspace-request.mjs` — a durable, physical-worktree-scoped queue
of pending user-submitted workspace mutations, replacing the in-process pending-waiters list as
the source of truth for D57's dispatch priority and for a request's own survive-restart
durability (D72/D74/D75/D77/D78). Implement D52's durable
start-operation record so step activation and its dependency-consumption snapshot become
jointly durable and crash-resumable, now also allocating and freezing a durable, monotonic
`consumptionSequence` (D58) before activation. Implement D53's declarative
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

### Workspace-writer slot — a third, distinct primitive, keyed by the physical worktree (D55/D56/D65)

- **`tools/specs/workflow/workspace-writer.mjs` (new).** Durable record at
  `.nevo-ai-local/locks/workspace-writer.lock` — **one single, well-known file per checkout,
  never keyed by `specId`** (D65), mirroring `git-finalize-lock.mjs`'s own sibling file in the
  same directory, so two different specs sharing this checkout correctly contend against each
  other: `{ownerId, kind: 'agent'|'cli-manual'|'human-submit'|'publish'|'batch-publish',
  status: 'active'|'recovery-required', specId, taskId?, sessionId?, turnId?, pid?,
  createdAt}`. `specId`/`taskId`/`sessionId`/`turnId` are attribution fields only — never part
  of the acquisition key. Exports:
  - `acquireWorkspaceWriter({repoRoot, kind, ...identity})` — atomic exclusive-create
    acquisition; on `EEXIST`:
    - If the existing record's `status` is `recovery-required` — an unconditional block (a
      plain field check, not a liveness judgment): report this distinctly to the caller
      (`{blocked: true, reason: 'recovery-required'}`) rather than registering an ordinary
      wait, so callers can surface `blocked-by-recovery` (D67) instead of silently retrying
      forever against a claim nothing will ever release without explicit reconciliation.
    - `kind: 'agent'` or `'cli-manual'` (otherwise) — do **not** attempt any liveness or
      settlement check here; this module exposes the claim's `sessionId`/`turnId`/`taskId` for
      the *caller* (task 29 for `agent`, this task's own `cli.mjs` wrapper for `cli-manual`) to
      run `assessExecutionSettlement` (D60) and call `forceReleaseWorkspaceWriter` or
      `markWorkspaceWriterRecoveryRequired` as appropriate (D61). This module itself never
      guesses liveness or attempts settlement checking.
    - `kind !== 'agent', 'cli-manual'` — check `process.kill(existing.pid, 0)`; `ESRCH` means
      stale (release + retry); otherwise genuine contention.
    On genuine (live) contention: register the caller in an **in-process, dashboard-only**
    pending-waiters list (tagged by `kind`) and retry with backoff until acquired or a bounded
    (generously long — an active agent execution may legitimately run for many minutes)
    timeout elapses. This low-level timeout is an internal safety valve only (D67) — callers
    representing a durable user-submitted operation (Publish, human-submit) re-attempt
    transparently across it rather than surfacing it as a failure.
  - `releaseWorkspaceWriter(lease)` — verifies `ownerId` before deleting; removes the caller
    from the pending-waiters list. Unchanged — this is the normal, happy-path self-release a
    holder calls on its own claim.
  - **`releaseWorkspaceWriterIfOwned({repoRoot, expectedOwnerId, expectedKind?, expectedSpecId?,
    expectedTaskId?, expectedSessionId?, expectedTurnId?})` (new, D70, the ordinary
    reconciliation-release API).** Reads the current record; if `ownerId` (mandatory) and any
    supplied optional identity field all match, deletes it and returns `{released: true}`.
    Otherwise does nothing — never deletes, never changes `status` — and returns
    `{released: false, reason: 'not-current-owner', currentClaim}`. This is the **exact same
    ownerId-verification discipline `releaseWorkspaceWriter(lease)` already applies**, extended
    to reconciliation call sites that don't hold the original lease object.
  - **`markWorkspaceWriterRecoveryRequiredIfOwned({repoRoot, expectedOwnerId, ...same optional
    identity fields})` (new, D70).** Same ownership check; on a match, flips `status` to
    `recovery-required` without deleting the record; on a mismatch, does nothing and returns
    the same `{marked: false, reason: 'not-current-owner', currentClaim}` shape.
  - **`forceReleaseWorkspaceWriterUnsafe({repoRoot})` (renamed from
    `forceReleaseWorkspaceWriter`, D70) — internal, unconditional, not exported for ordinary
    use.** No orchestration/reconciliation code calls this; at most a future, explicitly
    out-of-scope manual-operator recovery tool might, deliberately, with a human already
    involved.
  - `listPendingWorkspaceWriters(specId)` — returns the in-process pending-waiters list
    (`kind`, `requestedAt`) as a **local wakeup/optimization hint only** — no longer the
    authority for D57's dispatch-priority ordering, which now reads the durable
    `workspace-request.mjs` queue instead (D72/D74).
- This module never decides *when* to release an agent's or `cli-manual`'s claim, and never
  attempts settlement checking on its own initiative (that requires session/turn/workflow
  state this module doesn't have) — only how the claim is stored, atomically acquired, and
  conditionally released or marked `recovery-required` when told to, and only when the caller's
  claimed identity actually still matches what's currently there (D70).

### Durable workspaceOwnerId, recoverable after restart (D71)

- **Agent kind.** `workspaceOwnerId` (the `ownerId` returned by a successful
  `acquireWorkspaceWriter` call) is written onto the same durable session/turn record D42's own
  orphan-detection already reads — an existing record, owned by prior, already-accepted
  architecture, not a new file this task introduces — at the same moment that record's own
  canonical identity becomes durably observable (D66's steps 3–4). This task does not own that
  record (task 29 does); it only defines the field's meaning and consumes it via
  `expectedOwnerId` in the ownership-conditional API above.
- **`cli-manual` kind.** `workspaceOwnerId` is written into the task's own start-operation
  record (`start-operation.mjs`, this task) at claim-acquisition time — already keyed by the
  same task/step/attempt identity a `cli-manual` claim carries, so no new file is needed.
- **Unestablished identity fails closed.** If no persisted `workspaceOwnerId` can be found for
  an orphaned execution being reconciled, treat identity as unestablished: never release, never
  mark anything — surface this identically to `recovery-required` (an operator must resolve it;
  resolving it is out of scope for this task, D61).

### Execution settlement — the concrete, reusable "is it safe to release" check (D59/D60)

- **`tools/specs/workflow/execution-settlement.mjs` (new).** Exports
  `assessExecutionSettlement({repoRoot, changeSlug, taskId})` → `{settled: true} |
  {settled: false, reason}`. Settled only when **all** hold, each via an already-existing
  primitive, never re-derived:
  1. No in-flight `workflow-start-operations/<change>/<task>/**` record
     (`findInFlightStartOperation`, `start-operation.mjs`).
  2. No in-flight finish-operation record (`findInFlightOperationRecord`,
     `operation-record.mjs`).
  3. The task's current `workflow_progress` position for the relevant attempt is **not**
     `active`.
  4. No dirty tracked change within the execution's own owned scope
     (`resolveTaskScope`/`resolveWorkflowOwnedPaths`, `step-context.mjs`, import-only —
     inverted from their existing `OUT_OF_SCOPE_WORKTREE_CHANGES` use: checking whether the
     *in-scope* paths are dirty).
  Any failing → not settled. This function performs no session/turn inspection and no
  liveness judgment of any kind — it is purely a durable-record and worktree-scope
  inspection, safe to call from any context (task 29's dashboard-side hooks, or this task's own
  `cli.mjs` wrapper).
- **`cli-manual` workspace-writer kind (D62).** `cli.mjs`'s `handleWorkflowStepStart` wraps its
  own call to `compileStepContext` (the actual mutation point, via `ensureStepActivated`,
  `step-context.mjs`, forbidden path — read/imported, never edited) whenever the resolved
  position is non-terminal: if an existing `agent`-kind claim already covers this exact
  spec/task (this CLI invocation is itself one of that execution's own tool-call subprocesses),
  proceed without acquiring a second claim; otherwise acquire a `cli-manual` claim for the
  attempt's own duration, first attempting settlement-based reconciliation of any pre-existing
  `agent`/`cli-manual` claim found via `assessExecutionSettlement` (lazy reconciliation — there
  is no CLI "boot" event).
- **`cli-manual` release is settlement-gated, never a bare non-throwing return (D69).**
  `handleWorkflowStepFinish` calls `assessExecutionSettlement` **after `finishStep` settles —
  whatever its outcome** (a returned `blocked`/`input-required`/`reconciliation-required`
  result is not an exception and is not settlement; only a thrown error or an actually-settled
  result end the attempt) — and releases the `cli-manual` claim it owns via
  `releaseWorkspaceWriterIfOwned({expectedOwnerId: <this claim's own ownerId>, expectedTaskId,
  ...})` (D70) **only if** that reports settled. A non-settled result leaves the claim held,
  `active` — not an anomaly, simply "this attempt didn't finish; the same task/attempt will
  call `workflow step finish` again." A claim genuinely abandoned (no further `workflow step
  finish` ever comes) is only ever found stale later, via the lazy reconciliation path above,
  triggered by a *different* caller's next acquisition attempt.

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
  — because only one agent execution can be active per spec (D33) and it (or the covering
  `cli-manual` claim, D62) holds the workspace-writer slot for its whole duration (D55) — never
  overlaps any other workspace-writing operation for the same **physical worktree** (D65, not
  merely the same spec).

### Sequence-based authoritative matching (D58, supersedes D54)

- `findConsumersOfEpoch` resolves, per `(consumingTask, dependencyTaskId)` pair, the record
  with the **highest `consumptionSequence`** among **all** of that task's records (any
  consuming step) naming that dependency — its authoritative record — then matches only
  against it. Never step name, lexical step order, `consumingAttempt` alone, or
  `workflow_progress.history` position.

### Durable, physical-worktree-scoped workspace-request queue (D72/D74/D75/D76/D77/D78)

- **`tools/specs/workflow/workspace-request.mjs` (new).** Record family at
  `.nevo-ai-local/workspace-requests/<requestId>.json` (already worktree-scoped — no separate
  worktree key needed, D65's own precedent): `{requestId, requestSequence, kind: 'human-submit'
  |'publish'|'batch-publish', specId, taskId?, createdAt, status: 'queued'|
  'waiting-for-workspace'|'running'|'completed'|'failed'|'blocked-by-recovery'|
  'reconciliation-required', workspaceOwnerId?, operationRef}`. Exports at minimum
  `createWorkspaceRequest`, `transitionWorkspaceRequest` (idempotent, D77), `loadWorkspaceRequest`,
  `listWorkspaceRequests({status?})` (worktree-wide — never filtered by `specId` as the
  scheduling authority, D74), `findInFlightWorkspaceRequest`.
- **`requestSequence` allocation, reusing D58's own pattern (not reopening it).** Computed as
  one more than the current maximum found across all existing `workspace-requests/**` records,
  frozen before the request is first persisted — the identical "scan for max, +1, freeze"
  technique `consumptionSequence` already established, applied here to a different, unrelated
  sequence.
- **Created before contention begins (D72).** A caller (task 29 for `human-submit`, task 31 for
  `publish`/`batch-publish`) creates the record with `status: 'queued'` and an `operationRef`
  naming the underlying operation's own durable identity (D76) **before** ever calling
  `acquireWorkspaceWriter` for it. This module never duplicates that operation's own payload —
  only a reference.
- **Race-safe promotion to `running` (D78).** Only the caller that actually receives the
  `acquireWorkspaceWriter` grant writes `{status: 'running', workspaceOwnerId}` — immediately
  after acquiring, strictly before any tracked mutation begins. No separate lock is layered on
  top of the workspace-writer slot's own atomicity.
- **Reconciliation reuses D70's ownership-conditional API and D29/D50's existing
  resume/no-op/`reconciliation-required` discipline (D75).** A `running` request is settled by
  checking (a) whether a live workspace-writer claim still exists whose identity matches this
  request's own stored `workspaceOwnerId`, and (b) the referenced operation's own real state;
  never re-executed speculatively. A `queued`/`waiting-for-workspace` request found alongside a
  live claim that already matches its identity (the crash window D78 describes) has its own
  record completed with that claim's `ownerId` before classification continues.
- This module never implements Publish's or human-submit's own mutation logic — it only
  coordinates waiting/scheduling and points at the real operation via `operationRef` (D76).

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
- `acquireWorkspaceWriter` grants at most one holder **per physical worktree** at a time —
  proven by two different `specId`s contending for the same claim file; a `kind !== 'agent',
  'cli-manual'` claim left by a confirmed-dead pid is reclaimed via the same PID-liveness
  pattern; an `agent`/`cli-manual`-kind claim is **never** auto-reclaimed by this module
  itself — only via the ownership-conditional API, called by a caller that has already
  established settlement.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- `listPendingWorkspaceWriters` correctly reports a queued non-agent acquisition attempt
  while the slot is held by another kind.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- A workspace-writer record marked `recovery-required` is never granted to a new acquirer by
  any kind's staleness check, including a confirmed-dead pid on a `human-submit`/`publish`
  claim that happens to share the file — the field check takes precedence.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **`releaseWorkspaceWriterIfOwned` releases only on an exact `ownerId` match; a mismatch is a
  silent no-op, not an error, and the claim is left completely untouched (status, `ownerId`,
  every field unchanged).** Proven directly: acquire a claim as A, then call
  `releaseWorkspaceWriterIfOwned` with a different `expectedOwnerId` — the claim survives
  byte-for-byte; only a call with A's own `ownerId` releases it.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **`markWorkspaceWriterRecoveryRequiredIfOwned` is equally ownership-conditional** — a
  mismatched `expectedOwnerId` leaves `status` unchanged.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **The stale-reconciliation race from the brief, proven directly:** execution A acquires the
  claim and releases it normally; execution B then acquires the same physical-worktree claim;
  a *delayed* call representing A's own now-stale reconciliation (`releaseWorkspaceWriterIfOwned`
  with A's own captured `ownerId`) is attempted against the live record — it reports
  `{released: false, reason: 'not-current-owner'}` and B's claim is completely unaffected. The
  identical scenario is proven for `markWorkspaceWriterRecoveryRequiredIfOwned`.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- `forceReleaseWorkspaceWriterUnsafe` is not imported or called anywhere outside its own test
  file within this task's own scope — an explicit grep-style regression check.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- `assessExecutionSettlement` reports settled only when all four conditions hold; reports not
  settled for each of: an in-flight start-operation record, an in-flight finish-operation
  record, an `active` workflow position with no in-flight finish-operation, and a dirty file
  within the task's own owned scope — each proven independently, and each using the exact
  primitive already used elsewhere (`findInFlightStartOperation`,
  `findInFlightOperationRecord`, `resolveTaskScope`/`resolveWorkflowOwnedPaths`), not a
  reimplementation.
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- A dirty file entirely outside the task's own owned scope (an unrelated pre-existing change)
  never blocks settlement.
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- A direct/manual `workflow step start` invocation (no covering `agent`-kind claim) acquires a
  `cli-manual` workspace-writer claim; a concurrently-active agent execution (or another
  `cli-manual`/non-agent claim) blocks it until released. `workflow step finish` for that same
  attempt releases the `cli-manual` claim only once `assessExecutionSettlement` reports settled
  after `finishStep` returns successfully.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **`workflow step finish` returning `blocked`/`input-required`/`reconciliation-required` (no
  exception thrown) does NOT release the `cli-manual` claim** — proven directly by forcing each
  of the three outcomes and asserting the claim remains held, `active`, afterward; only a
  result for which `assessExecutionSettlement` independently reports settled releases it.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- A `cli-manual` claim abandoned by a crashed CLI process (no matching `workflow step finish`
  ever ran) is neither auto-released nor silently stolen by the next acquisition attempt —
  `assessExecutionSettlement` is consulted first, and an unsettled result marks
  `recovery-required` (via `markWorkspaceWriterRecoveryRequiredIfOwned`) rather than granting
  the slot.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **`workspaceOwnerId` is durably recoverable for both kinds.** An agent-kind claim's
  `workspaceOwnerId`, once written to the session/turn record, is readable independent of any
  in-memory value; a `cli-manual` claim's `workspaceOwnerId`, written into its start-operation
  record, is readable across a simulated process restart (a fresh `require`/import, no shared
  module-level state). Reconciliation attempted with no persisted `workspaceOwnerId` available
  at all takes the fail-closed path — no release, no mutation of the live claim.
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
- **A workspace-request is persisted (`status: 'queued'`) before it ever calls
  `acquireWorkspaceWriter`** — proven by inspecting the durable record's existence immediately
  after creation, before any contention attempt begins.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **`requestSequence` is allocated by scanning existing records for the current maximum, +1,
  frozen before first persistence** — proven for two requests created back-to-back, and for a
  request retried after a simulated crash (the original sequence is reused verbatim, never
  re-allocated).
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **Promotion to `running` is race-safe:** two simulated concurrent processors attempting to
  promote the same request never both succeed — only the one that actually receives the
  `acquireWorkspaceWriter` grant writes `{status: 'running', workspaceOwnerId}`.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **A process crash simulated between acquiring the workspace-writer claim and persisting
  `{status: 'running', workspaceOwnerId}` into the request record is recovered:** the next
  reconciliation pass finds the `queued`/`waiting-for-workspace` request, matches it against
  the live claim by identity, adopts the claim's own `ownerId` into the request record, and
  only then applies the resume/no-op/`reconciliation-required` classification.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- `listWorkspaceRequests` returns every non-terminal request for the physical worktree
  regardless of `specId` — proven with two different `specId`s' requests both returned by one
  worktree-wide call.
  `automated: node --test tools/tests/workspace-request.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/git-finalize-lock.test.mjs
node --test tools/tests/workspace-writer.test.mjs
node --test tools/tests/execution-settlement.test.mjs
node --test tools/tests/workspace-request.test.mjs
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
workspace-writer claim after settlement is assessed, and the worktree-wide dispatch-priority
policy that reads `workspace-request.mjs` (both task 29, which has real session/turn state —
this task only provides `assessExecutionSettlement`/the ownership-conditional
release/mark-recovery-required API/`workspace-request.mjs`'s own record primitives for it to
call). `handleWorkflowVerifyHuman`'s delegation to `activateAndSubmitHumanStep` (task 29, D63
— a distinct function in the same `cli.mjs` file this task edits only for
`handleWorkflowStepStart`/`handleWorkflowStepFinish`). The new combined human-decision
operation itself, its own durable human-submit request record (D73), and its own
lease/workspace-writer/workspace-request threading; Publish's own acquisition calls and its
own workspace-request creation inside `publishTask()`/`handleBatchPublish` (owned by tasks 29
and 31 respectively — this task only provides the primitives and wires its own
`finish-operation.mjs` call site). Resolving a `recovery-required` claim or a
`reconciliation-required` request once marked (a future task's own scope). Reopening a
terminal task's workflow. Any external locking library or new runtime dependency.
