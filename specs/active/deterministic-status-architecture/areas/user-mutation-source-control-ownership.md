# Area: User-mutation source-control ownership

## Responsibility

Make `workflow task publish` (and Batch Publish) own their own Git mutation end to end
(D29), closing the gap the real dogfooding run exposed: a standalone user mutation
(`change.yaml`'s `status: approved`) left dirty in the worktree, silently absorbed into an
unrelated agent's later finalize commit. Document the general ownership taxonomy this
mistake reveals (D30) so future dashboard actions are classified correctly before they're
built, rather than after a similar incident.

## Current state (grounded, 2026-09-21)

`publishTask()` (`tools/specs/workflow/publish/operation.mjs`) validates, calls
`setTaskStatus(change, taskId, 'approved')`, and returns — no commit/push call anywhere in
this file or in `store.mjs`. The reusable `commit-and-push` action
(`defaultActionRegistry.require('commit-and-push')`) is already registered and already called
by `finish-operation.mjs`'s own finalize sequence, but is not invoked from the publish path.
`docs/development/agent-workflow-protocol.md`'s existing ownership-boundaries section (D3's
precedent for where this kind of doc lives) does not yet distinguish standalone user
mutations from technical activations from completed lifecycle mutations.

## Requirements

- **Publish is a durable standalone operation, reusing `finishStep`'s real durability
  primitives — not a bare `commit-and-push` call (D29, corrected).** `CommitAndPushAction`
  alone does **not** inherit `finishStep`'s crash/resume semantics — those come from
  `operation-record.mjs`'s intent-then-verify pattern, not from the Git action by itself.
  `publishTask()` becomes: validate → durable intent (a
  `.nevo-ai-local/workflow-operations/<change>/<task>/publish/attempt-<n>.json` record) →
  mutate (`setTaskStatus`) → commit → push (only if the resolved `sourceControl` config
  enables it) → mark the record completed.
- **Reuse only the genuinely-exported primitives (D29, corrected pass 11 — `createOperationRecord`
  is not one of them).** A fresh read of `operation-record.mjs` in full found
  `createOperationRecord` is a **private, non-exported** function inside
  `finish-operation.mjs` — only `operationFilePath`/`loadOperationRecord`/
  `saveOperationRecord`/`findInFlightOperationRecord` are actually exported. Publish defines
  its own small, local record-shaping helper (its own `PUBLISH_STAGE_IDS = ['validate',
  'update-task', 'commit', 'push']`, following the exact shape convention
  `finish-operation.mjs`'s private helper uses) and reuses only the four genuinely-exported
  functions — never a cross-file import of `createOperationRecord` itself.
- **Deterministic commit message.** Auto-generate `chore(workflow): publish <task-id>` for a
  single-task publish.
- **Batch Publish is one atomic operation, not one commit per task, using the real path
  convention (D29, corrected).** One dashboard "Publish selected tasks" action is one durable
  operation record spanning the whole selected set at
  `.nevo-ai-local/workflow-operations/<change>/_batch-publish/publish/attempt-<n>.json` —
  `operationFilePath(repoRoot, changeSlug, taskId, stepName, attempt)`'s real signature always
  produces a **four-segment** path (`<change>/<taskId>/<stepName>/attempt-<n>.json`); the
  original three-segment path (missing the step-name level) did not match this and would not
  round-trip through the real primitives. Corrected: pseudo-`taskId` `_batch-publish`, real
  step name `publish`, calling `operationFilePath` exactly as a single-task publish does.
  Prevalidate **every** selected task first; only if all pass does mutation begin; mutate
  every selected task's status; one deterministic combined commit (e.g. `chore(workflow):
  publish <id-1>, <id-2>, ...`, bounded/summarized if the list is long) → optional push. If
  any task fails prevalidation, **none** are published. Never prompt the user for a commit
  message for either the single-task or batch case.
- **Clean-worktree guarantee preserved, and serialized against concurrent finalize operations
  (D47).** A durable record left `running` after a crash is reconciled the same way
  `finish-operation.mjs`'s own stages already reconcile an ambiguous intent (resume, no-op, or
  fail closed with `reconciliation-required` — never guess). `publishTask()`/Batch Publish
  additionally acquire `withGitFinalizeLock` (`git-finalize-lock.mjs`, owned by
  `dependency-release-and-invalidation`, task 27) around their own mutate-then-commit
  sequence — the same lock agent-driven `finishStep` and the new combined human-decision
  operation acquire, since a concurrently-running agent turn for a different task in the same
  change (legal under D45) could otherwise sweep Publish's own uncommitted mutation into its
  commit, the exact class of bug this whole area exists to fix.
- **Workspace-writer slot claimed first, git-finalize lease nested inside — inside
  `publishTask()` itself, not only in one caller (D55/D56/D64, corrected pass 15).** The
  git-finalize lease alone only protects the mutate-then-commit instant — it does not protect
  the whole period an agent execution actively holds the shared worktree between its own
  `workflow step start` succeeding and its own eventual finish. **`publishTask()`
  (`tools/specs/workflow/publish/operation.mjs`) itself** — the one function both `cli.mjs`'s
  `handleWorkflowTaskPublish` and the dashboard's Publish route call identically — therefore
  first calls `acquireWorkspaceWriter({kind: 'publish'})` (`workspace-writer.mjs`, task 27,
  keyed by the physical worktree, D65, not by `specId`) — waiting if an agent execution or any
  other writer currently holds the slot — and only once held, acquires `withGitFinalizeLock`
  nested inside it around the mutate-then-commit sequence specifically. Because the claim
  lives inside the shared domain function itself, the CLI, the dashboard route, and any direct
  test/tool call into `publishTask()` all get identical protection — safety does not depend on
  which caller remembered to arrange it (D64). This guarantees Publish never observes, is
  scoped-error-blocked by, or absorbs an actively-editing agent's own dirty source
  files/uncommitted `change.yaml` — including an agent execution belonging to a **different**
  spec that happens to share this same physical worktree (D65). Batch Publish is the one
  exception: its `kind: 'batch-publish'` claim is acquired in `handleBatchPublish`
  (`routes.mjs`, dashboard-only — no CLI equivalent exists) around the whole
  prevalidate-then-mutate-then-commit sequence, not inside the per-task `publishTask()` calls
  it reuses for prevalidation logic only. **The workspace-writer claim is held through the
  entire operation, including `push` and the durable record reaching `completed` — never
  released merely after the git-finalize-protected commit (D68, corrected pass 16).** Releasing
  it right after commit would let a second writer's own commit-and-push interleave with this
  operation's still-in-flight push; the git-finalize lease itself remains exactly as narrow as
  D50/D51 already established — only the outer workspace-writer boundary widens. Release is
  ownership-conditional (`releaseWorkspaceWriterIfOwned`, using the `workspaceOwnerId` this
  operation stored when it acquired the claim, D70) — never a blind, unconditional release
  that could touch a different operation's claim if this reconciliation runs late. A pending
  Publish/Batch Publish request that has not yet acquired the slot reports
  `waiting-for-workspace` or `blocked-by-recovery` (D67) — never a generic failure merely
  because the current holder is taking a while — and that pending state is itself durable
  (below), surviving a dashboard restart.
- **A durable workspace-request coordinates waiting, referencing Publish's own operation record
  rather than duplicating it (D72/D76).** Before `publishTask()`/`handleBatchPublish` ever
  calls `acquireWorkspaceWriter`, a workspace-request record (`kind: 'publish'`/
  `'batch-publish'`) is persisted `status: 'queued'`, naming the about-to-run Publish
  operation's own identity (`operationFilePath`'s convention) via `operationRef` — never
  copying its payload. The request is promoted to `running` (storing the acquired
  `workspaceOwnerId`) only once the claim is actually acquired, and to `completed`/`failed`
  once Publish's own existing durable record reaches its own terminal state — the request never
  maintains an independent copy of Publish's `validate/update-task/commit/push` stage machine.
- **Ownership taxonomy documented (D30), corrected (pass 12 — human-step auto-activation
  removed as an example).** Extend `docs/development/agent-workflow-protocol.md`'s existing
  ownership-boundaries section (no new doc file, per D3's precedent) with three explicit
  categories: (1) standalone user-originated Git-tracked mutation (must finalize its own
  commit/push — e.g. Publish); (2) technical activation that is part of an execution attempt
  (may remain part of that attempt, finalized by its own `workflow step finish` — e.g.
  `workflow step start`); (3) completed lifecycle mutation (already owns its own finalize,
  unchanged — e.g. `submitHumanStepResult`/`finishStep`, and, per D47, the new combined human
  `activateAndSubmitHumanStep` operation, which owns both its own activation *and* its own
  finalize as a single unit — it is not an instance of category (2), since D47 specifically
  removed the standalone "activate now, finalize later" shape for the human case).

## Constraints

- No duplicate Git implementation and no duplicate crash-recovery implementation — reuse
  `commit-and-push` and `operation-record.mjs`'s actually-exported persistence primitives
  exactly as `finish-operation.mjs` already does; Publish's own record-shaping helper
  (`createOperationRecord`-shaped but locally defined, since the real one is private to
  `finish-operation.mjs`) is a small, honest duplication of a ~10-line shape function, not of
  any git-state-reconciliation logic.
- No new doc file for the taxonomy (D3's precedent: extend the existing section).
- Batch Publish prevalidates every selected task before any mutation — no partial-batch
  mutation under any failure ordering.

## Interfaces and boundaries

Exposes: `publishTask()`'s corrected return contract (now implies a clean worktree on
success); the documented three-category taxonomy.

Consumed by: the dashboard's Publish/Batch Publish UI actions; future dashboard actions,
which must classify themselves against the taxonomy before being built.

## Area-specific acceptance criteria

- After a successful `workflow task publish`, `git status` shows no uncommitted change to
  `change.yaml` (when the resolved `sourceControl` config enables commit) — proven by an
  integration test that runs publish against a real worktree and inspects git state
  afterward, not by mocking the commit call.
- The generated commit message matches `chore(workflow): publish <task-id>` exactly, with no
  user-supplied message required or accepted for this action.
- A crash simulated between the durable-record write and the commit landing is reconciled on
  the next `publishTask()` invocation the same way `finish-operation.mjs`'s own stages
  reconcile an ambiguous intent — resumed, no-op, or a clear `reconciliation-required` error,
  never a silent guess.
- Batch Publish where one of three selected tasks fails prevalidation publishes **none** of
  the three — proven directly, not merely asserted.
- `docs/development/agent-workflow-protocol.md` states the three-category taxonomy with the
  concrete examples above, extending the existing section (`git diff` shows no new top-level
  heading/file).
- A concurrently-running agent `finishStep` for a different task in the same change waits for
  `withGitFinalizeLock` rather than committing while Publish's own mutation is uncommitted —
  proven by racing the two directly.
- Publish attempted while an agent execution actively holds the workspace-writer slot (source
  files genuinely dirty from that agent's own in-progress edits) waits for the slot rather
  than proceeding, never fails with a scope error caused by the agent's own unrelated dirty
  files, and never observes/absorbs the agent's own uncommitted `change.yaml` state; once the
  agent's execution releases the slot, the waiting Publish proceeds and completes normally.
- Calling `publishTask()` directly (no dashboard route, no CLI wrapper) still waits for an
  active agent's workspace-writer claim and never absorbs its dirty state — proving the
  arbitration lives inside `publishTask()` itself, not only in the dashboard route or the CLI
  handler.
- Publish for spec B waits while an agent execution for a **different** spec, A, actively
  holds the workspace-writer slot, because both share the same physical worktree (D65) —
  proven directly, not merely for the same-spec case.
- A Publish request waiting on an active agent that later fails/cancels with dirty,
  un-finalized state (moving the claim to `recovery-required` rather than releasing it, D59)
  reports `blocked-by-recovery`, not a timeout failure, and remains pending rather than
  erroring out.
- **Claim held through `push`, not just commit (D68):** a second writer attempting to acquire
  the workspace-writer slot while Publish has committed but not yet pushed still waits — proven
  by holding `push` open (a controllable fake remote/test double) and asserting the second
  writer has not acquired the slot until after `push` completes and the durable record reaches
  `completed`.
- **Ownership-conditional release (D70):** a delayed reconciliation call carrying a *previous*
  Publish attempt's own captured `ownerId`, run after that attempt's claim was already released
  and a different operation has since acquired it, is rejected as `not-current-owner` and does
  not touch the new operation's claim.
- **Durable request survives restart (D72/D75):** a Publish whose workspace-request is still
  `queued`/`waiting-for-workspace` when the dashboard restarts is rediscovered afterward with
  identical content and resumes contending for the slot, never silently lost; a `running`
  request whose underlying Publish operation actually completed is reconciled to `completed`,
  never re-published.
- **No duplicated state machine (D76):** the workspace-request's own status never disagrees
  with Publish's own durable operation record — proven by asserting the request reaches
  `completed` if and only if the operation record does, for both the success and the
  `reconciliation-required` paths.

## Dependencies

`dependency-release-and-invalidation` (task 27 — the `git-finalize-lock.mjs`,
`workspace-writer.mjs`, and `workspace-request.mjs` this area's Publish path acquires/creates,
D47/D55/D56/D72); otherwise reuses the existing `commit-and-push` action and
`operation-record.mjs` primitives directly.

## Out of scope

Redesigning `commit-and-push` itself. Any change to `finishStep`'s own finalize sequence.
Retroactively re-classifying every existing dashboard action against the new taxonomy (this
area documents the taxonomy and fixes the one action it names — Publish — not an audit of
every other action). The workspace-writer/workspace-request primitives themselves and their
ownership-conditional/reconciliation mechanics (task 27, D70/D72/D75 — this area only calls
them). The dispatch-priority policy between a pending Publish and the next automatic agent item
(owned by
task 27 and task 29 respectively, D55/D56/D57).
