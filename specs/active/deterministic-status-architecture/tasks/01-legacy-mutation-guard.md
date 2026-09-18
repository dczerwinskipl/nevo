---
id: deterministic-status-architecture.legacy-mutation-guard
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/lifecycle-boundary-guards.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/tests/legacy-mutation-guard.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/**
  - src/**
---

# Task: Legacy mutation guard

## Goal

Make `approve`/`start`/`complete`/`verify` each refuse to run against a deterministic spec,
before any state write, using the existing `resolveWorkflowMode()`
(`tools/specs/workflow/compatibility.mjs`) as the one canonical classifier.

## Implementation constraints

- Add a guard call at the start of each of the four operations
  (`tools/specs/{approve,start,complete,verify}/operation.mjs`), before their existing
  `setTaskStatus`/validation logic runs.
- Import only `resolveWorkflowMode()` (a shared, read-only classifier) — do not import
  anything from `tools/specs/workflow/**`'s mutation modules.
- The guard is a small, local addition per operation — do not introduce a shared function
  that branches on legacy-vs-deterministic mutation behavior; each operation keeps its own
  unchanged legacy behavior for the legacy case.
- Error message must name the spec as deterministic and name the deterministic command
  surface (`workflow task publish`/`workflow step start`/`workflow step finish`/
  `workflow verify-human`) to use instead.

## Acceptance criteria

- `approve <change> <task>` against a spec with `workflow.mode: deterministic` fails with a
  clear error and `change.yaml` is unchanged (byte-for-byte). `automated: node --test tools/tests/legacy-mutation-guard.test.mjs`
- `start <change> <task>` against the same deterministic spec fails identically, unchanged
  `change.yaml`. `automated: node --test tools/tests/legacy-mutation-guard.test.mjs`
- `complete <change> <task>` and `verify <change> <task>` against the same deterministic
  spec each fail identically, unchanged `change.yaml`. `automated: node --test tools/tests/legacy-mutation-guard.test.mjs`
- A spec with no `workflow` field, and a spec with explicit `workflow.mode: legacy`, are
  unaffected — `approve`/`start`/`complete`/`verify` behave exactly as before this task for
  both. `automated: node --test tools/tests/legacy-mutation-guard.test.mjs`
- Existing legacy test suites (`task-lifecycle.test.mjs`, `start.test.mjs`,
  `approve-git-sync.test.mjs`, `finalize.test.mjs`) continue passing unchanged.
  `automated: node --test tools/tests/task-lifecycle.test.mjs tools/tests/start.test.mjs tools/tests/approve-git-sync.test.mjs tools/tests/finalize.test.mjs`

## Verification

```bash
node --test tools/tests/legacy-mutation-guard.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node --test tools/tests/start.test.mjs
node --test tools/tests/approve-git-sync.test.mjs
node --test tools/tests/finalize.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The reverse guard (deterministic commands against a legacy spec) — task
`deterministic-mutation-guard`. The import-boundary static-analysis test — task
`lifecycle-boundary-regression-tests`.
