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
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/server/specs/routes.mjs
  - docs/development/agent-workflow-protocol.md
  - tools/tests/workflow-task-publish.test.mjs
forbidden_paths:
  - tools/specs/store.mjs
  - src/**
depends_on: []
semantic_references:
  decisions: [D29, D30]
---

# Task: User-mutation source-control finalization (corrected — durable operation, atomic batch)

## Goal

Make `workflow task publish`/Batch Publish durable standalone operations (D29, corrected):
`CommitAndPushAction` alone does not inherit `finishStep`'s crash/resume semantics — those
come from `operation-record.mjs`'s intent-then-verify pattern. `publishTask()` reuses that
same pattern directly. Batch Publish is one atomic operation (prevalidate all → mutate all →
one commit → optional push), not one commit per task. Document the three-way ownership
taxonomy (D30) in `docs/development/agent-workflow-protocol.md`'s existing section.

## Implementation constraints

- `publishTask()` (`publish/operation.mjs`): after validation, write a durable intent record
  via `operation-record.mjs`'s existing primitives (`createOperationRecord`/
  `saveOperationRecord`) at
  `.nevo-ai-local/workflow-operations/<change>/<task>/publish/attempt-<n>.json` with stages
  `['validate', 'update-task', 'commit', 'push']`. Investigate whether
  `finish-operation.mjs`'s own `ensureCommit`/`ensurePush` stage functions are already generic
  enough to call directly for this new stage sequence; if not, extract the minimal shared
  logic into functions both `finishStep` and `publishTask` call — do not duplicate the
  git-state-reconciliation/intent-verification logic a second time. Then mutate
  (`setTaskStatus`), commit (`chore(workflow): publish <task-id>`), push (per resolved
  `sourceControl` config), and mark the record `completed`.
- On the next `publishTask()` invocation, resume from any `findInFlightOperationRecord`
  result exactly as `finish-operation.mjs`'s own `planFinish` does — reconcile an ambiguous
  `running` stage against real repository/task state (resume, no-op, or fail closed with
  `reconciliation-required`), never guess.
- **Batch Publish, atomic (corrected — was previously undecided).** Extend `handleBatchPublish`
  (`routes.mjs`): prevalidate every selected task first (reuse `publishTask()`'s own
  validation logic without its mutation/commit stages); only if all pass, write **one**
  durable record spanning the whole set at
  `.nevo-ai-local/workflow-operations/<change>/_batch-publish/attempt-<n>.json`; mutate every
  selected task's status; one deterministic combined commit (`chore(workflow): publish
  <id-1>, <id-2>, ...`, bounded/summarized if long); optional push. If any task fails
  prevalidation, mutate none and commit nothing.
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

## Verification

```bash
node --test tools/tests/workflow-task-publish.test.mjs
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Redesigning `commit-and-push` itself. Any change to `finishStep`'s own finalize sequence
beyond extracting shared stage functions if genuinely needed. Retroactively re-classifying
every other existing dashboard action against the new taxonomy.
