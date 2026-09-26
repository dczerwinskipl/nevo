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

### Workspace-writer slot — a third primitive, never conflated with admission or the git-finalize lease (D55/D56, identity and release corrected D59–D62/D65/D69–D71, atomicity and identity corrected D79/D80/D82/D85/D86)

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
  'active'|'recovery-required', requestId?, operationRef?, specId, taskId?, sessionId?,
  turnId?, turnStartState?, pid?, createdAt}`. **`turnStartState: 'prepared'|'invoking'|'started'`
  is legal only for `kind: 'agent'` (D99)** — a positive, durably-written marker of how far
  `startTurn()` invocation has progressed, so absent transcript evidence during the ambiguous
  boundary is never mistaken for proof no turn was created. **`requestId` (new, D82) is present
  for every request-backed kind
  (`human-submit`/`publish`/`batch-publish`) and is the sole key reconciliation uses to match a
  claim back to its owning workspace-request** — `kind`/`specId`/`taskId` remain attribution
  fields, never a substitute identity key, since two distinct requests can share identical
  `kind`/`specId`/`taskId`. `specId`/`taskId`/`sessionId`/`turnId` identify *who* holds the
  claim for attribution and caller-side reconciliation — none of these are ever part of the
  file path, so a claim for one spec now correctly contends against an operation on a
  *different* spec sharing the same checkout. A record whose `status` is `recovery-required` is
  an unconditional block on acquisition — a plain field check, never treated as ordinary live
  contention, never auto-reclaimed by any kind's staleness check. Also maintains an in-process
  (dashboard-only) record of currently-waiting acquisition attempts, tagged by `kind`, so a
  caller can ask "is any non-agent acquisition already pending" (D57, now superseded as the
  scheduling authority by the durable request queue, D72/D74 — retained only as a local wakeup
  hint) and can distinguish `waiting-for-workspace` from `blocked-by-recovery` (D67).
- **Every record inspection-and-mutation is one atomic critical section under the
  workspace-control lock (D80).** A new, short-lived, cross-process lock —
  `.nevo-ai-local/locks/workspace-control.lock` (sibling to `git-finalize.lock`/
  `workspace-writer.lock`, same exclusive-create-plus-pid-staleness-reclaim pattern
  `git-finalize-lock.mjs` already establishes) — wraps **every** operation that reads and/or
  mutates the workspace-writer record: `acquireWorkspaceWriter`, `releaseWorkspaceWriter`,
  `releaseWorkspaceWriterIfOwned`, `markWorkspaceWriterRecoveryRequiredIfOwned`. Acquire the
  control lock → read the current record → decide → atomically create/update/delete → release
  the control lock, all as one indivisible sequence — this is what makes D70's own
  ownerId-comparison genuinely race-safe (a bare "read, then later conditionally write" is not
  one atomic unit, no matter how careful the comparison). The control lock is a **distinct
  primitive** from the workspace-writer claim itself, the git-finalize lease, and the
  agent-admission mutex (D84) — it is held only for this brief metadata step, **never** while
  waiting for the workspace itself to free up, never across an agent turn, a Publish operation,
  or a Git command.
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
  release. Any fail → mark `recovery-required` — the claim is retained, not deleted; no
  auto-clean/stash/discard of any file is ever performed. **A `cli-manual` claim releases the
  same way, gated on `assessExecutionSettlement` — never merely because `finishStep` returned
  without throwing** (a legitimate `blocked`/`input-required`/`reconciliation-required` return
  is not settlement, D69). **`kind !== 'agent', 'cli-manual'` (human-submit/publish/
  batch-publish) — dead pid never means safe to release; it means reconcile the durable request
  through one shared, generic reconciler, two-phase and lock-safe (D79, corrected
  D56/D88/D92/D95).** These kinds are now backed by a durable workspace request (D72) and a
  durable operation record (D29/D73) — a dead process may already have mutated tracked state. A
  pid mismatch is therefore never itself grounds for deletion. `acquireWorkspaceWriter`'s own
  control-lock-protected phase only **detects** the dead pid and returns a `claimSnapshot`,
  releasing the control lock before anything else runs (D92 — reconciliation's own primitives
  each acquire that same lock, so calling them while it is still held would self-deadlock).
  Only then does it call `reconcileRequestBackedWorkspaceClaim({repoRoot, claimSnapshot})`
  (`workspace-claim-reconciliation.mjs`, this area): load the workspace-request by
  `claimSnapshot.requestId` → dispatch to whichever checker is registered for `claim.kind`
  (task 29's own for `'human-submit'`, task 31's own for `'publish'`/`'batch-publish'` — an
  operation-*protocol* discriminator, never a workflow-step name), which returns a **terminal
  outcome, not merely a settlement-safety flag** (D95: `{settled: true, terminalStatus:
  'completed'|'failed'}` or `{settled: false, reason}`) → **settled** → release
  ownership-conditionally (D70) and mark the request `completed` or `failed` to match the
  checker's own `terminalStatus`, sourced from the operation's own durable record, never
  fabricated from settlement safety alone; **ambiguous** → mark the request
  `reconciliation-required` and either retain the claim or mark it `recovery-required` (never
  delete it). After reconciliation completes, `acquireWorkspaceWriter` retries from its own
  control-lock-protected detection phase against the now-current claim state. **No caller needs
  to know which kind previously owned the claim it's contending for** — this is what makes agent
  admission correctly reconcile a dead Publish claim, human-submit correctly reconcile a dead
  Batch Publish claim, Publish correctly reconcile a dead human-submit claim, and `cli-manual`
  correctly reconcile a dead Publish claim, all through one identical code path, with zero
  per-caller duplication of this logic. A request-backed claim with no resolvable
  `requestId`/request record, or whose `kind` has no registered checker, fails closed — no
  release, no mutation. Failed admission/session creation releases the workspace-writer claim
  in the same rollback path that already clears the admission "occupied" marker (D41/D49/D66).
- **Release/mark-recovery-required is ownership-conditional, never a blind
  worktree-global mutation (D70).** A *delayed* reconciliation event (a turn-terminal callback
  that finally runs after that execution's claim was already released and a different
  execution has since acquired the slot; a boot-time pass; failed-admission rollback;
  `cli-manual` settlement) must never act on whatever claim happens to be live *now* — only on
  the exact claim it was reconciling. `releaseWorkspaceWriterIfOwned`/
  `markWorkspaceWriterRecoveryRequiredIfOwned` (both new exports, `expectedOwnerId` mandatory,
  optional `expectedKind`/`expectedSpecId`/`expectedTaskId`/`expectedSessionId`/`expectedTurnId`
  for defense in depth) replace `forceReleaseWorkspaceWriter`/`markWorkspaceWriterRecoveryRequired`
  as the *ordinary* API — reusing the exact ownerId-verification discipline
  `releaseWorkspaceWriter(lease)`'s own normal release already applied, now extended to
  reconciliation call sites. A mismatch is a silent no-op (`{released: false, reason:
  'not-current-owner'}` / the mark equivalent) — never an error, never touching the live claim.
  A genuinely unconditional primitive may remain internally
  (`forceReleaseWorkspaceWriterUnsafe`), clearly marked unsafe, never called by ordinary
  orchestration code.
- **`workspaceOwnerId` persisted durably, recoverable after restart (D71, `cli-manual`'s own
  durable home corrected by D85; `agent`-kind storage corrected by D98).** For `agent` claims:
  `ownerId`/`sessionId`/`turnId`/`turnStartState` are durably recoverable directly from the
  workspace-writer claim record itself — the same record `updateWorkspaceWriterIfOwned` enriches
  at admission time — never from a separate copy on the session/turn record. D98 withdraws D71's
  original session-record persistence for this kind: a single scalar field on a session cannot
  survive `execution.session: reuse` (a later execution sharing that session would overwrite it,
  corrupting a delayed reconciliation for an earlier one), and it is unnecessary — reconciliation
  is always claim-triggered, and D65's single-claim-per-worktree uniqueness plus this module's own
  CAS/control-lock atomicity (D80/D83) already guarantee the claim record still reflects whichever
  execution most recently held it. For `cli-manual` claims: written into a new, small,
  **dependency-consumption-independent** record, `tools/specs/workflow/
  cli-workspace-execution.mjs` (`.nevo-ai-local/cli-workspace-executions/<change>/<task>/
  <step>/attempt-<n>.json`) — **not** the task's own start-operation record (D52), which exists
  only for steps declaring `consumesDependencies: true` and would leave a `cli-manual` claim on
  any other step (`review`, a custom agent step, anything else) with no durable home at all.
  This new record is created for every `cli-manual` acquisition regardless of the step's own
  `consumesDependencies` declaration, and participates in nothing dependency-consumption-related
  — no `consumptionSequence`, no release-epoch interaction, no remediation involvement (D85).
  Reconciliation reads `workspaceOwnerId` from the claim record (`agent`) or the
  `cli-workspace-execution.mjs` record (`cli-manual`) — never solely from an in-memory closure —
  to populate `expectedOwnerId`. If no persisted `workspaceOwnerId` can be found for an orphaned
  execution, identity is unestablished: never release, never mark anything — fail closed
  (`recovery-required`-equivalent).
- **An `agent`-kind claim's `sessionId` and a durable `turnStartState: 'prepared'` are enriched
  onto the exact claim before `AgentTurnRuntime.startTurn()` is ever called;
  `turnStartState: 'invoking'` immediately before invoking it; `turnId`/`turnStartState:
  'started'` atomically once it returns — never a single "before the provider executes"
  enrichment, which the real runtime API makes impossible (D89, corrected D93); session
  resolution branches on D26's `execution.session: fresh|reuse` policy; and crash classification
  is keyed on the claim's own durable `turnStartState`, never on transcript absence alone
  (D97/D98, corrected D99).** `startTurn()` (`turns/runtime.mjs`, forbidden path) allocates
  `turnId` synchronously inside its own call and schedules the actual provider spawn via
  `queueMicrotask` before the caller's own `await` resumes — no external caller can hold a
  known `turnId` and still delay that spawn without editing that forbidden file. `sessionId`,
  by contrast, is genuinely available first. Also grounded: `transcript-cache.mjs`'s own
  `recordCanonicalTurn`/`#markDirty` persist via a *debounced* flush, never synchronously — an
  absent transcript entry can never, by itself, prove `startTurn()` was never invoked (D99).
  Corrected sequence: claim acquired with no session identity → resolve `canonicalSessionId` per
  the entering transition's own D26 policy — `fresh` calls the already-accepted
  `AgentSessionService.createSession()`, which allocates and persists a new `sessionId`
  synchronously before any provider-native side effect runs; `reuse` resolves the existing target
  session's own `sessionId` via `AgentSessionService`'s existing session-lookup surface, never
  calling `createSession()` (D98; this area does not redefine D26's own reuse-selection
  mechanism) → **first** `updateWorkspaceWriterIfOwned({repoRoot, expectedOwnerId, sessionId:
  canonicalSessionId, turnStartState: 'prepared', specId, taskId})` (control-lock-protected like
  every other mutation, D80) — this enriched claim is now the sole durable ownership evidence, no
  separate session-level copy is written (D98) → **second**,
  `updateWorkspaceWriterIfOwned({..., turnStartState: 'invoking'})` alone, immediately before
  invoking `startTurn()` — only once this lands does `startTurn({..., sessionId:
  canonicalSessionId, ...})` actually get called with the already-decided `canonicalSessionId`,
  so the provider's own spawn (already scheduled internally, before this call's own `await`
  resumes) sets `NEVO_SESSION_ID` to a value that **already matches** the claim — satisfying D86
  from the very first CLI invocation even though the spawn precedes the third enrichment below —
  → once `startTurn()`'s own promise resolves, **third**, `updateWorkspaceWriterIfOwned({...,
  sessionId: canonicalSessionId, turnId, turnStartState: 'started', ...})` adds `turnId` and
  advances `turnStartState` together, one atomic merge. Each enrichment call is
  ownership-conditional — a mismatch fails the whole admission closed (first call) or simply
  fails to modify a newer claim (later calls, which never gate the turn's own already-real
  existence). Because `turnId` and `turnStartState: 'started'` land together, a claim observed as
  `'started'` is guaranteed to carry `turnId` — no separate "started but missing turnId" case
  exists. **Crash classification (D97, corrected D99), keyed on `turnStartState`, never on
  transcript absence alone:** a crash before the first enrichment leaves a `sessionId`-less claim,
  treated identically to D71's own unestablished-identity case; `turnStartState: 'prepared'` →
  `startTurn()` had not yet begun, settles normally via `assessExecutionSettlement` with **no
  transcript evidence required**; `turnStartState: 'invoking'` (the ambiguous boundary) is
  resolved by inspecting the same evidence `reconcileOrphanedTurns()` already uses — a genuinely
  discovered turn is recovered and enriched (advancing to `'started'`), but **no matching evidence
  is inconclusive, never proof of absence, and fails closed** (`recovery-required`) rather than
  settling normally or guessing either way; `turnStartState: 'started'` → `ownerId` + the
  canonical `sessionId` + `turnId` (guaranteed present) are fully authoritative on their own.
- **`cli-manual` kind — every deterministic CLI entry point participates too (D62), reuse of an
  existing `agent` claim requires trusted ambient identity (D86).** `cli.mjs`'s
  `handleWorkflowStepStart`/`handleWorkflowStepFinish` (task 27, already an allowed path) wrap
  `compileStepContext`'s own mutation (`ensureStepActivated`) in the same protocol: reuse an
  already-covering `agent`-kind claim **only when this CLI invocation's own trusted ambient
  execution identity — `readAgentExecutionContext(process.env, {...})`
  (`sessions/binding-service.mjs`, the same function `autoBindAgentSession` already calls,
  populated only by real provider spawn code via `NEVO_SESSION_ID`/`NEVO_AGENT_PROVIDER`/
  `NEVO_AGENT_PROVIDER_SESSION_ID` env vars, never a CLI argument) — resolves a `sessionId`
  matching the live claim's own recorded `sessionId` exactly** (spec/task/attempt equality
  alone is a necessary pre-check, never sufficient, D86); otherwise acquire/release a
  `cli-manual` claim for the attempt's own duration, releasing it (ownership-conditionally,
  D70) only once `assessExecutionSettlement` reports settled after `finishStep` settles —
  whatever its outcome (D69). A `cli-manual` claim abandoned by a crashed CLI process is
  reconciled lazily — attempted by the same `cli.mjs` wrapper the next time any caller tries
  to acquire the slot and finds it, via `assessExecutionSettlement`, exactly as Hooks 1/3
  reconcile an `agent`-kind claim.
- **Priority: pending user mutations before the next automatic agent item (D57), read from the
  durable request queue, not the in-process waiter list (D72/D74).** Before dispatching the
  sequential queue's `nextRunnable` item through `admitAgentExecution`,
  `automatic-workflow-continuation` (task 29) checks the durable workspace-request queue
  (below) for the **whole physical worktree** — never `listPendingWorkspaceWriters(specId)`
  scoped to one spec, since D65 already made the underlying claim itself worktree-scoped and
  D57's own resource is that same worktree. This area exposes both the in-process pending-
  waiters view (a local wakeup hint only) and the durable request-queue query task 29 actually
  uses for dispatch; it does not itself decide dispatch order.
- **Canonical lock ordering, extended to the workspace-control lock (D66/D84).** Admission
  mutex (agent-only) always acquired before the workspace-control lock, never the reverse, and
  no other kind ever touches the admission mutex at all; the workspace-control lock is always
  the innermost, briefest-held primitive — never held while waiting on the workspace-writer
  claim's own contention, an agent turn, a Publish operation, or the git-finalize lease — see
  `areas/workflow-continuation-and-session-handover.md` for the full ordering and rollback rule
  this area's primitives must support.

### Durable, physical-worktree-scoped workspace-request queue (D72/D74/D75/D76/D77/D78, allocation and CAS corrected D81/D82/D83)

- **Durable record, not an in-process promise (D72).** `.nevo-ai-local/workspace-requests/
  <requestId>.json` (new module, `workspace-request.mjs`, this area, living beside
  `workspace-writer.mjs`): `{requestId, requestSequence, kind: 'human-submit'|'publish'|
  'batch-publish', specId, taskId?, createdAt, status: 'queued'|'waiting-for-workspace'|
  'running'|'completed'|'failed'|'blocked-by-recovery'|'reconciliation-required',
  workspaceOwnerId?, operationRef}`. A request is persisted `status: 'queued'` **before** it
  ever begins contending for the workspace-writer slot — this is what makes the
  `waiting-for-workspace`/`blocked-by-recovery` promise (D67) survive a dashboard restart, not
  merely a promise kept only as long as the process stays up.
- **`requestSequence` allocation is atomic, under the workspace-control lock — never an
  unlocked scan-max-plus-one (D81, corrects D72's own original phrasing).** Because requests
  are created *before* workspace ownership is contended for, two independent callers (an
  Approve and a Publish, say) can otherwise both read the same "current maximum" before either
  persists, colliding on the same next value and breaking D74's own FIFO guarantee. Allocation
  and persistence happen inside one workspace-control-lock-protected critical section (D80):
  acquire the lock → read the durable current max/next sequence → allocate → persist the new
  request with that value → release the lock.
- **Coordinates, never duplicates, the underlying operation (D76).** `operationRef` names the
  identity of Publish's/Batch Publish's own already-durable operation record (D29), or the new
  human-submit operation record (D73) — the request never copies that payload, and never
  reimplements that operation's own stage machine.
- **One generic lifecycle, storing the acquired owner id, with compare-and-set transitions —
  not merely "idempotent" (D77, corrected D83).** `queued` → `waiting-for-workspace` →
  `running` → `completed`/`failed`, with `blocked-by-recovery`/`reconciliation-required` as
  side states. `transitionWorkspaceRequest({requestId, expectedStatus: [...], to, ...fields})`
  succeeds — and applies the mutation, under the same workspace-control lock (D80) — only when
  the request's *current* persisted status is one of `expectedStatus`; otherwise it is a no-op
  returning `{transitioned: false, reason: 'state-conflict', currentStatus}`. **Workspace
  exclusivity alone does not prove one request has only one executor over its lifetime** —
  processor A can run request R to completion and release, and a processor B holding a stale
  view of R could later acquire the now-free workspace and, without this check, execute R a
  second time. Every processor therefore re-reads R's own authoritative state and attempts
  `transitionWorkspaceRequest({requestId, expectedStatus: ['queued', 'waiting-for-workspace'],
  to: 'running', workspaceOwnerId})` immediately after acquiring the workspace-writer claim,
  **before** executing anything: success → proceed; failure (already `running`/`completed`/
  `failed`/`reconciliation-required`) → do not execute, release the just-acquired claim
  (ownership-conditionally, D70) instead.
- **The workspace-writer claim carries the exact `requestId` it belongs to — never inferred
  from `kind`/`specId`/`taskId` alone (D82, corrects D78's own original phrasing).** Two
  distinct requests (e.g. two separate human-submit requests for the same spec/task) can share
  identical `kind`/`specId`/`taskId` — that triple is not a unique key. `acquireWorkspaceWriter`
  embeds `requestId` into the claim at acquisition time, before the request's own record is
  transitioned to `running`. **Race-safe promotion to `running` (D78):** only the processor
  that actually receives the `acquireWorkspaceWriter` grant attempts the CAS transition above.
  If a crash occurs between acquiring the claim and persisting `running`, restart
  reconciliation (D75, below) finds the still-`queued`/`waiting-for-workspace` request whose
  own `requestId` matches a *live* claim's `requestId` **exactly** — never by
  `kind`/`specId`/`taskId` heuristic — and adopts that claim's own `ownerId` into the request
  before continuing.
- **Restart reconciliation reuses D29/D50's own "resume, no-op, or fail closed with
  `reconciliation-required` — never guess" discipline (D75).** `queued`/`waiting-for-workspace`
  requests simply restore scheduling eligibility; `blocked-by-recovery` requests remain
  blocked; a `running` request is checked against its own `operationRef`'s real state and the
  live workspace-writer claim's `requestId` (D82) before being classified `completed`,
  `reconciliation-required`, or (if the live claim already matches) resumed to correctness —
  never speculatively re-executed. A dead-pid finding on a request-backed claim runs this exact
  same reconciliation (D79) — pid liveness never triggers a bare delete for these kinds.

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
- The agent-admission lock, the workspace-control lock, the workspace-writer slot, and the
  git-finalize lease are four distinct primitives with four distinct roles (D55/D80) — no
  artifact describes one as a synonym or substitute for another.
- Every read-decide-mutate step over the workspace-writer record happens inside the
  workspace-control lock's own critical section — no file performs a read, then a separate,
  later conditional write, of that record outside the lock (D80).
- The workspace-control lock is never held while waiting for the workspace-writer claim
  itself, while an agent turn/Publish operation runs, or while a Git command executes (D80/D84).
- A request-backed workspace-writer claim is never matched to its owning request by
  `kind`/`specId`/`taskId` alone — always by `requestId` (D82).
- A dead pid on a request-backed claim (`human-submit`/`publish`/`batch-publish`) never
  triggers a bare delete — it always triggers durable request/operation reconciliation (D79).
- No processor executes a workspace request's underlying operation without first re-reading the
  request's own authoritative state and successfully CAS-transitioning it to `running` (D83).
- A `cli-manual` claim's `workspaceOwnerId` is never persisted into a step's own start-operation
  record (D52) — that record exists only for `consumesDependencies` steps; a separate,
  dependency-consumption-independent record is the durable home for every `cli-manual` claim
  (D85).
- Reuse of an existing `agent`-kind claim by a CLI invocation is never decided from spec/task
  equality alone — always corroborated by trusted ambient execution identity (D86).
- `consumptionSequence` is never allocated from an in-memory counter — always derived from
  and frozen into the durable start-operation record before activation (D58).
- A workspace-writer claim's release is never triggered by AI/session turn-terminal alone —
  always gated on a proven-settled result from `assessExecutionSettlement` (D59/D60); no file
  in this area calls the release/mark-recovery-required API from a terminal/orphan-detection
  hook directly, only after that settlement check.
- No auto-clean, auto-stash, or auto-discard of any tracked or untracked file, ever, as part
  of workspace-writer reconciliation (D61).
- No reconciliation path mutates or removes a workspace-writer claim without first verifying
  `ownerId` (and any other supplied identity field) against the *current* live record — no
  file calls `forceReleaseWorkspaceWriterUnsafe` from ordinary orchestration code (D70).
- No file introduces a second, competing durable state machine for Publish's or human-submit's
  own mutation — the workspace-request record only coordinates waiting/scheduling and
  references the real operation's identity (D76).
- The durable workspace-request queue is scoped to the physical worktree, never filtered by
  `specId`, when used as D57's scheduling authority (D65/D74).
- A human-submit workspace claim is never released in a bare `finally` — always gated on
  `assessExecutionSettlement`, and always released after (never before) its durable operation/
  request records are marked terminal (D87).
- No acquisition path (agent admission, human-submit, Publish, Batch Publish, `cli-manual`)
  contains its own copy of D79's dead-pid reconciliation logic — every path reaches the same
  `reconcileRequestBackedWorkspaceClaim`, dispatching by registered kind (D88).
- **The workspace-control lock is never recursively/nestedly acquired by one call chain (D92) —
  this is not the same as "no lock during a workspace-request transition or claim release."**
  Phase A's own acquisition inside `acquireWorkspaceWriter` is always released before it reads
  operation records, runs settlement/checker logic, invokes a registered reconciler, calls
  `transitionWorkspaceRequest`/`releaseWorkspaceWriterIfOwned`/
  `markWorkspaceWriterRecoveryRequiredIfOwned`, runs Git commands, or waits/backs off. Each of
  those primitives remains intentionally control-lock-protected for its own short, freshly-
  acquired critical section (D80/D83's own CAS atomicity is unweakened) — no file describes the
  lock as absent during those calls, only as never held open *across* them by an outer caller.
- An `agent`-kind claim's `sessionId` is enriched before `AgentTurnRuntime.startTurn()` is ever
  called; `turnId` only after it returns — never a single "before the provider spawns"
  enrichment, which the real runtime API makes impossible (D89, corrected D93). `turnId`'s
  absence during that narrow window never blocks a legitimate CLI reuse on `sessionId` alone.
- At most one non-terminal human-submit operation exists per `(change, task, step, attempt)` —
  no file creates a second concurrent one for the same attempt; a terminal record at that exact
  key is read via `loadHumanSubmitOperation`, never `findInFlightHumanSubmitOperation` (which
  intentionally excludes it), and is never overwritten by a later, stale submission (D90/D94).
- A request-backed operation's own durable intent record is always written before its paired
  workspace-request becomes durable, never after (D91).
- Every D88 operation-kind checker is registered from a module every relevant process already
  imports — never from a dashboard-only route/handler file (D96); no reconciliation for any
  currently-supported kind depends on incidental module-import order.

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s epoch-aware release logic;
`acquireGitFinalizeLease`/`withGitFinalizeLock`; the workspace-control lock (internal to
`workspace-writer.mjs`, not exposed directly); `workspace-writer.mjs`'s acquire/
ownership-conditional-release/ownership-conditional-mark-recovery-required/ownership-
conditional-enrichment (`updateWorkspaceWriterIfOwned`, D89)/pending-waiters primitives, all
control-lock-protected; `execution-settlement.mjs`'s `assessExecutionSettlement`;
`workspace-claim-reconciliation.mjs`'s `reconcileRequestBackedWorkspaceClaim`/
`registerRequestKindReconciler` (D88); `workspace-request.mjs`'s durable request-queue
primitives (D72/D75-D78, including atomic `requestSequence` allocation and CAS
`transitionWorkspaceRequest`, D81/D83); `cli-workspace-execution.mjs`'s durable `cli-manual`
owner-id record (D85); the start-operation module (D52, including `consumptionSequence`
allocation — unaffected by this pass); `dependency-consumption.mjs`'s step-scoped write/read
primitives and sequence-based authoritative-record resolution; the remediation-group derivation
function and its durable record primitives; `projectSuspensions(task, change)`; `cli.mjs`'s
`handleWorkflowStepStart`/`handleWorkflowStepFinish` `cli-manual`-kind workspace-writer
wrapping, including the trusted ambient-identity reuse check (D86).

Consumed by: `tools/specs/workflow/cli.mjs` (the D52 start-operation flow for a
`consumesDependencies` step, and its own `cli-manual` workspace-writer wrapping — now also
reading `readAgentExecutionContext` for trusted claim-reuse, D86, and writing
`cli-workspace-execution.mjs` records, D85 — around `handleWorkflowStepStart`/
`handleWorkflowStepFinish`, both owned by this area/task 27; `handleWorkflowVerifyHuman`'s
delegation to `activateAndSubmitHumanStep` is owned by task 29, D63, a distinct function in the
same file), `finish-operation.mjs` (acquires/accepts the git-finalize lease),
`automatic-workflow-continuation` (task 29 — reads release/invalidation state; claims the
workspace-writer slot for agent admission and for `activateAndSubmitHumanStep`, resolving
canonical session identity per D26's `fresh|reuse` policy and enriching `workspaceOwnerId`
directly onto that claim (D98, never a separate session-level copy); creates/transitions a
durable human-submit
workspace-request via CAS; reconciles dead-pid request-backed claims, D79; queries the durable,
worktree-wide request queue before dispatching the next automatic agent item; imports
`assessExecutionSettlement` and the ownership-conditional API for Hooks 1/3),
`publish/operation.mjs` (task 31 — `publishTask()` itself claims the workspace-writer slot for
the whole operation through `push`, embeds its own `requestId` into the claim, and acquires its
own git-finalize lease, D64/D68/D82; creates/transitions its own durable workspace-request via
CAS; reconciles its own dead-pid claims, D79), `readiness-policy.mjs`,
`areas/deterministic-sequential-queue.md`, `areas/dependency-invalidation-remediation-review.md`.

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
  until that state is explicitly cleared. A failed agent admission releases both the admission
  marker and the workspace-writer claim together.
- **Dead pid on a request-backed claim never means safe release (D79):** a `human-submit`/
  `publish`/`batch-publish` claim whose recorded pid is confirmed dead, but whose paired
  workspace-request shows a genuinely completed underlying operation, is released
  ownership-conditionally and the request marked `completed`; the identical claim with an
  *ambiguous* underlying operation state is instead marked `reconciliation-required`/
  `recovery-required` — never deleted merely because the pid is dead.
- **`cli-manual` parity:** a direct/manual `workflow step start` invocation with no covering
  dashboard-orchestrated claim acquires its own `cli-manual` workspace-writer claim and is
  blocked identically by a concurrently-active agent execution or Publish; `workflow step
  finish` releases a `cli-manual` claim it owns only once `assessExecutionSettlement` reports
  settled after `finishStep` settles — a legitimate `blocked`/`input-required`/
  `reconciliation-required` return leaves the claim held.
- **`workflow verify-human --approve`/`--request-changes`** acquires the workspace-writer slot
  and git-finalize lease via `activateAndSubmitHumanStep` identically to the dashboard's own
  combined submit — proven by racing it against an active agent execution the same way the
  dashboard path is raced.
- **`publishTask()` called directly** (no dashboard route, no CLI wrapper — a bare domain
  call) still waits for an active agent's workspace-writer claim, and holds its own claim
  through `push`, not merely through commit — proving the arbitration lives inside
  `publishTask()` itself (D64) and covers the whole operation (D68).
- **Stale-reconciliation race, proven directly (D70):** execution A's claim is released
  normally; execution B then acquires the same physical-worktree claim; a delayed
  reconciliation call carrying A's own captured `ownerId` is attempted against the live
  record — it is rejected as `not-current-owner` and B's claim is completely unaffected,
  proven for both the release and the mark-recovery-required paths.
- **`workspaceOwnerId` recoverable after restart (D71, corrected D98):** boot-time reconciliation
  for an orphaned agent turn reads `ownerId`/`sessionId`/`turnId` directly from the workspace-
  writer claim record itself (not an in-memory value, and not a separate session-level copy) and
  performs a conditional release/mark against it; if the claim carries no `sessionId`, no
  release/mark is attempted at all.
- **Durable workspace-request survives restart (D72/D75):** a request persisted `queued`/
  `waiting-for-workspace` before a simulated dashboard restart is rediscovered afterward with
  identical content and resumes contending for the slot; a `running` request whose underlying
  operation actually completed is reconciled to `completed`, never re-executed.
- **Worktree-wide scheduling (D74):** Spec A's agent finishes with Spec B's Publish request
  already `queued`/`waiting-for-workspace` and Spec A's own next agent item also eligible — the
  dispatch-priority check defers Spec A's next agent item until Spec B's Publish request is no
  longer pending, proven directly using two independent fixture specs sharing one worktree.
- **Race-safe request promotion (D78/D82):** two simulated concurrent processors for the same
  request never both write `status: 'running'`; a crash simulated between acquiring the claim
  and persisting that fact is recovered by the next reconciliation pass, which matches the live
  claim to the exact request by `requestId` — never by `kind`/`specId`/`taskId` — and adopts the
  claim's own `ownerId` into the request record before proceeding.
- **Workspace-control lock guards every record mutation (D80):** a stale reconciliation
  callback's read-then-conditionally-mutate sequence is proven race-safe by injecting a
  concurrent acquire-and-release between the callback's own read and its mutation attempt — the
  callback's conditional release/mark still correctly fails as `not-current-owner`, because the
  compare-and-mutate happened as one control-lock-protected unit, not two separate operations.
- **Atomic `requestSequence` allocation (D81):** two workspace requests created concurrently
  (simulated from independent callers/processes) receive distinct, sequential
  `requestSequence` values — never a collision — and this ordering remains monotonic across a
  simulated process restart.
- **`requestId` uniquely identifies a claim's owning request (D82):** two human-submit requests
  for the identical spec/task remain unambiguously distinguishable via their own claims'
  `requestId`; a crash after claim acquisition but before the request's own `running`
  transition is reconciled using the exact `requestId` match, never a `kind`/`specId`/`taskId`
  heuristic.
- **Request CAS prevents double execution (D83):** processor A completes request R and
  releases; processor B, holding a stale pre-completion view of R, later acquires the now-free
  workspace but its own `transitionWorkspaceRequest` CAS to `running` fails against R's actual
  `completed` state — B does not execute R's operation again, and releases the claim it just
  acquired. Only one processor can ever successfully CAS a given request from
  `queued`/`waiting-for-workspace` to `running`.
- **Generic `cli-manual` ownership works for any step (D85):** a direct CLI invocation of a
  step that does **not** declare `consumesDependencies: true` (e.g. `review`, or a
  newly-authored custom agent step) still acquires a `cli-manual` claim, persists its
  `workspaceOwnerId` into the new `cli-workspace-execution.mjs` record, and recovers it
  identically to the `consumesDependencies` case — proven with zero coupling to
  `consumptionSequence`/`start-operation.mjs`.
- **Trusted CLI→agent claim reuse (D86):** a CLI invocation whose spec/task match a live
  `agent`-kind claim, but whose ambient environment carries no `NEVO_SESSION_ID` (or a
  `NEVO_SESSION_ID` that does not match the claim's own recorded `sessionId`), does **not**
  reuse that claim — it falls through to normal `cli-manual` arbitration and blocks behind the
  active agent; a CLI invocation whose ambient `NEVO_SESSION_ID` exactly matches the live
  claim's own `sessionId` does reuse it.
- **Lock-order proof (D84):** a directed-acquisition-order test exercises the admission mutex,
  workspace-control lock, workspace-writer claim, and git-finalize lease across every
  documented path (agent admission, human-submit, Publish) and finds no pair of paths acquiring
  any two of these primitives in opposite order — no cycle is constructible.
- **Human-submit release is settlement-gated, never a bare `finally` (D87):** a human-submit
  whose `finishStep` returns `reconciliation-required`, or throws after `startHumanStep`'s own
  mutation, does **not** release the workspace-writer claim; a successful submission marks the
  durable operation/request `completed` *before* releasing the claim; a crash after the commit
  lands but before those markers are written is recovered on restart by the same settlement
  check, releasing the exact claim only once the records are settled.
- **Generic reconciliation is truly kind-agnostic (D88):** an agent admission encountering a
  dead Publish claim, a human-submit encountering a dead Batch Publish claim, a Publish
  encountering a dead human-submit claim, and a `cli-manual` acquisition encountering a dead
  Publish claim all resolve through the identical `reconcileRequestBackedWorkspaceClaim` call —
  no acquisition path contains its own duplicated D79 algorithm for a kind it doesn't own.
- **Agent claim identity enrichment, two steps, grounded in the real runtime API (D89,
  corrected D93):** a fresh agent admission's claim carries no session identity immediately
  after acquisition and does carry the exact `sessionId` before `startTurn()` is ever called;
  the provider's own spawn sets `NEVO_SESSION_ID` matching it from the first invocation; `turnId`
  is added only after `startTurn()`'s own promise resolves, and its absence during that window
  never blocks a legitimate CLI reuse on `sessionId` alone; a stale enrichment attempt using an
  already-superseded `ownerId` fails as `not-current-owner` and cannot modify a newer claim; a
  crash before `sessionId` enrichment leaves the claim's identity unestablished and restart
  reconciliation takes no release/mark action.
- **`turnStartState` crash classification never assumes "not started" from absent transcript
  evidence (D97, corrected D99):** the claim is durably `'prepared'` after `sessionId`
  enrichment and before `startTurn()` is ever invoked, `'invoking'` immediately before the call,
  and `turnId`/`'started'` atomically once it returns. A crash at `'prepared'` settles normally
  via `assessExecutionSettlement` with **no transcript-cache lookup required**. A crash at
  `'invoking'` (the ambiguous boundary) is resolved by inspecting transcript-cache evidence — a
  genuinely-registered turn is discovered and its `turnId` recovered/enriched (advancing to
  `'started'`), but **no matching evidence is inconclusive, never proof of absence, and fails
  closed** (`recovery-required`) rather than settling normally or guessing either way. A crash at
  `'started'` is safely reconciled by `ownerId` + canonical `sessionId` + `turnId` (guaranteed
  present by the atomic write) alone.
- **`execution.session: reuse` with an old persisted transcript but no newly-flushed turn still
  treats `'invoking'` as ambiguous, never "not started" (D99):** a session already carrying an
  older, unrelated turn from a prior execution is never mistaken for evidence about a newer
  execution's own, not-yet-flushed turn.
- **D26 `session: fresh|reuse` is respected and ownership evidence is reuse-safe (D98):** a
  `fresh`-policy transition creates a new canonical session and follows D93/D99's sequence; a
  `reuse`-policy transition resolves the existing target session's `sessionId` without ever
  calling `createSession()`; both enrich the claim with that canonical `sessionId` before
  `startTurn()` is invoked; two sequential executions reusing one canonical session but owning
  distinct workspace claims cannot let a delayed reconciliation for the older execution read or
  mutate the newer execution's claim, because Hook 1's own reconciliation for the older execution
  sources `expectedOwnerId`/`expectedSessionId`/`expectedTurnId` from that execution's own
  admission-time-captured identity — never from whichever claim happens to be currently live
  (D100) — and Hook 3/lazy reconciliation always starts from a fresh snapshot of the current
  claim, never a historical one.
- **Human-submit duplicate/conflict invariant, step-scoped (D90, corrected D94):** two rapid,
  identical submissions for one non-terminal attempt collapse to one durable request; a
  conflicting second decision for that same non-terminal attempt is rejected without
  overwriting the first; a new human-submit operation is created normally once the prior one is
  terminal and the workflow has moved to a later attempt; two different human-owned steps of
  the same task, both at attempt 1, persist to distinct paths; a stale submission against an
  already-terminal `(step, attempt)` never overwrites that historical record.
- **Durable operation-record-before-workspace-request ordering (D91):** for each of
  human-submit, Publish, and Batch Publish, a crash simulated immediately after workspace-
  request creation finds the referenced `operationRef` already resolving to real, durably-
  written intent — never a dangling reference.

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
claim, or a `reconciliation-required` workspace-request, once marked (D61/D75 — this pass
defines the states and their blocking behavior; the actual reconciliation workflow/tooling for
an operator to clear them is a future task's own scope). **Cross-spec workspace-writer
arbitration is no longer out of scope — it is the explicit, required behavior as of D65**,
since the workspace-writer record is now keyed by the physical worktree, not by `specId`.
Deciding *when* to reclaim an agent-kind claim after settlement (task 29's own judgment,
D71 — this area only provides the ownership-conditional API and the durable field's meaning).
The new durable human-submit operation record's own shape/creation (D73, task 29) and Publish's
own workspace-request creation/transitions (D76, task 31) — this area only provides
`workspace-request.mjs`'s generic primitives.
