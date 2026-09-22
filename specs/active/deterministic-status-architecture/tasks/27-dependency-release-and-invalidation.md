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
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
  - tools/tests/workflow-start-operation.test.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/execution-settlement.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/publish/**
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D50, D51, D52, D53, D55, D56, D58, D59, D60, D61, D62, D65, D66]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model. Implement D50/D51's corrected git-finalize lease.
Implement D55/D56's **workspace-writer** slot — a third, distinct primitive from agent
admission and the git-finalize lease — durable, recoverable, reconciled by `kind`, now
**keyed by the physical worktree, not `specId`** (D65) and releasable **only on proven
execution settlement**, never bare turn-terminal (D59/D60/D61). Implement the new
`execution-settlement.mjs` primitive (D60). Implement the `cli-manual` workspace-writer kind
so raw CLI invocations of `workflow step start`/`workflow step finish` participate in the same
arbitration as dashboard-orchestrated agent executions (D62). Implement D52's durable
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
    from the pending-waiters list.
  - `forceReleaseWorkspaceWriter({repoRoot})` — unconditional release. **Constrained (D61):
    documented as callable only by a caller that has already established settlement** (via
    `assessExecutionSettlement`) for an `agent`/`cli-manual` claim, or genuine unconditional
    process-lifetime pid-mismatch staleness for any other kind — never as a default "clean up
    an ambiguous owner" operation.
  - `markWorkspaceWriterRecoveryRequired({repoRoot})` (new, D61) — flips the existing record's
    `status` to `recovery-required` **without deleting it**. The claim stays held.
  - `listPendingWorkspaceWriters(specId)` — returns the in-process pending-waiters list
    (`kind`, `requestedAt`) for D57's dispatch-priority check, filtered to waiters whose
    recorded `specId` differs from the current holder's own `specId` where relevant to the
    caller (task 29 decides how to interpret cross-spec waiters for its own dispatch policy;
    this module only reports the raw list).
- This module never decides *when* to release an agent's or `cli-manual`'s claim, and never
  attempts settlement checking on its own initiative (that requires session/turn/workflow
  state this module doesn't have) — only how the claim is stored, atomically acquired, and
  forcibly released or marked `recovery-required` when told to.

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
  is no CLI "boot" event). `handleWorkflowStepFinish` releases a `cli-manual` claim it owns
  immediately, synchronously, once `finishStep` returns successfully (commit landed —
  settlement is trivial and in-process here, no async check needed).

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
  itself — only via `forceReleaseWorkspaceWriter`, called by a caller that has already
  established settlement.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- `listPendingWorkspaceWriters` correctly reports a queued non-agent acquisition attempt
  while the slot is held by another kind.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- A workspace-writer record marked `recovery-required` is never granted to a new acquirer by
  any kind's staleness check, including a confirmed-dead pid on a `human-submit`/`publish`
  claim that happens to share the file — the field check takes precedence.
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
  attempt releases the `cli-manual` claim immediately upon `finishStep`'s own successful,
  in-process completion.
  `automated: node --test tools/tests/workspace-writer.test.mjs`
- A `cli-manual` claim abandoned by a crashed CLI process (no matching `workflow step finish`
  ever ran) is neither auto-released nor silently stolen by the next acquisition attempt —
  `assessExecutionSettlement` is consulted first, and an unsettled result marks
  `recovery-required` rather than granting the slot.
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
node --test tools/tests/execution-settlement.test.mjs
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
workspace-writer claim after settlement is assessed, and the dispatch-priority policy that
reads `listPendingWorkspaceWriters` (both task 29, which has real session/turn state — this
task only provides `assessExecutionSettlement`/`forceReleaseWorkspaceWriter`/
`markWorkspaceWriterRecoveryRequired` for it to call). `handleWorkflowVerifyHuman`'s
delegation to `activateAndSubmitHumanStep` (task 29, D63 — a distinct function in the same
`cli.mjs` file this task edits only for `handleWorkflowStepStart`/`handleWorkflowStepFinish`).
The new combined human-decision operation itself and its own lease/workspace-writer
threading, and Publish's own acquisition calls inside `publishTask()`/`handleBatchPublish`
(owned by tasks 29 and 31 respectively — this task only provides the primitives and wires its
own `finish-operation.mjs` call site). Resolving a `recovery-required` claim once marked (a
future task's own scope). Reopening a terminal task's workflow. Any external locking library
or new runtime dependency.
