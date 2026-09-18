---
id: deterministic-status-architecture.deterministic-mutation-guard
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/lifecycle-boundary-guards.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/cli.mjs
  - tools/tests/deterministic-mutation-guard.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
---

# Task: Deterministic mutation guard

## Goal

Make `workflow step start`/`workflow step finish`/`workflow verify-human` each refuse to
run against a legacy spec, before any state write, using the same
`resolveWorkflowMode()` classifier the legacy guard task consumes.

## Implementation constraints

- Add an explicit guard at the entry of `handleWorkflowStepStart`/`handleWorkflowStepFinish`/
  `handleWorkflowVerifyHuman` (`tools/specs/workflow/cli.mjs`), before
  `resolveWorkflowRuntime`/`compileStepContext`/`finishStep` run — do not rely on whatever
  incidental failure currently happens when a legacy spec lacks a workflow definition;
  the failure must be an explicit, clearly-worded guard, not an implicit crash.
- Import only `resolveWorkflowMode()` — do not import anything from
  `tools/specs/{approve,start,complete,verify}/**`.
- Error message must name the spec as legacy and name the legacy command surface
  (`approve`/`start`/`complete`/`verify`) to use instead.

## Acceptance criteria

- `workflow step start <change> <task>` against a spec with no `workflow` field fails with
  a clear, legacy-aware error and `change.yaml` is unchanged. `automated: node --test tools/tests/deterministic-mutation-guard.test.mjs`
- `workflow step start <change> <task>` against a spec with explicit `workflow.mode: legacy`
  fails identically, unchanged `change.yaml`. `automated: node --test tools/tests/deterministic-mutation-guard.test.mjs`
- `workflow step finish <change> <task>` and `workflow verify-human <change> <task>` against
  both legacy variants above each fail identically. `automated: node --test tools/tests/deterministic-mutation-guard.test.mjs`
- A spec with `workflow.mode: deterministic` is unaffected — all three commands behave
  exactly as before this task. `automated: node --test tools/tests/deterministic-mutation-guard.test.mjs`
- Existing deterministic-engine test suites (`workflow-cli.test.mjs`, `workflow-e2e.test.mjs`,
  `workflow-compatibility.test.mjs`) continue passing unchanged.
  `automated: node --test tools/tests/workflow-cli.test.mjs tools/tests/workflow-e2e.test.mjs tools/tests/workflow-compatibility.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-mutation-guard.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/workflow-compatibility.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The reverse guard (legacy commands against a deterministic spec) — task
`legacy-mutation-guard`. The new `workflow task publish` operation's own guard — task
`workflow-task-publish-operation` (reuses this task's established guard pattern).
