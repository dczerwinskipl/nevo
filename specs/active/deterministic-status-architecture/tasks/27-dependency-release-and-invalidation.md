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
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
  - tools/tests/workflow-start-operation.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/publish/**
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D50, D51, D52, D53, D54]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model. Implement D50/D51's corrected git-finalize lease:
lease-passing (never recursive acquisition), boundary wrapping from `finishStep`'s first
tracked mutation through its commit, and PID-liveness-based stale-owner recovery. Implement
D52's durable start-operation record so step activation and its dependency-consumption
snapshot become jointly durable and crash-resumable. Implement D53's declarative
`consumesDependencies`-driven recording trigger and step-scoped record identity. Implement
D54's authoritative-record (latest-per-dependency) remediation matching. Implement D31's
evidence-based remediation-group derivation and D44's separate `SuspensionProjection`.

## Implementation constraints

### Release/invalidation (D40)

- `dependency-satisfaction.mjs`: scan the full `workflow_progress.history` for the latest
  entry whose matched transition declares `releasesDependencies: true` (its `{step, attempt}`
  is the release epoch); satisfied via this path iff no **later** entry's matched transition
  declares `invalidatesDependencyRelease: true`. Unchanged terminal-`outcome:success` path.

### Git-finalize lease — corrected boundary and lease-passing (D50)

- **`tools/specs/workflow/git-finalize-lock.mjs`** exports `acquireGitFinalizeLease({repoRoot,
  timeoutMs?})` (returns `{ownerId, release()}`) and `withGitFinalizeLock(fn, existingLease?)`.
  With no `existingLease`: acquire fresh, run `fn(lease)`, release in `finally`. With an
  `existingLease`: run `fn(existingLease)` directly — **no** new acquisition, **no** release
  (the original acquirer owns that). Never implicit/automatic reentrancy — only explicit
  lease-passing.
- **`finish-operation.mjs`, small additive change:** move the existing (or newly-added) lock
  acquisition to wrap from **before `ensureUpdateTask` begins** through **after
  `ensureCommit` completes** (`finally`) — not merely around the commit call.
  `push`/`transition` stages run outside the lease. `finishStep`'s public surface gains an
  optional `finalizeLease` input (threaded via its existing `context`) — when present, used
  as `existingLease`; when absent, `finishStep` acquires its own exactly as a normal
  CLI-driven `workflow step finish` always has.
- Do not restructure `FINISH_STAGE_IDS`'s own sequence — this is a lock-acquisition-point
  change only.

### Stale-lease recovery (D51)

- Lease file `.nevo-ai-local/locks/git-finalize.lock`: `{ownerId, pid, createdAt}`.
  Acquisition: exclusive create; on `EEXIST`, `process.kill(existing.pid, 0)` — `ESRCH` means
  stale (delete + retry immediately); otherwise retry-with-backoff up to a bounded overall
  timeout, then fail with a clear error naming the file and holder pid. Release: verify
  `ownerId` match before deleting; skip deletion on mismatch (never error loudly for this
  benign race).

### Durable start-operation (D52) + declarative trigger (D53)

- **`tools/specs/workflow/start-operation.mjs` (new):** record family at
  `.nevo-ai-local/workflow-start-operations/<change>/<task>/<step>/attempt-<n>.json`, own
  atomic-write primitives (distinct from `operation-record.mjs`'s own family — do not import/
  extend that module for this). Exports `planStart`, `completeActivateStage`,
  `completeConsumptionStage`, `findInFlightStartOperation`.
- **`tools/specs/workflow/dependency-consumption.mjs`:** exports
  `recordDependencyConsumption({repoRoot, change, consumingTaskId, consumingStep,
  consumingAttempt, dependencies: [{taskId, releaseEpoch}]})` writing
  `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json`, and
  `findConsumersOfEpoch({repoRoot, change, dependencyTaskId, releaseEpoch})`.
- **Call-site insertion, `cli.mjs`'s `handleWorkflowStepStart`:** when the **target step**
  declares `consumesDependencies: true` (read from the normalized definition — never a
  literal step-name comparison):
  1. Check `findInFlightStartOperation` first (resume path). If found, resume from its
     already-frozen `dependencySnapshot`, completing whichever of `activate`/
     `record-consumption` stages remain pending, idempotently. If the live
     `workflow_progress` state is inconsistent with what the record expects, fail closed with
     a clear reconciliation error.
  2. Fresh path: resolve dependency satisfaction now (`checkTaskDependencies`/
     `evaluateDependencySatisfaction`), freeze every release-based dependency into a snapshot,
     call `planStart` (writes the record, `status: 'running'`).
  3. Call `ensureStepActivated`. Call `completeActivateStage`.
  4. Call `recordDependencyConsumption` using the **frozen** snapshot (never re-resolved).
     Call `completeConsumptionStage` (marks overall `status: 'completed'`).
- This triggers on **every** activation of a `consumesDependencies` step, any attempt number
  — never gated on the task's own first-activation/history.

### Step-scoped identity, authoritative-record matching (D53/D54)

- Consumption record path includes `<step>`, per above. `findConsumersOfEpoch` first resolves
  each candidate task's **authoritative** record for the target `dependencyTaskId` (the
  highest `consumingAttempt` among same-`consumingStep` records naming that dependency), then
  matches only against that record.

### Remediation-group derivation, suspensions, `SuspensionProjection` (D31/D37/D44)

- Unchanged in shape from the prior pass: evidence-based group derivation (now via D54's
  authoritative matching), `suspensions` (not `blockedBy`), durable
  `remediation-record.mjs`, `suspension-projection.mjs` kept fully separate from
  `task-projection.mjs` (forbidden path, untouched), one additive check in
  `readiness-policy.mjs`.

## Acceptance criteria

- A dependency released remains released across further non-invalidating transitions; a
  declared invalidation revokes it.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `finishStep` acquires its lease before `ensureUpdateTask` runs — proven by a test that
  holds the lease externally and asserts the mutation stage itself waits, not only commit.
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- A caller passing an already-held lease into `finishStep` (via `finalizeLease`) triggers
  exactly zero additional acquisitions — proven directly, and proven not to deadlock.
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- Two independent callers with no shared lease serialize correctly.
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- A lease file left by a confirmed-dead pid is reclaimed without manual intervention; a lease
  held by a live pid is never stolen (a competing acquirer times out with a clear error if
  the holder never releases).
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- A crash simulated between `ensureStepActivated` succeeding and the consumption write
  completing is fully recovered on the next `workflow step start` — the consumption record is
  completed from the **original** frozen snapshot, not a newly-resolved one.
  `automated: node --test tools/tests/workflow-start-operation.test.mjs`
- A task depending on two upstream tasks, both release-based, records both in one atomic
  write at a single declared-step activation; invalidating either epoch is found by
  `findConsumersOfEpoch`.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A task can record dependency consumption again on a later attempt of a declared-consuming
  step (rework) — attempt 1 consumes epoch #1, attempt 2 (after invalidation and a fix)
  consumes a fresh epoch #2 of the same dependency.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Invalidating epoch #2 (the authoritative record) finds this consumer; invalidating the
  earlier, superseded epoch #1 does not.
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
  lock-acquisition wrap, proven by a test holding the lease externally and asserting
  `finishStep`'s mutation stage waits for it.
  `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/git-finalize-lock.test.mjs
node --test tools/tests/workflow-start-operation.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`deterministic-sequential-queue`, task 28).
The combined cross-task-aware review and `suspensions`-clearing
(`dependency-invalidation-remediation-review`, task 30). The `releasesDependencies`/
`invalidatesDependencyRelease`/`consumesDependencies` schema fields themselves
(`workflow-continuation-schema`, task 25). The new combined human-decision operation itself
and its own lease-threading, and Publish's own lease acquisition (owned by tasks 29 and 31
respectively — this task only provides the primitives and wires its own `finish-operation.mjs`
call site). Reopening a terminal task's workflow. Any external locking library or new runtime
dependency.
