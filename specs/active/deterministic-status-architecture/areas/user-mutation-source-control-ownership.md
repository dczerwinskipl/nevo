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
  `.nevo-ai-local/workflow-operations/<change>/<task>/publish/attempt-<n>.json` record, same
  convention/primitives `operation-record.mjs` already defines — `createOperationRecord`/
  `saveOperationRecord`/`findInFlightOperationRecord` reused directly) → mutate
  (`setTaskStatus`) → commit → push (only if the resolved `sourceControl` config enables it)
  → mark the record completed. Stages mirror `finish-operation.mjs`'s own
  `ensureUpdateTask`/`ensureCommit`/`ensurePush` intent-then-verify shape — extract these as
  shared functions callable from both `finishStep` and `publishTask` rather than
  reimplementing git-state reconciliation a second time.
- **Deterministic commit message.** Auto-generate `chore(workflow): publish <task-id>` for a
  single-task publish.
- **Batch Publish is one atomic operation, not one commit per task (D29, corrected —
  previously left undecided).** One dashboard "Publish selected tasks" action is one durable
  operation record spanning the whole selected set
  (`.nevo-ai-local/workflow-operations/<change>/_batch-publish/attempt-<n>.json`, a reserved
  pseudo-task-id since the record spans multiple real tasks): prevalidate **every** selected
  task first; only if all pass does mutation begin; mutate every selected task's status; one
  deterministic combined commit (e.g. `chore(workflow): publish <id-1>, <id-2>, ...`, bounded/
  summarized if the list is long) → optional push. If any task fails prevalidation, **none**
  are published — no partial-batch mutation. Never prompt the user for a commit message for
  either the single-task or batch case.
- **Clean-worktree guarantee preserved.** A durable record left `running` after a crash is
  reconciled the same way `finish-operation.mjs`'s own stages already reconcile an ambiguous
  intent (compare persisted `intent` against real repository/task state; resume, no-op, or
  fail closed with `reconciliation-required` — never guess).
- **Ownership taxonomy documented (D30).** Extend `docs/development/agent-workflow-protocol.md`'s
  existing ownership-boundaries section (no new doc file, per D3's precedent) with three
  explicit categories: (1) standalone user-originated Git-tracked mutation (must finalize its
  own commit/push — e.g. Publish); (2) technical activation that is part of an execution
  attempt (may remain part of that attempt, finalized by its own
  `workflow step finish`/`submitHumanStepResult` — e.g. `workflow step start`, human-step
  auto-activation); (3) completed lifecycle mutation (already owns its own finalize,
  unchanged — e.g. `submitHumanStepResult`, `finishStep`).

## Constraints

- No duplicate Git implementation and no duplicate crash-recovery implementation — reuse
  `commit-and-push` and `operation-record.mjs`'s primitives exactly as `finish-operation.mjs`
  already does; extract shared stage functions if `finish-operation.mjs`'s own
  `ensureCommit`/`ensurePush` aren't already generic enough to call directly.
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

## Dependencies

None among this change's own prior tasks — reuses the existing `commit-and-push` action and
`operation-record.mjs` primitives directly.

## Out of scope

Redesigning `commit-and-push` itself. Any change to `finishStep`'s own finalize sequence.
Retroactively re-classifying every existing dashboard action against the new taxonomy (this
area documents the taxonomy and fixes the one action it names — Publish — not an audit of
every other action).
