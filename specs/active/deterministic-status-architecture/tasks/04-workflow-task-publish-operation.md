---
id: deterministic-status-architecture.workflow-task-publish-operation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-task-publish.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/publish/**
  - tools/specs/workflow/cli.mjs
  - tools/specs.mjs
  - tools/tests/workflow-task-publish.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
depends_on: [ deterministic-mutation-guard ]
---

# Task: `workflow task publish` operation

## Goal

Add `workflow task publish <change> <task>` as an independent deterministic operation that
marks a draft, valid, dependency-clean, not-yet-started task ready for execution — without
calling or inheriting legacy `approveTask`'s review/fingerprint semantics.

## Dependencies

`deterministic-mutation-guard` — this operation reuses that task's established
`resolveWorkflowMode()` guard pattern (deterministic specs only).

## Implementation constraints

- New operation module (e.g. `tools/specs/workflow/publish/operation.mjs`), wired into the
  existing `workflow` CLI subcommand group in `tools/specs.mjs`/`tools/specs/workflow/cli.mjs`
  — do not create a new top-level CLI command outside the `workflow` group.
- Validate, in order: spec resolves to deterministic (guard); task exists; task's own
  `status` is `draft`; task definition validates (reuse existing validation logic, e.g. from
  `tools/specs.mjs validate`'s task-level checks, rather than re-implementing it);
  `depends_on` entries all resolve to real tasks in the same change; no `workflow_progress`
  exists yet for this task.
- On success: write `task.status: approved` as the one exception this task is permitted to
  make to "agents/operations don't hand-edit lifecycle fields" — this is the new,
  independent, deterministic-scoped write path itself (via `tools/specs/store.mjs`'s
  existing `setTaskStatus`, not a hand edit), not a call into `approveTask`.
- Must not commit unrelated repository changes; publication and Git-commit semantics stay
  separate (unlike legacy `approve`, which commits/pushes).
- Do not import `tools/specs/approve/operation.mjs` or any other legacy mutation module.

## Acceptance criteria

- Publishing a draft, valid, dependency-clean, not-started task succeeds and writes
  `status: approved`. `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publishing does not call/reuse legacy `approveTask` — asserted by grepping/inspecting the
  publish operation module for any import of `tools/specs/approve/operation.mjs` (brief
  regression test #5). `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publishing a task with a validation error, an unresolved `depends_on` entry, or an
  already-started workflow (`workflow_progress` present) fails clearly and writes nothing.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publishing against a legacy spec fails via the deterministic-mode guard, before any
  mutation. `automated: node --test tools/tests/workflow-task-publish.test.mjs`
- Publishing does not commit or push any repository change.
  `automated: node --test tools/tests/workflow-task-publish.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-task-publish.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

CLI help text for the `workflow` command group in `tools/specs.mjs` gains the new
`task publish` subcommand's usage line.

## Out of scope

The pre-execution product wording ("Draft"/"Ready"/"Published") in the UI — that's the
dashboard areas' concern, reading this operation's resulting state. Any Git-commit step for
publication (explicitly deferred).
