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
  - tools/specs/store.mjs
  - src/**
depends_on: []
semantic_references:
  decisions: [D29, D30]
---

# Task: User-mutation source-control finalization

## Goal

Make `workflow task publish`/Batch Publish own their own Git mutation (D29): validate →
mutate → commit → push (per the resolved `sourceControl` config), reusing the existing,
already-registered `commit-and-push` action, with an auto-generated commit message — and
document the three-way user-action/technical-activation/completed-mutation ownership
taxonomy (D30) in `docs/development/agent-workflow-protocol.md`'s existing ownership section.

## Implementation constraints

- `publishTask()` (`publish/operation.mjs`): after `setTaskStatus(change, taskId,
  'approved')` succeeds, invoke the existing `defaultActionRegistry.require('commit-and-push')`
  action (the same one `finish-operation.mjs` already calls) with an auto-generated commit
  title, `chore(workflow): publish <task-id>` — do not build a second Git implementation.
  Respect the resolved `workflow.sourceControl` config's `enabled`/`push` flags exactly as
  `finish-operation.mjs` already does for the same config.
- Extend `handleBatchPublish` (`routes.mjs`) the same way for multiple tasks in one call —
  either one combined commit naming all published task ids, or one commit per task (pick one,
  document the choice; do not leave partial application undefined — either all named tasks'
  mutations commit together or the operation reports the failure with the worktree left in
  the same class of dirty state `commit-and-push`'s own failure mode already produces).
- Do not change `setTaskStatus`'s own behavior or `store.mjs` (forbidden path) — this task
  only sequences the existing mutation with the existing commit action.
- Extend `docs/development/agent-workflow-protocol.md`'s existing ownership-boundaries
  section (do not create a new file, per D3's precedent) with the three categories from D30,
  using Publish/`workflow step start`/`submitHumanStepResult` as the worked examples.

## Acceptance criteria

- After a successful `workflow task publish` against a real worktree (with `sourceControl`
  enabled), `git status` shows no uncommitted change to `change.yaml` — proven by an
  integration test running publish against a real temporary worktree, not a mocked commit
  call.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- The generated commit message is exactly `chore(workflow): publish <task-id>` — no
  user-supplied message is required or accepted for this call.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- A forced `commit-and-push` failure after the `setTaskStatus` mutation leaves the worktree
  in the same class of dirty state `finish-operation.mjs`'s own equivalent failure already
  produces — proven by forcing the failure and inspecting the resulting state, not merely
  asserting no crash.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Batch Publish of two tasks commits both `change.yaml` mutations together (or, if the
  per-task-commit choice was made, both commits land) — proven end to end.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- `docs/development/agent-workflow-protocol.md`'s existing ownership section states the
  three-category taxonomy with Publish/`workflow step start`/`submitHumanStepResult` as
  examples — `git diff` shows an extension of the existing section, not a new top-level
  heading/file. `automated: node tools/docs.mjs validate`

## Verification

```bash
node --test tools/tests/workflow-task-publish.test.mjs
node tools/docs.mjs validate
node tools/specs.mjs validate
```

## Out of scope

Redesigning `commit-and-push` itself. Any change to `finishStep`'s own finalize sequence.
Retroactively re-classifying every other existing dashboard action against the new taxonomy.
