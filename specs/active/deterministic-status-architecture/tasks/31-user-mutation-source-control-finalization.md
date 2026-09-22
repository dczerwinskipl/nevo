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
  - tools/specs/store.mjs
  - src/**
depends_on: [ dependency-release-and-invalidation ]
semantic_references:
  decisions: [D29, D30, D47, D50, D51, D55, D56, D64, D65, D67, D68, D70, D72, D76, D77]
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
  confirmed convention). Then mutate (`setTaskStatus`), commit (`chore(workflow): publish
  <task-id>`), push (per resolved `sourceControl` config), and mark the record `completed`.
- On the next `publishTask()` invocation, resume from any `findInFlightOperationRecord`
  result exactly as `finish-operation.mjs`'s own `planFinish` does — reconcile an ambiguous
  `running` stage against real repository/task state (resume, no-op, or fail closed with
  `reconciliation-required`), never guess.
- **Create the durable workspace-request before any contention begins (D72/D76).** Inside
  `publishTask()`, before calling `acquireWorkspaceWriter` at all, create a workspace-request
  record (`workspace-request.mjs`, task 27 — import only; `kind: 'publish'`) with
  `operationRef` naming the Publish operation's own identity
  (`operationFilePath(repoRoot, change, task, 'publish', attempt)` convention) — `status:
  'queued'`. The equivalent `kind: 'batch-publish'` request is created in `handleBatchPublish`
  before its own first `acquireWorkspaceWriter` call.
- **Claim the workspace-writer slot first, inside `publishTask()` itself, held through the
  whole operation including `push`, then the git-finalize lease nested inside it for the
  mutate-then-commit instant specifically (D47/D50/D55/D64/D68).** Inside `publishTask()`
  (`publish/operation.mjs`) — never only in a caller — call
  `acquireWorkspaceWriter({kind: 'publish'})` — imported from `tools/specs/workflow/
  workspace-writer.mjs`, task 27, import only, do not edit that file — waiting if an agent
  execution or another writer (for this spec or any other sharing the same physical worktree,
  D65) currently holds the slot, transitioning the workspace-request to
  `waiting-for-workspace` while it does. If the existing claim's `status` is
  `recovery-required`, transition the request to `blocked-by-recovery` (D67) rather than
  waiting silently forever. Once acquired: transition the request to `running`, storing the
  acquired `workspaceOwnerId` into its own record (D77) — before any tracked mutation begins.
  Then call `withGitFinalizeLock(fn)` — with **no** `existingLease` argument, since Publish has
  no inner call into `finishStep`/`activateAndSubmitHumanStep`; it acquires its own fresh
  lease, runs its own mutate-then-commit sequence (from `setTaskStatus` through the commit
  call) inside `fn`, and releases automatically — `push` and marking the durable operation
  record `completed` run **after** the lease releases, still inside the workspace-writer
  claim. **Release the workspace-writer claim only once `push` completes and the durable
  operation record reaches its own terminal state (success or failure)** — via
  `releaseWorkspaceWriterIfOwned` using the `workspaceOwnerId` this operation itself stored
  (D70), never an unconditional release. Mark the paired workspace-request `completed`/`failed`
  to match. For Batch Publish, the equivalent `acquireWorkspaceWriter({kind:
  'batch-publish'})` call lives in `handleBatchPublish` (`routes.mjs`) around the whole batch
  sequence, held through its own `push` identically — since Batch Publish has no CLI
  equivalent and its atomic multi-task record already lives at that layer — never duplicated
  inside the per-task `publishTask()` calls it reuses for prevalidation.
  `acquireWorkspaceWriter`'s own internal bounded retry timeout is never surfaced directly as
  a Publish failure (D67) — retry transparently across it while the request's own reported
  status stays `waiting-for-workspace`.
- **Restart reconciliation reuses D75's discipline, never re-executes speculatively.** A
  workspace-request found `running` after a restart is checked against its own `operationRef`'s
  real durable-operation state and the live workspace-writer claim's identity (via
  `workspaceOwnerId`) before being classified `completed` (if the operation genuinely finished),
  `reconciliation-required` (ambiguous), or resumed — never blindly re-published. A crash
  simulated between acquiring the claim and persisting `{status: 'running',
  workspaceOwnerId}` into the request is recovered the same way (D78) — the next reconciliation
  pass matches the live claim to the request by identity and adopts its `ownerId`.
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
- **Race-safe promotion (D78):** a crash simulated between acquiring the workspace-writer
  claim and persisting `{status: 'running', workspaceOwnerId}` into the request is recovered
  by the next reconciliation pass, which adopts the live claim's own `ownerId` into the
  request record before proceeding.
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
`execution-settlement.mjs` — this task only calls their existing, genuinely-exported
functions, never edits them. Deciding dispatch priority between a pending Publish and the next
automatic agent item, worktree-wide or otherwise (owned by task 29, D57/D74). The
workspace-writer record's own physical-worktree keying and the ownership-conditional API's own
mechanics (D65/D70 — this task only calls `acquireWorkspaceWriter`/
`releaseWorkspaceWriterIfOwned`, already correctly implemented by task 27). Resolving a
`recovery-required` claim or a `reconciliation-required` request once marked (D61/D75 — a
future task's own scope; this task only reports `blocked-by-recovery`/creates and transitions
its own request, D67/D72). Retroactively re-classifying every other existing dashboard action
against the new taxonomy.
