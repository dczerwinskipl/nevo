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
  - tools/specs/store.mjs
  - src/**
depends_on: [ dependency-release-and-invalidation ]
semantic_references:
  decisions: [D29, D30, D47]
---

# Task: User-mutation source-control finalization (corrected — durable operation, atomic batch)

## Goal

Make `workflow task publish`/Batch Publish durable standalone operations (D29, corrected):
`CommitAndPushAction` alone does not inherit `finishStep`'s crash/resume semantics — those
come from `operation-record.mjs`'s intent-then-verify pattern. `publishTask()` reuses that
same pattern directly. Batch Publish is one atomic operation (prevalidate all → mutate all →
one commit → optional push), not one commit per task. Additionally acquire the shared
`withGitFinalizeLock` (task 27, D47) around the mutate-then-commit sequence, so a
concurrently-running agent `finishStep` for a different task in the same change (legal under
D45) cannot sweep Publish's own uncommitted mutation into its own commit. Document the
three-way ownership taxonomy (D30) in `docs/development/agent-workflow-protocol.md`'s
existing section.

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
- **Acquire the shared git-finalize lock (D47).** Import `withGitFinalizeLock` from
  `tools/specs/workflow/git-finalize-lock.mjs` (task 27, import only — forbidden path to
  edit) and wrap the mutate-then-commit sequence (from `setTaskStatus` through the commit
  call) in it, for both single-task and Batch Publish. This is the same lock agent-driven
  `finishStep` and the new combined human-decision operation acquire.
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

## Verification

```bash
node --test tools/tests/workflow-task-publish.test.mjs
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Redesigning `commit-and-push` itself. Any change whatsoever to `finish-operation.mjs`/
`operation-record.mjs`/`git-finalize-lock.mjs` — this task only calls their existing,
genuinely-exported functions, never edits them. Retroactively re-classifying every other
existing dashboard action against the new taxonomy.
