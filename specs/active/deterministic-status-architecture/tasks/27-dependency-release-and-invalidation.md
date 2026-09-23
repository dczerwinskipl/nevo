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
  - tools/specs/workflow/cli-workspace-execution.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
  - tools/tests/workflow-start-operation.test.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/execution-settlement.test.mjs
  - tools/tests/workspace-request.test.mjs
  - tools/tests/cli-workspace-execution.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/publish/**
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D50, D51, D52, D53, D55, D56, D58, D59, D60, D61, D62, D65, D66, D69, D70, D71, D72, D74, D75, D76, D77, D78, D79, D80, D81, D82, D83, D84, D85, D86]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model. Implement D50/D51's corrected git-finalize lease.
Implement D55/D56's **workspace-writer** slot — a third, distinct primitive from agent
admission and the git-finalize lease — durable, recoverable, reconciled by `kind`, now
**keyed by the physical worktree, not `specId`** (D65) and releasable **only on proven
execution settlement**, never bare turn-terminal (D59/D60/D61), **and only via an
ownership-conditional API, itself made truly atomic under a new short-lived
workspace-control lock** — no reconciliation path may mutate a claim it does not currently own,
and no compare-then-mutate ever happens as two separate operations (D70/D80), using a durable
`workspaceOwnerId` recoverable after restart (D71). Implement the new `execution-settlement.mjs`
primitive (D60). Implement the `cli-manual` workspace-writer kind so raw CLI invocations of
`workflow step start`/`workflow step finish` participate in the same arbitration as
dashboard-orchestrated agent executions (D62), releasing it only once
`assessExecutionSettlement` — never a bare non-throwing `finishStep` return — reports settled
(D69), with its own durable owner-id home independent of `consumesDependencies` (a new
`cli-workspace-execution.mjs`, D85), and reusing an existing `agent`-kind claim only when
trusted ambient execution identity proves it (D86). Implement a dead-pid finding on any
request-backed claim (`human-submit`/`publish`/`batch-publish`) as a trigger for durable
request/operation reconciliation, never an unconditional delete (D79). Implement the new
`workspace-request.mjs` — a durable, physical-worktree-scoped queue of pending user-submitted
workspace mutations, with atomically-allocated `requestSequence` (D81), an exact `requestId`
embedded in the workspace-writer claim it acquires (D82), and compare-and-set transitions so no
request is ever executed twice (D83) — replacing the in-process pending-waiters list as the
source of truth for D57's dispatch priority and for a request's own survive-restart durability
(D72/D74/D75/D77/D78). Implement D52's durable
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

### Workspace-writer slot — a third, distinct primitive, keyed by the physical worktree, every mutation atomic under the workspace-control lock (D55/D56/D65/D80)

- **`tools/specs/workflow/workspace-writer.mjs` (new).** Durable record at
  `.nevo-ai-local/locks/workspace-writer.lock` — **one single, well-known file per checkout,
  never keyed by `specId`** (D65), mirroring `git-finalize-lock.mjs`'s own sibling file in the
  same directory, so two different specs sharing this checkout correctly contend against each
  other: `{ownerId, kind: 'agent'|'cli-manual'|'human-submit'|'publish'|'batch-publish',
  status: 'active'|'recovery-required', requestId?, operationRef?, specId, taskId?, sessionId?,
  turnId?, pid?, createdAt}`. **`requestId` (D82) is required for every request-backed kind**
  (`human-submit`/`publish`/`batch-publish`) and is the sole match key reconciliation uses for
  those kinds — `kind`/`specId`/`taskId` remain attribution fields only, never the acquisition
  key and never a substitute for `requestId` (two distinct requests can share identical
  `kind`/`specId`/`taskId`).
- **`tools/specs/workflow/workspace-control-lock.mjs` (new, D80).** A short-lived, cross-process
  lock at `.nevo-ai-local/locks/workspace-control.lock` — same exclusive-create-plus-
  `process.kill(pid, 0)`-stale-reclaim pattern `git-finalize-lock.mjs` already establishes, but
  **purpose-distinct**: it protects only read-decide-mutate access to the workspace-writer
  record (and, D81, `requestSequence` allocation), never the workspace-writer claim itself,
  never the git-finalize lease, never the admission mutex. Exports `withWorkspaceControlLock(fn,
  {repoRoot})` — acquire → run `fn` (a synchronous-ish read/decide/mutate of the target record)
  → release, always via `finally`. Every function below that touches the workspace-writer
  record's file is implemented as one call to this wrapper — never a bare read followed by a
  later, separately-scheduled write.
- **`workspace-writer.mjs` exports, all control-lock-protected:**
  - `acquireWorkspaceWriter({repoRoot, kind, requestId?, operationRef?, ...identity})` — inside
    `withWorkspaceControlLock`: atomic exclusive-create acquisition (embedding `requestId` for
    request-backed kinds); on `EEXIST`:
    - If the existing record's `status` is `recovery-required` — an unconditional block (a
      plain field check, not a liveness judgment): report this distinctly to the caller
      (`{blocked: true, reason: 'recovery-required'}`) rather than registering an ordinary
      wait, so callers can surface `blocked-by-recovery` (D67) instead of silently retrying
      forever against a claim nothing will ever release without explicit reconciliation.
    - `kind: 'agent'` or `'cli-manual'` — do **not** attempt any liveness or settlement check
      here; this module exposes the claim's `sessionId`/`turnId`/`taskId` for the *caller*
      (task 29 for `agent`, this task's own `cli.mjs` wrapper for `cli-manual`) to run
      `assessExecutionSettlement` (D60) and call the ownership-conditional API as appropriate
      (D61/D70). This module itself never guesses liveness or attempts settlement checking.
    - **request-backed kind (`human-submit`/`publish`/`batch-publish`) with a dead pid** — do
      **not** delete unconditionally (D79). Expose the existing claim's `requestId`/
      `operationRef` to the *caller* (task 29/31, which have the durable request/operation
      readers) to run the D79 reconciliation sequence and call the ownership-conditional API
      once (and only if) settlement is actually established.
    - **request-backed kind with a live pid** — genuine contention; register the caller in an
      **in-process, dashboard-only** pending-waiters list (tagged by `kind`, a local wakeup
      hint only, D72) and retry with backoff until acquired or a bounded (generously long — an
      active agent execution may legitimately run for many minutes) timeout elapses. This
      low-level timeout is an internal safety valve only (D67) — callers representing a
      durable user-submitted operation (Publish, human-submit) re-attempt transparently across
      it rather than surfacing it as a failure.
  - `releaseWorkspaceWriter(lease)` — inside `withWorkspaceControlLock`: verifies `ownerId`
    before deleting; removes the caller from the pending-waiters list. Unchanged — this is the
    normal, happy-path self-release a holder calls on its own claim.
  - **`releaseWorkspaceWriterIfOwned({repoRoot, expectedOwnerId, expectedRequestId?,
    expectedKind?, expectedSpecId?, expectedTaskId?, expectedSessionId?, expectedTurnId?})`
    (D70, the ordinary reconciliation-release API, now inside `withWorkspaceControlLock` so
    compare-and-mutate is one atomic unit, D80).** Reads the current record; if `ownerId`
    (mandatory) and any supplied optional identity field (including `requestId`, when
    reconciling a request-backed claim — D82) all match, deletes it and returns
    `{released: true}`. Otherwise does nothing — never deletes, never changes `status` — and
    returns `{released: false, reason: 'not-current-owner', currentClaim}`.
  - **`markWorkspaceWriterRecoveryRequiredIfOwned({repoRoot, expectedOwnerId, ...same optional
    identity fields})` (D70, also control-lock-protected).** Same ownership check inside the
    same lock; on a match, flips `status` to `recovery-required` without deleting the record;
    on a mismatch, does nothing and returns the same `{marked: false, reason:
    'not-current-owner', currentClaim}` shape.
  - **`forceReleaseWorkspaceWriterUnsafe({repoRoot})` (renamed from
    `forceReleaseWorkspaceWriter`, D70) — internal, unconditional, not exported for ordinary
    use.** No orchestration/reconciliation code calls this; at most a future, explicitly
    out-of-scope manual-operator recovery tool might, deliberately, with a human already
    involved.
  - `listPendingWorkspaceWriters(specId)` — returns the in-process pending-waiters list
    (`kind`, `requestedAt`) as a **local wakeup/optimization hint only** — no longer the
    authority for D57's dispatch-priority ordering, which now reads the durable
    `workspace-request.mjs` queue instead (D72/D74).
- This module never decides *when* to release an agent's or `cli-manual`'s claim, never decides
  whether a request-backed claim's underlying operation actually settled, and never attempts
  settlement/reconciliation checking on its own initiative (that requires session/turn/workflow/
  operation state this module doesn't have) — only how the claim is stored, atomically acquired
  and mutated as one indivisible unit under the control lock, and conditionally released or
  marked `recovery-required` when told to, and only when the caller's claimed identity actually
  still matches what's currently there (D70/D82).

### Durable workspaceOwnerId, recoverable after restart (D71)

- **Agent kind.** `workspaceOwnerId` (the `ownerId` returned by a successful
  `acquireWorkspaceWriter` call) is written onto the same durable session/turn record D42's own
  orphan-detection already reads — an existing record, owned by prior, already-accepted
  architecture, not a new file this task introduces — at the same moment that record's own
  canonical identity becomes durably observable (D66's steps 3–4). This task does not own that
  record (task 29 does); it only defines the field's meaning and consumes it via
  `expectedOwnerId` in the ownership-conditional API above.
- **`cli-manual` kind — a new, dependency-consumption-independent record, not the task's own
  start-operation record (D85, corrects an earlier draft of this same section).**
  `start-operation.mjs`'s record exists only for steps declaring `consumesDependencies: true`
  (D53) — a direct CLI invocation of any other step (`review`, a custom agent step, anything
  else) would have no such record to write into. `workspaceOwnerId` is instead written into a
  new, small record — `tools/specs/workflow/cli-workspace-execution.mjs`
  (`.nevo-ai-local/cli-workspace-executions/<change>/<task>/<step>/attempt-<n>.json`:
  `{taskId, step, attempt, workspaceOwnerId, createdAt, status: 'active'|'completed'|'failed'}`)
  — created for **every** `cli-manual` acquisition regardless of `consumesDependencies`.
  `handleWorkflowStepStart` writes it at acquisition time; `handleWorkflowStepFinish` marks it
  `completed`/`failed` in step with the claim's own settlement-gated release (D69). This record
  participates in nothing dependency-consumption-related — no `consumptionSequence`, no
  release-epoch interaction, no remediation involvement.
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
- **`cli-manual` workspace-writer kind, `agent`-claim reuse requires trusted ambient identity
  (D62/D86).** `cli.mjs`'s `handleWorkflowStepStart` wraps its own call to `compileStepContext`
  (the actual mutation point, via `ensureStepActivated`, `step-context.mjs`, forbidden path —
  read/imported, never edited) whenever the resolved position is non-terminal:
  - **If an existing `agent`-kind claim's spec/task/attempt matches** — this is a *necessary*
    pre-check, never sufficient on its own (D86). Additionally call
    `readAgentExecutionContext(process.env, {repoRoot, specId, taskId})`
    (`tools/dashboard/server/ai/sessions/binding-service.mjs`, import only — the same function
    `autoBindAgentSession` already calls). Reuse the existing claim **only if** the resolved
    `sessionId` matches the claim's own recorded `sessionId` exactly (and `turnId`, where
    independently resolvable). If `readAgentExecutionContext` returns `null` (no ambient
    identity — a genuine manual/human terminal invocation) or the `sessionId` mismatches — do
    **not** reuse the claim; fall through to normal `cli-manual` acquisition below, which
    correctly blocks behind the live agent claim.
  - **Otherwise** — acquire a `cli-manual` claim for the attempt's own duration, first
    attempting settlement-based reconciliation of any pre-existing `agent`/`cli-manual` claim
    found via `assessExecutionSettlement` (lazy reconciliation — there is no CLI "boot" event).
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

### Dead-pid reconciliation for request-backed claims — never a bare delete (D79)

- A dead-pid finding for a `human-submit`/`publish`/`batch-publish` claim (during
  `acquireWorkspaceWriter`'s own `EEXIST` handling, above) never deletes the claim on its own.
  It surfaces `{requestId, operationRef}` from the existing claim to the *caller* (task 29 for
  `human-submit`, task 31 for `publish`/`batch-publish` — the only code with durable
  request/operation readers), which then:
  1. Loads the workspace-request by `requestId`. Missing/unresolvable → fail closed, no
     release, no mutation.
  2. Loads the referenced operation record via `operationRef` and inspects its own real state,
     reusing the exact resume/no-op/`reconciliation-required` discipline D29/D75 already apply.
  3. **Genuinely settled/completed** → `transitionWorkspaceRequest(..., to: 'completed'/'failed')`
     and `releaseWorkspaceWriterIfOwned` (D70), using the requestId-matched `ownerId`.
  4. **Ambiguous** → `transitionWorkspaceRequest(..., to: 'reconciliation-required')` and either
     retain the claim or `markWorkspaceWriterRecoveryRequiredIfOwned` — never delete
     speculatively.
- `workspace-writer.mjs` itself performs no part of steps 1–4 — it only detects the dead pid
  and hands identity back to the caller, exactly as it already does for `agent`/`cli-manual`
  settlement checks (D61/D62).

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

### Durable, physical-worktree-scoped workspace-request queue, atomic allocation, CAS execution (D72/D74/D75/D76/D77/D78, corrected D81/D82/D83)

- **`tools/specs/workflow/workspace-request.mjs` (new).** Record family at
  `.nevo-ai-local/workspace-requests/<requestId>.json` (already worktree-scoped — no separate
  worktree key needed, D65's own precedent): `{requestId, requestSequence, kind: 'human-submit'
  |'publish'|'batch-publish', specId, taskId?, createdAt, status: 'queued'|
  'waiting-for-workspace'|'running'|'completed'|'failed'|'blocked-by-recovery'|
  'reconciliation-required', workspaceOwnerId?, operationRef}`. Exports at minimum
  `createWorkspaceRequest`, `transitionWorkspaceRequest` (compare-and-set, D83, see below),
  `loadWorkspaceRequest`, `listWorkspaceRequests({status?})` (worktree-wide — never filtered by
  `specId` as the scheduling authority, D74), `findInFlightWorkspaceRequest`.
- **`requestSequence` allocation is atomic, under the workspace-control lock — never an
  unlocked scan-max-plus-one (D81, corrects an earlier draft that reused D58's own pattern
  *unlocked*).** Requests are created before workspace ownership is contended for, so two
  independent callers (an Approve and a Publish) could otherwise both read the same "current
  maximum" before either persists, colliding on the same next value. `createWorkspaceRequest`
  performs allocation and persistence as one `withWorkspaceControlLock` (D80) critical section:
  acquire the control lock → read the durable current max/next sequence → allocate → persist
  the new request with that value → release the lock.
- **Created before contention begins (D72).** A caller (task 29 for `human-submit`, task 31 for
  `publish`/`batch-publish`) creates the record with `status: 'queued'` and an `operationRef`
  naming the underlying operation's own durable identity (D76) **before** ever calling
  `acquireWorkspaceWriter` for it. This module never duplicates that operation's own payload —
  only a reference.
- **The claim embeds the exact `requestId` it belongs to — never inferred from
  `kind`/`specId`/`taskId` (D82, corrects an earlier draft's identity-field matching).** The
  caller passes its own `requestId` (and `operationRef`, for diagnostics) into
  `acquireWorkspaceWriter`, which embeds it in the claim at acquisition time, before the
  request's own record is transitioned to `running`.
- **`transitionWorkspaceRequest` uses compare-and-set semantics, not mere idempotency (D83,
  corrects D77's earlier "idempotent transitions" framing).**
  `transitionWorkspaceRequest({requestId, expectedStatus: [...], to, ...fields})` succeeds —
  and applies the mutation, under the workspace-control lock (D80) — only if the request's
  *current* persisted status is one of `expectedStatus`; otherwise it is a no-op returning
  `{transitioned: false, reason: 'state-conflict', currentStatus}`. **Every caller that acquires
  the workspace-writer claim for a request must re-read the request's own authoritative state
  and attempt `transitionWorkspaceRequest({requestId, expectedStatus: ['queued',
  'waiting-for-workspace'], to: 'running', workspaceOwnerId})` before executing anything** —
  success proceeds; failure (already `running`/`completed`/`failed`/`reconciliation-required`
  by a different processor) means the operation must **not** run again, and the just-acquired
  claim is released (ownership-conditionally, D70) instead. Workspace exclusivity alone does
  not prove a request has only one executor over its lifetime — a processor that acquires the
  now-free workspace after a different processor already completed the same request, without
  this CAS, would re-execute it.
- **Race-safe promotion to `running`, crash-window recovery matches by `requestId` (D78,
  corrected D82).** Because only one processor can win the CAS above, no two processors both
  write `running`. If a crash occurs between acquiring the claim and completing the CAS,
  restart reconciliation (D75, below) matches the still-`queued`/`waiting-for-workspace`
  request whose own `requestId` equals a *live* claim's `requestId` **exactly** — never by
  `kind`/`specId`/`taskId` — and adopts that claim's `ownerId` before continuing.
- **Reconciliation reuses D70's ownership-conditional API and D29/D50's existing
  resume/no-op/`reconciliation-required` discipline (D75), also the target of D79's dead-pid
  trigger.** A `running` request is settled by checking (a) whether a live workspace-writer
  claim still exists whose `requestId` matches this request's own, and (b) the referenced
  operation's own real state; never re-executed speculatively.
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
  proven by two different `specId`s contending for the same claim file; an `agent`/`cli-manual`-
  kind claim is **never** auto-reclaimed by this module itself — only via the
  ownership-conditional API, called by a caller that has already established settlement.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **A dead-pid finding on a request-backed claim (`human-submit`/`publish`/`batch-publish`)
  never triggers a bare delete (D79):** `acquireWorkspaceWriter` surfaces the existing claim's
  `requestId`/`operationRef` to the caller instead of deleting it — proven directly by
  asserting the claim survives an `EEXIST`-with-dead-pid contention attempt for these kinds,
  in contrast to the pre-D79 behavior a regression here would reintroduce.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **Dead-pid reconciliation for a request-backed claim resolves correctly for both outcomes
  (D79):** a dead-pid claim whose paired durable operation genuinely settled is released
  (ownership-conditionally) and its request marked `completed`; the identical claim with an
  ambiguous operation state is marked `reconciliation-required`/`recovery-required` instead —
  never deleted speculatively either way.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **A request-backed claim with no resolvable `requestId`/request record fails closed (D79):**
  no release, no mutation of the live claim.
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
  in-memory value; a `cli-manual` claim's `workspaceOwnerId`, written into the new
  `cli-workspace-execution.mjs` record, is readable across a simulated process restart (a fresh
  `require`/import, no shared module-level state). Reconciliation attempted with no persisted
  `workspaceOwnerId` available at all takes the fail-closed path — no release, no mutation of
  the live claim.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **Generic `cli-manual` ownership does not depend on `consumesDependencies` (D85):** a
  `cli-manual` claim acquired for a step that does **not** declare `consumesDependencies: true`
  still gets a `cli-workspace-execution.mjs` record and a recoverable `workspaceOwnerId` —
  proven with a fixture step that declares no dependency-consumption at all, and asserting zero
  interaction with `start-operation.mjs`/`consumptionSequence`.
  `automated: node --test tools/tests/cli-workspace-execution.test.mjs`
- **Trusted-identity `agent`-claim reuse (D86):** a CLI invocation whose spec/task match a live
  `agent`-kind claim but whose `process.env` carries no `NEVO_SESSION_ID` does not reuse that
  claim (falls through to `cli-manual` arbitration, blocking behind the agent); the identical
  invocation with a matching `NEVO_SESSION_ID` reuses it; a mismatched `NEVO_SESSION_ID` does
  not.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **Workspace-control lock makes compare-and-mutate atomic (D80):** injecting a concurrent
  acquire-and-release of the workspace-writer claim between a reconciler's own read and its
  conditional mutation attempt does not corrupt the result — the conditional mutation still
  correctly fails as `not-current-owner` against the now-different live claim, proven by
  asserting the two operations never interleave (the control lock serializes them).
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- **`requestSequence` allocation is race-safe (D81):** two `createWorkspaceRequest` calls
  issued concurrently (simulated from independent callers) receive distinct, sequential
  values — never a collision — and a retry after a simulated crash reuses the original
  allocated value rather than allocating a new one.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **Claim carries the exact `requestId` (D82):** two workspace-requests with identical
  `kind`/`specId`/`taskId` produce claims distinguishable by `requestId` alone; a crash
  simulated between claim acquisition and the request's own `running` transition is reconciled
  by matching `claim.requestId === workspaceRequest.requestId` exactly, never a
  `kind`/`specId`/`taskId` heuristic.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **`transitionWorkspaceRequest` CAS prevents double execution (D83):** a transition attempted
  with an `expectedStatus` that no longer matches the request's actual current status is a
  no-op returning `{transitioned: false, reason: 'state-conflict'}`; a processor whose CAS
  attempt fails this way does not execute the underlying operation and releases the claim it
  just acquired. Only one of two simulated concurrent processors can successfully CAS a given
  request from `queued`/`waiting-for-workspace` to `running`.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **Lock-order proof (D84):** a directed test asserts no two of {admission mutex,
  workspace-control lock, workspace-writer claim, git-finalize lease} are ever acquired in
  opposite order across the agent-admission path and the request-backed-operation path.
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
- **`requestSequence` is allocated atomically under the workspace-control lock, never an
  unlocked scan-max-plus-one** — proven for two requests created concurrently from independent
  callers (distinct, non-colliding values), and for a request retried after a simulated crash
  (the original sequence is reused verbatim, never re-allocated).
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **Promotion to `running` is race-safe via CAS, not merely "only one acquirer":** two
  simulated concurrent processors attempting `transitionWorkspaceRequest(..., to: 'running')`
  for the same request never both succeed — only one CAS wins, and the loser does not execute
  the operation.
  `automated: node --test tools/tests/workspace-request.test.mjs`
- **A process crash simulated between acquiring the workspace-writer claim and completing the
  CAS to `running` is recovered by exact `requestId` matching:** the next reconciliation pass
  finds the `queued`/`waiting-for-workspace` request whose own `requestId` equals a live
  claim's `requestId`, adopts the claim's own `ownerId` into the request record, and only then
  applies the resume/no-op/`reconciliation-required` classification — never a
  `kind`/`specId`/`taskId` heuristic.
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
node --test tools/tests/cli-workspace-execution.test.mjs
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
workspace-writer claim after settlement is assessed, running the D79 dead-pid reconciliation
sequence itself (steps 1–4, which require real session/turn/operation-record readers), and the
worktree-wide dispatch-priority policy that reads `workspace-request.mjs` (both task 29, which
has real session/turn state — this task only provides `assessExecutionSettlement`/the
ownership-conditional release/mark-recovery-required API/`workspace-request.mjs`'s own record
primitives for it to call). `handleWorkflowVerifyHuman`'s delegation to
`activateAndSubmitHumanStep` (task 29, D63 — a distinct function in the same `cli.mjs` file
this task edits only for `handleWorkflowStepStart`/`handleWorkflowStepFinish`). The new
combined human-decision operation itself, its own durable human-submit request record (D73),
and its own lease/workspace-writer/workspace-request/CAS threading; Publish's own acquisition
calls and its own workspace-request creation/CAS-execution inside
`publishTask()`/`handleBatchPublish` (owned by tasks 29 and 31 respectively — this task only
provides the primitives and wires its own `finish-operation.mjs` call site). Resolving a
`recovery-required` claim or a `reconciliation-required` request once marked (a future task's
own scope). Reopening a terminal task's workflow. Any external locking library or new runtime
dependency (the workspace-control lock reuses the same Node built-ins/atomic-file convention as
`git-finalize-lock.mjs`).
