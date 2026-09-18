---
id: deterministic-status-architecture.deterministic-cli-default-task-resolution
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-task-publish.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/cli.mjs
  - tools/tests/deterministic-cli-default-task-resolution.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ deterministic-mutation-guard ]
semantic_references:
  decisions: [D2]
---

# Task: Deterministic CLI default-task resolution

## Goal

Remove `resolveDefaultTask()`'s reliance on legacy `status === 'in-implementation'` for
resolving an omitted task id on deterministic commands, per `owner-decisions.md` D2:
require an explicit task id instead, with no new "in-flight" state introduced.

## Dependencies

`deterministic-mutation-guard` — both tasks touch `tools/specs/workflow/cli.mjs`; this task
builds on that one's guard being in place first to avoid conflicting edits to the same file.

## Implementation constraints

- Delete `resolveDefaultTask()`'s legacy-status-scanning logic entirely — do not replace it
  with any new deterministic "active task" derivation (D2 explicitly defers that).
- `workflow step start`/`workflow step finish`/the human-decision operation invoked without
  a task id on a deterministic spec must fail with a clear "task id required" error naming
  the command's correct usage.
- Update the CLI help text in `tools/specs.mjs`/`tools/specs/workflow/cli.mjs` that
  currently documents the old fallback ("Defaults to the change's one in-implementation task
  when omitted").

## Acceptance criteria

- `workflow step start <change>` (task id omitted) on a deterministic spec fails with a
  clear "task id required" error, regardless of how many tasks are `in-implementation`.
  `automated: node --test tools/tests/deterministic-cli-default-task-resolution.test.mjs`
- `workflow step finish <change>` and the human-decision operation (task id omitted) fail
  identically. `automated: node --test tools/tests/deterministic-cli-default-task-resolution.test.mjs`
- `workflow step start <change> <task>` (task id given) is unaffected — no behavior change
  when the task id is explicit. `automated: node --test tools/tests/deterministic-cli-default-task-resolution.test.mjs`
- No reference to legacy `status === 'in-implementation'` remains in
  `tools/specs/workflow/cli.mjs`'s default-task resolution.
  `automated: node --test tools/tests/deterministic-cli-default-task-resolution.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-cli-default-task-resolution.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

A future deterministic "in-flight task" convenience concept (D2 explicitly defers this).
