---
id: deterministic-status-architecture.user-mutation-source-control-finalization
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/user-mutation-source-control-ownership.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/publish/operation.mjs
  - tools/dashboard/server/specs/routes.mjs
  - docs/development/agent-workflow-protocol.md
  - tools/tests/workflow-task-publish.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/workspace-request.mjs
  - tools/specs/workflow/workspace-claim-reconciliation.mjs
  - tools/specs/store.mjs
  - src/**
depends_on: [ dependency-release-and-invalidation ]
semantic_references:
  decisions: [D29, D30, D47, D50, D51, D55, D56, D64, D65, D67, D68, D70, D72, D76, D77, D79, D81, D82, D83, D88, D91, D92, D95, D96]
---

# Task: User-mutation source-control finalization (corrected — durable operation, atomic batch, workspace-writer-aware)

## Goal

Make `workflow task publish`/Batch Publish durable standalone operations (D29, corrected):
`CommitAndPushAction` alone does not inherit `finishStep`'s crash/resume semantics — those
come from `operation-record.mjs`'s intent-then-verify pattern. `publishTask()` reuses that
same pattern directly. Batch Publish is one atomic operation (prevalidate all → mutate all →
one commit → optional push), not one commit per task. **`publishTask()` itself (D64) —** not
merely its dashboard-route caller **—** additionally claims the shared **workspace-writer
slot** (D55, `kind: 'publish'`, keyed by the physical worktree not `specId`, D65) **for the
entire operation, through `push` and the durable record reaching `completed` — never released
merely after the git-finalize-protected commit (D68, corrected pass 16)** — and the
git-finalize lease (D47/D50) nested inside it, around the mutate-then-commit sequence
specifically — so a concurrently-active agent execution *for this spec or any other sharing
the same checkout* (which itself holds the workspace-writer slot for its whole turn, D55/D65)
cannot have its dirty worktree/uncommitted `change.yaml` interfered with by Publish, and vice
versa, and so a *second* writer's own commit-and-push can never interleave with this
operation's still-in-flight push. Release is **ownership-conditional**
(`releaseWorkspaceWriterIfOwned`, using this operation's own stored `workspaceOwnerId`, D70) —
never a blind, unconditional release that could touch a different operation's claim if
reconciliation runs late. Batch Publish's own `kind: 'batch-publish'` claim is acquired in
`handleBatchPublish` (`routes.mjs`, dashboard-only — no CLI equivalent exists), around its own
whole prevalidate-then-mutate-then-commit-then-push sequence, not inside the per-task
`publishTask()` calls it reuses for prevalidation logic only. **A durable workspace-request
(D72) is created *before* either path ever calls `acquireWorkspaceWriter`**, referencing
Publish's own already-durable operation record via `operationRef` rather than duplicating it
(D76) — this is what makes a pending Publish/Batch Publish request's
`waiting-for-workspace`/`blocked-by-recovery` status (D67) survive a dashboard restart, not
merely a promise kept only as long as the process stays up. Document the three-way ownership
taxonomy (D30) in `docs/development/agent-workflow-protocol.md`'s existing section.

## Implementation constraints

- **`createOperationRecord` is private to `finish-operation.mjs`, not exported (corrected,
  pass 11) — do not import it.** `operation-record.mjs`'s actual exports are only
  `operationFilePath`/`loadOperationRecord`/`saveOperationRecord`/`findInFlightOperationRecord`.
  `publishTask()` (`publish/operation.mjs`) defines its own small, local record-shaping
  helper — its own `PUBLISH_STAGE_IDS = ['validate', 'update-task', 'commit', 'push']` and a
  trivial function building `{operationId, change, task, step: 'publish', attempt, status:
  'running', operations: PUBLISH_STAGE_IDS.map(id => ({id, status: 'pending'}))}`, following
  the exact shape `finish-operation.mjs`'s own private `createOperationRecord` uses — then
  calls the four genuinely-exported persistence functions directly
  (`operationFilePath`/`saveOperationRecord`/`loadOperationRecord`/
  `findInFlightOperationRecord`), never a cross-file import of the private function itself.
  Record path: `operationFilePath(repoRoot, change, task, 'publish', attempt)` →
  `.nevo-ai-local/workflow-operations/<change>/<task>/publish/attempt-<n>.json` (the real,
  confirmed convention).
- **This durable operation record is written *first* — before the paired workspace-request,
  before any workspace contention (D91).** `publishTask()`'s own sequence: (1) write the
  operation record above, `status: 'running'`, all stages `pending` — this touches only
  `.nevo-ai-local` runtime state, never a tracked file, so it needs no workspace protection at
  all; (2) create the paired workspace-request (`workspace-request.mjs`, task 27 — import only;
  `kind: 'publish'`, its own atomically-allocated `requestSequence`, D81 — this task never
  scans/allocates it directly), `operationRef` naming that now-real record's own identity,
  `status: 'queued'`; (3) only then call `acquireWorkspaceWriter`. This ordering guarantees a
  workspace-request can never survive a crash pointing at intent that was never durably
  written. The equivalent `kind: 'batch-publish'` sequence (batch operation record, then its
  own paired request) is created in `handleBatchPublish` before its own first
  `acquireWorkspaceWriter` call. Then mutate (`setTaskStatus`), commit (`chore(workflow):
  publish <task-id>`), push (per resolved `sourceControl` config), and mark the record
  `completed`.
- On the next `publishTask()` invocation, resume from any `findInFlightOperationRecord`
  result exactly as `finish-operation.mjs`'s own `planFinish` does — reconcile an ambiguous
  `running` stage against real repository/task state (resume, no-op, or fail closed with
  `reconciliation-required`), never guess.
- **Register `'publish'`/`'batch-publish'` checkers into the generic reconciler at
  `publish/operation.mjs`'s own module-load time — never from `routes.mjs` (D88, corrected
  D92/D95/D96).** **Both** `registerRequestKindReconciler('publish', checkerFn)` **and**
  `registerRequestKindReconciler('batch-publish', checkerFn)` are called from
  `publish/operation.mjs` (`workspace-claim-reconciliation.mjs`, task 27 — import only) — the
  one domain module both `cli.mjs` and `routes.mjs` already import identically. The
  `'batch-publish'` checker itself only needs to *inspect* the referenced Batch-Publish
  operation record (`findInFlightOperationRecord` against the `_batch-publish` pseudo-taskId
  path, unchanged D29 logic) — it has no dependency on `handleBatchPublish`'s own mutation
  orchestration, which stays in `routes.mjs` exactly as D64 already established (dashboard-only,
  no CLI equivalent). Registering the *checker* from `publish/operation.mjs` therefore makes it
  available in **every** process that can call `acquireWorkspaceWriter` — including a bare CLI
  process running `workflow step start`/`workflow task publish` that never imports `routes.mjs`
  at all (D96) — while the actual batch mutation flow remains exactly where D64 put it. Each
  `checkerFn` returns **`{settled: true, terminalStatus: 'completed'}`** once the commit (and
  push, where configured) genuinely landed, **`{settled: true, terminalStatus: 'failed'}`** if
  the operation's own durable record shows it failed at some stage, or `{settled: false, reason,
  reconciliationRequired: true}` otherwise — `terminalStatus` is read from the operation
  record's own actual stage outcome, never fabricated from settlement safety alone (D95). This
  task supplies **no** dead-pid reconciliation code of its own for claims of any kind, and never
  calls `transitionWorkspaceRequest`/`releaseWorkspaceWriterIfOwned` directly from inside a
  registered checker — `acquireWorkspaceWriter`'s own two-phase acquisition (D92) calls the
  shared `reconcileRequestBackedWorkspaceClaim` (task 27) *after* releasing its own
  workspace-control lock, dispatching to whichever checker matches the encountered claim's own
  `kind`, including a dead human-submit or Batch Publish claim this task's own Publish path
  might encounter.
- **Claim the workspace-writer slot first, embedding this request's own `requestId`, inside
  `publishTask()` itself, held through the whole operation including `push`, then the
  git-finalize lease nested inside it for the mutate-then-commit instant specifically
  (D47/D50/D55/D64/D68/D82).** Inside `publishTask()` (`publish/operation.mjs`) — never only in
  a caller — call `acquireWorkspaceWriter({kind: 'publish', requestId, operationRef, specId,
  taskId})` — imported from `tools/specs/workflow/workspace-writer.mjs`, task 27, import only,
  do not edit that file — waiting if an agent execution or another writer (for this spec or any
  other sharing the same physical worktree, D65) currently holds the slot, transitioning the
  workspace-request to `waiting-for-workspace` while it does. If the existing claim's `status`
  is `recovery-required`, transition the request to `blocked-by-recovery` (D67) rather than
  waiting silently forever. **A dead pid on any pre-existing request-backed claim found here is
  reconciled by `acquireWorkspaceWriter`'s own internal, generic call to
  `reconcileRequestBackedWorkspaceClaim` (task 27, D88)** — never deleted merely because the
  pid is dead, and this task supplies no kind-specific reconciliation code of its own, even for
  a dead claim of a *different* kind (e.g. a stale human-submit claim this Publish attempt
  happens to encounter).
  Once acquired: **re-read this request's own authoritative durable state and attempt
  `transitionWorkspaceRequest({requestId, expectedStatus: ['queued', 'waiting-for-workspace'],
  to: 'running', workspaceOwnerId})` (D83)** — a failed CAS (another processor already
  transitioned this exact request, e.g. two concurrent `publishTask()` invocations for the same
  request) means: release the just-acquired claim (ownership-conditionally) and do **not**
  mutate/commit/push; only a successful CAS proceeds, before any tracked mutation begins. Then
  call `withGitFinalizeLock(fn)` — with **no** `existingLease` argument, since Publish has no
  inner call into `finishStep`/`activateAndSubmitHumanStep`; it acquires its own fresh lease,
  runs its own mutate-then-commit sequence (from `setTaskStatus` through the commit call) inside
  `fn`, and releases automatically — `push` and marking the durable operation record `completed`
  run **after** the lease releases, still inside the workspace-writer claim. **Release the
  workspace-writer claim only once `push` completes and the durable operation record reaches
  its own terminal state (success or failure)** — via `releaseWorkspaceWriterIfOwned` using the
  `workspaceOwnerId` this operation itself stored (D70), never an unconditional release. Mark
  the paired workspace-request `completed`/`failed` to match. For Batch Publish, the equivalent
  `acquireWorkspaceWriter({kind: 'batch-publish', requestId, ...})` call, its own CAS to
  `running`, and its own dead-pid reconciliation all live in `handleBatchPublish` (`routes.mjs`)
  around the whole batch sequence, held through its own `push` identically — since Batch
  Publish has no CLI equivalent and its atomic multi-task record already lives at that layer —
  never duplicated inside the per-task `publishTask()` calls it reuses for prevalidation.
  `acquireWorkspaceWriter`'s own internal bounded retry timeout is never surfaced directly as
  a Publish failure (D67) — retry transparently across it while the request's own reported
  status stays `waiting-for-workspace`.
- **Restart reconciliation reuses D75's discipline, never re-executes speculatively.** A
  workspace-request found `running` after a restart is checked against its own `operationRef`'s
  real durable-operation state and the live workspace-writer claim's own `requestId` (D82,
  never `kind`/`specId`/`taskId`) before being classified `completed` (if the operation
  genuinely finished), `reconciliation-required` (ambiguous), or resumed — never blindly
  re-published. A crash simulated between acquiring the claim and completing the CAS to
  `running` is recovered the same way (D78/D82) — the next reconciliation pass matches the
  live claim to the request by exact `requestId` and adopts its `ownerId`.
- **Batch Publish, atomic, real path convention (corrected, pass 11).** Extend
  `handleBatchPublish` (`routes.mjs`): prevalidate every selected task first (reuse
  `publishTask()`'s own validation logic without its mutation/commit stages); only if all
  pass, write **one** durable record spanning the whole set via
  `operationFilePath(repoRoot, change, '_batch-publish', 'publish', attempt)` →
  `.nevo-ai-local/workflow-operations/<change>/_batch-publish/publish/attempt-<n>.json` (the
  real four-segment shape — a three-segment path with no step-name level, used in an earlier
  draft of this task, does not match `operationFilePath`'s actual signature and would not
  round-trip through it or `findInFlightOperationRecord` correctly); mutate every selected
  task's status; one deterministic combined commit (`chore(workflow): publish <id-1>,
  <id-2>, ...`, bounded/summarized if long); optional push. If any task fails prevalidation,
  mutate none and commit nothing.
- Extend `docs/development/agent-workflow-protocol.md`'s existing ownership-boundaries
  section (no new file, D3) with the three D30 categories, using Publish/`workflow step
  start`/`submitHumanStepResult` as the worked examples.

## Acceptance criteria

- After a successful `workflow task publish` against a real worktree (`sourceControl`
  enabled), `git status` shows no uncommitted change to `change.yaml` — proven against a real
  temporary worktree, not a mocked commit call.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- The generated commit message is exactly `chore(workflow): publish <task-id>` for a
  single-task publish.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- A crash simulated between the durable-record write and the commit landing is reconciled on
  the next `publishTask()` invocation identically in kind to how `finish-operation.mjs`'s own
  stages reconcile an ambiguous intent — resumed, no-op, or a clear `reconciliation-required`
  error, proven by forcing exactly this ordering.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Batch Publish of three tasks where one fails prevalidation publishes **none** of the three
  — proven directly (no partial mutation, no partial commit).
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Batch Publish of three passing tasks produces exactly one commit naming all three.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- `docs/development/agent-workflow-protocol.md`'s existing ownership section states the
  three-category taxonomy, extending the existing section.
  `automated: node tools/docs.mjs validate`
- A concurrently-running agent `finishStep` for a different task in the same change waits for
  `withGitFinalizeLock` rather than committing while Publish's own mutation is uncommitted —
  proven by racing the two directly, not merely by absence of a flaky failure.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publish attempted while an agent execution actively holds the workspace-writer slot (source
  files genuinely dirty from that agent's own in-progress edits, not merely mid-commit) waits
  for the slot rather than proceeding — and never fails with a scope error caused by the
  agent's own unrelated dirty files, and never observes/absorbs the agent's own uncommitted
  `change.yaml` state.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Once the agent's execution releases the workspace-writer slot, a Publish request that was
  waiting proceeds and completes normally.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Calling `publishTask()` directly (no dashboard route, no CLI wrapper) still waits for an
  active agent's workspace-writer claim — proving the arbitration lives inside `publishTask()`
  itself (D64).
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publish for spec B waits while an agent execution for a **different** spec, A, sharing the
  same physical worktree, actively holds the workspace-writer slot (D65) — proven directly,
  not merely for the same-spec case.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- A Publish request waiting on an agent claim that is subsequently marked `recovery-required`
  (rather than released) reports `blocked-by-recovery`, never a timeout failure, and remains
  pending rather than erroring out (D67).
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Claim held through `push`, not just commit (D68):** a second writer attempting to acquire
  the workspace-writer slot while Publish has committed but not yet pushed still waits —
  proven by holding `push` open (a controllable fake remote/test double) and asserting the
  second writer has not acquired the slot until after `push` completes and the durable record
  reaches `completed`.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Ownership-conditional release (D70):** a delayed reconciliation call carrying a *previous*
  Publish attempt's own captured `ownerId`, invoked after that attempt's claim was already
  released and a different operation has since acquired it, is rejected as `not-current-owner`
  and does not touch the new operation's claim.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Durable workspace-request created before contention begins (D72):** the request record
  exists with `status: 'queued'` immediately after `publishTask()`/`handleBatchPublish` is
  invoked, before `acquireWorkspaceWriter` is ever called.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Request survives restart (D72/D75):** a Publish whose workspace-request is still
  `queued`/`waiting-for-workspace` when a restart is simulated is rediscovered afterward with
  identical content and resumes contending for the slot; a `running` request whose underlying
  Publish operation actually completed is reconciled to `completed`, never re-published.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **No duplicated state machine (D76):** the workspace-request's own status never disagrees
  with Publish's own durable operation record, for both the success and the
  `reconciliation-required` paths.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Race-safe promotion (D78/D82):** a crash simulated between acquiring the workspace-writer
  claim and completing the CAS to `running` is recovered by the next reconciliation pass, which
  matches the live claim to the exact request by `requestId` — never `kind`/`specId`/`taskId`
  — and adopts its own `ownerId` into the request record before proceeding.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Dead pid on a Publish/Batch Publish claim never triggers a bare delete (D79/D88):** a claim
  whose recorded pid is confirmed dead but whose commit genuinely landed (per the durable
  operation record) is released and the request marked `completed`; the identical claim with
  an ambiguous/partial commit state is instead marked `reconciliation-required`/
  `recovery-required` — never deleted merely because the pid is dead.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Publish encountering a dead human-submit claim invokes the same generic reconciler (D88):**
  proven directly with a fixture whose `'human-submit'` checker is registered by a different
  module — this task's own Publish acquisition code contains no branch recognizing that kind.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Durable operation record precedes its paired workspace-request (D91):** the Publish
  operation record exists (via `findInFlightOperationRecord`) at the exact moment the
  workspace-request is first persisted — proven by a crash simulated immediately after request
  creation, confirming `operationRef` already resolves to real, durable intent.
- **A settled failed Publish becomes a `failed` workspace-request, never `completed` (D95):** a
  fixture where the durable Publish operation record itself shows a failed stage results in the
  registered `'publish'` checker returning `{settled: true, terminalStatus: 'failed'}`, and the
  workspace-request transitions to `failed`, not `completed` — the claim is still released
  either way.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **A fresh CLI process reconciles a dead `batch-publish` claim without ever importing
  `routes.mjs` (D96):** a fixture that persists a `batch-publish` workspace claim, kills the
  owning process, and runs `workflow step start`/`workflow task publish` from a fresh process
  that never imports the dashboard's `routes.mjs` module at all — the generic reconciler still
  finds the `'batch-publish'` checker (registered from `publish/operation.mjs`) and resolves the
  claim correctly.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Registration for `'publish'` and `'batch-publish'` is available independent of module-import
  order (D96):** importing `publish/operation.mjs` alone (without ever importing `routes.mjs`)
  registers both checkers.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **Atomic `requestSequence` under concurrent creation (D81):** two workspace requests created
  back-to-back from independent callers (e.g. a concurrent Approve and Publish, or two
  concurrent Publish attempts) receive distinct, non-colliding `requestSequence` values.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- **CAS prevents double-publish (D83):** a second processor holding a stale pre-completion view
  of an already-completed Publish request fails its own `transitionWorkspaceRequest` CAS to
  `running` against the request's actual `completed` state, releases the workspace-writer claim
  it just acquired, and does not run `publishTask()`'s own mutate/commit/push sequence again.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-task-publish.test.mjs
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Redesigning `commit-and-push` itself. Any change whatsoever to `finish-operation.mjs`/
`operation-record.mjs`/`git-finalize-lock.mjs`/`workspace-writer.mjs`/`workspace-request.mjs`/
`execution-settlement.mjs`/`workspace-control-lock.mjs` — this task only calls their existing,
genuinely-exported functions, never edits them. Deciding dispatch priority between a pending
Publish and the next automatic agent item, worktree-wide or otherwise (owned by task 29,
D57/D74). The workspace-writer record's own physical-worktree keying, the ownership-conditional
API's own mechanics, `requestSequence`'s own atomic-allocation implementation, and
`transitionWorkspaceRequest`'s own CAS mechanics (D65/D70/D80/D81/D83 — this task only calls
`acquireWorkspaceWriter`/`releaseWorkspaceWriterIfOwned`/`createWorkspaceRequest`/
`transitionWorkspaceRequest`, already correctly implemented by task 27). Resolving a
`recovery-required` claim or a `reconciliation-required` request once marked (D61/D75 — a
future task's own scope; this task only reports `blocked-by-recovery`/creates and transitions
its own request, D67/D72). The generic `reconcileRequestBackedWorkspaceClaim`/
`registerRequestKindReconciler` mechanics themselves (`workspace-claim-reconciliation.mjs`,
task 27, D88 — this task only registers its own `'publish'`/`'batch-publish'` checkers into
it). Human-submit's own settlement-gated release ordering, duplicate/conflict invariant, and
checker registration (task 29, D87/D90). Retroactively re-classifying every other existing
dashboard action against the new taxonomy.
